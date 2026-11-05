import { useId, useState } from 'react'
import Dialog from '../Dialog'
import { Button, ErrorBox, Field, Input, Select } from '../ui'
import { todayInAthens, WEEKDAYS } from '../../lib/schedule/dates'
import type { ShiftTemplate, StaffingRequirement } from '../../lib/schedule/intervals'
import { supabase } from '../../lib/supabase'

export default function RequirementEditor({ storeId, templates, existing, onClose, onSaved }: {
  storeId: string; templates: ShiftTemplate[]; existing?: StaffingRequirement; onClose: () => void; onSaved: () => void
}) {
  const [today] = useState(todayInAthens)
  const [initial] = useState(() => ({ id: existing?.id, revision: existing?.revision, template_code: existing?.template_code ?? '',
    weekday: existing?.weekday ?? 1, start_time: existing?.start_time ?? '', end_time: existing?.end_time ?? '', minimum: existing?.minimum ?? 1,
    valid_from: existing?.valid_from ?? today, valid_to: existing?.valid_to ?? '' }))
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = useId()
  const types = [...new Map(templates.filter((item) => item.active).map((item) => [item.code, item])).values()]
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError('')
    if (!form.start_time || form.start_time >= form.end_time || !Number.isInteger(form.minimum) || form.minimum < 0) {
      setError('Ελέγξτε το διάστημα και τον απαιτούμενο αριθμό ατόμων.'); return
    }
    setBusy(true)
    try {
      const { error: saveError } = await supabase.rpc('save_staffing_requirement', { p_store: storeId, p_requirement: { ...form, template_code: form.template_code || null, valid_to: form.valid_to || null } })
      if (saveError) throw new Error(saveError.message)
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Η ανάγκη δεν αποθηκεύτηκε.') }
    finally { setBusy(false) }
  }
  return <Dialog open title="Ανάγκη στελέχωσης" description="Ελάχιστα άτομα για συγκεκριμένο πραγματικό διάστημα" size="lg" onClose={onClose} busy={busy} dirty={JSON.stringify(form) !== JSON.stringify(initial)}
    footer={<><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Ακύρωση</Button><Button type="submit" form={id} disabled={busy}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση ανάγκης'}</Button></>}>
    <form id={id} onSubmit={save} className="space-y-4"><ErrorBox message={error} />
      <div className="grid grid-cols-2 gap-3"><Field label="Ημέρα"><Select value={form.weekday} disabled={busy} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}>{WEEKDAYS.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</Select></Field>
        <Field label="Τύπος προσωπικού"><Select value={form.template_code} disabled={busy} onChange={(e) => setForm({ ...form, template_code: e.target.value })}><option value="">Οποιαδήποτε βάρδια</option>{types.map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}</Select></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Από ώρα"><Input type="time" required disabled={busy} value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></Field>
        <Field label="Έως ώρα"><Input type="time" required disabled={busy} value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></Field></div>
      <Field label="Ελάχιστα άτομα"><Input type="number" min={0} max={500} step={1} required disabled={busy} value={form.minimum} onChange={(e) => setForm({ ...form, minimum: Number(e.target.value) })} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Ισχύει από"><Input type="date" required min={today} disabled={busy} value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></Field>
        <Field label="Έως (προαιρετικά)"><Input type="date" min={form.valid_from} disabled={busy} value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} /></Field></div>
      <p className="rounded-control bg-blue-50 p-3 text-xs leading-relaxed text-slate-600">Δηλώστε ανάγκες σε όλο το ωράριο που θέλετε να ελέγχεται. Στο κενό του σπαστού ο εργαζόμενος δεν προσμετράται. Το 0 δηλώνει ρητά διάστημα χωρίς απαίτηση προσωπικού.</p>
    </form>
  </Dialog>
}

export function EndRequirement({ storeId, requirement, onClose, onSaved }: { storeId: string; requirement: StaffingRequirement; onClose: () => void; onSaved: () => void }) {
  const [until, setUntil] = useState(() => [todayInAthens(), requirement.valid_from].sort().at(-1)!)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <Dialog open title="Λήξη ανάγκης στελέχωσης" description="Το ιστορικό έως τη δηλωμένη ημέρα παραμένει." onClose={onClose} busy={busy}
    footer={<><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Ακύρωση</Button><Button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError('')
      try {
        const { error: saveError } = await supabase.rpc('end_staffing_requirement', { p_store: storeId, p_id: requirement.id, p_revision: requirement.revision, p_until: until })
        if (saveError) throw new Error(saveError.message)
        onSaved()
      } catch (e) { setError(e instanceof Error ? e.message : 'Η λήξη δεν αποθηκεύτηκε.') } finally { setBusy(false) }
    }}>Ορισμός λήξης</Button></>}><ErrorBox message={error} /><Field label="Τελευταία ημέρα ισχύος"><Input type="date" required min={todayInAthens()} disabled={busy} value={until} onChange={(e) => setUntil(e.target.value)} /></Field></Dialog>
}
