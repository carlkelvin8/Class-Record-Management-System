# Verification report

Verified on 2026-10-11 in the Windows workspace with hosted Supabase and the in-app browser.

| Check                                      | Result                                               |
| ------------------------------------------ | ---------------------------------------------------- |
| TypeScript typecheck                       | Passed                                               |
| Production Vite build                      | Passed                                               |
| Importer, CSV and grading tests            | 17 passed                                            |
| PostgreSQL, RLS, import and recovery tests | 21 passed                                            |
| Pagination and export tests                | 6 passed                                             |
| Total automated tests                      | 44 passed                                            |
| Actual SALAZAR template extraction         | 25 learners; 11 Term 1 assessments                   |
| Available cached calculation comparison    | 325 values; zero mismatches                          |
| Hosted migrations                          | 001 through 011 applied using verified TLS           |
| Authenticated browser import               | Fabricated workbook saved successfully               |
| Browser score edit                         | Enter saved score; authoritative grade recalculated  |
| Browser learner delete and restore         | Learner returned with edited score 6                 |
| Browser assessment delete and restore      | Assessment returned with edited score 6              |
| Browser duplicate-file detection           | Repeated workbook warning displayed                  |
| Browser dashboard                          | Owner-scoped aggregate returned active class metrics |

Database tests execute all migration files against PGlite, an actual PostgreSQL engine, with minimal Auth/Storage fixtures. Recovery tests verify score preservation and version increments, stale revision rejection, cross-teacher denial, already-restored rejection, and atomic rollback when another required parent is deleted. Duplicate tests verify rejection, explicit-copy consent, token retries and denial of direct internal RPC execution. Export tests verify all pages, failed pages, mixed revisions and duplicate/missing rows.

Browser verification used a fabricated workbook with two synthetic learners, not the real SALAZAR class. The synthetic class was archived after verification. Screenshot evidence is stored locally under docs/design and ignored by Git. These are manual browser regression checks; there is no automated browser test runner in the repository.

The production build retains a nonfatal main-bundle size warning (approximately 600 kB minified). Original workbook retention and signed-download expiry were not re-tested in this pass. Credential rotation requires the project owner. Records deleted before migration 008 cannot be restored through the new recovery UI.
