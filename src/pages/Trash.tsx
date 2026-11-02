import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDateTime } from '../lib/constants'
import { logActivity } from '../lib/activity'
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui'
import type { Profile } from '../lib/types'

type Row = Profile & { stores: { name: string; code: string | null } | null }

export default function Trash() {
  const { store, isAdmin, isPrimary, isMaster } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [actors, setActors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    let q = supabase
      .from('profiles')
      .select('*, stores(name, code)')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    if (!isMaster) q = q.eq('store_id', store?.id ?? '00000000-0000-0000-0000-000000000000')
    const { data } = await q
    const list = (data as Row[]) ?? []
    setRows(list)
    const ids = [...new Set(list.map((r) => r.deleted_by).filter(Boolean))] as string[]
    if (ids.length > 0) {
      const { data: act } = await supabase.from('profiles').select('id, full_name').in('id', ids)
      const map: Record<string, string> = {}
      ;(act ?? []).forEach((a: { id: string; full_name: string }) => { map[a.id] = a.full_name })
      setActors(map)
    }
    setLoading(false)
  }, [isMaster, store])

  useEffect(() => { load() }, [load])

  const sameStore = (r: Row) => isMaster || r.store_id === store?.id
  const canRestore = (r: Row) =>
    sameStore(r) && (r.role === 'admin' ? isPrimary : isAdmin)

  async function restore(r: Row) {
    setError('')
    const { error } = await supabase.rpc('restore_user', { target: r.id })
    if (error) { setError(error.message); return }
    await logActivity('Επαναφορά χρήστη από κάδο', r.full_name)
    await load()
  }

  async function purge(r: Row) {
    if (!window.confirm(`ΟΡΙΣΤΙΚΗ διαγραφή του ${r.full_name}; Δεν αναιρείται.`)) return
    setError('')
    const { error } = await supabase.rpc('purge_user', { target: r.id })
    if (error) { setError(error.message); return }
    await logActivity('Οριστική διαγραφή χρήστη', r.full_name)
    await load()
  }

  if (loading) return <Spinner />
  if (!isAdmin) return <Card><p className="text-sm text-slate-500">Δεν έχετε δικαίωμα.</p></Card>

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Κάδος" title="Κάδος ανακύκλωσης" subtitle="Διαγραμμένοι χρήστες. Η επαναφορά τους απαιτεί εκ νέου έγκριση." />

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {rows.length === 0 && <Card><EmptyState title="Ο κάδος είναι άδειος" text="Δεν υπάρχουν διαγραμμένοι χρήστες." /></Card>}

      <div className="space-y-2">
        {rows.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{r.full_name}</div>
                <div className="text-xs text-slate-500">{r.email}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {isMaster && r.stores ? `${r.stores.name}${r.stores.code ? ` · ${r.stores.code}` : ''} · ` : ''}
                  Διαγραφή: {r.deleted_at ? fmtDateTime(r.deleted_at) : '—'}
                  {r.deleted_by && actors[r.deleted_by] ? ` από ${actors[r.deleted_by]}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={r.role === 'admin' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}>
                  {r.role === 'admin' ? 'Υπεύθυνος' : 'Υπάλληλος'}
                </Badge>
                {canRestore(r) && (
                  <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => restore(r)}>Επαναφορά</Button>
                )}
                {isMaster && (
                  <Button variant="danger" className="!px-3 !py-1.5 text-xs" onClick={() => purge(r)}>Οριστική διαγραφή</Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
