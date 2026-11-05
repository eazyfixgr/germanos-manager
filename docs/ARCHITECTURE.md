# Αρχιτεκτονική — Γερμανός Manager

Τελευταία ενημέρωση: 5 Νοεμβρίου 2026

Τα νέα Phase 1.2 authorization/member-management modules και migrations είναι τοπικά υλοποιημένα, όχι remote-applied/deployed. Βλ. `IMPLEMENTATION_PROGRESS.md` για κατάσταση και σειρά διάθεσης.

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
    OrganizationMembers.tsx Owner-controlled org roles και πρόσφατο audit
    SupportBanner.tsx      Καθολικό session banner/countdown/end
    SupportHistory.tsx     Tenant-scoped support audit viewer
    ui.tsx                Buttons, inputs, cards, modals, KPI, empty states
    Dialog.tsx            Portal/focus stack, busy/dirty guards, fixed header/footer
    Charts.tsx            SVG sales trend chart
    services/             CategorySettings, CalendarSettings
    schedule/             CalendarViews, DayReview, ShiftEditor, LeaveRequests,
                          GenerationDialog, PatternSettings και scoped CSS
  lib/
    supabase.ts           Supabase client
    auth.tsx              Session/profile/store context
    access.ts             Effective permissions από store capabilities
    support.ts            Support models και server-derived client deadline
    types.ts              TypeScript domain types
    constants.ts          Labels, status metadata, formatting
    projection.ts         Working days, projection, category stats
    scheduleGen.ts        Automatic schedule algorithm
    schedule/             Bounded read model/hook, dates/day semantics και CSV
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
| `/organization` | Οργανισμός / μέλη | Effective store/org admin |
| `/stores` | Όλα τα καταστήματα | Master |
| `/security` | Master allowlist | Master |
| `/support` | Χρονικά περιορισμένη υποστήριξη | Master |
| `/activity` | Ιστορικό | Authenticated |
| `/account` | Λογαριασμός | Authenticated |

Role guards στο UI είναι συμπληρωματικοί. Η πραγματική άδεια ελέγχεται από RLS και RPCs.

## 4. Μοντέλο δεδομένων

Βασικοί πίνακες:

- `stores`: κατάστημα, κωδικός, ωράριο, `organization_id`, `min_staff`, `fallback_work_days`.
- `profiles`: χρήστης, ρόλος (`master`/`admin`/`user`), `store_id` (home store), `active_store_id`, `active`, `is_primary`, `is_seller`, `can_edit_points`, soft-delete πεδία.
- `organizations`: εταιρεία/οργανισμός.
- `organization_memberships`: ρόλοι owner/admin/member ανά οργανισμό.
- `organization_audit_events`: actor/target, previous/new org role, timestamp (νέο τοπικό migration).
- `support_access_sessions`, `support_audit_events`: support lifecycle και scoped before/after master mutations (τοπικά).
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
- `current_store()` επιστρέφει κατάστημα μόνο για ενεργό, μη διαγραμμένο χρήστη με ισχύουσα πρόσβαση. Authority από συγκεκριμένο store membership ή org owner/admin, όχι global home profile role.
- Security-definer RPCs για ευαίσθητες ενέργειες:
  - `approve_user`, `reject_request`, `delete_user`, `restore_user`, `purge_user`.
  - `set_primary`, `lookup_store_code`.
  - `store_category_sales`, `store_daily_sales` (aggregates χωρίς έκθεση μεμονωμένων πωλητών).
  - `replace_month_shifts` (ατομική αντικατάσταση προγράμματος μήνα).
  - `store_capabilities`, `list_organization_people`, `set_organization_member` (νέα τοπικά migrations).
  - `read_schedule(store,start,end,scope)`: W1, έως 62 ημέρες, minimal membership-based staff και redacted team absences/notes. Restrictive leave SELECT για ιδιωτικές αιτιολογίες.
- Triggers προστασίας: profile fields, target points, task fields, master allowlist.
- Sync trigger `sync_store_membership`: συγχρονίζει authority/lifecycle αλλαγές του home store profile, όχι contact-only updates. Δεν ανασταίνει revoked membership από αλλαγή ονόματος.
- Restrictive active-account policies στα operational tables και store-access policies στα self-row sales/targets/tasks. Owner guards εμποδίζουν απώλεια του τελευταίου ενεργού org owner.
- Soft delete και audit.
- Realtime σε orders, profiles, sales, tasks.

## 5.1 Πολλαπλά καταστήματα

- Τα καταστήματα μπορούν να ανήκουν σε `organization`. Η παλιά master create-store σελίδα ακόμη αφήνει το πεδίο κενό.
- Το `profiles.active_store_id` ορίζει το ενεργό κατάστημα για RLS μέσω `current_store()`.
- `current_store()` ελέγχει πρόσβαση στο επιλεγμένο active store (ή home αν δεν έχει οριστεί active). Δεν επιστρέφει ανεξέλεγκτο home store μετά από ανάκληση πρόσβασης.
- Πρόσβαση δίνεται από `store_memberships` ή από ρόλο owner/admin στο organization.
- `set_active_store(store_id)` εναλλάσσει κατάστημα με έλεγχο πρόσβασης.
- `create_org_store(...)` προσθέτει membership/active store για tenant manager. Για master δημιουργεί store χωρίς membership, επιλογή ή αυτόματη πρόσβαση.
- Η σελίδα **Οργανισμός** εμφανίζει τα προσβάσιμα καταστήματα, επιτρέπει εναλλαγή και (για owner/admin) δημιουργία καταστήματος.
- Το member-management UI επιτρέπει μόνο tenant owner να αλλάζει org roles μέσω audited RPC. Οι org admins έχουν read-only μέλη· store-scoped support δεν επιτρέπει org-wide master authority.
- Ο master βλέπει κατάλογο store metadata από `list_support_stores`. Πλήρες tenant context/capabilities απαιτούν ενεργό session από `/support`. `is_master` είναι platform identity, όχι αυτόματο `isAdmin`.
- Restrictive RLS και BEFORE/AFTER support guards/audit επιβάλλουν store scope και στα definer writes. Status polling/focus και server-derived deadline καθαρίζουν frontend context· route scope key απορρίπτει cached tenant state.
- `order_events.store_id` διατηρεί το event tenant scope και σε cascade διαγραφές. Περιορισμοί/audit coverage στο `SUPPORT_ACCESS.md`.

## 5.2 Πρόγραμμα W1

- `/schedule` συντονίζει μικρά components και `lib/schedule` modules. Προσωπική/ομαδική προβολή, μήνας/εβδομάδα και day dialog χρησιμοποιούν το ίδιο bounded read model.
- Το `useScheduleData` διαχωρίζει cache keys ανά store/range/scope και αγνοεί παλιές async απαντήσεις. Δεν υποκαθιστά missing RPC με legacy unbounded queries.
- `Dialog` χρησιμοποιείται και από τον συμβατό `Modal` adapter. Διατηρεί focus/scroll/stack και κοινό footer, με explicit busy/dirty semantics.
- Οι legacy shift/leave/generation ενέργειες παραμένουν ξεχωριστές από τα μελλοντικά atomic day/leave ledger και versioned publish workflows. Η κάλυψη δεν παρουσιάζεται ως επιβεβαιωμένη από το ημερήσιο minimum.
- Συμπεριφορά, tests και roll-out: `WORKFORCE_W1_PROGRESS.md`.

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

Σειρά 5/11: `20261105_membership_authorization.sql`, `20261105_organization_membership_management.sql`, `20261105_support_access.sql`, `20261105_support_access_guards.sql`, `20261105_workforce_read_model.sql`. Εφαρμόζονται μία φορά πριν από το νέο frontend, που απαιτεί capabilities, support και `read_schedule` RPCs. Σε υπάρχουσα βάση δεν επανεκτελείται baseline/seeds. Το `app_private` δεν εκτίθεται στο PostgREST.

### Περιορισμός hosting

Το GitHub Pages δεν επιτρέπεται από τους όρους του GitHub για εμπορικό SaaS/hosting online business. Η εφαρμογή μπορεί να παραμείνει εκεί για demo/εσωτερική χρήση. Για εμπορική διάθεση απαιτείται μεταφορά του frontend σε κατάλληλο hosting, χωρίς αλλαγή της αρχιτεκτονικής React/Vite.

## 8. Περιβάλλον demo

Η τρέχουσα βάση θεωρείται demo/testing και περιέχει συνθετικά δεδομένα 3 μηνών για το κατάστημα `G1109`:

- 8 συνθετικοί λογαριασμοί πωλητών. Τα credentials δεν καταγράφονται στην τεκμηρίωση.
- 1 manager (υπάρχων λογαριασμός).
- Στόχοι, πωλήσεις, πόντοι, πρόγραμμα, εργασίες, παραγγελίες, ιστορικό.

Πριν από δημόσιο demo, τα δεδομένα πρέπει να απομονωθούν από πραγματικά δεδομένα.
