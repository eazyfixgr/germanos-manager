import { useId, useState } from 'react'
import Dialog, { DialogCloseButton } from '../Dialog'
import { Badge, Button, EmptyState, ErrorBox, Field, Input, Select, Textarea } from '../ui'
import type { ScheduleData } from '../../lib/schedule/model'
import { formatScheduleDate, dateValue, type DateRange } from '../../lib/schedule/dates'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/activity'
import { estimateLeaveDays, leaveLedgerSummary, type LeaveDayEstimate } from '../../lib/schedule/leaveEstimate'

export function LeaveRequestForm({ data, initialDate, onClose, onSaved }: {
  data: ScheduleData; initialDate: string; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({ type: 'repo', start: initialDate, end: initialDate, reason: '' })
  const [restDates, setRestDates] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const formId = useId()
  const dirty = form.type !== 'repo' || form.start !== initialDate || form.end !== initialDate || form.reason !== '' || restDates.length > 0
  let estimate = null
  let estimateError = ''
  try { if (form.start && form.end && form.end >= form.start) estimate = estimateLeaveDays({ storeId: data.store_id,
    type: form.type as 'repo'|'adeia', start: form.start, end: form.end, selectedRests: restDates,
    patterns: data.patterns, calendar: data.calendar, shifts: data.shifts }) }
  catch (e) { estimateError = e instanceof Error ? e.message : 'Ελέγξτε το διάστημα.' }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('')
    try { dateValue(form.start); dateValue(form.end); if (form.end < form.start) throw new Error('Η λήξη πρέπει να είναι ίδια ή μεταγενέστερη της έναρξης.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Ελέγξτε τις ημερομηνίες.'); return }
    setBusy(true)
    try {
      const { error: saveError } = await supabase.rpc('submit_leave_request', { p_store: data.store_id, p_type: form.type,
        p_start: form.start, p_end: form.end, p_reason: form.reason.trim() || null, p_requested_rest_dates: restDates })
      if (saveError) throw new Error(saveError.code === 'PGRST202' ? 'Η συναλλαγή αιτήσεων απαιτεί το workforce_w3_leave_transactions migration.' : saveError.message)
      await logActivity('Αίτηση ρεπό/άδειας', `${form.start} → ${form.end}`, data.store_id).catch(() => {})
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Η αίτηση δεν υποβλήθηκε.') }
    finally { setBusy(false) }
  }
  return <Dialog open size="lg" title="Η αίτησή μου — άδεια / ρεπό" description="Η αίτηση θα σταλεί στον υπεύθυνο για έγκριση. Η προεπισκόπηση είναι ενδεικτική μέχρι να ελεγχθεί από τον υπεύθυνο." onClose={onClose} busy={busy} dirty={dirty}
    footer={<><DialogCloseButton disabled={busy}>Ακύρωση</DialogCloseButton><Button type="submit" form={formId} disabled={busy}>{busy ? 'Υποβολή…' : 'Υποβολή αίτησης'}</Button></>}>
    <form id={formId} onSubmit={submit} className="space-y-4">
      <ErrorBox message={error} />
      <Field label="Είδος"><Select value={form.type} disabled={busy} onChange={(e) => { const type=e.target.value; setForm({ ...form, type }); if(type!=='adeia') setRestDates([]) }}><option value="repo">Ρεπό</option><option value="adeia">Άδεια</option></Select></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Από"><Input type="date" required value={form.start} disabled={busy} onChange={(e) => { const start=e.target.value; setForm({ ...form, start }); setRestDates((old)=>old.filter((day)=>day>=start&&day<=form.end)) }} /></Field>
        <Field label="Έως"><Input type="date" required min={form.start} value={form.end} disabled={busy} onChange={(e) => { const end=e.target.value; setForm({ ...form, end }); setRestDates((old)=>old.filter((day)=>day>=form.start&&day<=end)) }} /></Field></div>
      <Field label="Αιτιολογία (προαιρετικά)"><Textarea rows={3} maxLength={2000} value={form.reason} disabled={busy} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
      <div className="rounded-xl border border-line p-4"><h3 className="text-sm font-bold">Προεπισκόπηση ημερών</h3>
        {estimateError ? <p className="mt-2 text-xs text-amber-800">{estimateError}</p> : estimate && <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-slate-50 p-2"><b>{estimate.length}</b><small className="mt-1 block text-[10px] text-muted">Ημερολογιακές</small></div><div className="rounded-lg bg-blue-50 p-2"><b>{estimate.filter((day) => day.disposition === 'charged_leave').length}</b><small className="mt-1 block text-[10px] text-muted">Εκτίμηση χρέωσης</small></div><div className="rounded-lg bg-emerald-50 p-2"><b>{estimate.filter((day) => day.disposition !== 'charged_leave').length}</b><small className="mt-1 block text-[10px] text-muted">Εξαιρούμενες</small></div></div>
          {form.type === 'adeia' && estimate.some((day) => ['charged_leave','requested_rest'].includes(day.disposition)) && <div className="mt-4"><p className="text-xs font-semibold">Πρότεινε πρόσθετα ρεπό μέσα στην άδεια</p><p className="mt-1 text-[11px] text-muted">Ο υπεύθυνος θα επιβεβαιώσει την τελική χρέωση.</p><div className="mt-2 flex flex-wrap gap-2">{estimate.filter((day) => day.disposition === 'charged_leave' || day.disposition === 'requested_rest').map((day) => <label key={day.date} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-xs"><input type="checkbox" disabled={busy} checked={restDates.includes(day.date)} onChange={(e) => setRestDates((old) => e.target.checked ? [...old,day.date].sort() : old.filter((value) => value!==day.date))} />{formatScheduleDate(day.date)}</label>)}</div></div>}
          <ul className="mt-3 max-h-40 space-y-1 overflow-auto text-[11px]">{estimate.map((day) => <li key={day.date} className="flex justify-between gap-2"><span>{formatScheduleDate(day.date)}</span><span className={day.disposition==='charged_leave'?'text-blue-700':'text-muted'}>{day.disposition==='charged_leave'?'Πιθανή χρέωση':day.reason}</span></li>)}</ul>
        </>}
      </div>
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
  const [reviewing, setReviewing] = useState<ScheduleData['leaves'][number] | null>(null)
  const [reviewError, setReviewError] = useState('')
  const relevant = data.leaves.filter((leave) => leave.start_date < range.end && leave.end_date >= range.start
    && (canManage || leave.user_id === actorId))
  const shown = relevant.filter((leave) => filter === 'all' || leave.status === filter)
  async function review(id: string, status: 'approved' | 'rejected', restDates?: string[]) {
    setError(''); setBusy(id)
    try {
      if (!data.leaves.find((leave) => leave.id === id)?.revision) throw new Error('Απαιτείται το W3 migration αιτήσεων. Ανανεώστε τη βάση πριν συνεχίσετε.')
      const { error: saveError } = await supabase.rpc('review_leave_request', { p_store: data.store_id, p_request: id,
        p_revision: data.leaves.find((leave) => leave.id === id)!.revision, p_decision: status, p_selected_rest_dates: restDates ?? null })
      if (saveError) throw new Error(saveError.message)
      await logActivity(status === 'approved' ? 'Έγκριση αιτήματος' : 'Απόρριψη αιτήματος', id, data.store_id).catch(() => {})
      setReviewing(null)
      onChanged()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Η αλλαγή δεν αποθηκεύτηκε.'
      if (reviewing?.id === id) setReviewError(message); else setError(message)
    }
    finally { setBusy(null) }
  }
  async function revoke(leave: ScheduleData['leaves'][number]) {
    setError(''); setBusy(leave.id)
    try {
      if (!leave.revision) throw new Error('Απαιτείται το W3 migration αιτήσεων. Ανανεώστε τη βάση πριν συνεχίσετε.')
      const { error: revokeError } = await supabase.rpc('revoke_leave_request', { p_store: data.store_id, p_request: leave.id, p_revision: leave.revision })
      if (revokeError) throw new Error(revokeError.message)
      onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : 'Η αίτηση δεν ανακλήθηκε.') }
    finally { setBusy(null) }
  }
  return <><Dialog open size="lg" title="Άδειες & ρεπό" description={`${canManage && data.scope === 'team' ? 'Αιτήσεις καταστήματος' : 'Οι αιτήσεις μου'} · επιλεγμένη περίοδος`} onClose={onClose} busy={Boolean(busy)}
    footer={<><Button type="button" variant="secondary" onClick={onClose} disabled={Boolean(busy)}>Κλείσιμο</Button>{canRequest && <Button type="button" onClick={onNew} disabled={Boolean(busy)}>Νέα αίτηση</Button>}</>}>
    <div className="mb-4 flex flex-wrap gap-2">{[['pending', 'Εκκρεμείς'], ['approved', 'Εγκεκριμένες'], ['rejected', 'Απορριφθείσες'], ['revoked','Ανακληθείσες'], ['all', 'Όλες']].map(([value, label]) =>
      <Button key={value} type="button" variant={filter === value ? 'primary' : 'secondary'} className="!text-xs" onClick={() => setFilter(value)}>{label}{value === 'pending' ? ` (${relevant.filter((leave) => leave.status === 'pending').length})` : ''}</Button>)}</div>
    <ErrorBox message={error} />
    {shown.length === 0 ? <EmptyState title="Δεν υπάρχουν αιτήσεις σε αυτό το φίλτρο" text="Οι αιτήσεις αφορούν την περίοδο που βλέπετε στο Πρόγραμμα." /> : <div className="grid gap-3 sm:grid-cols-2">
      {shown.map((leave) => <article key={leave.id} className="rounded-xl border border-line p-4">
        <div className="flex items-start justify-between gap-2"><div><h3 className="text-sm font-bold">{data.staff.find((person) => person.id === leave.user_id)?.full_name ?? 'Μέλος καταστήματος'}</h3><p className="mt-1 text-xs text-muted">{leave.type === 'repo' ? 'Ρεπό' : 'Άδεια'}</p></div>
          <Badge className={leave.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : leave.status === 'revoked' ? 'bg-slate-100 text-slate-600' : leave.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}>{leave.status === 'approved' ? 'Εγκρίθηκε' : leave.status === 'rejected' ? 'Απορρίφθηκε' : leave.status === 'revoked' ? 'Ανακλήθηκε' : 'Σε αναμονή'}</Badge></div>
        <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs font-semibold">{formatScheduleDate(leave.start_date)} – {formatScheduleDate(leave.end_date)}</p>
        {leave.reason && <p className="mt-3 whitespace-pre-wrap break-words text-xs text-muted">{leave.reason}</p>}
        {leave.status === 'approved' && <details className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
          <summary className="cursor-pointer font-semibold">Χρεώσιμες ημέρες άδειας: {leaveLedgerSummary(leave).charged ?? '—'} · Ανάλυση ημερών</summary>
          <ul className="mt-2 space-y-1">{leaveLedgerSummary(leave).days.map((day) => <li key={day.date} className="flex justify-between gap-3"><span>{formatScheduleDate(day.date)}</span><span>{day.disposition==='charged_leave'?'Χρεώθηκε':day.disposition==='requested_rest'?'Επιλεγμένο πρόσθετο ρεπό':day.disposition==='preexisting_rest'?'Προϋπάρχον ρεπό':day.disposition==='approved_rest'?'Εγκεκριμένο ρεπό':'Κλειστό κατάστημα'}</span></li>)}</ul>
        </details>}
        {canManage && leave.status === 'pending' && leave.user_id !== actorId && <div className="mt-3 flex gap-2"><Button type="button" className="!text-xs" disabled={Boolean(busy)} onClick={() => { setReviewError(''); setReviewing(leave) }}>Έγκριση / έλεγχος</Button><Button type="button" variant="danger" className="!text-xs" disabled={Boolean(busy)} onClick={() => void review(leave.id, 'rejected')}>Απόρριψη</Button></div>}
        {canManage && leave.status === 'pending' && leave.user_id === actorId && <p className="mt-3 text-xs text-amber-800">Η δική σας αίτηση χρειάζεται έγκριση από άλλον υπεύθυνο.</p>}
        {leave.status === 'approved' && canManage && <Button type="button" variant="danger" className="mt-3 !text-xs" disabled={Boolean(busy)} onClick={() => void revoke(leave)}>Ανάκληση έγκρισης</Button>}
        {leave.status === 'pending' && leave.user_id === actorId && <Button type="button" variant="secondary" className="mt-3 !text-xs" disabled={Boolean(busy)} onClick={() => void revoke(leave)}>Ακύρωση αίτησης</Button>}
      </article>)}
    </div>}
  </Dialog>
  {reviewing && <LeaveReviewDialog data={data} leave={reviewing} busy={busy === reviewing.id} error={reviewError} onClose={() => { setReviewing(null); setReviewError('') }} onConfirm={(rests) => void review(reviewing.id,'approved',rests)} />}</>
}

function LeaveReviewDialog({ data, leave, busy, error, onClose, onConfirm }: {
  data: ScheduleData; leave: ScheduleData['leaves'][number]; busy: boolean; error: string; onClose: () => void; onConfirm: (rests: string[]) => void
}) {
  let eligibleDates: string[]=[]
  try { eligibleDates=estimateLeaveDays({ storeId:data.store_id,type:leave.type,start:leave.start_date,end:leave.end_date,
    patterns:data.patterns,calendar:data.calendar,shifts:data.shifts }).filter((day)=>day.disposition==='charged_leave').map((day)=>day.date) }
  catch { /* Server review performs validation and returns a visible error. */ }
  const [rests,setRests]=useState(()=> (leave.requested_rest_dates ?? []).filter((date)=>eligibleDates.includes(date)))
  let estimate: LeaveDayEstimate[]=[]
  try { estimate=estimateLeaveDays({ storeId:data.store_id,type:leave.type,start:leave.start_date,end:leave.end_date,selectedRests:rests,patterns:data.patterns,calendar:data.calendar,shifts:data.shifts }) }
  catch { /* Approval RPC remains authoritative and will return a validation error. */ }
  return <Dialog open size="lg" title="Έλεγχος άδειας / ρεπό" description="Ελέγξτε τις ημερομηνίες και τις προτιμήσεις πριν την έγκριση." onClose={onClose} busy={busy} dirty={JSON.stringify(rests)!==JSON.stringify(leave.requested_rest_dates??[])}
    footer={<><DialogCloseButton disabled={busy}>Επιστροφή</DialogCloseButton><Button type="button" disabled={busy} onClick={() => onConfirm(leave.type==='adeia'?rests:[])}>{busy?'Έγκριση…':'Έγκριση και εφαρμογή'}</Button></>}>
    <ErrorBox message={error} />
    <p className="text-sm"><b>{data.staff.find((person)=>person.id===leave.user_id)?.full_name ?? 'Μέλος καταστήματος'}</b> · {formatScheduleDate(leave.start_date)} – {formatScheduleDate(leave.end_date)}</p>
    {leave.type==='adeia' && <div className="mt-4 rounded-xl border border-line p-4"><p className="text-sm font-bold">Πρόσθετα ρεπό μέσα στην άδεια</p><p className="mt-1 text-xs text-muted">Επιλογή υπευθύνου πριν από την έγκριση· η τελική απόφαση καταγράφεται.</p>
      <div className="mt-3 flex flex-wrap gap-2">{estimate.filter((day)=>day.disposition==='charged_leave'||day.disposition==='requested_rest').map((day)=><label key={day.date} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-xs"><input type="checkbox" disabled={busy} checked={rests.includes(day.date)} onChange={(event)=>setRests((old)=>event.target.checked?[...old,day.date].sort():old.filter((value)=>value!==day.date))}/>{formatScheduleDate(day.date)}</label>)}</div>
      <div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-lg bg-blue-50 p-3 text-sm"><b>{estimate.filter((day)=>day.disposition==='charged_leave').length}</b><span className="ml-2 text-xs">εκτίμηση χρέωσης</span></div><div className="rounded-lg bg-emerald-50 p-3 text-sm"><b>{estimate.filter((day)=>day.disposition!=='charged_leave').length}</b><span className="ml-2 text-xs">εξαιρούμενες ημέρες</span></div></div>
    </div>}
    <ul className="mt-4 max-h-48 space-y-1 overflow-auto text-xs">{estimate.map((day)=><li key={day.date} className="flex justify-between gap-3"><span>{formatScheduleDate(day.date)}</span><span className={day.disposition==='charged_leave'?'text-blue-700':'text-muted'}>{day.disposition==='charged_leave'?'Χρεώσιμη εργάσιμη':day.reason}</span></li>)}</ul>
  </Dialog>
}
