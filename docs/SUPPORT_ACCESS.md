# Πρόσβαση υποστήριξης master — Phase 1.2

Κατάσταση 5/11/2026: τοπική υλοποίηση και tests. Δεν εφαρμόστηκε στη remote/demo βάση και δεν έγινε client deployment.

## Συμπεριφορά

1. Ο master συνδέεται σε λειτουργία πλατφόρμας. Διατίθενται κατάλογος καταστημάτων (`id/name/code/organization_id`), αιτήσεις νέων καταστημάτων και ρυθμίσεις master.
2. Από **Πρόσβαση υποστήριξης** (`/support`) επιλέγει κατάστημα, αιτιολογία 10–1000 χαρακτήρων και διάρκεια 5–60 λεπτών (default 30).
3. Η βάση δημιουργεί μία συνεδρία ανά master, επιλέγει το κατάστημα και καταγράφει actor, reason, start/expiry. Νέα συνεδρία αντικαθιστά την προηγούμενη σε όλα τα tabs/συσκευές του λογαριασμού.
4. Εμφανίζεται καθολικό banner με κατάστημα, αιτιολογία, υπόλοιπο χρόνου και κουμπί τερματισμού. Τα tenant μενού/δικαιώματα ενεργοποιούνται μέσω `store_capabilities`.
5. Λήξη, τερματισμός ή απενεργοποίηση master ανακαλεί την πρόσβαση στη βάση. Το frontend καθαρίζει το tenant context στο server-derived deadline και ελέγχει αλλαγές ανά 15 δευτερόλεπτα/on focus.
6. Explicit logout επιχειρεί πρώτα να τερματίσει τη συνεδρία. Σε offline/διακοπή σύνδεσης το server TTL εξακολουθεί να ισχύει.

Οι org owner/admin βλέπουν το ιστορικό υποστήριξης του δικού τους οργανισμού από τη σελίδα **Οργανισμός**. Απλός employee δεν βλέπει τα snapshots.

## Όρια εξουσιοδότησης

| Πεδίο | Master εκτός υποστήριξης | Master με ενεργή υποστήριξη Α |
|---|---|---|
| Κατάλογος store IDs/ονομάτων/κωδικών | Ναι | Ναι |
| Πλήρη στοιχεία υπάρχοντος καταστήματος | Όχι | Μόνο Α |
| Παραγγελίες, πωλήσεις, πόντοι, πρόγραμμα, εργασίες | Όχι | Μόνο Α |
| Προσωπικό υπάρχοντος tenant | Όχι | Μόνο profiles του Α |
| Aggregate RPCs | Όχι | Μόνο Α |
| Νέα καταστήματα / αιτήσεις νέου tenant | Διαχείριση πλατφόρμας | Διαχείριση πλατφόρμας |
| Master identity/allowlist, κεντρικές κατηγορίες | Διαχείριση πλατφόρμας | Διαχείριση πλατφόρμας |
| Org-wide προσωπικό / αλλαγές org ρόλων | Όχι | Όχι — διαχειρίζεται ο tenant owner |
| Μεταφορά store/profile σε άλλο tenant | Όχι | Όχι |

Η δημιουργία καταστήματος από master δεν δημιουργεί tenant membership και δεν ενεργοποιεί πρόσβαση στο νέο store. Legacy org/store memberships ενός master δεν παρακάμπτουν το support boundary. Ο τελευταίος tenant owner δεν μπορεί να προαχθεί σε master πριν ορίσει άλλον ενεργό owner.

## Βάση και audit

- `support_access_sessions`: master/store/org snapshot, reason, started/expires/ended και end kind. Μοναδικό open session ανά master· profile row lock για starts/ends.
- `has_support_access(store)` χρησιμοποιεί **`statement_timestamp()`**, όχι transaction-fixed `now()`. Έτσι η λήξη ισχύει και μεταξύ statements ήδη ανοικτής συναλλαγής.
- Restrictive RLS intersects τα legacy `is_master()` exceptions σε store-keyed operational tables, profiles και order events.
- BEFORE write guards προστατεύουν και SECURITY DEFINER lifecycle RPCs. Aggregate RPCs κάνουν explicit scoped checks.
- Τα org membership RPCs βρίσκονται πίσω από public wrappers με tenant-only checks. Τα εσωτερικά implementations στο `app_private` δεν είναι εκτελέσιμα από anon/authenticated.
- `order_events.store_id` συμπληρώνεται από τον parent order, με backfill παλιών events. Διατηρεί tenant scope όταν διαγράφεται ο parent και εκτελείται cascade.
- `support_audit_events`: actor, session, store/org, reason, action, table/record, before/after snapshots. Τα direct application insert/update/delete σε sessions/audit απορρίπτονται.
- AFTER audit triggers καλύπτουν master writes σε stores, profiles, targets/points, categories/sales, orders/events, shifts/leaves/fairness, calendar/patterns, tasks/templates και activity log. Τα snapshots γράφονται στην ίδια συναλλαγή με τη μεταβολή.
- Αιτήσεις νέου tenant εξυπηρετούνται ως platform onboarding χωρίς να ανοίγει υποστήριξη ή να εκχωρείται πρόσβαση σε ήδη υπάρχοντα tenant. Συγκρουόμενος κωδικός καταστήματος απορρίπτεται.

Η αυτόματη ανάκληση στο `expires_at` δεν απαιτεί background job. Το session row μπορεί να παραμένει με `ended_at = null` μετά τη λήξη· η πρόσβαση ήδη απορρίπτεται. Η εγγραφή `session.expired` προστίθεται στο επόμενο start/end και περιέχει την πραγματική ώρα λήξης. Το start audit αποθηκεύει εξαρχής το `expires_at`.

Το audit καταγράφει χρονικό παράθυρο πρόσβασης και τις παραπάνω μεταβολές, όχι ξεχωριστό event για κάθε SELECT ή κάθε απορριφθείσα συναλλαγή. Ενιαίο application-wide audit/monitoring και πολιτική retention παραμένουν επόμενη φάση.

## Έλεγχοι

- `supportAccess.integration.test.ts`: 16 PostgreSQL/RLS tests με synthetic δεδομένα. Περιλαμβάνουν backfill populated events, default deny, scoped reads/RPCs, ownership sessions, inactive master, actual expiry μεταξύ statements, private-function denial, before/after audit, cascade deletion, owner visibility και onboarding.
- `supportAuth.test.tsx`: 5 React Testing Library/jsdom tests πάνω στο πραγματικό AuthProvider και SupportBanner, με mocked transport. Start/end, deadline expiry, άλλη καρτέλα, stale response μετά logout και explicit server end στο logout.
- `support.test.ts`: 3 tests υπολογισμού deadline από server clock/invalid timestamps.
- Effective-permission regression: master identity χωρίς capabilities δεν δίνει tenant admin authority.

Τα component tests δεν είναι hosted Supabase ή πραγματικό browser E2E. Εκκρεμούν Auth/PostgREST schema-cache smoke, πλήρης Realtime authorization, multi-connection concurrency, responsive/keyboard browser flows και deployment acceptance.

## Διάθεση

Σειρά νέων migrations μετά τα δύο `20261104_*`:

1. `20261105_membership_authorization.sql`
2. `20261105_organization_membership_management.sql`
3. `20261105_support_access.sql`
4. `20261105_support_access_guards.sql`
5. `20261105_workforce_read_model.sql` (W1 Πρόγραμμα, εξαρτάται από τα παραπάνω support/access helpers)
6. `20261105_workforce_w2_01_intervals.sql`
7. `20261105_workforce_w2_02_configuration.sql`
8. `20261105_workforce_w2_03_assignments.sql`

Εκτέλεση μία φορά και **πριν από το αντίστοιχο frontend**. Το παλιό master UI δεν είναι συμβατό με τη νέα default-deny συμπεριφορά· απαιτείται συντονισμένη διάθεση βάσης/client. Το `app_private` δεν πρέπει να προστεθεί στα exposed PostgREST schemas.

Πριν διάθεση: synthetic master χωρίς session → άρνηση tenant data, start στο Α → πρόσβαση μόνο Α, direct RPC προς Β → άρνηση, end/expiry → άρνηση, tenant owner → δικό του audit, νέα αίτηση καταστήματος → onboarding χωρίς support session.
