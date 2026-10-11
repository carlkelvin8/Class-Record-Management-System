# Data and security contracts

Every exposed application table has RLS. Classes are owned by auth.uid(); child policies derive access through public.owns_class(class_id). Browser-supplied owner IDs have no authority. Compound foreign keys keep enrollment, score, term, category and assessment relationships inside one class. Direct child writes are not granted; validated RPCs perform mutations with a fixed empty search_path and schema-qualified references. Public/anonymous execute is revoked on mutating functions. Private helper execute permissions are revoked from authenticated users.

Views term_grades and final_grades use security_invoker=true. Their underlying row visibility remains governed by RLS. Arithmetic grade_rules/final_rules is immutable and does not access teacher records. config_json and calculate_term run as the caller and see only permitted rows. Teacher profiles reference Auth users and are created on registration; only their owner can read/edit them.

## RPCs

- create_class(p_info, p_config): validates required metadata/configuration, derives owner from Auth, creates applicable terms and categories.
- import_class_record(payload, confirmation_token): validates shape, limits, configuration, ownership, identity mappings, score range and duplicate coordinates. New imports create a class. Reimports require expected_revision and keep/fill/replace. All writes roll back together on any exception. It never deletes enrollments or removes omitted scores. Existing metadata/configuration and assessment definition conflicts are rejected. Imported existing learner mappings must preserve names/LRNs/groups; edit those separately when necessary.
- save_score(p_class,p_enrollment,p_assessment,p_value,p_expected_version): locks the parent class, validates all parent relationships and maximum, compares version before update, and increments score version plus class revision. New cells require null expected version. Blank null differs from numeric zero.
- manage_record(p_class,p_expected_revision,p_action,p_data): ownership/revision check precedes learner, assessment, grading configuration, metadata or archive mutations. Maxima cannot drop below stored scores. Assessment grouping cannot be changed after creation. Terms with assessments cannot be deactivated.

Payload contains class_id (null for new), expected_revision, strategy, allow_missing_lrn, info, config, filename, fingerprint, learners, assessments, scores and provenance. No owner ID is used. Each source learner/assessment has a unique source key. Existing learners require explicit enrollment_id mapping, validated against parent ownership. No name matching occurs in SQL. Missing LRNs remain null and get normal UUID enrollment IDs. Existing LRNs must be explicitly mapped on reimport; no browser name-based merges.

The server locks the authenticated-user/confirmation-token pair before looking up prior batches. A matching prior payload hash returns the same batch/class without writes. A reused token with a different payload is rejected. The UI freezes the payload at final review. Reimports additionally lock the parent and compare revision: a concurrent score or configuration change makes an old import snapshot fail.

## Grading configuration

Normalized configurations, transmutation rows and descriptors store 41 exact source lookup rows and grade labels. Payload validation verifies sums, bounds, unique terms, unit totals, unique maximum boundaries and grade keys. Resolved=false yields provisional results. Configuration edits are explicit and immediately reflected in authoritative views. Decimal.js frontend calculations mirror PostgreSQL numeric round at each stage; tests compare their results at all boundaries and representative score combinations.

Raw source addresses, maxima, metadata/configuration inputs, source formulas and available caches are stored in import_provenance; formulas are strings only. Names/scores are not logged. Excluded source-row decisions and recorded formula-input resolutions are also retained.

## Storage

The workbooks bucket is private. Paths have exactly four segments: user UUID / class UUID / import batch UUID / encoded filename. Policies require user prefix, owned parent class and an owned import batch for the same class. INSERT, SELECT and DELETE are allowed only under those checks; object updates are not allowed. Browser download uses createSignedUrl with 60-second expiry. Anonymous object reads and cross-teacher forged path prefixes are denied. Original retention is optional and occurs after the atomic database import, since Storage and PostgreSQL cannot share one transaction.

The frontend receives only the publishable key. No service key, admin credentials or database password appears in VITE variables. Development seed data is entirely synthetic. Production seed inclusion is intentionally omitted in the hosted setup instructions.
