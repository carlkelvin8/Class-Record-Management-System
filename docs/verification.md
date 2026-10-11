# Verification report

Verified on 2026-10-11 in the restricted Windows workspace.

| Check | Result |
| --- | --- |
| TypeScript typecheck | Passed |
| Production Vite build | Passed |
| Importer, CSV, grading and review tests | 17 passed |
| PostgreSQL functions, transactional imports, RLS and Storage policy tests | 14 passed |
| Total automated tests | 31 passed; none skipped |
| Actual SALAZAR.xlsx extraction | Passed; 25 named learners, no LRNs, 11 Term 1 assessments |
| Available cached calculation comparison | 325 Term 1 values compared; zero mismatches |
| Term 2, Term 3 and final cached numerical evidence | None available |

The [reference comparison artifact](reference-comparison.json) contains only sheet/cell calculation evidence counts and mismatch records. It contains no names or LRNs. The importer also reports mismatches with sheet and cell addresses in the review interface.

The database tests execute all four migration files against PGlite, an actual PostgreSQL engine, using minimal Auth and Storage schema fixtures. Tests cover staged rounding, examination subweights, every transmutation boundary, different applicable terms, blank and zero inputs, rollback, idempotency, explicit duplicate-name consent, reimport conflicts, stale updates, child ownership, anonymous RPC denial and private Storage object policies.

## Unverified service and interface behavior

Docker engine access was denied in this environment. Full local Supabase Auth, PostgREST and Storage services were not run. The live database and HTTP smoke tests are included as npm run test:db and npm run test:api, but have not been executed here. These include signed URL expiry and seeded Auth login. The development seed has not been executed against a running GoTrue service.

No connected browser was available, so rendered UI, keyboard interaction and the complete authenticated browser workflow were not visually verified. The attempted development server also encountered restricted ancestor-directory access during dependency optimization. Production compilation succeeded; normal local setup instructions are in the README.

The build emits a nonfatal chunk-size warning for the main JavaScript bundle (approximately 598 kB minified, 180 kB gzip). Import parsing, analytics and record pages are loaded on demand.
