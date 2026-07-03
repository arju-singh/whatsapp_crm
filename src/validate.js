// Dependency-free, schema-based request validation & sanitization.
//
// Security model (OWASP ASVS V5 "Validation, Sanitization & Encoding"):
//   * Positive validation (allowlist) — a schema declares EXACTLY which fields
//     are accepted and their type/shape. Anything not in the schema is rejected
//     by default (mass-assignment / parameter-pollution defence).
//   * Type coercion + bounds — every value is coerced to its declared type and
//     checked against length/range/enum/pattern limits, so handlers never see a
//     surprise type (e.g. an object where a string was expected).
//   * Sanitization — strings are trimmed and stripped of ASCII control chars
//     (except tab/newline) to neutralise log-injection and stray null bytes.
//
// Usage (as Express middleware):
//   const { body, query, S } = require('../validate');
//   router.post('/', body({
//     name:  S.string({ required: true, max: 200 }),
//     email: S.email({ max: 200 }),
//     age:   S.int({ min: 0, max: 150 }),
//     role:  S.enum(['user', 'admin']),
//   }), handler);
//
// On success the cleaned object replaces req.body (and is also available as
// req.valid). On failure the middleware responds 400 with a field-level report
// and never reaches the handler.

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function cleanString(s, { trim = true } = {}) {
  let out = String(s).replace(CONTROL_CHARS, '');
  if (trim) out = out.trim();
  return out;
}

// ---- Per-type validators ---------------------------------------------------
// Each returns { ok: true, value } or { ok: false, error }. They receive the
// raw value (already known to be non-undefined) and the field spec.

const TYPES = {
  string(value, spec) {
    if (typeof value === 'object') return { ok: false, error: 'must_be_string' };
    let v = cleanString(value, spec);
    if (spec.lower) v = v.toLowerCase();
    if (spec.minLength != null && v.length < spec.minLength) return { ok: false, error: `min_length_${spec.minLength}` };
    const max = spec.maxLength != null ? spec.maxLength : 10000; // hard default cap
    if (v.length > max) return { ok: false, error: `max_length_${max}` };
    if (spec.pattern && !spec.pattern.test(v)) return { ok: false, error: 'invalid_format' };
    return { ok: true, value: v };
  },

  int(value, spec) {
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: 'must_be_integer' };
    if (spec.min != null && n < spec.min) return { ok: false, error: `min_${spec.min}` };
    if (spec.max != null && n > spec.max) return { ok: false, error: `max_${spec.max}` };
    return { ok: true, value: n };
  },

  number(value, spec) {
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n)) return { ok: false, error: 'must_be_number' };
    if (spec.min != null && n < spec.min) return { ok: false, error: `min_${spec.min}` };
    if (spec.max != null && n > spec.max) return { ok: false, error: `max_${spec.max}` };
    return { ok: true, value: n };
  },

  bool(value) {
    if (typeof value === 'boolean') return { ok: true, value };
    if (value === 'true' || value === 1 || value === '1') return { ok: true, value: true };
    if (value === 'false' || value === 0 || value === '0') return { ok: true, value: false };
    return { ok: false, error: 'must_be_boolean' };
  },

  // Accepts boolean-ish OR 0/1 and returns 0/1 — matches the SQLite columns that
  // store flags as integers (active, completed, stop_on_reply, ...).
  flag(value) {
    const r = TYPES.bool(value);
    if (!r.ok) return r;
    return { ok: true, value: r.value ? 1 : 0 };
  },

  enum(value, spec) {
    const v = cleanString(value);
    if (!spec.values.includes(v)) return { ok: false, error: 'invalid_value' };
    return { ok: true, value: v };
  },

  email(value, spec) {
    const v = cleanString(value, spec).toLowerCase();
    if (v.length > (spec.maxLength || 254)) return { ok: false, error: 'max_length_254' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok: false, error: 'invalid_email' };
    return { ok: true, value: v };
  },

  // Identifier — digits only (DB row ids come through req.params/body as strings).
  id(value) {
    const v = cleanString(value);
    if (!/^[0-9]+$/.test(v)) return { ok: false, error: 'invalid_id' };
    return { ok: true, value: v };
  },

  array(value, spec) {
    if (!Array.isArray(value)) return { ok: false, error: 'must_be_array' };
    if (spec.maxItems != null && value.length > spec.maxItems) return { ok: false, error: `max_items_${spec.maxItems}` };
    if (spec.of) {
      const out = [];
      for (const item of value) {
        const r = validateField(spec.of, item);
        if (!r.ok) return { ok: false, error: `item_${r.error}` };
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    return { ok: true, value };
  },

  // Free-form object — only used where a route genuinely needs nested JSON
  // (e.g. analytics props). Size is bounded by the JSON body limit upstream.
  object(value) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'must_be_object' };
    return { ok: true, value };
  },
};

// Validate a single value against a spec (handles type dispatch only; required/
// default handling lives in the schema runner).
function validateField(spec, value) {
  const fn = TYPES[spec.type];
  if (!fn) throw new Error(`validate: unknown field type "${spec.type}"`);
  return fn(value, spec);
}

// ---- Schema runner ---------------------------------------------------------
// data: the object to validate (req.body / req.query)
// schema: { fieldName: spec }
// opts.unknown: 'reject' (default) | 'strip' — how to treat keys not in schema.
function runSchema(data, schema, { unknown = 'reject' } = {}) {
  const src = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  const out = {};
  const errors = {};

  // Reject unexpected fields up-front (allowlist enforcement).
  if (unknown === 'reject') {
    for (const key of Object.keys(src)) {
      if (!Object.prototype.hasOwnProperty.call(schema, key)) {
        errors[key] = 'unexpected_field';
      }
    }
  }

  for (const [name, spec] of Object.entries(schema)) {
    const present = Object.prototype.hasOwnProperty.call(src, name);
    let value = present ? src[name] : undefined;

    // Treat empty string / null as "absent" so optional fields stay optional.
    const blank = value == null || value === '';
    if (!present || blank) {
      if (spec.required) { errors[name] = 'required'; continue; }
      if (spec.default !== undefined) out[name] = spec.default;
      else if (present) out[name] = spec.nullable === false ? value : null;
      continue;
    }

    const r = validateField(spec, value);
    if (!r.ok) { errors[name] = r.error; continue; }
    out[name] = r.value;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: out };
}

// ---- Middleware factories --------------------------------------------------
function makeMiddleware(source, schema, opts = {}) {
  return function validateMiddleware(req, res, next) {
    const result = runSchema(req[source], schema, opts);
    if (!result.ok) {
      return res.status(400).json({ error: 'validation_failed', fields: result.errors });
    }
    // Expose the cleaned data. For body we replace it outright (handlers read
    // req.body); for query we attach as req.validatedQuery since req.query is a
    // read-only getter on newer Express.
    req.valid = result.value;
    if (source === 'body') req.body = result.value;
    else req.validatedQuery = result.value;
    next();
  };
}

// body(): strict allowlist by default (reject unknown fields).
function body(schema, opts = {}) {
  return makeMiddleware('body', schema, { unknown: 'reject', ...opts });
}

// query(): strips unknown params by default (URLs often carry cache-busters /
// tracking params we don't want to hard-reject), but still validates known ones.
function query(schema, opts = {}) {
  return makeMiddleware('query', schema, { unknown: 'strip', ...opts });
}

// ---- Schema field shorthands (S) -------------------------------------------
const S = {
  string: (o = {}) => ({ type: 'string', ...o }),
  text: (o = {}) => ({ type: 'string', maxLength: 10000, ...o }),
  int: (o = {}) => ({ type: 'int', ...o }),
  number: (o = {}) => ({ type: 'number', ...o }),
  bool: (o = {}) => ({ type: 'bool', ...o }),
  flag: (o = {}) => ({ type: 'flag', ...o }),
  enum: (values, o = {}) => ({ type: 'enum', values, ...o }),
  email: (o = {}) => ({ type: 'email', ...o }),
  id: (o = {}) => ({ type: 'id', ...o }),
  array: (o = {}) => ({ type: 'array', ...o }),
  object: (o = {}) => ({ type: 'object', ...o }),
};

module.exports = { body, query, runSchema, validateField, S, cleanString };
