import { useId, useState } from 'react'
import Dialog from '../Dialog'
import { Button, ErrorBox, Field, Select, Textarea } from '../ui'
import { supabase } from '../../lib/supabase'
import { SHIFT_TYPE } from '../../lib/constants'
import { formatScheduleDate } from '../../lib/schedule/dates'
import { shiftLabel, type StaffDay } from '../../lib/schedule/model'
import { formatSegments, resolvedSegments, templateApplies, validSegments, type ShiftTemplate } from '../../lib/schedule/intervals'
import SegmentFields from './SegmentFields'
import type { ShiftType } from '../../lib/types'

export default function ShiftEditor({ storeId, date, row, closed, openingHours, templates = [], onClose, onSaved }: {
  storeId: string; date: string; row: StaffDay; closed: boolean; openingHours?: string | null; templates?: ShiftTemplate[]; onClose: () => void; onSaved: () => void
}) {
  const [initial] = useState(() => ({ type: row.shift?.shift_type ?? 'custom', templateId: row.shift?.template_id ?? '',
    segments: resolvedSegments(row.shift)?.length ? resolvedSegments(row.shift)! : row.shift?.shift_type === 'split'
      ? [{ start: '', end: '' }, { start: '', end: '' }] : [{ start: '', end: '' }], note: row.shift?.note ?? '' }))
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const formId = useId()
  const options = templates.filter((template) => templateApplies(template, date) || template.id === row.shift?.template_id)
  const selected = options.find((template) => template.id === form.templateId)
  const type = selected?.legacy_type ?? form.type
  const absence = type === 'repo' || type === 'adeia'
  const segments = selected?.segments ?? form.segments
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError('')
    if (row.approved || !row.person.active) { setError('Η εγκεκριμένη απουσία ή το ιστορικό μέλους δεν αλλάζει από εδώ.'); return }
    if (!absence && (closed || !validSegments(segments) || (type === 'split' && (segments.length !== 2 || segments[1].start <= segments[0].end)))) {
      setError(closed ? 'Η ημέρα έχει δηλωθεί κλειστή.' : 'Ορίστε πραγματικά, μη επικαλυπτόμενα διαστήματα. Το σπαστό χρειάζεται δύο με κενό.'); return
    }
    if (!absence && openingHours) {
      const [open, close] = openingHours.split('–')
      if (segments[0].start < open || segments.at(-1)!.end > close) { setError(`Η βάρδια πρέπει να βρίσκεται εντός ωραρίου ${openingHours}.`); return }
    }
    setBusy(true)
    try {
      const { error: saveError } = await supabase.rpc('save_shift_assignment', { p_store: storeId, p_assignment: {
        id: row.shift?.id ?? null, revision: row.shift?.revision ?? 0, user_id: row.person.id, date,
        template_id: selected?.id ?? null, shift_type: type, segments: absence ? null : segments, note: form.note,
      } })
      if (saveError) throw new Error(saveError.code === 'PGRST202' ? 'Η ανάθεση διαστημάτων απαιτεί τα W2 migrations.' : saveError.message)
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Η βάρδια δεν αποθηκεύτηκε.') }
    finally { setBusy(false) }
  }
  return <Dialog open title="Χειροκίνητη βάρδια" description={`${row.person.full_name} · ${formatScheduleDate(date, true)}`}
    onClose={onClose} busy={busy} dirty={JSON.stringify(form) !== JSON.stringify(initial)}
    footer={<><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Ακύρωση</Button><Button type="submit" form={formId} disabled={busy}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση βάρδιας'}</Button></>}>
    <form id={formId} onSubmit={save} className="space-y-4"><ErrorBox message={error} />
      {options.length > 0 && <Field label="Τύπος καταστήματος"><Select value={form.templateId} disabled={busy} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
        <option value="">Χειροκίνητα διαστήματα</option>{options.map((template) => <option key={template.id} value={template.id}>{template.name}{!template.active ? ' · ιστορικό' : ''}</option>)}
      </Select></Field>}
      {!selected && <Field label="Τύπος βάρδιας"><Select value={form.type} disabled={busy} onChange={(e) => {
        const next = e.target.value as ShiftType
        setForm({ ...form, type: next, segments: next === 'split' ? [form.segments[0], form.segments[1] ?? { start: '', end: '' }] : [form.segments[0]] })
      }}>{Object.keys(SHIFT_TYPE).map((value) => <option key={value} value={value}>{shiftLabel(value)}</option>)}</Select></Field>}
      {!absence && (selected ? <p className="rounded-control bg-blue-50 p-3 text-sm">{formatSegments(selected.segments)}</p>
        : <SegmentFields value={form.segments} onChange={(value) => setForm({ ...form, segments: value })} disabled={busy} />)}
      <Field label="Σημείωση (προαιρετικά)"><Textarea rows={2} value={form.note} disabled={busy} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
    </form>
  </Dialog>
}
