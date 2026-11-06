# Implementation Progress — Γερμανός Manager

Τελευταία ενημέρωση: 5 Νοεμβρίου 2026

## Τρέχουσα κατάσταση

**W1/W2 live· W3 migration εφαρμόστηκε· store roles/transfers και category-points τοπικά.**

- Οι Phase 0/1.1 παραδόθηκαν προηγουμένως (`9edc2dd`, `9ea6643`). Ο επανέλεγχος εντόπισε ουσιαστικά κενά· οι παλιές σημάνσεις «ολοκληρωμένο/ελεγμένο» δεν αποτελούν πλήρη πιστοποίηση ασφάλειας.
- Ο χρήστης επιβεβαίωσε επιτυχή εφαρμογή των πρώτων 8 authorization/W1/W2 migrations. W1/W2 έγινε deploy στο `main` (`116767a`); GitHub Actions build/tests/deploy πέρασαν.
- Ο χρήστης επιβεβαίωσε ότι εφάρμοσε και το W3 migration `20261105_workforce_w3_leave_transactions.sql`. Το W3 client δεν έχει γίνει deploy.
- Store hierarchy/transfers υλοποιούνται τοπικά· νέα migration `20261105_store_hierarchy_transfers.sql` εκκρεμεί εφαρμογής. Αναλυτικά: `docs/STORE_HIERARCHY_PROGRESS.md`.
- Points ανά κατηγορία: rules ανά κατάστημα, πωλήσεις × rate, append-only διορθώσεις, category targets· migration `20261105_store_point_categories.sql` εκκρεμεί. Spec: `docs/POINTS_BY_CATEGORY_SPEC.md`.
- PostgreSQL/PGlite ελέγχει W1/W2/W3/store roles/category-points με synthetic accounts. Hosted Supabase/Realtime acceptance και client deployment εκκρεμούν.
- Η συνολική Phase 1.2 παραμένει ανοιχτή: W3/store roles/category-points client deployment acceptance και period closing εκκρεμούν.
- Νέα οδηγία χρήστη: **προηγείται η αναβάθμιση Προγράμματος/αδειών και παραθύρων σύμφωνα με το δοσμένο HTML demo**, πριν ξεκινήσει το period closing. Οι νέες ενότητες συνεργασίας καταγράφηκαν στο roadmap ως μελλοντική υλοποίηση.

## Νέα προδιαγραφή χρήστη — Πρόγραμμα και καθημερινή συνεργασία

- [x] Μελέτη του παρεχόμενου HTML/CSS/JavaScript demo και σύγκριση με το πραγματικό `Schedule`, `PatternSettings`, generator/types και shared Modal. Δεν έγινε browser-render acceptance του demo.
- [x] `docs/WORKFORCE_UX_SPEC.md`: οθόνες/παράθυρα, κανόνες ευκολίας χρήσης, πραγματικά intervals/κάλυψη, ημερήσια ανάλυση, αιτήσεις/χρέωση άδειας και σειρά W1–W5.
- [x] `docs/COLLABORATION_MODULES_PLAN.md`: Σημειώσεις/to-do/ραντεβού με share/Εισερχόμενα, Προωθητικές Telecom/ΓΕΡΜΑΝΟΣ και Chat ανά store για αντικατάσταση Viber.
- [x] Κύκλος Προωθητικών: PDF μέσα στη σελίδα, προαιρετικό κείμενο επάνω, βέλη προηγούμενης/επόμενης ενέργειας, έναρξη/λήξη, Αρχείο για τρεις ημερολογιακούς μήνες και πραγματική διαγραφή PDF/metadata από server job.
- [x] Ενημερωμένες αποφάσεις/roadmap και κριτήρια αποδοχής πρώτης χρήσης χωρίς προφορική καθοδήγηση.
- [x] W1 τοπικά: shared dialogs, scoped read model, μήνας/εβδομάδα, ημερήσια ανάλυση, προσωπική/ομαδική προβολή, CSV και διατηρημένες legacy ενέργειες. Αναλυτικά: `docs/WORKFORCE_W1_PROGRESS.md`.
- [x] W2 core τοπικά: τύποι/εκδόσεις βαρδιών, πραγματικά διαστήματα, ανάγκες στελέχωσης, revision-safe αναθέσεις και χρονική κάλυψη. Αναλυτικά: `docs/WORKFORCE_W2_PROGRESS.md`.
- [x] W2 core live: W2 client deployed μετά την επιβεβαίωση εφαρμογής των 8 migrations.
- [x] W3 core τοπικά: transactional leave submit/review/revoke + dated ledger, revision-safe atomic day save. `docs/WORKFORCE_W3_PROGRESS.md`.
- [x] Ο χρήστης επιβεβαίωσε εφαρμογή της W3 migration.
- [ ] W3/store-role client deployment acceptance· εφαρμογή της 10ης `store_hierarchy_transfers` migration πριν από client push/merge στο `main`.
- [ ] W4–W5: αποθηκευμένα drafts/publish και πλήρης αξιολόγηση πρώτης χρήσης.
- [ ] Υλοποίηση C0–C3 μετά το άμεσο ορόσημο, με προτεινόμενη αλληλουχία inbox/notifications → Σημειώσεις → Προωθητικές → Chat/mobile push.

Το W1 ελέγχθηκε με SQL, unit/component και Chrome synthetic browser scenarios. Δεν έγινε remote migration/deploy ή μεταβολή πραγματικών λογαριασμών.

## Phase 0/1.1 — προηγούμενη παράδοση

- Αντικατάσταση `xlsx`, exact count ανοιχτών παραγγελιών, aggregate NULL/store checks, atomic schedule RPC, pending ρεπό ως προτιμήσεις.
- Organizations, organization/store memberships, active store, `set_active_store`, `create_org_store`, σελίδα `/organization` και store selector.
- 25 αρχικά unit tests και CI test step πριν το build.
- Τα migrations `20261104_*` είχαν αναφερθεί ως εφαρμοσμένα στη demo βάση. Η remote κατάσταση δεν επανελέγχθηκε στην παρούσα εργασία.

## Επανέλεγχος και τοπικές διορθώσεις

### Membership authorization

- [x] Αναπαραγωγή legacy privilege leak: home-store admin αποκτούσε admin authority σε δεύτερο store όπου ήταν employee.
- [x] `can_manage_store` / `can_lead_store` και effective permissions βάσει του συγκεκριμένου store membership ή org owner/admin.
- [x] Ενεργός, μη διαγραμμένος actor υποχρεωτικά στα access/org helpers και restrictive operational RLS policies.
- [x] Ανάκληση membership: χωρίς ανεξέλεγκτο home-store fallback ή αναδημιουργία membership από αλλαγή στοιχείων επικοινωνίας.
- [x] Πρόσθετος store-access έλεγχος στα self-row policies πωλήσεων, seller targets και εργασιών. Η ανάκληση membership αφαιρεί και την πρόσβαση σε προσωπικές παλιές εγγραφές του store.
- [x] Profile guard: αποτροπή self-promotion, αυθαίρετων lifecycle/seller/tenant/identity αλλαγών και forged active store.
- [x] Αφαίρεση direct membership mutation policies/grants· org role changes μέσω ελεγχόμενου RPC.
- [x] Store tenant guard: store admin δεν μεταφέρει κατάστημα σε άλλον οργανισμό.
- [x] `create_org_store` δεν εγγράφει τον platform master ως tenant member και δεν ανοίγει πρόσβαση στο νέο store. Για master το store context προέρχεται μόνο από ενεργό support session.

### Atomic πρόγραμμα

- [x] Αναπαραγωγή legacy silent filtering: άκυρο payload μπορούσε να διαγράψει το παλιό πρόγραμμα χωρίς error.
- [x] Πλήρες validation λιστών, μήνα, ημερομηνιών, τύπων, ενεργών store members, duplicates και fairness πριν από διαγραφή.
- [x] Αποτυχία οποιασδήποτε εγγραφής διατηρεί παλιές βάρδιες και fairness.
- [x] Store-row lock για serialization writers. Δεν πραγματοποιήθηκε concurrent multi-connection stress test.
- [x] Αποδοχή ενεργού store member ακόμη και όταν το home profile του ανήκει σε άλλο κατάστημα.
- [ ] Πραγματικά split intervals, adjacent-month consistency και έλεγχοι νομικής συμμόρφωσης/στελέχωσης παραμένουν επόμενη εργασία.

### Organization membership management

- [x] `list_organization_people`: προσωπικό μόνο του επιλεγμένου οργανισμού.
- [x] `set_organization_member`: tenant owner διαχειρίζεται admin/member· owner appointment/change μόνο από master. Store-scoped master support δεν δίνει org-wide authority.
- [x] Last-active-owner guard σε demotion/removal, απενεργοποίηση, soft delete και οριστική διαγραφή profile.
- [x] Ownership transfer αφού οριστεί δεύτερος ενεργός owner.
- [x] `organization_audit_events`: before/after ρόλος, actor, target, timestamp· άμεσες εφαρμογικές μεταβολές του audit απορρίπτονται.
- [x] UI με επιλογή ρόλου, confirmation, loading/errors και πρόσφατο ιστορικό. Org admins βλέπουν τα μέλη, tenant owner αλλάζει ρόλους.
- [ ] Browser E2E και επαλήθευση με Supabase Auth/PostgREST/Realtime.

### Frontend / spreadsheets

- [x] Auth context φορτώνει `store_capabilities`: org-only admin με legacy profile role `user` αποκτά τα αντίστοιχα μενού, guards και points permissions.
- [x] Role labels ακολουθούν τα effective δικαιώματα του ενεργού καταστήματος.
- [x] Store switch errors εμφανίζονται και αποτυχία capability reload επιστρέφεται στον caller.
- [x] Generation guards, ακύρωση queued auth loads και αποφυγή DB calls μέσα στο auth lock callback.
- [x] Auth load failure εμφανίζει retry/logout αντί αέναου spinner.
- [x] Πραγματικό multi-sheet XLSX roundtrip και quoted CSV tests, ελληνικά/αριθμοί/leading zeros.
- [x] Απόρριψη unsupported extensions και αρχείων άνω των 10 MB πριν το parsing. Αφαίρεση `any` από dynamic spreadsheet imports.
- [ ] Browser download/upload E2E. Το όριο συμπιεσμένου αρχείου δεν είναι πλήρης προστασία από υπερβολικό decompressed workbook.

### Πρόσβαση υποστήριξης master

- [x] Μία χρονικά περιορισμένη συνεδρία ανά master, υποχρεωτικό reason, start/end/replacement και 5–60 λεπτά διάρκεια.
- [x] Default deny σε tenant data χωρίς session, restrictive RLS και write guards ακόμη και για SECURITY DEFINER RPCs. Λήξη με server `statement_timestamp()`, ανεξάρτητα από browser/cleanup.
- [x] Περιορισμένος platform directory, νέα-store onboarding και platform identity διαχείριση διατηρούνται χωρίς global tenant reads.
- [x] Support audit με actor/session/store/reason και before/after master writes. Org managers βλέπουν μόνο το δικό τους ιστορικό.
- [x] `/support`, καθολικό banner, countdown/end, καθαρισμός context σε expiry και remount cached route state. Poll/focus για αλλαγές άλλων συσκευών.
- [x] Legacy master org memberships αγνοούνται· last-owner promotion σε master απορρίπτεται χωρίς άλλον ενεργό tenant owner.
- [x] Backfill `order_events.store_id` και audit ολόκληρου order/event delete cascade.
- [x] Explicit home-store FK στα profile→store joins για αποφυγή αμφίσημου PostgREST relationship μετά το `active_store_id`.
- [ ] Hosted/browser/Realtime και multi-connection acceptance. Αναλυτικά όρια/ροές: `docs/SUPPORT_ACCESS.md`.

## Database migrations και σειρά διάθεσης

| Αρχείο στο `supabase/` | Κατάσταση |
|---|---|
| `schema.sql` | Ιστορικό baseline, μόνο για νέα εγκατάσταση |
| `migrations/20261104_phase0_security_fixes.sql` | Προηγουμένως εφαρμοσμένο στη demo βάση |
| `migrations/20261104_phase1_organizations.sql` | Προηγουμένως εφαρμοσμένο στη demo βάση |
| `migrations/20261105_membership_authorization.sql` | Εφαρμόστηκε στη demo βάση, κατά δήλωση χρήστη |
| `migrations/20261105_organization_membership_management.sql` | Εφαρμόστηκε στη demo βάση, κατά δήλωση χρήστη |
| `migrations/20261105_support_access.sql` | Εφαρμόστηκε στη demo βάση, κατά δήλωση χρήστη |
| `migrations/20261105_support_access_guards.sql` | Εφαρμόστηκε στη demo βάση, κατά δήλωση χρήστη |
| `migrations/20261105_workforce_read_model.sql` | Εφαρμόστηκε στη demo βάση, κατά δήλωση χρήστη |
| `migrations/20261105_workforce_w2_01_intervals.sql` | Εφαρμόστηκε στη demo βάση, κατά δήλωση χρήστη |
| `migrations/20261105_workforce_w2_02_configuration.sql` | Εφαρμόστηκε στη demo βάση, κατά δήλωση χρήστη |
| `migrations/20261105_workforce_w2_03_assignments.sql` | Εφαρμόστηκε στη demo βάση, κατά δήλωση χρήστη |
| `migrations/20261105_workforce_w3_leave_transactions.sql` | Ο χρήστης επιβεβαίωσε εφαρμογή στη demo βάση; client deploy pending |
| `migrations/20261105_store_hierarchy_transfers.sql` | Ρόλοι/ιεραρχία/μεταφορές, local SQL-tested; **εκκρεμεί εφαρμογή** |
| `migrations/20261105_store_point_categories.sql` | Category-points, local SQL-tested; **εκκρεμεί εφαρμογή μετά το store hierarchy** |

Ο χρήστης επιβεβαίωσε εφαρμογή των πρώτων 8 migrations και του W3 migration. Εκτελεστικές migrations 10 και 11 είναι `store_hierarchy_transfers` και `store_point_categories` αντίστοιχα. Τρέχουν μία φορά με αυτή τη σειρά μετά το W3 και πριν από το νέο client. Δεν επανεκτελείται baseline ή seed.

Η διάθεση κάθε ορόσημου απαιτεί migration πριν από το αντίστοιχο client. Το W1/W2 client είναι live. W3 migration εφαρμόστηκε· store hierarchy/category-points migrations και νέο client deploy εκκρεμούν. Το `app_private` παραμένει μη exposed.

## Επαληθευμένα τοπικά checks

- `npm.cmd test` → **152 passed**, 16 αρχεία:
  - 25 αρχικά unit tests, 5 effective-permission tests, 3 spreadsheet regression tests.
  - 30 authorization PostgreSQL tests, 16 support-access PostgreSQL, 8 schedule-read PostgreSQL, 10 W2 interval PostgreSQL και 16 W3/W4 role, transfer and points PostgreSQL tests.
  - 8 W1 date/day-model, 7 W2 interval-coverage unit, 3 support-clock tests.
  - 21 React/jsdom tests: 5 support-auth, 5 shared-dialog και 11 schedule/leave/day UI tests.
- Chrome/Playwright synthetic smoke → επιτυχία desktop 1440×1000 / mobile 390×844, χωρίς πραγματικά Supabase writes. Ξεχωριστό W2 scenario: τύπος σπαστού, απόρριψη επικαλυπτόμενης ανάγκης και ανάθεση με πραγματικά διαστήματα.
- `npm.cmd run build` → επιτυχία, με bundle-size warning (~780 kB main chunk).
- `npm.cmd run lint` → **0 errors**, 43 warnings (κυρίως React effects/compiler/dependencies).
- `npm.cmd audit --json` → **0 vulnerabilities** κατά τον έλεγχο.

Το PGlite εκτελεί το πραγματικό baseline και migrations, JWT-sub fixture και `SET LOCAL ROLE authenticated`. Εξαιρούνται μόνο pgcrypto extension/Realtime publication DDL. Τα corrective migrations εφαρμόζονται πάνω σε ήδη populated synthetic δεδομένα. Δεν υποκαθιστά hosted Supabase integration ή browser E2E.

## Επόμενα βήματα

1. Εφαρμογή των `store_hierarchy_transfers` και `store_point_categories` migrations με τη σειρά και hosted synthetic smoke tests, έπειτα συντονισμένο client deploy.
2. W4–W5: time-aware draft/preview/publish, ιστορική δικαιοσύνη, πραγματικά όρια εβδομάδων και έλεγχος πρώτης χρήσης. Βλ. `WORKFORCE_UX_SPEC.md`.
3. Period closing με server-side month locks/correction workflow, μετά την ολοκλήρωση W4/W5.
4. C0–C3: κοινό inbox/notifications/attachments, προσωπικές Σημειώσεις με Εισερχόμενα, Προωθητικές PDF με retention και Chat καταστήματος/mobile notifications. Βλ. `COLLABORATION_MODULES_PLAN.md`.
5. Περαιτέρω tenant-reference invariants, atomic imports, ενιαίο audit/monitoring και analytics χωρίς αυθαίρετη πρόσθεση επικαλυπτόμενων `count` κατηγοριών.
6. Email verification/MFA και κατάλληλο SaaS hosting πριν από εμπορική διάθεση.

**Backups: σε αναμονή κατόπιν οδηγίας χρήστη.** Το GitHub Pages και η σημερινή Supabase βάση παραμένουν demo/testing. Τα καταστήματα που δημιουργούνται από τη master σελίδα ακόμη δεν συνδέονται αυτόματα σε οργανισμό.
