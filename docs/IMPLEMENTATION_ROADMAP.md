# Implementation Roadmap — Γερμανός Manager

Ημερομηνία: 4 Νοεμβρίου 2026
Σχετικές αποφάσεις: `docs/DECISIONS.md`

## Αρχές

- Διατήρηση υπάρχουσας λειτουργικότητας και δεδομένων.
- Additive, versioned migrations.
- Έλεγχοι δικαιωμάτων στη βάση, όχι μόνο στο UI.
- Καμία ψεύτικη λειτουργία ή demo-only λύση που παρουσιάζεται ως production.
- Μικρές, ελεγχόμενες αλλαγές με tests.
- Καμία παραγωγική διάθεση χωρίς ρητή έγκριση.

## Φάση 0 — Audit & Stabilization

- [x] Baseline build, lint, dependency audit.
- [x] `docs/ARCHITECTURE.md`, `docs/SECURITY_AUDIT.md`, `docs/IMPLEMENTATION_PROGRESS.md`.
- [x] Αντικατάσταση ευάλωτου `xlsx` με ασφαλείς browser βιβλιοθήκες.
- [x] Διόρθωση `current_store()` για inactive/deleted χρήστες.
- [x] Περιορισμός delete policies στο κατάστημα.
- [x] Explicit NULL/ownership checks στα aggregate RPCs.
- [x] Ατομική αντικατάσταση προγράμματος μέσω `replace_month_shifts`.
- [x] Διόρθωση KPI ανοιχτών παραγγελιών.
- [x] Καταγραφή ενεργειών master μέσω active store.
- [x] Διόρθωση εβδομάδων ορίου μήνα στο πρόγραμμα.
- [x] Εκκρεμή ρεπό ως προτιμήσεις.
- [x] Unit tests για projection, schedule, normalization.
- [x] CI test step πριν το build.
- [ ] Integration tests για RLS/RPC cross-store.
- [ ] Browser E2E για import/export.
- [ ] Σχέδιο email verification + MFA.

## Φάση 1 — Commercial-Grade Foundation

- [x] Οντότητες `organizations`, `organization_memberships`.
- [x] `store_memberships` και migration υπαρχόντων ρόλων.
- [x] Organization/store isolation με RLS.
- [x] Υποστήριξη πολλαπλών καταστημάτων ανά organization.
- [x] Active store switching (`active_store_id`, `set_active_store`).
- [x] Σελίδα **Οργανισμός** με λίστα καταστημάτων και δημιουργία νέου.
- [ ] UI διαχείρισης organization memberships.
- [ ] Org-only admins (χωρίς store admin profile role).
- [ ] Λειτουργία «πρόσβαση υποστήριξης» με reason + audit.
- [ ] Ενιαίο audit events (actor, tenant, before/after, reason).
- [ ] Μηνιαίο κλείδωμα περιόδου (period closing).
- [ ] Backup στρατηγική και restore test (όταν εγκριθεί).
- [ ] Error monitoring.
- [ ] Email verification + MFA για privileged roles.

## Φάση 2 — Premium Core Experience

- [ ] Πλήρες design system σε όλες τις οθόνες.
- [ ] Role-based dashboards (owner/admin/employee).
- [ ] Multi-store dashboard και store comparison.
- [ ] Καλύτερα analytics (περίοδοι, σύγκριση, trends).
- [ ] Mobile βελτιώσεις και performance.

## Φάση 3 — Operational Intelligence

- [ ] Advanced reports και Report Builder.
- [ ] Ημερήσια Ενημέρωση (deterministic briefing).
- [ ] Automation Center (triggers/actions/history/idempotency).
- [ ] Notification Center (in-app, email/push όταν εγκριθεί).
- [ ] Import Center 2.0 (profiles, batch history, atomic imports).
- [ ] Integration layer (generic connectors, webhooks, scheduled jobs).

## Φάση 4 — Advanced Store Operations

- [ ] Workforce 2.0: interval shifts, availability, leave balances, draft/publish, fairness history.
- [ ] Orders 2.0: multiple products, suppliers, bulk receiving, IMEI/Serial, exceptions.
- [ ] Tasks & Checklists 2.0: checklists, dependencies, evidence, verification, escalation.
- [ ] Advanced operational analytics.

## Φάση 5 — Commercial SaaS Features

- [ ] Subscription architecture και feature entitlements.
- [ ] Trial/free demo environments.
- [ ] Public demo με απομονωμένα synthetic δεδομένα.
- [ ] Landing page και onboarding.
- [ ] PWA βελτιώσεις (install, offline shell, notifications).
- [ ] Support documentation.

## Φάση 6 — Final Hardening

- [ ] Full regression tests.
- [ ] Security verification και tenant-isolation tests.
- [ ] Accessibility review.
- [ ] Performance profiling.
- [ ] Database integrity/migration verification.
- [ ] Backup restore verification.
- [ ] Production deployment documentation και release readiness.

## Definition of Done

Ένα feature θεωρείται ολοκληρωμένο μόνο όταν:

- Το UI λειτουργεί με πραγματικά δεδομένα.
- Τα δεδομένα αποθηκεύονται σωστά.
- Υπάρχει validation και error/loading states.
- Τα δικαιώματα ελέγχονται σε DB/API.
- Υπάρχουν tests που περνούν.
- Η τεκμηρίωση ενημερώθηκε.
- Δεν υπάρχει γνωστό critical defect.
