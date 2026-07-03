# Postgres + Row-Level Security — Migration Plan (scoping doc)

Status: **PROPOSAL — not started.** This scopes the work so the blast radius and
the hard decisions are visible before any code moves. Nothing here is built yet.

## 1. Why do this at all
The single reason: **database-enforced tenant isolation.** Today isolation is
app-level — every query appends `orgFilter()` (`organization_id = @orgId AND
deleted_at IS NULL`). One forgotten `WHERE` = a cross-tenant data leak. Postgres
Row-Level Security (RLS) makes the *database itself* refuse to return another
tenant's rows even if application code forgets. SQLite cannot do RLS at all, so
this is the one capability that genuinely requires leaving SQLite.

**When it's worth it:** when onboarding the first real *external* multi-tenant
customer. For a single workspace (today) the app-level scoping is adequate. Don't
pay this cost early — it is the largest single task in the project.

## 2. Blast radius (measured against the current code)
| Thing | Count | Why it matters |
|---|---|---|
| `db.prepare()` call sites | **449** | Each is synchronous today; Postgres is async → each becomes `await` |
| Route files | 29 | Handlers become `async` |
| Tables (`AUTOINCREMENT`) | 33 | `SERIAL`/`IDENTITY` + RLS policy each |
| Files using `db.transaction()` | 18 | better-sqlite3's sync txn API → async `BEGIN/COMMIT` |
| Files using `.lastInsertRowid` | 29 | → `RETURNING id` |
| SQLite-only SQL | `strftime`(6), `json_extract`(1, the metadata engine), `INSERT OR IGNORE`(2), `ON CONFLICT`(5), `PRAGMA table_info`(4) | dialect translation |

**The dominant cost is not SQL translation — it's that `better-sqlite3` is
synchronous and `pg` is asynchronous.** Every data call and its callers up the
stack must become `async`/`await`. This is mechanical but touches ~449 sites plus
the background workers (`scheduler.js`, `whatsapp.js`, `automation.js`,
`ai-agent.js`).

## 3. The two hard decisions

### 3a. How to cross the sync → async chasm
- **Option A — global async adapter (recommended).** Build `src/db.js` v2 exposing
  an async API that mirrors today's shape as closely as possible:
  `query(sql, params)`, `get()`, `all()`, `run()` (returns `{rowCount, rows}` and,
  via `RETURNING id`, an insert id). A **named-param translator** converts our
  existing `@name` params → `$1,$2` so the SQL strings barely change. Callers
  change from `db.prepare(sql).get(p)` to `await db.get(sql, p)`. Churn is large
  but uniform and scriptable; SQL mostly survives.
- **Option B — per-request connection (required for RLS, see 3b).** The adapter
  must run on a connection that has the tenant GUC set. So the data handle becomes
  **request-scoped** (`req.db`), not a global singleton. Background jobs (no `req`)
  set the tenant explicitly per unit of work.
- **Rejected:** a "sync Postgres" shim (`deasync`) — fragile, blocks the event
  loop, not production-safe.

### 3b. RLS connection + tenant-context model
- A dedicated **app DB role** that is NOT the table owner (RLS is bypassed by the
  owner/superuser unless `FORCE ROW LEVEL SECURITY`). App connects as this role.
- Per request (middleware, replacing/augmenting `tenantContext`):
  1. check out a pooled client,
  2. `BEGIN`,
  3. `SELECT set_config('app.current_tenant', $1, true)` — `true` = LOCAL, scoped
     to this transaction (safe with pooling; auto-resets on COMMIT/ROLLBACK),
  4. attach client as `req.db`,
  5. on response finish: `COMMIT` (or `ROLLBACK` on error) and release.
- Policy on every tenant table:
  ```sql
  ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
  ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON <t>
    USING (organization_id = current_setting('app.current_tenant')::int)
    WITH CHECK (organization_id = current_setting('app.current_tenant')::int);
  ```
  `USING` filters reads; `WITH CHECK` blocks writing a row into another tenant.
- **Hard-fail rule:** if `app.current_tenant` is unset, queries error (no policy
  match) rather than returning everything — exactly the safety net we want. The
  global/platform tables (`users`, `sessions`, `organizations`, `memberships`,
  `analytics_events`, `audit_log`, `feedback`) are NOT RLS-scoped; they're queried
  on a connection without the tenant GUC (auth/login happen before tenant is known).

## 4. Schema translation
Keep types boring to minimize churn. Migrate the *model* as-is; do not redesign.
| SQLite | Postgres |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGINT GENERATED ALWAYS AS IDENTITY` (or `BIGSERIAL`) |
| `INTEGER` epoch-ms timestamps | `BIGINT` (keep ms epochs — do NOT convert to `timestamptz` now; avoids touching every date) |
| `0/1` booleans | keep `INTEGER` (or `BOOLEAN`; keeping int = zero code change) |
| `TEXT` | `TEXT` |
| metadata `data TEXT` (JSON) | `JSONB` + GIN index; `json_extract(data,'$.x')` → `data->>'x'` |
| `strftime('%s','now')*1000` | `(extract(epoch from now())*1000)::bigint` (or set default in app) |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| `ON CONFLICT(col) DO UPDATE SET …` | same syntax (named conflict target) — minor tweaks |
| `PRAGMA table_info(t)` (the `ensureColumn` helpers) | `information_schema.columns`; better: replace ad-hoc `ensureColumn`/`addCol` with real migration files |
| `.run().lastInsertRowid` | `INSERT … RETURNING id` |
| `NULLS LAST` | native in Postgres (no change) |

Migrations: today each module runs `migrate(db)` ad-hoc with `CREATE TABLE IF NOT
EXISTS` + `ensureColumn`. For Postgres, introduce a real **migration runner**
(node-pg-migrate or Umzug) with ordered, versioned files. The module registry
still owns its migrations, but they become numbered SQL/JS files, not idempotent
inline `exec`.

## 5. Data migration (one-time, copy → transform → load)
1. **Schema apply:** run the new migration files against an empty Postgres DB.
2. **Export:** read every table from `data/crm.db` with better-sqlite3.
3. **Transform:** booleans/timestamps pass through; metadata `data` strings →
   JSONB; reset identity sequences to `MAX(id)+1` per table after load.
4. **Load:** `COPY`/batched inserts inside a transaction, RLS temporarily set via
   a superuser/owner connection (which bypasses RLS) so the backfill isn't blocked.
5. **Verify parity:** row counts per table match; spot-check FKs; run the existing
   authenticated smoke test (all GET endpoints 200) against the Postgres build;
   diff a sample of records SQLite vs Postgres.

## 6. Phased rollout (keeps a working system throughout)
- **Phase 0 — adapter seam (no Postgres yet).** Introduce the async `db` adapter
  in front of the *current SQLite* (a thin async wrapper over better-sqlite3).
  Convert all 449 call sites + handlers to `await`/`async` against SQLite. App
  behaves identically but is now async-shaped. **This de-risks the conversion
  separately from Postgres** — ship and verify before swapping engines.
- **Phase 1 — Postgres engine.** Implement the same adapter interface over `pg`
  with the per-request connection model. Behind an env flag (`DB_DRIVER=pg`).
- **Phase 2 — RLS.** Add policies + the dedicated role + the tenant-GUC middleware.
  Verify isolation with a two-org test (org A cannot read org B even with a query
  that "forgets" the filter).
- **Phase 3 — data migration + cutover.** Migrate prod data, run parity checks,
  flip the flag, keep SQLite as a rollback for one cycle.
- **Phase 4 — background workers.** Make `scheduler`/`whatsapp`/`automation`/`ai`
  set the tenant per unit of work (loop orgs or carry org through the job). This
  overlaps with the already-flagged "background-worker per-org rework."

## 7. Verification strategy
- Reuse the existing authenticated multi-endpoint smoke test (all 30+ GETs → 200).
- **New isolation test:** two orgs with data; assert a deliberately-unscoped query
  on org A's connection returns ONLY org A rows (proves RLS, not app code).
- `WITH CHECK` test: attempt to insert/update a row with another org's id → rejected.
- Unset-tenant test: a query with no `app.current_tenant` set → errors (not full read).
- Performance sanity: GIN index on metadata `data`; `(organization_id, …)` indexes
  carried over; check the heavy list/report queries.

## 8. Effort & risk
- **Effort:** largest single task in the project. Phase 0 (async conversion of 449
  sites) is the bulk and is mechanical-but-broad. Realistically multi-day focused
  work, more with careful per-file verification.
- **Top risks:** (1) a missed `await` → silent wrong data/races; (2) connection-pool
  exhaustion if a request forgets to release its client (mitigate with the
  middleware owning checkout/release, never handlers); (3) RLS bypass via the
  table-owner role (mitigate with `FORCE RLS` + a non-owner app role); (4) dialect
  edge cases in the metadata JSON queries and the `ensureColumn` helpers.

## 9. Recommendation
- **Do Phase 0 first and independently** — convert the data layer to an async
  adapter over SQLite. It's the riskiest mechanical part, and doing it alone (no
  engine swap) means you can verify behavior is unchanged before Postgres enters.
- **Defer Phases 1–4 until the first external multi-tenant customer is real.**
  Until then, app-level `orgFilter()` is adequate and RLS is insurance you're not
  yet collecting on.
- **Lighter interim alternative (if you want most of the safety now, cheaply):**
  add a defense-in-depth assertion to the *current* query helper — a wrapper that
  refuses to run a tenant-table query whose SQL lacks an `organization_id`
  predicate (fail loud in dev/test). Catches the "forgot the WHERE" class of bug
  without the Postgres migration. ~1 day vs. the full migration.
