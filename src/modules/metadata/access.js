// ---------------------------------------------------------------------------
// Record-level and field-level access for the metadata engine — layers 2 and 3
// of the architecture doc's §5 (layer 1, object/operation RBAC, is requirePerm).
//
//   Record-level: can this user see/edit THIS record? Driven by the record's
//     visibility (public | private), ownership (owner_id), explicit shares
//     (record_shares), and an org-wide override (records.view_all / .edit_all
//     for managers/admins). Enforced as a SQL predicate on list queries and a
//     boolean check on single-record reads/writes, so the API, and anything
//     built on it, all respect the same rule.
//   Field-level: each field may carry read_perm / write_perm. A user lacking the
//     read_perm has the field masked out of responses; lacking write_perm, an
//     attempt to set it is rejected. Checked on read AND write.
//
// ctx = { me: <userId>, role: <effective role>, orgId }. objDefault is the
// object's default visibility (object_definitions.record_visibility).
// ---------------------------------------------------------------------------

const { hasPermission } = require('../../permissions');

// System columns that are never field-masked (they identify/authorize the row).
const SYSTEM_KEYS = new Set(['id', 'object_id', 'owner_id', 'stage_id', 'visibility', 'created_at', 'updated_at']);

const canViewAll = (role) => hasPermission(role, 'records.view_all');
const canEditAll = (role) => hasPermission(role, 'records.edit_all');

// SQL predicate for which meta_records rows a user may READ. Bind these params on
// the query: @viewAll (0/1), @objDefault, @me, @orgId. `alias` qualifies the
// columns when the records table is aliased in the query.
function readPredicate(alias) {
  const a = alias ? `${alias}.` : '';
  return `(
    @viewAll = 1
    OR COALESCE(${a}visibility, @objDefault) = 'public'
    OR ${a}owner_id = @me
    OR EXISTS (SELECT 1 FROM record_shares s WHERE s.record_id = ${a}id AND s.user_id = @me AND s.organization_id = @orgId AND s.deleted_at IS NULL)
  )`;
}

// Single-record read check (mirror of the predicate, for GET /:id).
function canReadRecord(db, ctx, row, objDefault) {
  if (canViewAll(ctx.role)) return true;
  const vis = row.visibility || objDefault || 'public';
  if (vis === 'public') return true;
  if (row.owner_id === ctx.me) return true;
  const share = db.prepare(
    `SELECT 1 FROM record_shares WHERE record_id = ? AND user_id = ? AND organization_id = ? AND deleted_at IS NULL`,
  ).get(row.id, ctx.me, ctx.orgId);
  return !!share;
}

// Write check: org-wide edit override, ownership, or a write-grade share.
function canWriteRecord(db, ctx, row) {
  if (canEditAll(ctx.role)) return true;
  if (row.owner_id === ctx.me) return true;
  const share = db.prepare(
    `SELECT access FROM record_shares WHERE record_id = ? AND user_id = ? AND organization_id = ? AND deleted_at IS NULL`,
  ).get(row.id, ctx.me, ctx.orgId);
  return !!(share && share.access === 'write');
}

// Fields the user is allowed to READ (read_perm unset, or granted).
function readableFields(fields, role) {
  return fields.filter((f) => !f.read_perm || hasPermission(role, f.read_perm));
}

// Of the fields present in `data`, those the user is NOT allowed to WRITE.
function forbiddenWrites(fields, role, data) {
  return fields
    .filter((f) => f.write_perm && !hasPermission(role, f.write_perm)
      && Object.prototype.hasOwnProperty.call(data || {}, f.api_name))
    .map((f) => f.api_name);
}

// Strip non-readable tenant fields from a presented record (system keys kept).
function maskRecord(rec, fields, role) {
  if (!rec) return rec;
  const allowed = new Set(readableFields(fields, role).map((f) => f.api_name));
  const out = {};
  for (const k of Object.keys(rec)) {
    if (SYSTEM_KEYS.has(k) || allowed.has(k)) out[k] = rec[k];
  }
  return out;
}

module.exports = {
  canViewAll, canEditAll, readPredicate, canReadRecord, canWriteRecord,
  readableFields, forbiddenWrites, maskRecord,
};
