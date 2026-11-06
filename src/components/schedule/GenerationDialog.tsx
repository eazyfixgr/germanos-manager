import { useState } from 'react'
import Dialog from '../Dialog'
import { Button, ErrorBox, Field, Input } from '../ui'
import { readSchedule } from '../../lib/schedule/data'
import { monthRange } from '../../lib/schedule/dates'
import { buildSchedule, type ScheduleResult } from '../../lib/scheduleGen'
import { monthLabel } from '../../lib/constants'
import { supabase } from '../../lib/supabase'

export default function GenerationDialog({ storeId, month, onClose, onSaved }: { storeId: string; month: string; onClose: () => void; onSaved: (message: string) => void }) {
  const [target, setTarget] = useState(month)
  const [preview, setPreview] = useState<ScheduleResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function prepare() {
    setError(''); setBusy(true); setPreview(null)
    try {
      const range = monthRange(target)
      const [data, fairness] = await Promise.all([
        readSchedule(storeId, range, 'team'),
        supabase.from('schedule_fairness').select('user_id,split_offs,short_offs').eq('store_id', storeId).lt('month', target),
      ])
      if (fairness.error || !data.can_manage) throw new Error('Δεν ήταν δυνατή η επιβεβαίωση δεδομένων και δικαιωμάτων.')
      if (data.templates?.length || data.requirements?.length) throw new Error('Το κατάστημα χρησιμοποιεί πραγματικά διαστήματα. Η παλιά παραγωγή μήνα δεν αντικαθιστά τις νέες αναθέσεις. Χρησιμοποιήστε την ημερήσια καταχώριση μέχρι τη νέα διαδικασία draft/publish.')
      const employees = data.staff.filter((person) => person.active)
      if (employees.length === 0) throw new Error('Δεν υπάρχουν ενεργά μέλη για δημιουργία προγράμματος.')
      const initialFairness: Record<string, { split: number; short: number }> = {}
      for (const row of (fairness.data ?? []) as { user_id: string; split_offs: number; short_offs: number }[]) {
        const previous = initialFairness[row.user_id] ?? { split: 0, short: 0 }
        initialFairness[row.user_id] = { split: previous.split + Number(row.split_offs), short: previous.short + Number(row.short_offs) }
      }
      const result = buildSchedule({ storeId, month: target, employees, patterns: data.patterns, calendar: data.calendar,
        leaves: data.leaves.filter((leave) => leave.status !== 'revoked').map((leave) => ({ ...leave, status: leave.status as 'pending'|'approved'|'rejected' })),
        minStaff: data.min_staff, initialFairness })
      if (result.shifts.some((shift) => shift.shift_type === 'split')) {
        throw new Error('Η αυτόματη κατανομή δεν έχει ακόμη πραγματικά διαστήματα σπαστού. Δεν αποθηκεύτηκε πρόγραμμα με εκτιμώμενες ώρες· καταχωρίστε τις βάρδιες χειροκίνητα.')
      }
      setPreview(result)
    } catch (e) { setError(e instanceof Error ? e.message : 'Η προετοιμασία απέτυχε.') }
    finally { setBusy(false) }
  }
  async function save() {
    if (!preview) return
    setError(''); setBusy(true)
    try {
      const { error: saveError } = await supabase.rpc('replace_month_shifts', { p_store: storeId, p_month: target, p_shifts: preview.shifts, p_fairness: preview.fairness })
      if (saveError) throw new Error(saveError.message)
      onSaved(`Αποθηκεύτηκαν ${preview.shifts.length} βάρδιες για ${monthLabel(target)}.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Το πρόγραμμα δεν αποθηκεύτηκε.') }
    finally { setBusy(false) }
  }
  return <Dialog open title="Αυτόματη δημιουργία προγράμματος" description="Προετοιμασία με τον υπάρχοντα αλγόριθμο μοτίβων ημέρας" onClose={onClose} busy={busy} size="lg"
    footer={<><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Ακύρωση</Button><Button type="button" onClick={() => void (preview ? save() : prepare())} disabled={busy}>{busy ? 'Επεξεργασία…' : preview ? 'Αντικατάσταση μήνα' : 'Προετοιμασία προγράμματος'}</Button></>}>
    <ErrorBox message={error} />
    <Field label="Μήνας προγράμματος"><Input type="month" value={target} disabled={busy} onChange={(e) => { setTarget(e.target.value); setPreview(null) }} /></Field>
    <p className="mt-4 rounded-control border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">Η τελική αποθήκευση αντικαθιστά τις καταχωρημένες βάρδιες του επιλεγμένου μήνα. Η νέα διαδικασία αποθηκευμένων προσχεδίων και δημοσίευσης θα προστεθεί σε επόμενο στάδιο.</p>
    {preview && <div className="mt-4 space-y-3"><h3 className="font-bold">{monthLabel(target)} · {preview.shifts.length} βάρδιες</h3>
      <p className="text-sm text-muted">Οι εγκεκριμένες άδειες/ρεπό χρησιμοποιήθηκαν ως δεσμευτικές απουσίες. Η στελέχωση ελέγχθηκε με το σημερινό ημερήσιο ελάχιστο.</p>
      {preview.warnings.length > 0 && <div className="rounded-control border border-amber-200 p-3 text-xs"><strong>Προειδοποιήσεις κατανομής</strong><ul className="mt-2 list-inside list-disc space-y-1">{preview.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></div>}
    </div>}
  </Dialog>
}
