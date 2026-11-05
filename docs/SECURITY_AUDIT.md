# Security Audit — Γερμανός Manager

Τελευταίος τοπικός επανέλεγχος: 5 Νοεμβρίου 2026.
Πεδίο: frontend, PostgreSQL RLS/RPCs/triggers, dependencies, migration safety.

## Κατάσταση διάθεσης και αποδεικτικών στοιχείων

Οι Phase 0/1.1 παραδόθηκαν προηγουμένως. Ο επανέλεγχος επιβεβαίωσε κενά που δεν κάλυπταν τα αρχικά unit/manual tests. Οι διορθώσεις `20261105_*` είναι **τοπικές, όχι εφαρμοσμένες στη demo βάση ή deployed**. Η ένδειξη «τοπική διόρθωση» παρακάτω δεν σημαίνει ότι το live demo προστατεύεται ήδη από αυτήν.

- 114 passing tests: 54 PostgreSQL/RLS integration, 16 React/jsdom, 8 W1 dates/day-model, 5 effective-permission, 3 support-clock, 3 spreadsheet και 25 αρχικά unit tests.
- PGlite με πραγματικό schema/migrations και synthetic actors δύο οργανισμών· authenticated role/JWT-sub fixture, όχι mock SQL assertions.
- Corrective migrations πάνω σε populated fixture· test διατήρησης tenant/profile/membership δεδομένων.
- Build επιτυχές, lint 0 errors/37 warnings, dependency audit 0 vulnerabilities κατά τον έλεγχο.
- Chrome W1 smoke desktop/mobile με synthetic transport και χωρίς remote writes. Hosted Auth/PostgREST/Realtime, πλήρες browser regression και concurrent multi-connection tests παραμένουν ανοιχτά.

## Ευρήματα Phase 0/1.1

| ID | Εύρημα | Σοβαρότητα | Τρέχουσα κατάσταση |
|---|---|---|---|
| SEC-01 | Ευάλωτο `xlsx` | High | Αντικαταστάθηκε, audit 0· νέο πραγματικό XLSX/CSV regression coverage |
| SEC-02 | Inactive/deleted `current_store()` | High | Αρχική διόρθωση ανεπαρκής για self-row/org policies· τοπικά ενισχυμένη |
| SEC-03 | Cross-store order/leave deletes | High | Scoped delete policies προηγούμενης φάσης |
| SEC-04 | Aggregate checks με NULL `current_store()` | High | Explicit NULL/store checks· τοπικό negative test |
| SEC-05 | Μερική/σιωπηλά ελλιπής αντικατάσταση προγράμματος | High | Phase 0 transaction, αλλά silent filtering· τοπικά πλήρες validation πριν delete |
| SEC-06 | Λάθος KPI ανοιχτών παραγγελιών | Medium | Exact count αντί 5 τελευταίων |
| SEC-07 | Master activity χωρίς store | Low | Active-store fallback· δεν αποτελεί πλήρες immutable audit |
| SEC-08 | Εβδομάδες ορίου μήνα στο πρόγραμμα | Medium | Majority-of-week heuristic· πραγματική adjacent-month/νομική κάλυψη εκκρεμεί |
| SEC-09 | Έλλειψη tests | High | Unit και SQL/RLS regression coverage· hosted/browser coverage εκκρεμεί |
| SEC-10 | Email verification απενεργοποιημένη | High για production | Ανοιχτό |
| SEC-11 | MFA privileged roles | High για production | Ανοιχτό |
| SEC-12 | Master άμεση πρόσβαση σε tenant δεδομένα | High για production | Τοπικό support boundary με RLS/RPC guards και audit· remote εφαρμογή εκκρεμεί |
| SEC-13 | Import validation/commit race | Medium | Ανοιχτό· απαιτεί atomic server-side recheck |
| SEC-14 | GitHub Pages για εμπορικό SaaS | High για commercial | Demo μόνο· κατάλληλο hosting πριν εμπορική διάθεση |
| SEC-15 | Realtime authorization | Medium | Store-filter στο header orders subscription· πλήρης έλεγχος εκκρεμεί |
| SEC-16 | Rate limiting / security headers | Medium | Ανοιχτό |
| SEC-17 | Backups / restore verification | High για production | Σε αναμονή χρήστη |
| SEC-18 | Multi-store isolation | High | Αρχικό manual smoke δεν επαρκούσε· corrective migration και SQL tests τοπικά |
| SEC-19 | Org-only admin χωρίς admin UI | Medium | Τοπικά effective capabilities στο auth context/guards/navigation |
| SEC-20 | NULL `p_store` σε aggregates/schedule | High | Explicit rejection, SQL regression coverage |

## Επιβεβαιωμένα κενά και τοπικές διορθώσεις Phase 1.2

### SEC-21 — Home-store role διαρρέει σε δεύτερο store (High)

- **Αναπαραγωγή:** legacy admin του Α, employee member του Β, καλεί `set_active_store(B)`· το παλιό `is_admin()` παραμένει true.
- **Διόρθωση:** `can_manage_store(store)`, `can_lead_store(store)`, scoped `is_admin`/`is_primary_admin`/`can_edit_points` και `store_capabilities` RPC.
- **Frontend:** `profile.role` δεν εκχωρεί admin rights σε άλλο store. Org-only admin με profile role `user` λαμβάνει effective permissions.
- **Test:** legacy reproduction, patched denial σε store targets και effective UI permission tests.

### SEC-22 — Inactive/deleted actor σε org/self-row policies (High)

- **Αιτία:** org membership helpers δεν έλεγχαν lifecycle· `user_id = auth.uid()` επέτρεπε πρόσβαση ανεξάρτητα από `current_store()`.
- **Διόρθωση:** `actor_is_active`, active actor στους access/org helpers και restrictive `active_account_required` operational policies.
- **Test:** inactive org manager δεν δημιουργεί store· inactive/soft-deleted employee δεν βλέπει δικές του πωλήσεις ή capabilities.
- Το self profile παραμένει αναγνώσιμο ώστε να λειτουργεί η οθόνη αναμονής/απενεργοποίησης.

### SEC-23 — Ανάκληση membership δεν ανακαλούσε όλη την πρόσβαση (High)

- **Αιτίες:** home-store fallback, unconditional profile-to-membership sync, self-row policies σε sales/targets/tasks.
- **Διόρθωση:** access-validated `current_store`, sync μόνο σε authority/lifecycle αλλαγές και restrictive `store_access_required` στα τρία self-row tables.
- **Tests:** αλλαγή ονόματος δεν ανασταίνει revoked membership· ανακαλούνται own sales, seller targets και ανατεθειμένες εργασίες, μαζί με task updates.

### SEC-24 — Self-edit ευαίσθητων profile fields (High)

- **Διόρθωση:** trigger απορρίπτει identity/tenant/authority/lifecycle escalation, `is_seller` αλλαγές και μη εξουσιοδοτημένο active store. Home-store managers έχουν μόνο τα επιτρεπόμενα επίπεδα authority.
- **Tests:** self-promotion, seller flag, soft deletion και forged store απορρίπτονται.

### SEC-25 — Direct membership escalation και απώλεια owner (High)

- **Διόρθωση:** direct mutations ανακαλούνται· `set_organization_member` μόνο για tenant owner με target από το ίδιο org staff. Το support migration αποκλείει org-wide master authority.
- **Last owner:** DB guards σε membership demotion/removal και profile deactivate/soft-delete/purge. Μεταφορά επιτρέπεται αφού προστεθεί άλλος ενεργός owner.
- **Audit:** `organization_audit_events` καταγράφει actor/target/previous/new role/timestamp· direct insert/update/delete από application role απορρίπτονται.
- **Tests:** owner grant/transfer, admin/self/foreign-tenant denial, last-owner lifecycle/purge guards και append-only direct-access checks.
- Η αφαίρεση org membership δεν αφαιρεί ξεχωριστό store membership και δεν διαγράφει τον λογαριασμό. Πρόκειται για αλλαγή org authority.

### SEC-26 — Store reparenting σε άλλο tenant (High)

- **Διόρθωση:** `protect_store_tenant` απορρίπτει αλλαγή store ID/organization από μη master.
- **Test:** owner του Α δεν μεταφέρει store σε org Β. Org-only admin δημιουργεί/εναλλάσσει store στο Α και απορρίπτεται από Β.
- **Master:** η τελική support έκδοση της `create_org_store` δεν δημιουργεί membership ούτε επιλέγει/ανοίγει πρόσβαση στο νέο store. Το παλιότερο regression suite ελέγχει χωριστά τη συμπεριφορά του προηγούμενου migration checkpoint.

### SEC-27 — Atomic RPC με silent filtering (High)

- **Αναπαραγωγή:** η παλιά RPC διαγράφει μήνα και αγνοεί άκυρες εγγραφές, ολοκληρώνοντας επιτυχώς με κενό/ελλιπές πρόγραμμα.
- **Διόρθωση:** ολόκληρο payload ελέγχεται πριν από κάθε delete· μη έγκυρος μήνας, duplicate user/date, λάθος store member/type ή αρνητικό fairness απορρίπτουν τη συναλλαγή. Store-row locking για writers.
- **Tests:** παλιές βάρδιες **και** fairness παραμένουν μετά από invalid payload. Ενεργό membership επιτρέπει πρόγραμμα ακόμη και αν το home profile είναι σε άλλο store.
- **Υπόλοιπο:** times/intervals, approved-leave invariants, period locks και πλήρεις workforce/νομικοί κανόνες δεν καλύπτονται από αυτό το payload validation.

## Spreadsheets και auth lifecycle

- Πραγματικό multi-sheet `.xlsx` read/write roundtrip και CSV quoted separators/quotes/newlines/leading-zero codes.
- Supported extensions `.xlsx/.csv`, όριο 10 MB πριν parsing. Browser download/upload E2E και όρια decompressed περιεχομένου εκκρεμούν.
- Auth requests με generation guards, ακύρωση queued loads σε αλλαγή session, DB calls έξω από auth lock και ορατό failure/retry.
- Αποτυχημένο `store_capabilities` load είναι fail-closed και το store switch επιστρέφει το error. React/jsdom tests καλύπτουν support start/end, expiry, αλλαγή άλλου tab και stale response μετά logout· πραγματικά browser/hosted tests εκκρεμούν.

## SEC-12 — Υλοποιημένο τοπικά support boundary

- `support_access_sessions` + start/end/status/directory RPCs, validated reason/duration, μία συνεδρία ανά master και profile-row serialization.
- `has_support_access` με statement time, scoped aggregate RPCs, restrictive operational/profile RLS και BEFORE guards για definer writes. Audit πριν/μετά στην ίδια συναλλαγή, μαζί με order-event cascades.
- Tenant owners βλέπουν μόνο support audit του δικού τους org. Master βλέπει μόνο δικές του συνεδρίες/audit και δεν μεταβάλλει org-wide memberships από store-scoped support.
- Παλιές org memberships δεν παρακάμπτουν το master boundary. Ο τελευταίος tenant owner προστατεύεται και από promotion σε master.
- Control-plane εξαιρέσεις: directory metadata, νέα-store applications/onboarding, master identity/allowlist και κεντρικές κατηγορίες. Δεν δίνουν αυτόματα tenant-data πρόσβαση.
- 16 SQL tests και 5 React/jsdom tests. Operational snapshots καλύπτουν τις τεκμηριωμένες support mutations, όχι κάθε SELECT/denied transaction ή όλες τις platform security ενέργειες.
- Έλεγχοι/rollout/περιορισμοί στο `SUPPORT_ACCESS.md`. Hosted Realtime, actual browser και concurrent multi-connection verification παραμένουν ανοιχτά.

## Περιορισμοί και επόμενη επαλήθευση

1. Εφαρμογή των πέντε νέων migrations μία φορά, με τη σειρά του `IMPLEMENTATION_PROGRESS.md`, πριν από το νέο frontend. Hosted smoke tests σε synthetic accounts.
2. Έλεγχος operational foreign references (user/category/store), remaining privileged RPCs και όλων των Realtime subscriptions. Οι συγκεκριμένες επιτυχείς δοκιμές δεν συνιστούν καθολική απόδειξη tenant isolation.
3. Συντονισμένη διάθεση support access· το σημερινό live δεν έχει τα νέα restrictions. Ενιαίο audit/retention/monitoring παραμένει επόμενη εργασία.
4. Month locks, atomic import/conflict detection, ασφαλές workforce draft/publish και non-additive category analytics.
5. Email verification/MFA, κατάλληλο hosting, monitoring και μελλοντική δοκιμή restore όταν επανενεργοποιηθεί η εργασία backups.

Δεν υπάρχουν νέα remote test writes ή αλλαγές πραγματικών/demo λογαριασμών από τον παρόντα επανέλεγχο.

## SEC-28 — W1 workforce read projection / ιδιωτικότητα

- `read_schedule` ελέγχει ζωντανή πρόσβαση, bounded start/end έως 62 ημέρες και scope. Προσωπικό από memberships, όχι μόνο legacy home store.
- Minimal staff fields, own requests και μόνο εγκεκριμένες ημερομηνίες απουσίας συναδέλφων για non-managers. Reason/reviewer και shift notes άλλων μελών redacted στο RPC.
- Restrictive SELECT policy στο `leave_requests` αποτρέπει παράκαμψη της ιδιωτικότητας αιτιολογιών με direct table read.
- SQL tests: cross-store/invalid windows, own projection, overlapping periods, redaction, org-only managers, inactive/revoked actors και master support end.
- Frontend αλλάζει cache key και κρύβει παλιό payload σε αλλαγή scope/περιόδου. Αποτυχημένο write διατηρεί τις τιμές και δεν εμφανίζει επιτυχία.
- Τα transactional leave approval/revoke/ledger και approved-absence invariants όλων των write paths παραμένουν W3· τα νέα UI guards δεν παρουσιάζονται ως πλήρης DB εγγύηση.
