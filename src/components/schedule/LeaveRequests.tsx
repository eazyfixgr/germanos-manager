import { useId, useState } from 'react'
import Dialog from '../Dialog'
import { Badge, Button, EmptyState, ErrorBox, Field, Input, Select, Textarea } from '../ui'
import type { ScheduleData } from '../../lib/schedule/model'
import { formatScheduleDate, dateValue, type DateRange } from '../../lib/schedule/dates'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/activity'

export function LeaveRequestForm({ storeId, userId, initialDate, onClose, onSaved }: {
  storeId: string; userId: string; initialDate: string; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({ type: 'repo', start: initialDate, end: initialDate, reason: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const formId = useId()
  const dirty = form.type !== 'repo' || form.start !== initialDate || form.end !== initialDate || form.reason !== ''
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('')
    try { dateValue(form.start); dateValue(form.end); if (form.end < form.start) throw new Error('Η λήξη πρέπει να είναι ίδια ή μεταγενέστερη της έναρξης.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Ελέγξτε τις ημερομηνίες.'); return }
    setBusy(true)
    try {
      const { error: saveError } = await supabase.from('leave_requests').insert({ store_id: storeId, user_id: userId,
        type: form.type, start_date: form.start, end_date: form.end, reason: form.reason.trim() || null, status: 'pending' }).select('id').single()
      if (saveError) throw new Error(saveError.message)
      await logActivity('Αίτηση ρεπό/άδειας', `${form.start} → ${form.end}`, storeId).catch(() => {})
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Η αίτηση δεν υποβλήθηκε.') }
    finally { setBusy(false) }
  }
  return <Dialog open title="Η αίτησή μου — άδεια / ρεπό" description="Η αίτηση θα σταλεί στον υπεύθυνο για έγκριση." onClose={onClose} busy={busy} dirty={dirty}
    footer={<><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Ακύρωση</Button><Button type="submit" form={formId} disabled={busy}>{busy ? 'Υποβολή…' : 'Υποβολή αίτησης'}</Button></>}>
    <form id={formId} onSubmit={submit} className="space-y-4">
      <ErrorBox message={error} />
      <Field label="Είδος"><Select value={form.type} disabled={busy} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="repo">Ρεπό</option><option value="adeia">Άδεια</option></Select></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Από"><Input type="date" required value={form.start} disabled={busy} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
        <Field label="Έως"><Input type="date" required min={form.start} value={form.end} disabled={busy} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field></div>
      <Field label="Αιτιολογία (προαιρετικά)"><Textarea rows={3} maxLength={2000} value={form.reason} disabled={busy} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
      <p className="rounded-control bg-blue-50 p-3 text-xs leading-relaxed text-slate-600">Το εκκρεμές ρεπό λαμβάνεται υπόψη ως προτίμηση. Οι εγκεκριμένες άδειες και τα εγκεκριμένα ρεπό δεσμεύουν το πρόγραμμα.</p>
    </form>
  </Dialog>
}

export function LeaveRequests({ data, range, actorId, canManage, canRequest, onClose, onNew, onChanged }: {
  data: ScheduleData; range: DateRange; actorId: string; canManage: boolean; canRequest: boolean
  onClose: () => void; onNew: () => void; onChanged: () => void
}) {
  const [filter, setFilter] = useState('pending')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const relevant = data.leaves.filter((leave) => leave.start_date < range.end && leave.end_date >= range.start
    && (canManage || leave.user_id === actorId))
  const shown = relevant.filter((leave) => filter === 'all' || leave.status === filter)
  async function review(id: string, status: 'approved' | 'rejected') {
    setError(''); setBusy(id)
    try {
      const { error: saveError } = await supabase.from('leave_requests').update({ status, reviewed_by: actorId })
        .eq('id', id).eq('store_id', data.store_id).eq('status', 'pending').select('id').single()
      if (saveError) throw new Error('Η αίτηση δεν ενημερώθηκε. Ίσως άλλαξε ήδη ή δεν έχετε πλέον πρόσβαση. Ανανεώστε την περίοδο.')
      await logActivity(status === 'approved' ? 'Έγκριση αιτήματος' : 'Απόρριψη αιτήματος', id, data.store_id).catch(() => {})
      onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : 'Η αλλαγή δεν αποθηκεύτηκε.') }
    finally { setBusy(null) }
  }
  return <Dialog open size="lg" title="Άδειες & ρεπό" description={`${canManage && data.scope === 'team' ? 'Αιτήσεις καταστήματος' : 'Οι αιτήσεις μου'} · επιλεγμένη περίοδος`} onClose={onClose} busy={Boolean(busy)}
    footer={<><Button type="button" variant="secondary" onClick={onClose} disabled={Boolean(busy)}>Κλείσιμο</Button>{canRequest && <Button type="button" onClick={onNew} disabled={Boolean(busy)}>Νέα αίτηση</Button>}</>}>
    <div className="mb-4 flex flex-wrap gap-2">{[['pending', 'Εκκρεμείς'], ['approved', 'Εγκεκριμένες'], ['rejected', 'Απορριφθείσες'], ['all', 'Όλες']].map(([value, label]) =>
      <Button key={value} type="button" variant={filter === value ? 'primary' : 'secondary'} className="!text-xs" onClick={() => setFilter(value)}>{label}{value === 'pending' ? ` (${relevant.filter((leave) => leave.status === 'pending').length})` : ''}</Button>)}</div>
    <ErrorBox message={error} />
    {shown.length === 0 ? <EmptyState title="Δεν υπάρχουν αιτήσεις σε αυτό το φίλτρο" text="Οι αιτήσεις αφορούν την περίοδο που βλέπετε στο Πρόγραμμα." /> : <div className="grid gap-3 sm:grid-cols-2">
      {shown.map((leave) => <article key={leave.id} className="rounded-xl border border-line p-4">
        <div className="flex items-start justify-between gap-2"><div><h3 className="text-sm font-bold">{data.staff.find((person) => person.id === leave.user_id)?.full_name ?? 'Μέλος καταστήματος'}</h3><p className="mt-1 text-xs text-muted">{leave.type === 'repo' ? 'Ρεπό' : 'Άδεια'}</p></div>
          <Badge className={leave.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : leave.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}>{leave.status === 'approved' ? 'Εγκρίθηκε' : leave.status === 'rejected' ? 'Απορρίφθηκε' : 'Σε αναμονή'}</Badge></div>
        <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs font-semibold">{formatScheduleDate(leave.start_date)} – {formatScheduleDate(leave.end_date)}</p>
        {leave.reason && <p className="mt-3 whitespace-pre-wrap break-words text-xs text-muted">{leave.reason}</p>}
        {canManage && leave.status === 'pending' && <div className="mt-3 flex gap-2"><Button type="button" className="!text-xs" disabled={Boolean(busy)} onClick={() => void review(leave.id, 'approved')}>Έγκριση</Button><Button type="button" variant="danger" className="!text-xs" disabled={Boolean(busy)} onClick={() => void review(leave.id, 'rejected')}>Απόρριψη</Button></div>}
      </article>)}
    </div>}
  </Dialog>
}
