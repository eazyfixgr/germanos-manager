import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate } from '../lib/constants'
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui'
import type { Profile, StorePosition, StoreType } from '../lib/types'

type Row = Profile & { stores: { name: string; code: string | null; store_type: StoreType } | null }
const titles: Record<StorePosition,string> = { owner:'Ιδιοκτήτης Franchise',director:'Διευθυντής',assistant_director:'Υποδιευθυντής',supervisor:'Προϊστάμενος καταστήματος',employee:'Υπάλληλος' }
const rank: Record<StorePosition,number> = { owner:0,director:1,assistant_director:2,supervisor:3,employee:4 }

function storeLabel(r: Row) {
  if (r.stores) return `${r.stores.name}${r.stores.code ? ` · ${r.stores.code}` : ''}`
  if (r.pending_store_code) return `Νέο κατάστημα: ${r.pending_store_name ?? '—'} (${r.pending_store_code})`
  return '—'
}

export default function Requests() {
  const { isAdmin, isMaster, store, refreshProfile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actorPosition, setActorPosition] = useState<StorePosition>('employee')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*, stores:stores!profiles_store_id_fkey(name, code, store_type)')
      .eq('active', false)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    setRows((data as Row[]) ?? [])
    if (store) {
      const { data: position } = await supabase.rpc('my_store_position', { p_store: store.id })
      setActorPosition((position ?? 'employee') as StorePosition)
    }
    setLoading(false)
  }, [store])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('requests-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  async function approve(r: Row) {
    setError('')
    const { error } = await supabase.rpc('approve_user', { target: r.id })
    if (error) { setError(error.message); return }
    await refreshProfile()
    await load()
  }

  async function reject(r: Row) {
    if (!window.confirm(`Να απορριφθεί η αίτηση του ${r.full_name};`)) return
    setError('')
    const { error } = await supabase.rpc('reject_request', { target: r.id })
    if (error) { setError(error.message); return }
    await load()
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Εγκρίσεις"
        title="Αιτήσεις εγγραφής"
        subtitle={isMaster
          ? 'Νέα καταστήματα και αιτήσεις του καταστήματος ενεργής υποστήριξης.'
          : 'Εγκρίνετε αιτήσεις υπαλλήλων και υπευθύνων του καταστήματός σας.'}
      />

      {!isAdmin && !isMaster && <Card><p className="text-sm text-slate-500">Δεν έχετε δικαίωμα.</p></Card>}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {rows.length === 0 && (
        <Card><EmptyState title="Δεν υπάρχουν εκκρεμείς αιτήσεις" text="Όταν κάποιος κάνει εγγραφή, θα εμφανιστεί εδώ." /></Card>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <Card key={r.id}>
            {(() => {
              const requested = r.pending_position ?? r.store_position
              const canApprove = isMaster || (requested !== 'owner' && r.store_id === store?.id && rank[actorPosition] < rank[requested])
              return <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{r.full_name}</div>
                <div className="text-xs text-slate-500">{r.email}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {storeLabel(r)} · {fmtDate(r.created_at)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={requested === 'owner' || requested === 'director' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}>
                  {titles[requested]}
                </Badge>
                {r.pending_store_type && <Badge>{r.pending_store_type === 'franchise' ? 'Franchise' : 'Ιδιόκτητο'}</Badge>}
                {!r.stores && r.pending_store_code && (
                  <Badge className="bg-purple-100 text-purple-800">Νέο κατάστημα · master</Badge>
                )}
                {canApprove && <Button className="!px-3 !py-1.5 text-xs" onClick={() => approve(r)}>
                  Έγκριση
                </Button>}
                {canApprove && <Button variant="danger" className="!px-3 !py-1.5 text-xs" onClick={() => reject(r)}>
                  Απόρριψη
                </Button>}
              </div>
            </div>
              </>
            })()}
          </Card>
        ))}
      </div>
    </div>
  )
}
