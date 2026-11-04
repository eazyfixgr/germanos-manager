# Security Audit — Γερμανός Manager

Ημερομηνία: 4 Νοεμβρίου 2026
Πεδίο: frontend, Supabase schema/RLS/RPCs, dependencies, deployment.

## Σύνοψη

| ID | Εύρημα | Σοβαρότητα | Κατάσταση |
|---|---|---|---|
| SEC-01 | Ευπάθειες `xlsx` (prototype pollution, ReDoS) | High | Διορθώθηκε |
| SEC-02 | `current_store()` επέστρεφε κατάστημα και για ανενεργούς/διαγραμμένους | High | Διορθώθηκε |
| SEC-03 | Delete policies χωρίς έλεγχο καταστήματος | High | Διορθώθηκε |
| SEC-04 | Έλεγχοι RPC με NULL `current_store()` | High | Διορθώθηκε |
| SEC-05 | Μη ατομική αντικατάσταση προγράμματος | Medium | Διορθώθηκε |
| SEC-06 | Λάθος KPI ανοιχτών παραγγελιών | Medium | Διορθώθηκε |
| SEC-07 | Master actions χωρίς καταγραφή σε ιστορικό | Low | Διορθώθηκε |
| SEC-08 | Λάθος χειρισμός εβδομάδας σε όριο μήνα | Medium | Διορθώθηκε |
| SEC-09 | Έλλειψη αυτοματοποιημένων tests | High | Μερικώς διορθώθηκε |
| SEC-10 | Email verification απενεργοποιημένη | High (production) | Ανοιχτό |
| SEC-11 | MFA για privileged roles | High (production) | Ανοιχτό |
| SEC-12 | Master άμεση πρόσβαση σε όλα τα δεδομένα | High (production) | Σχεδιασμένο |
| SEC-13 | Race στον έλεγχο/commit εισαγωγών | Medium | Ανοιχτό |
| SEC-14 | GitHub Pages για εμπορικό SaaS | High (commercial) | Ανοιχτό |
| SEC-15 | Realtime authorization verification | Medium | Ανοιχτό |
| SEC-16 | Rate limiting / security headers | Medium | Ανοιχτό |
| SEC-17 | Backups / restore verification | High (production) | Σε αναμονή |
| SEC-18 | Multi-store / organization isolation | High | Αρχική υλοποίηση, ελεγμένο |
| SEC-19 | Org managers στο UI χρειάζονται admin profile | Medium | Γνωστός περιορισμός |
| SEC-20 | NULL `p_store` δεν απορριπτόταν σε RPC | High | Διορθώθηκε |

## Αναλυτικά ευρήματα

### SEC-01 — Ευπάθειες `xlsx`
- **Απόδειξη:** `npm audit` ανέφερε `xlsx` high (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9).
- **Επίπτωση:** ανάλυση κακόβουλου spreadsheet.
- **Διόρθωση:** αφαίρεση `xlsx`, χρήση `read-excel-file` + `write-excel-file` (browser subpaths) στο `src/lib/xlsx.ts`.
- **Επαλήθευση:** `npm audit` → 0 vulnerabilities. Build και tests περνούν.
- **Υπόλοιπο:** browser E2E για import/export πραγματικών αρχείων.

### SEC-02 — `current_store()` και ανενεργοί χρήστες
- **Απόδειξη:** `supabase/schema.sql`, παλιά έκδοση επέστρεφε `store_id` χωρίς έλεγχο `active`/`deleted_at`.
- **Επίπτωση:** ανενεργός/διαγραμμένος χρήστης μπορούσε να διατηρεί πρόσβαση σε store-scoped policies.
- **Διόρθωση:** `current_store()` φιλτράρει `active = true and deleted_at is null`.
- **Migration:** `supabase/migrations/20261104_phase0_security_fixes.sql`.
- **Επαλήθευση:** seller token σε ξένο store → απόρριψη.

### SEC-03 — Delete policies
- **Απόδειξη:** `orders_delete_admin`, `leave_delete_admin` χρησιμοποιούσαν μόνο `is_admin()`.
- **Επίπτωση:** admin άλλου store μπορούσε να διαγράψει εγγραφές αν γνώριζε IDs.
- **Διόρθωση:** `is_master() or (is_admin() and store_id = current_store())`.

### SEC-04 — RPC NULL handling
- **Απόδειξη:** `store_category_sales`, `store_daily_sales` είχαν `if not (is_master() or p_store = current_store())`. Με `current_store() = null`, το αποτέλεσμα είναι NULL και το `IF` δεν εκτελεί το raise.
- **Διόρθωση:** ρητός έλεγχος `current_store() is null or p_store <> current_store()`.
- **Επαλήθευση:** seller token σε ξένο store → HTTP 400/απόρριψη.

### SEC-05 — Ατομική αντικατάσταση προγράμματος
- **Απόδειξη:** `src/pages/Schedule.tsx` έκανε delete, insert chunks, delete/insert fairness σε χωριστά requests.
- **Επίπτωση:** μερική αποτυχία αφήνει ελλιπές πρόγραμμα.
- **Διόρθωση:** RPC `replace_month_shifts` (μία συναλλαγή) με έλεγχο δικαιωμάτων και audit. Φιλτράρει επίσης ώστε κάθε βάρδια να ανήκει σε υπάλληλο του ίδιου καταστήματος και στον σωστό μήνα.
- **Επαλήθευση:** admin RPC → επιτυχία, seller → απόρριψη, cleanup OK. Δοκιμή με άκυρο χρήστη/λάθος μήνα → εισήχθη μόνο η έγκυρη βάρδια.

### SEC-06 — KPI ανοιχτών παραγγελιών
- **Απόδειξη:** `src/pages/Dashboard.tsx` μετρούσε τις τελευταίες 5.
- **Διόρθωση:** exact count query με statuses `new, ordered, in_transit, received, ready, notified`.

### SEC-07 — Master activity logging
- **Απόδειξη:** `src/lib/activity.ts` επέστρεφε χωρίς log όταν `profile.store_id` ήταν null.
- **Διόρθωση:** fallback στο `gm_active_store` του master store selector.

### SEC-08 — Όριο εβδομάδας προγράμματος
- **Απόδειξη:** το προηγούμενο rule βασιζόταν στη Δευτέρα του μήνα.
- **Επίπτωση:** πιθανό διπλό ρεπό ή χαμένο ρεπό σε εβδομάδες που μοιράζονται μήνες.
- **Διόρθωση:** κάθε εβδομάδα ανατίθεται στον μήνα με >=4 ημέρες της.
- **Επαλήθευση:** tests σε Νοέμβριο/Οκτώβριο.

### SEC-09 — Tests
- **Προστέθηκαν:** 23 unit tests (`src/lib/__tests__/`) για projection, schedule generation, normalization.
- **CI:** `npm test` πριν το build στο deploy workflow.
- **Υπόλοιπο:** integration tests RLS/RPC και E2E ροών.

### SEC-10 / SEC-11 — Email verification & MFA
- **Κατάσταση:** email confirmation είναι απενεργοποιημένη για demo· δεν υπάρχει MFA.
- **Απαίτηση production:** ενεργοποίηση email verification, MFA για master/admin, έλεγχος invitation flows.

### SEC-12 — Master support access
- **Απόφαση χρήστη:** να υπάρχει λειτουργία «πρόσβαση υποστήριξης» όπως IT, με αιτιολογία και audit.
- **Κατάσταση:** σχεδιασμένο, δεν έχει υλοποιηθεί.

### SEC-13 — Import race
- **Κατάσταση:** validation και commit είναι χωριστά βήματα. Αν αλλάξει εγγραφή ενδιάμεσα, το commit μπορεί να αντικαταστήσει τιμή που δεν είχε προεπισκοπηθεί.
- **Σχέδιο:** server-side import RPC με re-check παλιών τιμών/conflict token και atomic batch.

### SEC-14 — GitHub Pages
- **Περιορισμός:** [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) — δεν επιτρέπεται για εμπορικό SaaS.
- **Απόφαση:** παραμένει για demo/εσωτερική χρήση· μεταφορά hosting πριν την εμπορική διάθεση.

### SEC-15 — Realtime
- **Εκκρεμεί:** επιβεβαίωση ότι όλα τα subscriptions σέβονται RLS και δεν εκθέτουν cross-tenant events.

### SEC-16 — Rate limiting / headers
- **Εκκρεμεί:** app-level rate limiting σε imports/actions, security headers (απαιτεί κατάλληλο hosting).

### SEC-17 — Backups
- **Κατάσταση:** σε αναμονή σύμφωνα με οδηγία χρήστη.
- **Απαίτηση production:** automated encrypted backups, retention, restore test.

### SEC-18 — Multi-store / organization isolation
- **Υλοποίηση:** `organizations`, `organization_memberships`, `store_memberships`, `stores.organization_id`, `profiles.active_store_id`.
- **Έλεγχος πρόσβασης:** `can_access_store()` = master ή ενεργό store membership ή org owner/admin.
- **RLS:** νέες πολιτικές σε organizations/memberships/stores. Το `current_store()` χρησιμοποιεί το active store μόνο μετά από έλεγχο πρόσβασης.
- **RPC:** `set_active_store`, `create_org_store` με ελέγχους org manager/master.
- **Επαλήθευση:** demo org admin δημιούργησε 2ο κατάστημα, το είδε, εκτέλεσε aggregate, επέστρεψε στο αρχικό, cleanup OK.
- **Υπόλοιπο:** UI διαχείρισης org memberships (προσθήκη/αφαίρεση admins) και πλήρες org-only admin UI.

### SEC-19 — Org manager στο UI
- **Κατάσταση:** το UI εμφανίζει οργανισμό/διαχείριση σε χρήστες με `profiles.role = 'admin'`. Ένας org manager με profile role `user` μπορεί να έχει DB δικαιώματα αλλά όχι τα admin μενού.
- **Επίπτωση:** λειτουργικός περιορισμός, όχι privilege escalation.
- **Σχέδιο:** έκθεση `orgRole` από το auth context και role-based nav.

### SEC-20 — NULL `p_store`
- **Απόδειξη:** `p_store = NULL` σε RPC με `current_store` μη-null παρήγαγε NULL comparison και δεν ενεργοποιούσε το raise.
- **Διόρθωση:** ρητός έλεγχος `p_store is null` σε `store_category_sales`, `store_daily_sales`, `replace_month_shifts`.
- **Επαλήθευση:** κλήση με `p_store: null` → απόρριψη.

## Επιβεβαιωμένοι έλεγχοι

- Δεν υπάρχει service-role key στο frontend.
- Το anon/publishable key είναι δημόσιο by design.
- RLS ενεργό σε όλους τους πίνακες.
- Master allowlist και triggers προστασίας πεδίων.
- Soft delete/audit για χρήστες.
- Security-definer RPCs με explicit store checks (μετά το migration).
- Καμία ευπάθεια στο `npm audit` μετά την αντικατάσταση του `xlsx`.
