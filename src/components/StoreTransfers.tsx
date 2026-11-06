import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Card, ErrorBox, Field, Input, Select, Spinner, SuccessBox } from './ui'
import type { Profile, Store, StorePosition } from '../lib/types'

type Transfer = {
  id: string; user_id: string; user_name: string; from_store_id: string; from_store_name: string
  to_store_id: string; to_store_name: string; requested_position: StorePosition
  replacement_user_id: string | null; replacement_name: string | null; revision: number
}
type Member = { id: string; full_name: string; position: StorePosition }
const rank: Record<StorePosition, number> = { owner: 0, director: 1, assistant_director: 2, supervisor: 3, employee: 4 }
const labels: Record<StorePosition, string> = {
  owner: 'Ιδιοκτήτης Franchise', director: 'Διευθυντής', assistant_director: 'Υποδιευθυντής',
  supervisor: 'Προϊστάμενος καταστήματος', employee: 'Υπάλληλος',
}

export default function StoreTransfers({ profile, store, onTransferred }: { profile: Profile; store: Store; onTransferred: () => Promise<void> }) {
  const [position, setPosition] = useState<StorePosition>('employee')
  const [members, setMembers] = useState<Member[]>([])
  const [allMembers, setAllMembers] = useState<Member[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [storeNames, setStoreNames] = useState<Record<string, string>>({})
  const [destinationCode, setDestinationCode] = useState('')
  const [replacement, setReplacement] = useState('')
  const [masterTarget, setMasterTarget] = useState('')
  const [masterReason, setMasterReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const [positionResult, memberResult, transferResult] = await Promise.all([
      supabase.rpc('my_store_position', { p_store: store.id }),
      supabase.from('store_memberships').select('user_id,position').eq('store_id', store.id).eq('active', true),
      supabase.rpc('list_store_transfer_requests', { p_store: store.id }),
    ])
    if (positionResult.error || memberResult.error || transferResult.error) {
      setError('Δεν ήταν δυνατή η φόρτωση των αιτημάτων μεταφοράς. Ελέγξτε ότι εφαρμόστηκε το store_hierarchy_transfers migration.')
      setLoading(false); return
    }
    const currentPosition = (positionResult.data ?? 'employee') as StorePosition
    setPosition(currentPosition)
    const membership = memberResult.data ?? []
    const memberIds = membership.map((row) => row.user_id)
    const relevant = (transferResult.data ?? []) as Transfer[]
    const memberProfiles = memberIds.length ? await supabase.from('profiles').select('id,full_name').in('id',memberIds) : {data:[],error:null}
    if (memberProfiles.error) { setError('Δεν ήταν δυνατή η φόρτωση των μελών του καταστήματος.'); setLoading(false); return }
    const peopleNames = Object.fromEntries([...(memberProfiles.data ?? []).map((row) => [row.id,row.full_name]), ...relevant.flatMap((row) => [
      [row.user_id,row.user_name], ...(row.replacement_user_id ? [[row.replacement_user_id,row.replacement_name ?? 'Μέλος']] : []),
    ])])
    setNames(peopleNames)
    setStoreNames(Object.fromEntries(relevant.flatMap((row) => [[row.from_store_id,row.from_store_name],[row.to_store_id,row.to_store_name]])))
    const loadedMembers=membership.map((row) => ({ id: row.user_id, full_name: peopleNames[row.user_id] ?? 'Μέλος', position: row.position as StorePosition }))
    setAllMembers(loadedMembers.filter((member) => member.position!=='owner'))
    setMembers(loadedMembers.filter((member) => member.position === 'assistant_director' || member.position === 'supervisor'))
    setTransfers(relevant)
    setLoading(false)
  }, [profile.id, store.id])

  useEffect(() => { void load() }, [load])

  const incoming = useMemo(() => transfers.filter((request) => request.to_store_id === store.id), [transfers, store.id])
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('')
    const targetPosition=allMembers.find((member)=>member.id===masterTarget)?.position
    const { error: submitError } = profile.role==='master'
      ? await supabase.rpc('master_transfer_member',{p_user:masterTarget,p_to_code:destinationCode.trim(),
        p_replacement:targetPosition==='director'?replacement||null:null,p_reason:masterReason.trim()})
      : await supabase.rpc('submit_store_transfer', {
        p_to_code: destinationCode.trim(), p_replacement: position === 'director' ? replacement || null : null,
      })
    setBusy(false)
    if (submitError) { setError(submitError.message); return }
    setDestinationCode(''); setReplacement(''); setMasterTarget(''); setMasterReason('')
    setSuccess(profile.role==='master'?'Η μεταφορά εκτελέστηκε και καταγράφηκε στο ιστορικό πλατφόρμας.':'Το αίτημα στάλθηκε για έγκριση στο κατάστημα υποδοχής.')
    if(profile.role==='master') await onTransferred()
    await load()
  }

  async function decide(request: Transfer, decision: 'approved' | 'rejected') {
    setBusy(true); setError(''); setSuccess('')
    const { error: decisionError } = await supabase.rpc('review_store_transfer', {
      p_request: request.id, p_revision: request.revision, p_decision: decision,
    })
    setBusy(false)
    if (decisionError) { setError(decisionError.message); return }
    setSuccess(decision === 'approved' ? 'Η μεταφορά εγκρίθηκε και ενεργοποιήθηκε.' : 'Το αίτημα μεταφοράς απορρίφθηκε.')
    await load()
  }

  async function cancel(request: Transfer) {
    setBusy(true); setError(''); setSuccess('')
    const { error: cancelError } = await supabase.rpc('cancel_store_transfer', { p_request: request.id, p_revision: request.revision })
    setBusy(false)
    if (cancelError) { setError(cancelError.message); return }
    setSuccess('Το αίτημα μεταφοράς ακυρώθηκε.')
    await load()
  }

  if (loading) return <Spinner />
  const canDecide = (request: Transfer) => profile.role === 'master' || rank[position] < rank[request.requested_position]
  return <Card>
    <h2 className="font-semibold text-slate-900">Μετακίνηση σε άλλο κατάστημα</h2>
    <p className="mt-1 text-xs text-slate-500">Η μεταφορά ολοκληρώνεται όταν εγκριθεί από ανώτερο ρόλο στο κατάστημα υποδοχής.</p>
    <ErrorBox message={error} /><SuccessBox message={success} />
    {profile.role==='master' ? <form onSubmit={submit} className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Μέλος του ενεργού καταστήματος"><Select required value={masterTarget} onChange={(event)=>{setMasterTarget(event.target.value);setReplacement('')}}>
        <option value="">Επιλέξτε μέλος</option>{allMembers.map((member)=><option key={member.id} value={member.id}>{member.full_name} · {labels[member.position]}</option>)}
      </Select></Field><Field label="Κωδικός καταστήματος υποδοχής"><Input required value={destinationCode} onChange={(event)=>setDestinationCode(event.target.value.toUpperCase())} placeholder="π.χ. G1234" /></Field></div>
      {(allMembers.find((member)=>member.id===masterTarget)?.position==='director' || store.acting_director_id===masterTarget) && <Field label="Προτεινόμενος αναπληρωτής διευθυντή"><Select required value={replacement} onChange={(event)=>setReplacement(event.target.value)}>
        <option value="">Επιλέξτε μέλος</option>{members.map((member)=><option key={member.id} value={member.id}>{member.full_name} · {labels[member.position]}</option>)}
      </Select></Field>}
      <Field label="Αιτιολογία πλατφορμικής μεταφοράς"><Input required minLength={10} maxLength={1000} value={masterReason} onChange={(event)=>setMasterReason(event.target.value)} /></Field>
      <Button type="submit" disabled={busy||!masterTarget}>{busy?'Μεταφορά…':'Μεταφορά μέλους (master)'}</Button>
    </form> : position !== 'owner' && <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Κωδικός καταστήματος υποδοχής"><Input required value={destinationCode} onChange={(event) => setDestinationCode(event.target.value.toUpperCase())} placeholder="π.χ. G1234" /></Field>
      {position === 'director' ? <Field label="Προτεινόμενος αναπληρωτής διευθυντή"><Select required value={replacement} onChange={(event) => setReplacement(event.target.value)}>
        <option value="">Επιλέξτε μέλος</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name} · {labels[member.position]}</option>)}
      </Select></Field> : <div />}
      <Button type="submit" disabled={busy}>{busy ? 'Αποστολή…' : 'Αποστολή αιτήματος'}</Button>
    </form>}
    {transfers.filter((request) => request.user_id === profile.id).map((request) => <div key={request.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
      <span>Εκκρεμεί μεταφορά ως {labels[request.requested_position]} προς {storeNames[request.to_store_id] ?? 'το κατάστημα υποδοχής'}.</span>
      <Button variant="secondary" disabled={busy} onClick={() => void cancel(request)}>Ακύρωση αιτήματος</Button>
    </div>)}
    {incoming.length > 0 && <section className="mt-5 space-y-2">
      <h3 className="text-sm font-semibold">Αιτήματα προς το κατάστημα</h3>
      {incoming.map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
        <div className="text-sm"><b>{names[request.user_id] ?? 'Μέλος'}</b><span className="ml-2 text-xs text-muted">{labels[request.requested_position]} από {storeNames[request.from_store_id] ?? 'άλλο κατάστημα'}</span>
          {request.replacement_user_id && <span className="block text-xs text-muted">Προτεινόμενος αναπληρωτής: {names[request.replacement_user_id] ?? 'Μέλος'} (ο υπάρχων ρόλος δεν αλλάζει)</span>}</div>
        {canDecide(request) && <div className="flex gap-2"><Button disabled={busy} onClick={() => void decide(request, 'approved')}>Έγκριση</Button>
          <Button variant="danger" disabled={busy} onClick={() => void decide(request, 'rejected')}>Απόρριψη</Button></div>}
      </div>)}
    </section>}
  </Card>
}
