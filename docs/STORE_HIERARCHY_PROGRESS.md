# Store roles and transfers

Κατάσταση: τοπική υλοποίηση και SQL-tested· η migration δεν έχει εφαρμοστεί ή γίνει deploy.

## Συμφωνημένο μοντέλο

- Existing demo stores: όλα χαρακτηρίζονται **Franchise**.
- Προστίθεται κενό demo ιδιόκτητο κατάστημα **ΓΕΡΜΑΝΟΣ Demo Ιδιόκτητο** με κωδικό `DEMO-OWNED-01`, χωρίς ψεύτικους χρήστες ή πωλήσεις.
- Στην εγγραφή στελέχους επιλέγονται τύπος καταστήματος και ρόλος. Οι επιλογές Franchise είναι Ιδιοκτήτης, Διευθυντής, Υποδιευθυντής και Προϊστάμενος καταστήματος. Στα ιδιόκτητα (ΑΦΜ ΓΕΡΜΑΝΟΣ) δεν υπάρχει ρόλος Ιδιοκτήτη.
- Ιεραρχία: Ιδιοκτήτης → Διευθυντής → Υποδιευθυντής → Προϊστάμενος καταστήματος → Υπάλληλος. Αλλαγή ρόλου, έγκριση εγγραφής ή αφαίρεση μέλους απαιτεί ανώτερο επίπεδο. Μόνο master προσθέτει/αλλάζει Ιδιοκτήτη.
- Ιδιοκτήτες Franchise είναι organization memberships, άρα μπορούν να καλύπτουν πολλά καταστήματα και να υπάρχουν πολλοί ανά Franchise. Οι υπόλοιποι ρόλοι αποδίδονται ανά κατάστημα.
- Μεταφορά εργαζομένου υποβάλλεται από τον ίδιο και εγκρίνεται από ανώτερο στέλεχος του καταστήματος υποδοχής. Κατά τη μεταφορά Διευθυντή ή Αναπληρωτή Διευθυντή επιλέγεται διάδοχος· κρατά τον υπάρχοντα βαθμολογικό τίτλο και λαμβάνει προσωρινά τις δυνατότητες αναπλήρωσης.
- Ο master μπορεί να ολοκληρώσει άμεση μεταφορά με αιτιολογία· οι αλλαγές καταγράφονται ως platform audit events.

## Migration / διάθεση

Ο χρήστης επιβεβαίωσε ότι εφάρμοσε το W3 migration `20261105_workforce_w3_leave_transactions.sql`. Η επόμενη migration είναι:

`supabase/migrations/20261105_store_hierarchy_transfers.sql`

Τρέχει **μία φορά, μετά το W3** και πριν από το αντίστοιχο frontend deploy. Δεν ξανατρέχουμε τις προηγούμενες migrations. Το category-points migration `20261105_store_point_categories.sql` ακολουθεί αμέσως μετά. Μετά τοπικό SQL test: role escalation, Franchise/ιδιόκτητο onboarding, πολλαπλοί owners, demo-store seed, ordinary transfer, acting successor και master platform transfer.

Frontend: `src/pages/Login.tsx`, `src/pages/Requests.tsx`, `src/pages/Employees.tsx`, `src/components/StoreTransfers.tsx`, `src/pages/Account.tsx`.
