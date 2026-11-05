# Implementation Roadmap — Γερμανός Manager

Ημερομηνία: 5 Νοεμβρίου 2026
Σχετικές αποφάσεις: `docs/DECISIONS.md`

Νέες προδιαγραφές χρήστη: [Πρόγραμμα / UX βάσει demo](WORKFORCE_UX_SPEC.md), [Σημειώσεις, Προωθητικές και Chat](COLLABORATION_MODULES_PLAN.md).

Κατάσταση διάθεσης και αποδεικτικά checks: `docs/IMPLEMENTATION_PROGRESS.md`. Τα νέα Phase 1.2 checkmarks αφορούν τοπική υλοποίηση/SQL tests· migrations και frontend δεν έχουν διατεθεί remote, browser/hosted acceptance παραμένει ανοιχτό.

## Αρχές

- Διατήρηση υπάρχουσας λειτουργικότητας και δεδομένων.
- Additive, versioned migrations.
- Έλεγχοι δικαιωμάτων στη βάση, όχι μόνο στο UI.
- Καμία ψεύτικη λειτουργία ή demo-only λύση που παρουσιάζεται ως production.
- Μικρές, ελεγχόμενες αλλαγές με tests.
- Καμία παραγωγική διάθεση χωρίς ρητή έγκριση.
- Καθημερινές εργασίες κατανοητές στην πρώτη χρήση, με συνεπή εμφάνιση και παράθυρα. Αποδοχή με πραγματικά σενάρια νέου χρήστη.

## Άμεση σειρά εκτέλεσης — αναθεώρηση 5/11

1. **Πρόγραμμα & άδειες σύμφωνα με το παρεχόμενο HTML demo**: shared dialogs/UX, μήνας/εβδομάδα, πραγματικά διαστήματα και ανάγκες, ημερήσια ανάλυση, αιτήσεις/χρέωση άδειας και draft/preview/publish.
2. Browser/usability και DB/RPC acceptance των νέων ροών, μαζί με τις εκκρεμότητες εξουσιοδότησης/συντονισμένης διάθεσης.
3. Επανένταξη **period closing** πάνω στο καθορισμένο μοντέλο προγράμματος/αδειών.
4. Νέες ενότητες καθημερινής συνεργασίας. Προτεινόμενη αλληλουχία: κοινή inbox/notification/attachment υποδομή → Σημειώσεις → Προωθητικές → Chat καταστήματος με mobile notifications.

Η υπάρχουσα αρίθμηση φάσεων διατηρεί το συνολικό scope. Η παραπάνω σειρά υπερισχύει της παλιάς αναβολής του Workforce για τη Φάση 4. Τα νέα features είναι προγραμματισμένα, όχι υλοποιημένα.

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
- [x] Τοπικά PostgreSQL/PGlite integration tests για RLS/RPC cross-store και migration data preservation.
- [ ] Hosted Supabase Auth/PostgREST/Realtime και browser regression tests.
- [ ] Browser E2E για import/export.
- [ ] Σχέδιο email verification + MFA.

## Φάση 1 — Commercial-Grade Foundation

- [x] Οντότητες `organizations`, `organization_memberships`.
- [x] `store_memberships` και migration υπαρχόντων ρόλων.
- [x] Αρχικό organization/store RLS και corrective membership authorization migration, τοπικά ελεγμένο.
- [ ] Πλήρης επαλήθευση tenant-reference invariants και hosted isolation.
- [x] Υποστήριξη πολλαπλών καταστημάτων ανά organization.
- [x] Active store switching (`active_store_id`, `set_active_store`).
- [x] Σελίδα **Οργανισμός** με λίστα καταστημάτων και δημιουργία νέου.
- [x] Τοπικό UI διαχείρισης org memberships, owner-only RPC, last-owner guards και role audit.
- [x] Τοπικό org-only admin UI με effective store capabilities αντί legacy profile role.
- [ ] Συντονισμένη εφαρμογή των πέντε migrations `20261105_*` και hosted acceptance πριν client deployment.
- [x] Τοπική πρόσβαση υποστήριξης με reason/TTL/start/end, default-deny RLS/RPC guards και before/after audit.
- [x] React/jsdom lifecycle tests για support start/end/expiry, άλλο tab και logout races.
- [ ] Ενιαίο audit events (actor, tenant, before/after, reason).
- [ ] Μηνιαίο κλείδωμα περιόδου, μετά το άμεσο ορόσημο Προγράμματος/αδειών.
- [ ] Backup στρατηγική και restore test (όταν εγκριθεί).
- [ ] Error monitoring.
- [ ] Email verification + MFA για privileged roles.

## Φάση 2 — Premium Core Experience

- [x] Μελέτη παρεχόμενου demo και καταγραφή UX/gap analysis στο `WORKFORCE_UX_SPEC.md` (προδιαγραφή, όχι UI delivery).
- [x] W1 τοπικά: shared dialogs, date/read-model helpers, μήνας/εβδομάδα/ημέρα, scoped own/team view και Chrome synthetic desktop/mobile smoke. Όρια/αποδοχή: `WORKFORCE_W1_PROGRESS.md`.
- [ ] W2: store shift templates, πραγματικά intervals/σπαστό, ανάγκες στελέχωσης και ασφαλές legacy backfill.
- [ ] W3: ημερήσιο dialog, atomic save και ολοκληρωμένο leave estimate/approval/revoke/ledger με προστασία εγκεκριμένων απουσιών.
- [ ] W4: draft, interval coverage, εξηγήσιμες προτάσεις, ιστορική δικαιοσύνη, πραγματικά όρια εβδομάδων και publish με revision checks.
- [ ] W5: desktop/mobile/keyboard και δοκιμές πρώτης χρήσης χωρίς προφορική καθοδήγηση, με διορθώσεις στα ευρήματα.
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

### Νέες εφαρμογές καθημερινής συνεργασίας — προγραμματισμένες

- [ ] C0: κοινή υποδομή inbox/read/unread, notification outbox, private attachments και server-side background jobs.
- [ ] C1 — **Σημειώσεις**: προσωπικές σημειώσεις, to-do με τίτλο/περιγραφή/ημερομηνία ανάθεσης/προθεσμία, ραντεβού και κατάλληλα reminders.
- [ ] C1 — **Κοινοποίηση / Εισερχόμενα**: αποστολή σε ενεργό συνάδελφο/υπεύθυνο, ξεχωριστά δικαιώματα προβολής/επεξεργασίας/ανάθεσης, read state, ενημέρωση και ανάκληση χωρίς διπλότυπα.
- [ ] C2 — **Προωθητικές**: Telecom (κινητή/σταθερή/TV) και ΓΕΡΜΑΝΟΣ (προϊόντα/υπηρεσίες), PDF μέσα στη σελίδα, προαιρετικό κείμενο πάνω, έναρξη/λήξη και βέλη προηγούμενης/επόμενης ενέργειας.
- [ ] C2 — Publishing από υπεύθυνο/υποδιευθυντή/master με store-scoped capabilities και ρητό audience.
- [ ] C2 — Αυτόματο Αρχείο στη λήξη, διατήρηση τριών ημερολογιακών μηνών και server cleanup PDF/εκδόσεων/metadata με retry και ιδιωτικό Storage.
- [ ] C3 — **Chatroom ανά κατάστημα**: μηνύματα, replies, αρχεία/φωτογραφίες, search, pins, unread/read state και αξιόπιστο retry/reconnect.
- [ ] C3 — Mobile/PWA/push milestone και notification preferences, ώστε το chat να μπορεί να αντικαταστήσει λειτουργικά το Viber.
- [ ] Αποδοχή με δύο πραγματικά test accounts/devices, revoked membership/share, store isolation, PDF boundaries/retention και offline/reconnect.

Scope, ενδεικτικό μοντέλο δεδομένων και αποφάσεις πριν τα migrations: `COLLABORATION_MODULES_PLAN.md`.

## Φάση 4 — Advanced Store Operations

- Το βασικό Workforce 2.0 μεταφέρθηκε στην άμεση προτεραιότητα W1–W5. Εδώ συνεχίζονται οι προχωρημένες επεκτάσεις availability, leave balances/συμβάσεων και αναλυτικής δικαιοσύνης, με επιβεβαιωμένους κανόνες.
- [ ] Orders 2.0: multiple products, suppliers, bulk receiving, IMEI/Serial, exceptions.
- [ ] Tasks & Checklists 2.0: checklists, dependencies, evidence, verification, escalation.
- [ ] Advanced operational analytics.

## Φάση 5 — Commercial SaaS Features

- [ ] Subscription architecture και feature entitlements.
- [ ] Trial/free demo environments.
- [ ] Public demo με απομονωμένα synthetic δεδομένα.
- [ ] Landing page και onboarding.
- [ ] Πρόσθετες PWA βελτιώσεις. Το βασικό install/mobile push που χρειάζεται το chat παραδίδεται μαζί με το C3, όχι ως μακρινή εξάρτηση.
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
- Βασική καθημερινή ροή ολοκληρώνεται από νέο χρήστη χωρίς προφορικές οδηγίες, με σωστό feedback και χωρίς σιωπηλή απώλεια αλλαγών.
- Ρυθμίσεις, dialogs, errors, κινητό και keyboard συμπεριφέρονται συνεπώς· κάλυψη/εκτιμήσεις δεν παρουσιάζονται ως βεβαιότητα όταν λείπουν δεδομένα.
