# Workforce W1 — τοπική υλοποίηση και έλεγχοι

Ημερομηνία: 5 Νοεμβρίου 2026. Κατάσταση: **υλοποιημένο τοπικά, δεν εφαρμόστηκε στη demo βάση / δεν έγινε deploy**.

## Παραδοτέο

- Μηνιαίο ημερολόγιο με πλοήγηση, επιλογή μήνα, «Σήμερα», οπτική επιλεγμένης ημέρας και keyboard arrows/Home/End.
- Εβδομαδιαίο πλέγμα με σταθερή στήλη ονομάτων, αναζήτηση, αποθηκευμένες ώρες και σύνοψη ημέρας.
- Επιλογή **«Το πρόγραμμά μου / Ομάδα καταστήματος»**, KPI περιόδου, σημεία προσοχής και CSV εξαγωγή της επιλεγμένης προβολής.
- Παράθυρο ημέρας με ομάδες βαρδιών ταξινομημένες κατά πρώτη αποθηκευμένη ώρα έναρξης, χωριστά απουσίες/ρεπό και μη ανατεθειμένοι εργαζόμενοι.
- Ενδείξεις για κενές αναθέσεις, ελλιπείς/εκτός ωραρίου ώρες, βάρδιες σε κλειστή ημέρα και διαφωνία βάρδιας με εγκεκριμένη απουσία.
- Προσωπική αίτηση άδειας/ρεπό, φίλτρα και η υπάρχουσα έγκριση/απόρριψη, με ορατά save errors και διατήρηση της φόρμας στην αποτυχία.
- Διατήρηση χειροκίνητης μεμονωμένης καταχώρισης βάρδιας, ωραρίου/μοτίβων και υπάρχουσας παραγωγής μήνα σε μικρά modules.
- Η παραγωγή έχει στάδιο προετοιμασίας με πλήθος βαρδιών/προειδοποιήσεις πριν από ρητή **«Αντικατάσταση μήνα»**. Fairness υπολογίζεται μόνο από προγενέστερους μήνες και δεν αντικαθίσταται μήνας με άδειο προσωπικό.

## Shared dialogs

Το νέο `components/Dialog.tsx` χρησιμοποιείται και από τον υπάρχοντα `Modal` adapter:

- Portal, semantic dialog, τίτλος/περιγραφή, σταθερή κεφαλίδα και optional footer.
- Focus trap/restore, Escape, scroll lock και στοίβα παραθύρων με inert/aria-hidden για τα προηγούμενα.
- Busy close guard και inline επιβεβαίωση απόρριψης dirty values στα νέα forms/ρυθμίσεις.
- Άνοιγμα Αιτήσεων από την ημέρα και νέας αίτησης από τις Αιτήσεις επιστρέφει στο προηγούμενο παράθυρο, με το context διατηρημένο.
- Responsive διαστάσεις, εσωτερικό scrolling και controls εντός viewport. Το εβδομαδιαίο πλέγμα κάνει scroll μέσα στον δικό του container.

## Read model και ιδιωτικότητα

`20261105_workforce_read_model.sql` προσθέτει `read_schedule(store,start,end,scope)`:

- Live access/support check, scope `own/team`, exclusive end date και διάστημα έως 62 ημέρες.
- Προσωπικό από ενεργά **store memberships**, μαζί με απαραίτητα ιστορικά IDs της περιόδου. Δεν βασίζεται μόνο στο home store του profile.
- Περιορισμένη προβολή προσωπικού: `id/full_name/active`, χωρίς email/τηλέφωνο. Soft-deleted/master ιστορικές εγγραφές παίρνουν γενική ετικέτα.
- Shifts μόνο της περιόδου και αιτήσεις που επικαλύπτονται μαζί της, ακόμη κι αν άρχισαν προηγουμένως.
- Μη manager βλέπει δικές του αιτήσεις και ημερομηνίες/τύπο εγκεκριμένων απουσιών ομάδας, όχι pending αιτήσεις ή ιδιωτική αιτιολογία συναδέλφου. Στο RPC οι σημειώσεις βάρδιας άλλων μελών επίσης αποδίδονται ως null.
- Restrictive SELECT policy στο `leave_requests` προστατεύει τις αιτιολογίες και σε direct table reads. Managers βλέπουν τα δεδομένα review του προσβάσιμου store.
- Frontend validator ελέγχει store/range/scope και query state κρύβει αμέσως cached δεδομένα άλλης περιόδου/scope. Καθυστερημένη απάντηση αγνοείται μετά αλλαγή context.

## Τι παραμένει για W2–W5

- **W2**: πραγματικά split intervals, templates, time-based staffing requirements και ανάλογοι υπολογισμοί. Στο W1 το υπάρχον split δείχνει ρητά μόνο το αποθηκευμένο εύρος.
- Η χρονική κάλυψη είναι **«Μη αξιολογημένη»**. Το ημερήσιο ελάχιστο ή η απουσία εμφανών λαθών δεν παρουσιάζονται ως πλήρης στελέχωση.
- **W3**: atomic day save, leave estimate/ledger, συγχρονισμένη έγκριση με βάρδιες και ασφαλής ανάκληση, μαζί με invariants σε όλα τα write paths. Το W1 κλειδώνει τις εγκεκριμένες απουσίες στο νέο editor και εμφανίζει υφιστάμενες ασυμφωνίες· δεν προσποιείται ότι υπάρχει ήδη πλήρης transactional leave workflow.
- **W4**: αποθηκευμένα drafts/versions, diff/manual-preservation και publish με revision checks. Η διατηρημένη παλιά παραγωγή αντικαθιστά ακόμη τον μήνα μετά από ρητή ενέργεια.
- **W5**: ολοκληρωμένη αξιολόγηση χρηστικότητας χωρίς εκπαίδευση, πραγματικά hosted Auth/PostgREST/Realtime checks, φυσικές συσκευές/κινητά και regression όλων των παλιών Modal consumers.

## Επαλήθευση

- 114 passing tests σε 13 αρχεία: τα 87 προηγούμενα + 8 dates/day-model, 8 PostgreSQL read-model/privacy, 5 shared Dialog και 6 Schedule/UI tests.
- Production build επιτυχές, κύριο chunk ~721 kB με το γνωστό size warning.
- Lint: 0 errors, 37 warnings από τις καταγεγραμμένες υπάρχουσες περιοχές.
- Chrome με Playwright σε 1440×1000 και 390×844, πραγματικό τοπικό app και synthetic/mocked Supabase transport: μήνας, ημέρα, nested editor/dirty-discard, focus return, nested request failure/back navigation και mobile εβδομαδιαίο scroller. Χωρίς real Supabase writes.
- Screenshots ελέγχου: `C:\Users\George\AppData\Local\Temp\opencode\germanos-w1-browser\` (`desktop-month`, `desktop-day`, `desktop-request-error`, `mobile-month`, `mobile-day`). Ο προσωρινός browser runner και οι εικόνες είναι τοπικά artifacts, όχι hosted acceptance ή CI E2E suite.

## Σειρά διάθεσης

Μετά τα τέσσερα authorization/support migrations εφαρμόζεται μία φορά το **`20261105_workforce_read_model.sql`**, πριν από το νέο frontend. Η οθόνη αναφέρει ξεκάθαρα έλλειψη του RPC αντί να γυρνά σιωπηλά σε legacy/unbounded queries. Baseline/παλιά seeds δεν επανεκτελούνται.
