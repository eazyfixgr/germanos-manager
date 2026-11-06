import { useId, useState } from 'react'
import Dialog, { DialogCloseButton } from '../Dialog'
import { Button, ErrorBox, Field, Input, Select } from '../ui'
import SegmentFields from './SegmentFields'
import { addDays, todayInAthens } from '../../lib/schedule/dates'
import { validSegments, type ShiftTemplate } from '../../lib/schedule/intervals'
import { shiftLabel } from '../../lib/schedule/model'
import { supabase } from '../../lib/supabase'
import type { ShiftType } from '../../lib/types'

export default function TemplateEditor({ storeId, existing, onClose, onSaved }: {
  storeId: string; existing?: ShiftTemplate; onClose: () => void; onSaved: () => void
}) {
  const [today] = useState(todayInAthens)
  const [initial] = useState(() => ({ id: existing?.id, revision: existing?.revision,
    code: existing?.code ?? `shift_${crypto.randomUUID().slice(0, 8)}`, name: existing?.name ?? '', short_label: existing?.short_label ?? '',
    color: existing?.color ?? '#4365ed', legacy_type: existing?.legacy_type ?? 'full',
    segments: existing?.segments ?? [{ start: '', end: '' }],
    valid_from: existing?.last_assigned_date ? [today, addDays(existing.last_assigned_date, 1), addDays(existing.valid_from, 1)].sort().at(-1)!
      : existing ? [today, existing.valid_from].sort().at(-1)! : today,
    valid_to: existing?.valid_to ?? '',
  }))
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = useId()
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError('')
    if (!validSegments(form.segments) || (form.legacy_type === 'split' &&
      (form.segments.length !== 2 || form.segments[1].start <= form.segments[0].end))) {
      setError('Ορίστε διαδοχικά, μη επικαλυπτόμενα διαστήματα. Το σπαστό χρειάζεται δύο διαστήματα με κενό.'); return
    }
    setBusy(true)
    try {
      const { error: saveError } = await supabase.rpc('save_shift_template', { p_store: storeId, p_template: { ...form, valid_to: form.valid_to || null } })
      if (saveError) throw new Error(saveError.message)
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Ο τύπος δεν αποθηκεύτηκε.') }
    finally { setBusy(false) }
  }
  return <Dialog open title={existing ? 'Έκδοση τύπου βάρδιας' : 'Νέος τύπος βάρδιας'} description="Ονόματα, πραγματικά διαστήματα και ημερομηνίες ισχύος" onClose={onClose} busy={busy}
    dirty={JSON.stringify(initial) !== JSON.stringify(form)} size="lg"
    footer={<><DialogCloseButton disabled={busy}>Ακύρωση</DialogCloseButton><Button type="submit" form={id} disabled={busy}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση τύπου'}</Button></>}>
    <form id={id} onSubmit={save} className="space-y-4"><ErrorBox message={error} />
      <div className="grid gap-3 sm:grid-cols-[1fr_110px]"><Field label="Όνομα"><Input required maxLength={100} value={form.name} disabled={busy} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="π.χ. Πρωινό" /></Field>
        <Field label="Συντομογραφία"><Input required maxLength={4} value={form.short_label} disabled={busy} onChange={(e) => setForm({ ...form, short_label: e.target.value })} placeholder="π.χ. Π" /></Field></div>
      <div className="grid grid-cols-[1fr_90px] gap-3"><Field label="Βασικός τύπος"><Select value={form.legacy_type} disabled={busy} onChange={(e) => {
        const type = e.target.value as ShiftType
        setForm({ ...form, legacy_type: type, segments: type === 'split' ? [form.segments[0], form.segments[1] ?? { start: '', end: '' }] : [form.segments[0]] })
      }}>{['open', 'mid', 'close', 'full', 'short', 'split', 'custom'].map((type) => <option value={type} key={type}>{shiftLabel(type)}</option>)}</Select></Field>
        <Field label="Χρώμα"><Input type="color" value={form.color} disabled={busy} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field></div>
      <SegmentFields value={form.segments} onChange={(segments) => setForm({ ...form, segments })} disabled={busy} />
      <div className="grid grid-cols-2 gap-3"><Field label="Ισχύει από"><Input type="date" min={today} required value={form.valid_from} disabled={busy} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></Field>
        <Field label="Έως (προαιρετικά)"><Input type="date" min={form.valid_from} value={form.valid_to} disabled={busy} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} /></Field></div>
      {existing && <p className="rounded-control bg-blue-50 p-3 text-xs leading-relaxed text-slate-600">Οι χρησιμοποιημένες εκδόσεις μένουν στο ιστορικό. Νέα ισχύς δημιουργεί έκδοση χωρίς να ξαναγράφει ήδη ανατεθειμένες βάρδιες.</p>}
    </form>
  </Dialog>
}
