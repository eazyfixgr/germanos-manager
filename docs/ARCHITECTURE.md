# Αρχιτεκτονική — Γερμανός Manager

Τελευταία ενημέρωση: 4 Νοεμβρίου 2026

## 1. Επισκόπηση

Η εφαρμογή είναι single-page web app για λειτουργίες καταστήματος λιανικής. Διαθέτει ρόλους, εγκρίσεις, στόχους, πωλήσεις, παραγγελίες, πρόγραμμα, εργασίες, εισαγωγές/εξαγωγές και ιστορικό.

- Frontend: React 19 + TypeScript + Vite + Tailwind CSS 4.
- Backend: Supabase (PostgreSQL, Auth, Realtime, RLS, RPC).
- Hosting: GitHub Pages (demo/εσωτερική χρήση).
- Γλώσσα UI: Ελληνικά. Χωρίς emojis.

## 2. Δομή κώδικα

```
src/
  App.tsx                 Routing και role guards
  main.tsx                Entry point, HashRouter, AuthProvider
  index.css               Design tokens, base styles, print styles
  components/
    Layout.tsx            AppShell, sidebar, topbar, mobile drawer
    ui.tsx                Buttons, inputs, cards, modals, KPI, empty states
    Charts.tsx            SVG sales trend chart
    services/             CategorySettings, CalendarSettings
    schedule/             PatternSettings
  lib/
    supabase.ts           Supabase client
    auth.tsx              Session/profile/store context
    types.ts              TypeScript domain types
    constants.ts          Labels, status metadata, formatting
    projection.ts         Working days, projection, category stats
    scheduleGen.ts        Automatic schedule algorithm
    tasks.ts              Task recurrence + generation
    normalize.ts          Number/date/Excel-error normalization
    xlsx.ts               Spreadsheet read/write adapter
    csv.ts                CSV export helper
    activity.ts           Activity log helper
  pages/                  One component per route
supabase/
  schema.sql              Consolidated idempotent baseline
  migrations/             Versioned incremental migrations
docs/                     Architecture, security, roadmap, progress
```

## 3. Routes

| Route | Σελίδα | Πρόσβαση |
|---|---|---|
| `/login` | Login/Register | Public |
| `/` | Dashboard | Authenticated + active |
| `/targets` | Στόχοι πόντων | Authenticated |
| `/services` | Υπηρεσίες/πωλήσεις | Authenticated |
| `/orders`, `/orders/:id` | Παραγγελίες | Authenticated |
| `/schedule` | Πρόγραμμα | Authenticated |
| `/tasks` | Εργασίες | Authenticated |
| `/requests` | Αιτήσεις | Admin |
| `/employees` | Προσωπικό | Admin |
| `/import` | Εισαγωγή | Admin |
| `/trash` | Κάδος | Admin |
| `/store` | Στοιχεία καταστήματος | Admin |
| `/stores` | Όλα τα καταστήματα | Master |
| `/security` | Master allowlist | Master |
| `/activity` | Ιστορικό | Authenticated |
| `/account` | Λογαριασμός | Authenticated |

Role guards στο UI είναι συμπληρωματικοί. Η πραγματική άδεια ελέγχεται από RLS και RPCs.

## 4. Μοντέλο δεδομένων

Βασικοί πίνακες:

- `stores`: κατάστημα, κωδικός, ωράριο, `organization_id`, `min_staff`, `fallback_work_days`.
- `profiles`: χρήστης, ρόλος (`master`/`admin`/`user`), `store_id` (home store), `active_store_id`, `active`, `is_primary`, `is_seller`, `can_edit_points`, soft-delete πεδία.
- `organizations`: εταιρεία/οργανισμός.
- `organization_memberships`: ρόλοι owner/admin/member ανά οργανισμό.
- `store_memberships`: πρόσβαση και ρόλος ανά κατάστημα (admin/user, is_seller, can_edit_points).
- `store_targets`, `employee_targets`: στόχοι πόντων ανά μήνα.
- `point_entries`: ημερήσιοι πόντοι ανά υπάλληλο.
- `service_categories`: κεντρικές κατηγορίες υπηρεσιών, μονάδα `count`/`currency`.
- `store_categories`: ενεργοποίηση/σειρά ανά κατάστημα.
- `store_category_targets`, `seller_category_targets`: στόχοι κατηγοριών.
- `sales_entries`: μία ημερήσια εγγραφή ανά πωλητή/κατηγορία/ημερομηνία.
- `orders`, `order_events`: παραγγελίες και ιστορικό κατάστασης.
- `store_patterns`, `store_calendar`: ωράριο/μοτίβα και εξαιρέσεις ημερομηνιών.
- `shifts`, `leave_requests`, `schedule_fairness`: πρόγραμμα, άδειες/ρεπό, μετρητές δικαιοσύνης.
- `task_templates`, `store_tasks`: επαναλαμβανόμενες εργασίες και αναθέσεις.
- `activity_log`: ενέργειες χρηστών.
- `master_allowlist`: emails με δικαίωμα master.

## 5. Ασφάλεια και RLS

- RLS ενεργό σε όλους τους πίνακες.
- Βοηθητικές συναρτήσεις: `is_master()`, `is_admin()`, `is_primary_admin()`, `current_store()`, `can_edit_points()`.
- `current_store()` επιστρέφει κατάστημα μόνο για ενεργό, μη διαγραμμένο χρήστη.
- Security-definer RPCs για ευαίσθητες ενέργειες:
  - `approve_user`, `reject_request`, `delete_user`, `restore_user`, `purge_user`.
  - `set_primary`, `lookup_store_code`.
  - `store_category_sales`, `store_daily_sales` (aggregates χωρίς έκθεση μεμονωμένων πωλητών).
  - `replace_month_shifts` (ατομική αντικατάσταση προγράμματος μήνα).
- Triggers προστασίας: profile fields, target points, task fields, master allowlist.
- Sync trigger `sync_store_membership`: κρατά το `store_memberships` ευθυγραμμισμένο με τα πεδία του home store profile.
- Soft delete και audit.
- Realtime σε orders, profiles, sales, tasks.

## 5.1 Πολλαπλά καταστήματα

- Κάθε κατάστημα ανήκει σε `organization`.
- Το `profiles.active_store_id` ορίζει το ενεργό κατάστημα για RLS μέσω `current_store()`.
- `current_store()` επιστρέφει το active store μόνο αν ο χρήστης έχει πρόσβαση (`can_access_store`), αλλιώς το home store.
- Πρόσβαση δίνεται από `store_memberships` ή από ρόλο owner/admin στο organization.
- `set_active_store(store_id)` εναλλάσσει κατάστημα με έλεγχο πρόσβασης.
- `create_org_store(...)` δημιουργεί κατάστημα σε organization, προσθέτει store membership για τον δημιουργό και το θέτει ενεργό.
- Η σελίδα **Οργανισμός** εμφανίζει τα προσβάσιμα καταστήματα, επιτρέπει εναλλαγή και (για owner/admin) δημιουργία καταστήματος.
- Ο master βλέπει όλα τα καταστήματα μέσω `is_master()` και του store selector.

## 6. Υπολογισμοί

- Projection πόντων: σύνολο πόντων ÷ εργάσιμες που πέρασαν × σύνολο εργάσιμων.
- Category stats: πρόοδος, επίτευξη, projection, απόκλιση, απαιτούμενη ημερήσια ποσότητα.
- Εργάσιμες: ημερολόγιο καταστήματος, αλλιώς fallback του καταστήματος.
- Αυτόματο πρόγραμμα:
  - Μία βάρδια ανά υπάλληλο/ημέρα.
  - 1 κυλιόμενο ρεπό/εβδομάδα.
  - Σεβασμός αδειών, αιτημάτων ρεπό, min staffing.
  - Δικαιοσύνη split/short με μηνιαίους μετρητές.
  - Κάθε εβδομάδα ανατίθεται στον μήνα με τις περισσότερες ημέρες της (αποφυγή διπλού ρεπό).

## 7. Deployment

- Build: `npm run build` (`tsc -b && vite build`).
- Base path: `/germanos-manager/`.
- Router: `HashRouter` για συμβατότητα με GitHub Pages.
- CI/CD: GitHub Actions, tests → build → deploy Pages.
- Secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public anon key).
- Δεν υπάρχει service-role key στο frontend.

### Fresh installs / migrations

Το `supabase/schema.sql` είναι το consolidated baseline. Οι νεότερες αλλαγές βρίσκονται σε `supabase/migrations/` και είναι το authoritative incremental history. Για νέα εγκατάσταση:

1. Τρέξε `supabase/schema.sql`.
2. Τρέξε τα migrations με χρονολογική σειρά.

### Περιορισμός hosting

Το GitHub Pages δεν επιτρέπεται από τους όρους του GitHub για εμπορικό SaaS/hosting online business. Η εφαρμογή μπορεί να παραμείνει εκεί για demo/εσωτερική χρήση. Για εμπορική διάθεση απαιτείται μεταφορά του frontend σε κατάλληλο hosting, χωρίς αλλαγή της αρχιτεκτονικής React/Vite.

## 8. Περιβάλλον demo

Η τρέχουσα βάση θεωρείται demo/testing και περιέχει συνθετικά δεδομένα 3 μηνών για το κατάστημα `G1109`:

- 8 demo πωλητές (`demo1@germanos.local` … `demo8@germanos.local`, κωδικός `Demo123456!`).
- 1 manager (υπάρχων λογαριασμός).
- Στόχοι, πωλήσεις, πόντοι, πρόγραμμα, εργασίες, παραγγελίες, ιστορικό.

Πριν από δημόσιο demo, τα δεδομένα πρέπει να απομονωθούν από πραγματικά δεδομένα.
