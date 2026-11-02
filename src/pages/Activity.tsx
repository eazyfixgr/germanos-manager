import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDateTime } from '../lib/constants'
import type { ActivityLog } from '../lib/types'
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui'

export default function Activity() {
  const { store, isMaster } = useAuth()
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [actors, setActors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!store && !isMaster) { setLoading(false); return }
    let q = supabase
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    if (!isMaster && store) q = q.eq('store_id', store.id)
    const { data } = await q
    const list = (data as ActivityLog[]) ?? []
    setLogs(list)
    const ids = [...new Set(list.map((l) => l.actor_id).filter(Boolean))] as string[]
    if (ids.length > 0) {
      const { data: act } = await supabase.from('profiles').select('id, full_name').in('id', ids)
      const map: Record<string, string> = {}
      ;(act ?? []).forEach((a: { id: string; full_name: string }) => { map[a.id] = a.full_name })
      setActors(map)
    }
    setLoading(false)
  }, [store, isMaster])

  useEffect(() => { load() }, [load])

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Ιστορικό" title="Ιστορικό ενεργειών" subtitle="Τι άλλαξε, ποιος το έκανε και πότε" />
      <Card>
        {logs.length === 0 ? (
          <EmptyState title="Δεν υπάρχουν καταγραφές" text="Οι ενέργειες θα εμφανίζονται εδώ." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {logs.map((l) => (
              <li key={l.id} className="py-2">
                <div className="text-sm font-medium text-slate-800">{l.action}</div>
                {l.detail && <div className="text-xs text-slate-500">{l.detail}</div>}
                <div className="text-xs text-slate-400">
                  {l.actor_id && actors[l.actor_id] ? `από ${actors[l.actor_id]} · ` : ''}
                  {fmtDateTime(l.created_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
