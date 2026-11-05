import { useId, useState } from 'react'
import Dialog from '../Dialog'
import { Button, ErrorBox, Field, Input, Select } from '../ui'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/activity'
import { SHIFT_TYPE } from '../../lib/constants'
import { formatScheduleDate } from '../../lib/schedule/dates'
import { shiftLabel, type StaffDay } from '../../lib/schedule/model'
import type { ShiftType } from '../../lib/types'

export default function ShiftEditor({ storeId, date, row, closed, openingHours, onClose, onSaved }: {
  storeId: string; date: string; row: StaffDay; closed: boolean; openingHours?: string | null; onClose: () => void; onSaved: () => void
}) {
  const initial = { type: row.shift?.shift_type ?? 'custom', start: row.shift?.start_time?.slice(0, 5) ?? '', end: row.shift?.end_time?.slice(0, 5) ?? '' }
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const formId = useId()
  const absence = form.type === 'repo' || form.type === 'adeia'
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError('')
    if (row.approved || !row.person.active) { setError('Η εγκεκριμένη απουσία ή το ιστορικό μέλους δεν αλλάζει από εδώ.'); return }
    if (!absence && (closed || !form.start || !form.end || form.start >= form.end)) {
      setError(closed ? 'Η ημέρα έχει δηλωθεί κλειστή. Ενημερώστε πρώτα το ωράριο.' : 'Ορίστε έγκυρη ώρα έναρξης και λήξης.'); return
    }
    if (!absence && openingHours) {
      const [open, close] = openingHours.split('–')
      if (form.start < open || form.end > close) { setError(`Η βάρδια πρέπει να βρίσκεται εντός ωραρίου ${openingHours}.`); return }
    }
    setBusy(true)
    try {
      const payload = { shift_type: form.type, start_time: absence ? null : form.start, end_time: absence ? null : form.end }
      const result = row.shift
        ? await supabase.from('shifts').update(payload).eq('id', row.shift.id).eq('store_id', storeId).select('id').single()
        : await supabase.from('shifts').insert({ ...payload, store_id: storeId, user_id: row.person.id, date }).select('id').single()
      if (result.error) throw new Error(result.error.message)
      await logActivity('Αλλαγή βάρδιας', `${date} · ${row.person.full_name} · ${shiftLabel(form.type)}`, storeId).catch(() => {})
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Η βάρδια δεν αποθηκεύτηκε.') }
    finally { setBusy(false) }
  }
  return <Dialog open title="Χειροκίνητη βάρδια" description={`${row.person.full_name} · ${formatScheduleDate(date, true)}`}
    onClose={onClose} busy={busy} dirty={dirty}
    footer={<><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Ακύρωση</Button><Button type="submit" form={formId} disabled={busy}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση βάρδιας'}</Button></>}>
    <form id={formId} onSubmit={save} className="space-y-4">
      <ErrorBox message={error} />
      <Field label="Τύπος βάρδιας"><Select value={form.type} disabled={busy} onChange={(e) => setForm({ ...form, type: e.target.value as ShiftType })}>
        {Object.keys(SHIFT_TYPE).map((type) => <option key={type} value={type}>{shiftLabel(type)}</option>)}
      </Select></Field>
      {!absence && <div className="grid grid-cols-2 gap-3"><Field label="Έναρξη"><Input type="time" required value={form.start} disabled={busy} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
        <Field label="Λήξη"><Input type="time" required value={form.end} disabled={busy} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field></div>}
      {form.type === 'split' && <p className="rounded-control bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">Η υπάρχουσα καταχώριση σπαστού αποθηκεύει ένα συνολικό εύρος. Η διάκριση των δύο διαστημάτων θα προστεθεί με τις νέες ρυθμίσεις βαρδιών.</p>}
    </form>
  </Dialog>
}
