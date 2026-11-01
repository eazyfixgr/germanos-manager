import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate } from '../lib/constants'
import { Badge, Button, Card, Spinner } from '../components/ui'
import type { Profile } from '../lib/types'

type Row = Profile & { stores: { name: string; code: string | null } | null }

export default function Requests() {
  const { isAdmin, isPrimary } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    let q = supabase
      .from('profiles')
      .select('*, stores(name, code)')
      .eq('active', false)
      .order('created_at', { ascending: true })
    if (!isPrimary) q = q.eq('role', 'user')
    const { data } = await q
    setRows((data as Row[]) ?? [])
    setLoading(false)
  }, [isPrimary])

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
    if (error) setError(error.message)
    await load()
  }

  async function reject(r: Row) {
    if (!window.confirm(`Να απορριφθεί και να διαγραφεί η αίτηση του ${r.full_name};`)) return
    setError('')
    const { error } = await supabase.rpc('delete_user', { target: r.id })
    if (error) setError(error.message)
    await load()
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Αιτήσεις εγγραφής</h1>
      <p className="text-sm text-slate-500">
        {isPrimary
          ? 'Εγκρίνετε αιτήσεις υπαλλήλων και υπευθύνων.'
          : 'Εγκρίνετε αιτήσεις υπαλλήλων.'}
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
                  {r.stores?.name ?? '—'}
                  {r.stores?.code ? ` · ${r.stores.code}` : ''} · {fmtDate(r.created_at)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={r.role === 'admin' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}>
                  {r.role === 'admin' ? 'Υπεύθυνος' : 'Υπάλληλος'}
                </Badge>
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
