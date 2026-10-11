# Classroom — Class Record Management System

React + TypeScript + Vite application with Supabase Auth, PostgreSQL, RPC imports and private Storage. There is no separate Node API, Fastify or Prisma backend. Node scripts are development and verification utilities only.

## Local setup (PowerShell)

Requirements: Node.js 22.12 or newer, npm, Docker Desktop running with Linux containers. Supabase CLI is used through npx. Run commands from this directory.

```powershell
npm ci
npx supabase start
npx supabase db reset
npx supabase status
Copy-Item .env.example .env.local
```

Edit .env.local. Set VITE_SUPABASE_URL to the local API URL from status (normally http://127.0.0.1:54321). Set VITE_SUPABASE_PUBLISHABLE_KEY to the publishable key shown by the local CLI; older local CLI versions label this public key anon. Never use the secret/service_role key. DATABASE_URL is used only by local database verification, never the browser. No credentials are checked in.

```powershell
npm run dev
```

Open http://127.0.0.1:5173. Local Studio: http://127.0.0.1:54323. The local-only seed creates teacher@example.test and other.teacher@example.test with password DemoClass123!. The first account has a synthetic class with completed, failing and incomplete records; the second demonstrates a separate workspace. Real reference learners are never seeded or committed.

The database reset command resets only the local development database and runs migrations plus synthetic seeds. Do not point development seed scripts at a production project. Local Auth email confirmations are disabled; hosted projects can keep confirmations enabled, and registration will prompt users to check email.

## Hosted Supabase

Create a project, link it using npx supabase link --project-ref YOUR_PROJECT_REF and apply migrations using npx supabase db push (without --include-seed). Set the frontend URL and publishable key from that project and configure Auth site/redirect URLs for your origin. Build with npm run build. Serve dist with an SPA fallback to index.html. No Edge Function is necessary: parsing is client-side and transactional processing/grading is PostgreSQL-side.

## Verification

```powershell
npm run typecheck
npm test
npm run build
# Against a RUNNING, MIGRATED local Supabase database:
npm run test:db
```

npm test executes extraction, CSV mapping, grading, pagination, export and database/RLS tests. The database suite normally uses PGlite (actual PostgreSQL engine in WASM), with minimal Auth/Storage schema fixtures. It executes all migration files unchanged, then tests their SQL functions, views, ownership policies and permissions. This is not a mock implementation of the grading or importer.

npm run test:db executes that same suite against local Supabase PostgreSQL using DATABASE_URL or the default port 54322. It wraps tests in a transaction, isolates failed statements with savepoints, and rolls everything back. It refuses nonlocal database URLs. For a customized local connection:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
npm run test:db
```

The reference extraction test reads SALAZAR.xlsx from Downloads on this machine when present. Else it is explicitly skipped. To run it elsewhere:

```powershell
$env:REFERENCE_WORKBOOK = 'C:\path\to\SALAZAR.xlsx'
npm test
```

The source workbook must not be added to Git. The extraction test compares numerical evidence without logging learner names or LRNs.

Vite and Vitest use configLoader runner to avoid bundling the configuration through inaccessible ancestor directories in restricted Windows workspaces. The application build still uses the normal production Vite pipeline.

## Workflow

1. Register/sign in. Open Import workbook and select XLSX. CSV first opens a column mapper.
2. Review class information, applicable terms, component/subcomponent weights, units, transmutation maxima and exact descriptors. Metadata is editable.
3. Review learners, exclude labels/empty slots/duplicate records, correct LRNs as text and explicitly confirm generated application identifiers for missing LRNs. No name-based automatic merges occur.
4. Review/edit raw scores and maximums. Blank and zero remain distinct. Formula inputs must be replaced with reviewed raw values and a recorded source resolution. Altered formulas and custom elective ambiguity mark configuration provisional until explicitly resolved.
5. For reimports choose a class, explicitly map existing enrollments, and select keep, fill blanks, or replace incoming cells (including blank cells). Metadata/configuration/assessment conflicts block commit until resolved. Existing learners and omitted score cells are never removed. Use the exact-change table to review every score action.
6. Confirm. A frozen payload plus UUID confirmation token commits atomically. Retry uses the same token and payload; the database returns the original batch. A changed class revision rejects the stale preview. Original retention, if selected, is a separate private Storage upload after database commit; storage failure is reported without undoing a successful class import.
7. Open the class record. Edit raw scores inline. Enter/blur saves, Escape cancels. Expected score versions reject stale writes. Add/edit learners and assessments, or delete them after confirmation. Deleting a learner or assessment removes its associated scores and recalculates grades. Class records and final grades use server pagination with search, filters and sorting; CSV export includes all matching pages. Review final grades and inspect actual-data charts.

## Workbook mappings and grading

[Workbook mapping and formula documentation](docs/workbook-mapping.md) was written before schema/import implementation. It documents INPUT DATA cells, male/female ranges, raw assessment columns, maximum row, stage rounding, helper lookup dependencies and missing-value behavior. [Security and import contracts](docs/security-and-imports.md) describes payloads and access boundaries.

This source has 25 named learners, no LRNs, and only Term 1 assessment inputs, though its subject requires all three terms. Its selected weights are 20/50/30, with examination weights 30/30/40. Those are resolved from the subject helper row, not universal defaults. Final grades stay provisional without an LRN, as in the original workbook. The UI never invents LRNs. It also deliberately leaves an entirely missing initial grade blank instead of allowing Excel's empty lookup value to be coerced into a transmuted zero grade.

A partial component can produce a numerical workbook grade because SUM ignores blanks; the application displays the number but flags it incomplete and withholds final passed/failed remarks. Dashboard failing counts and averages use only complete, resolved results. Passing threshold 75 is stored in the configuration. Every teacher can review/change their class configuration explicitly.

CSV cannot preserve workbook tabs/formulas/grading configuration. The UI offers the inspected SALAZAR configuration for explicit review (initially unresolved), and the teacher must supply class metadata, term selection and assessment maxima. Other arbitrary XLSX layouts are rejected rather than guessed. Identical learner names require explicit confirmation that they identify distinct learners, or exclusion of duplicate rows during import. Duplicate LRNs and duplicate score coordinates are always rejected.

## Current verification and limits

Typecheck and production build pass; all 44 tests pass. The reference audit compares 325 cached Term 1 calculation values with zero mismatches. See [the verification report](docs/verification.md) for exact results and limitations. Automated tests cover the actual reference extraction, matching available cached Term 1 grades, identifiers, blank/zero, duplicate detection, exam subweights, every transmutation boundary, one/two/three-term finals, rollback, idempotency, reimport strategies, stale score updates, all-table cross-teacher denial and Storage object policies.

The local Docker service suite was not available during initial verification. The PostgreSQL functions and policies are tested with PGlite; migrations have also been applied to the configured hosted Supabase project. Authenticated browser checks cover dashboard layouts, class pagination, edit controls, delete confirmations, and workbook review through final confirmation. Run the local Supabase commands, test:db and test:api above to verify the complete local Auth, Storage and HTTP integration suite. Historical reports in docs describe the checks available when each report was written.

No uploaded macros or arbitrary formulas are evaluated. Parsing occurs in the browser, not an Edge Function. Upload limit is 15 MB; the supported template has fixed 50 slots per male/female group. Student records are not sent to logs. CSV exports neutralize spreadsheet formula prefixes. Original files are opt-in and private; original download links expire after 60 seconds.

## Full local service smoke test

After local Supabase is running, seeded, and .env.local is configured:

```powershell
npm run test:api
```

This signs in as the two synthetic seed teachers and exercises real Auth, PostgREST RPC/import/edit/read APIs, rollback, idempotency, private Storage uploads, cross-teacher access denial and signed URL expiry. It creates only a synthetic temporary class and removes that class/file in cleanup using the local-only DATABASE_URL. It refuses remote API/database URLs. A failed assertion exits nonzero.

## Recovery and import safeguards

Deleted learners and assessments can be restored from **Deleted records / Restore** in their class. Their original scores return in the same transaction, with incremented score versions. If another required learner or assessment is also deleted, restore that other record first. Records deleted before migration 008 cannot be recovered by this feature.

Repeated workbooks are detected before confirmation. Choose an existing class to update, or explicitly approve a separate copy. The server also checks the file fingerprint to prevent concurrent accidental duplicate imports. Dashboard counts and averages come from one owner-scoped aggregate RPC. CSV exports reject mixed class revisions or incomplete pages and use the fetched assessment metadata.

Apply migrations 008 through 011, in order, to existing deployments. The combined setup SQL is for empty projects only.
