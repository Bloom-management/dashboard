# Admin payout ledger

This dashboard records money owed and external payments. It does not transfer money or connect to payment processors.

## Accounting source

Finalized earnings come from `public.assignments.completed_pay_cents` for completed jobs, per participant. Each assignment remains a separate earning, including repeat cleanings at one property. The dashboard does not recalculate earnings using current property rates or assume shared pay is half of a solo rate. Null or unreliable completed snapshots need review and are excluded from numeric balances. Claimed and in-progress jobs do not count.

All-time outstanding balances are the default. The existing completion implementation remains responsible for saving participant snapshots; the ledger does not create duplicate earnings on completion retries.

Adjustments preserve the original snapshot and require a reason. Payment allocations apply explicit integer-cent amounts to individual balances. Payment methods on saved payments are separate from the person's current preference. Voiding a mistaken entry retains the original record and records an administrator, timestamp, and reason. A replacement payment may then be recorded.

## Local verification

Use only labeled local development fixtures for payment mutations. `tests/integration/payouts-browser.mjs` requires a Clerk test key and the local Supabase port; it signs into the running app using short-lived development sign-in tickets and revokes its sessions afterward. It does not print credentials.

Production migrations and deployments are not part of this local delivery.

Verified locally on September 22, 2026:

- Real authenticated Clerk development admin: searchable Payouts tab and white detail dialog; saved solo and unequal shared earnings; separate repeat cleanings; unfinished cleaning excluded; completion comments and missing-snapshot warning.
- Real admin UI: preferred method save, explicitly allocated partial payment, full remaining payment, reasoned adjustment, audited void with restored balances, and old payment method retained after changing the preference. Non-fixture balances were compared before/after and unchanged.
- Real owner and cleaner sessions: summary/detail reads and all mutation routes denied. Anonymous summary request denied.
- Database rollback suite: completed snapshots, historical rate-edit protection, completed assignment immutability, admin self earnings, full/partial allocations, idempotent adjustment/void/payment, completion retries, missing earnings rejected, unfinished jobs excluded, and database role/table access denial.
- Parallel database sessions: two admins cannot overallocate one balance; simultaneous requests using the same idempotency key create one payment and return its original ID.
- Production-component browser checks at 320/390/1440px: filters/search, per-cleaning allocation validation, confirmation, duplicate-click guard, reason fields, preference/void forms, shared date-picker sizing and top-right close button.
- The production build, TypeScript, ESLint and the existing 56 UI tests passed.

The local database's nine pre-existing completed jobs had no missing participant snapshots. Deliberately incomplete `LOCAL TEST Payouts` fixtures remain labeled and flagged for review. This is not an audit of hosted production data.

Reproduce from the repository root with local development services running and migration 032 applied:

```sh
npm run typecheck
npm run lint
npm run test:ui
BLOOM_PLAYWRIGHT=/tmp/bloom-header-tools/node_modules/playwright/index.mjs node tests/ui/payouts-browser.mjs
node --env-file=.env.local tests/integration/payouts-browser.mjs
node tests/integration/payouts-concurrency.mjs
docker exec -i supabase_db_bloom-backend-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/payouts-local.sql
```

The SQL accounting suite rolls back. Browser/concurrency suites create new clearly labeled local fixtures and preserve their audit history; they never allocate against pre-existing real cleaners. Browser screenshots are saved under `/tmp/bloom-payouts-verification/`.

Migration `202609220032_admin_payouts.sql` was applied and registered in the local migration ledger; `npm run db:check` passed. No hosted database was inspected or changed.
