import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate } from '../lib/constants'
import { Badge, Button, Card, Spinner } from '../components/ui'
import type { Profile } from '../lib/types'

type Row = Profile & { stores: { name: string; code: string | null } | null }

function storeLabel(r: Row) {
  if (r.stores) return `${r.stores.name}${r.stores.code ? ` · ${r.stores.code}` : ''}`
  if (r.pending_store_code) return `Νέο κατάστημα: ${r.pending_store_name ?? '—'} (${r.pending_store_code})`
  return '—'
}

export default function Requests() {
  const { isAdmin, isMaster, refreshProfile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*, stores(name, code)')
      .eq('active', false)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    setRows((data as Row[]) ?? [])
    setLoading(false)
  }, [])

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
      <h1 className="text-xl font-bold text-slate-900">Αιτήσεις εγγραφής</h1>
      <p className="text-sm text-slate-500">
        {isMaster
          ? 'Εγκρίνετε αιτήσεις για νέα καταστήματα, υπευθύνους και υπαλλήλους.'
          : 'Εγκρίνετε αιτήσεις υπαλλήλων και υπευθύνων του καταστήματός σας.'}
      </p>

      {!isAdmin && <Card><p className="text-sm text-slate-500">Δεν έχετε δικαίωμα.</p></Card>}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {rows.length === 0 && (
        <Card><p className="text-sm text-slate-500">Δεν υπάρχουν εκκρεμείς αιτήσεις.</p></Card>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{r.full_name}</div>
                <div className="text-xs text-slate-500">{r.email}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {storeLabel(r)} · {fmtDate(r.created_at)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={r.role === 'admin' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}>
                  {r.role === 'admin' ? 'Υπεύθυνος' : 'Υπάλληλος'}
                </Badge>
                {!r.stores && r.pending_store_code && (
                  <Badge className="bg-purple-100 text-purple-800">Νέο κατάστημα · master</Badge>
                )}
                <Button className="!px-3 !py-1.5 text-xs" onClick={() => approve(r)}>
                  Έγκριση
                </Button>
                <Button variant="danger" className="!px-3 !py-1.5 text-xs" onClick={() => reject(r)}>
                  Απόρριψη
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
