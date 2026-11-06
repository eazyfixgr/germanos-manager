import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate } from '../lib/constants'
import { logActivity } from '../lib/activity'
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui'
import type { Profile, StorePosition } from '../lib/types'

type Row = Profile & { stores: { name: string; code: string | null } | null; membershipPosition: StorePosition }

const titles: Record<StorePosition, string> = {
  owner: 'Ιδιοκτήτης Franchise', director: 'Διευθυντής', assistant_director: 'Υποδιευθυντής',
  supervisor: 'Προϊστάμενος καταστήματος', employee: 'Υπάλληλος',
}
const rank: Record<StorePosition, number> = { owner: 0, director: 1, assistant_director: 2, supervisor: 3, employee: 4 }

export default function Employees() {
  const { profile, store, isAdmin, isMaster, refreshProfile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actorPosition, setActorPosition] = useState<StorePosition>('employee')

  const load = useCallback(async () => {
    let q = supabase
      .from('profiles')
      .select('*, stores:stores!profiles_store_id_fkey(name, code)')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    q = q.eq('store_id', store?.id ?? '00000000-0000-0000-0000-000000000000')
    const { data } = await q
    const profiles = (data ?? []) as Omit<Row, 'membershipPosition'>[]
    const [{ data: memberships }, { data: currentPosition }] = await Promise.all([
      supabase.from('store_memberships').select('user_id,position').eq('store_id', store?.id ?? '').eq('active', true),
      store ? supabase.rpc('my_store_position', { p_store: store.id }) : Promise.resolve({ data: 'employee' }),
    ])
    const positionByUser = new Map((memberships ?? []).map((member) => [member.user_id, member.position as StorePosition]))
    setRows(profiles.map((person) => ({ ...person, membershipPosition: positionByUser.get(person.id) ?? person.store_position })))
    setActorPosition((currentPosition ?? 'employee') as StorePosition)
    setLoading(false)
  }, [store])

  useEffect(() => { load() }, [load])

  const sameStore = (r: Row) => isMaster || r.store_id === store?.id

  const personPosition = (r: Row) => r.membershipPosition
  const canApprove = (r: Row) => !r.active && sameStore(r) && isAdmin && (
    isMaster || rank[actorPosition] < rank[r.pending_position ?? r.store_position]
      || (actorPosition === 'owner' && (r.pending_position ?? r.store_position) === 'owner'))

  const canDelete = (r: Row) =>
    r.active && r.id !== profile?.id && r.role !== 'master' && sameStore(r) &&
    (isMaster || (sameStore(r) && rank[actorPosition] < rank[personPosition(r)]))

  const canChangeRole = (r: Row) =>
    (isMaster || (sameStore(r) && rank[actorPosition] < rank[personPosition(r)])) && r.role !== 'master' && r.id !== profile?.id

  const canTogglePoints = (r: Row) =>
    personPosition(r) === 'employee' && sameStore(r) && isAdmin && (isMaster || rank[actorPosition] < rank[personPosition(r)])

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, log?: string) {
    setError('')
    const { error } = await fn()
    if (error) { setError(error.message); return }
    if (log) await logActivity(log)
    await load()
  }

  async function approve(r: Row) {
    await run(() => supabase.rpc('approve_user', { target: r.id }), `Έγκριση χρήστη: ${r.full_name}`)
    await refreshProfile()
  }

  function remove(r: Row) {
    if (!window.confirm(`Να διαγραφεί οριστικά ο λογαριασμός του ${r.full_name};`)) return
    return run(() => supabase.rpc('delete_user', { target: r.id }), `Διαγραφή χρήστη: ${r.full_name}`)
  }

  function changeRole(r: Row, position: StorePosition) {
    return run(
      () => supabase.rpc('set_store_position', { p_store: store!.id, p_user: r.id, p_position: position }),
      `Αλλαγή ρόλου: ${r.full_name} → ${titles[position]}`,
    )
  }

  function togglePoints(r: Row) {
    return run(
      () => supabase.from('profiles').update({ can_edit_points: !r.can_edit_points }).eq('id', r.id),
      `Δικαίωμα πόντων: ${r.full_name}`,
    )
  }

  function toggleSeller(r: Row) {
    return run(
      () => supabase.from('profiles').update({ is_seller: !r.is_seller }).eq('id', r.id),
      `Ιδιότητα πωλητή: ${r.full_name}`,
    )
  }

  if (loading) return <Spinner />
  if (!isAdmin) return <Card><p className="text-sm text-slate-500">Δεν έχετε δικαίωμα.</p></Card>

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Ομάδα"
        title="Προσωπικό"
        subtitle="Ρόλοι, εγκρίσεις και ιδιότητα πωλητή"
        actions={isMaster ? <Badge className="bg-slate-900 text-white">Προβολή όλων των καταστημάτων</Badge> : undefined}
      />

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="space-y-2">
        {rows.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{r.full_name}</span>
                  {r.id === profile?.id && <span className="text-xs text-slate-400">(εσύ)</span>}
                </div>
                <div className="text-xs text-slate-500">{r.email} · Εγγραφή: {fmtDate(r.created_at)}</div>
                {isMaster && (
                  <div className="mt-1 text-xs text-slate-500">
                    {r.stores
                      ? `${r.stores.name}${r.stores.code ? ` · ${r.stores.code}` : ''}`
                      : r.pending_store_code
                        ? `Νέο κατάστημα: ${r.pending_store_name ?? '—'} (${r.pending_store_code})`
                        : '—'}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={r.active ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                  {r.active ? 'Ενεργός' : 'Σε αναμονή'}
                </Badge>
                <Badge className={personPosition(r) === 'owner' || personPosition(r) === 'director' ? 'bg-slate-200 text-slate-800' : 'bg-slate-100 text-slate-600'}>
                  {r.role === 'master' ? 'Master' : titles[personPosition(r)]}
                </Badge>
                {store?.acting_director_id === r.id && <Badge className="bg-blue-100 text-blue-800">Αναπληρωτής διευθυντή</Badge>}
                {r.can_edit_points && <Badge className="bg-blue-100 text-blue-800">Πόντοι</Badge>}
                {r.role !== 'master' && (
                  <Badge className={r.is_seller ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-500'}>
                    {r.is_seller ? 'Πωλητής' : 'Μη πωλητής'}
                  </Badge>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {canApprove(r) && (
                <Button className="!px-3 !py-1.5 text-xs" onClick={() => approve(r)}>Έγκριση</Button>
              )}
              {canTogglePoints(r) && (
                <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => togglePoints(r)}>
                  {r.can_edit_points ? 'Αφαίρεση δικαιώματος πόντων' : 'Δικαίωμα επεξεργασίας πόντων'}
                </Button>
              )}
              {r.role !== 'master' && sameStore(r) && isAdmin && r.active && (isMaster || rank[actorPosition] < rank[personPosition(r)]) && (
                <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => toggleSeller(r)}>
                  {r.is_seller ? 'Ορισμός ως μη πωλητή' : 'Ορισμός ως πωλητή'}
                </Button>
              )}
              {canChangeRole(r) && <select aria-label={`Ρόλος ${r.full_name}`} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                value={personPosition(r)} onChange={(event) => void changeRole(r,event.target.value as StorePosition)}>
                {(['director','assistant_director','supervisor','employee'] as StorePosition[])
                  .filter((position) => isMaster || rank[actorPosition] < rank[position])
                  .map((position) => <option key={position} value={position}>{titles[position]}</option>)}
              </select>}
              {canDelete(r) && (
                <Button variant="danger" className="!px-3 !py-1.5 text-xs" onClick={() => remove(r)}>
                  Διαγραφή
                </Button>
              )}
            </div>
          </Card>
        ))}
        {rows.length === 0 && <Card><EmptyState title="Δεν υπάρχουν χρήστες" text="Οι νέες εγγραφές θα εμφανίζονται εδώ." /></Card>}
      </div>
    </div>
  )
}
