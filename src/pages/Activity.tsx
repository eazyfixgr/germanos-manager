import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDateTime } from '../lib/constants'
import type { ActivityLog } from '../lib/types'
import { Card, Spinner } from '../components/ui'

export default function Activity() {
  const { store } = useAuth()
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!store) return
    const { data } = await supabase
      .from('activity_log')
      .select('*')
      .eq('store_id', store.id)
      .order('created_at', { ascending: false })
      .limit(100)
    setLogs((data as ActivityLog[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [store])

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Ιστορικό ενεργειών</h1>
      <Card>
        {logs.length === 0 ? (
          <p className="text-sm text-slate-500">Δεν υπάρχουν καταγραφές.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {logs.map((l) => (
              <li key={l.id} className="py-2">
                <div className="text-sm font-medium text-slate-800">{l.action}</div>
                {l.detail && <div className="text-xs text-slate-500">{l.detail}</div>}
                <div className="text-xs text-slate-400">{fmtDateTime(l.created_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
