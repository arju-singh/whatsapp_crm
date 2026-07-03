// ---------------------------------------------------------------------------
// Record Service — the runtime engine behind tenant-defined objects.
//
// Given a tenant's FIELD_DEFINITIONs, this validates record data, enforces
// required/unique/type rules, and compiles a tenant's filter into safe,
// parameterised SQL over the record's JSON `data` column (SQLite JSON1). It is
// schema-agnostic: the same code drives a `Property`, a `Patient`, or a
// `Shipment` object. Storage is the hybrid model from the architecture doc —
// system columns (id, organization_id, object_id, owner_id, stage_id, …) as real
// columns; tenant-defined fields in the JSON `data` column.
//
// Safety: field api_names are validated to ^[a-z][a-z0-9_]*$ at creation, so
// inlining them into a json_extract path is injection-safe; all VALUES are bound
// parameters, never concatenated.
// ---------------------------------------------------------------------------

const API_NAME_RE = /^[a-z][a-z0-9_]*$/;

const DATA_TYPES = new Set([
  'text', 'textarea', 'number', 'boolean', 'date',
  'email', 'phone', 'picklist', 'multipicklist', 'lookup',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidApiName(s) {
  return typeof s === 'string' && API_NAME_RE.test(s) && s.length <= 64;
}

function parseJson(s, fallback) {
  if (s == null || s === '') return fallback;
  try { return JSON.parse(s); } catch (_) { return fallback; }
}

// Coerce + validate a single value against its field definition.
// Returns { value } on success or { error } on failure. `value` is the storage
// form (string/number/0|1/array). Empty values are handled by the caller.
function coerceValue(field, raw, db, orgId) {
  const v = field.validation ? parseJson(field.validation, {}) : {};
  const opts = field.options ? parseJson(field.options, {}) : {};
  switch (field.data_type) {
    case 'text':
    case 'textarea': {
      const s = String(raw);
      const max = v.maxLength || (field.data_type === 'textarea' ? 10000 : 255);
      if (s.length > max) return { error: `too_long (max ${max})` };
      if (v.pattern) { try { if (!new RegExp(v.pattern).test(s)) return { error: 'pattern_mismatch' }; } catch (_) {} }
      return { value: s };
    }
    case 'number': {
      const n = Number(raw);
      if (Number.isNaN(n)) return { error: 'not_a_number' };
      if (v.min != null && n < v.min) return { error: `below_min (${v.min})` };
      if (v.max != null && n > v.max) return { error: `above_max (${v.max})` };
      return { value: n };
    }
    case 'boolean':
      return { value: (raw === true || raw === 'true' || raw === 1 || raw === '1') ? 1 : 0 };
    case 'date': {
      const n = typeof raw === 'number' ? raw : Date.parse(raw);
      if (Number.isNaN(n)) return { error: 'invalid_date' };
      return { value: n };
    }
    case 'email': {
      const s = String(raw).trim();
      if (!EMAIL_RE.test(s)) return { error: 'invalid_email' };
      return { value: s };
    }
    case 'phone': {
      const s = String(raw).replace(/[^\d+]/g, '');
      if (s.replace(/\D/g, '').length < 6) return { error: 'invalid_phone' };
      return { value: s };
    }
    case 'picklist': {
      const allowed = opts.values || [];
      if (!allowed.includes(raw)) return { error: 'not_in_picklist' };
      return { value: raw };
    }
    case 'multipicklist': {
      const allowed = opts.values || [];
      const arr = Array.isArray(raw) ? raw : [raw];
      for (const x of arr) if (!allowed.includes(x)) return { error: `not_in_picklist: ${x}` };
      return { value: arr };
    }
    case 'lookup': {
      const targetId = Number(raw);
      if (!Number.isInteger(targetId)) return { error: 'invalid_lookup_id' };
      // Referential integrity: the target must be a live record of the target
      // object in the same org.
      const target = opts.target_object_id;
      if (target && db) {
        const row = db.prepare(
          `SELECT id FROM meta_records WHERE id = ? AND object_id = ? AND organization_id = ? AND deleted_at IS NULL`,
        ).get(targetId, target, orgId);
        if (!row) return { error: 'lookup_target_not_found' };
      }
      return { value: targetId };
    }
    default:
      return { error: 'unknown_type' };
  }
}

// Validate an incoming record payload against the object's fields.
// opts.partial = true skips "required" checks for fields not present (PATCH).
// Returns { ok, errors, data } where data is the cleaned JSON object to store.
function validateRecord(fields, payload, { partial = false, db, orgId } = {}) {
  const errors = {};
  const data = {};
  const byName = {};
  for (const f of fields) byName[f.api_name] = f;

  for (const f of fields) {
    const present = Object.prototype.hasOwnProperty.call(payload, f.api_name);
    const raw = payload[f.api_name];
    const empty = raw === undefined || raw === null || raw === '';

    if (empty) {
      if (f.required && !partial) errors[f.api_name] = 'required';
      continue; // don't store empty values
    }
    const r = coerceValue(f, raw, db, orgId);
    if (r.error) errors[f.api_name] = r.error;
    else data[f.api_name] = r.value;
  }
  return { ok: Object.keys(errors).length === 0, errors, data };
}

// Unique-constraint enforcement for fields flagged is_unique. Checks the cleaned
// data against live records of the same object/org. excludeId skips self (PATCH).
function checkUnique(db, orgId, objectId, fields, data, excludeId = null) {
  const errors = {};
  for (const f of fields) {
    if (!f.is_unique) continue;
    if (!Object.prototype.hasOwnProperty.call(data, f.api_name)) continue;
    // api_name is validated safe; value is bound.
    const sql = `
      SELECT id FROM meta_records
      WHERE organization_id = @orgId AND object_id = @objectId AND deleted_at IS NULL
        AND json_extract(data, '$.${f.api_name}') = @val
        ${excludeId ? 'AND id != @excludeId' : ''}
      LIMIT 1`;
    const hit = db.prepare(sql).get({ orgId, objectId, val: data[f.api_name], excludeId });
    if (hit) errors[f.api_name] = 'not_unique';
  }
  return errors;
}

// Compile a tenant filter into a parameterised WHERE fragment over `data`.
// `filter` is an array of { field, op, value }. Supported ops:
//   eq ne gt gte lt lte contains starts in
// Unknown fields/ops are ignored (defensive). Returns { sql, params }.
const OPS = { eq: '=', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

function compileFilter(fields, filter) {
  const byName = {};
  for (const f of fields) byName[f.api_name] = f;
  const clauses = [];
  const params = {};
  let i = 0;
  for (const cond of Array.isArray(filter) ? filter : []) {
    const f = cond && byName[cond.field];
    if (!f || !isValidApiName(f.api_name)) continue;
    const path = `json_extract(data, '$.${f.api_name}')`; // api_name is safe
    const key = `f${i++}`;
    const op = cond.op || 'eq';
    if (OPS[op]) {
      clauses.push(`${path} ${OPS[op]} @${key}`);
      params[key] = cond.value;
    } else if (op === 'contains') {
      clauses.push(`${path} LIKE @${key}`);
      params[key] = `%${cond.value}%`;
    } else if (op === 'starts') {
      clauses.push(`${path} LIKE @${key}`);
      params[key] = `${cond.value}%`;
    } else if (op === 'in' && Array.isArray(cond.value)) {
      const keys = cond.value.map((val, j) => { const k = `${key}_${j}`; params[k] = val; return `@${k}`; });
      if (keys.length) clauses.push(`${path} IN (${keys.join(', ')})`);
    }
  }
  return { sql: clauses.join(' AND '), params };
}

// Flatten a stored record row into the API shape: system columns + the
// tenant-defined fields merged up to the top level.
function presentRecord(row) {
  if (!row) return null;
  const data = parseJson(row.data, {});
  return {
    id: row.id,
    object_id: row.object_id,
    owner_id: row.owner_id,
    stage_id: row.stage_id,
    visibility: row.visibility, // per-record override (null → object default)
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...data,
  };
}

module.exports = {
  API_NAME_RE, DATA_TYPES, isValidApiName, parseJson,
  coerceValue, validateRecord, checkUnique, compileFilter, presentRecord,
};
