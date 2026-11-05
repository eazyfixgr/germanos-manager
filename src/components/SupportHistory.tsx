import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDateTime } from '../lib/constants'
import { Card, EmptyState, ErrorBox, Spinner } from './ui'

interface SupportAuditEvent {
  id: string; action: string; actor_id: string; store_id: string | null
  reason: string; table_name: string | null; record_id: string | null; created_at: string
  before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null
}
const actions: Record<string, string> = {
  'session.started': 'Έναρξη υποστήριξης', 'session.ended': 'Λήξη από τον master',
  'session.replaced': 'Μετάβαση σε νέα συνεδρία', 'session.expired': 'Καταγραφή λήξης ισχύος',
  'data.insert': 'Προσθήκη', 'data.update': 'Αλλαγή', 'data.delete': 'Διαγραφή',
  'platform.insert': 'Δημιουργία πλατφόρμας', 'platform.update': 'Αλλαγή πλατφόρμας', 'platform.delete': 'Διαγραφή πλατφόρμας',
}

export default function SupportHistory({ organizationId, revision }: { organizationId?: string; revision?: string }) {
  const [events, setEvents] = useState<SupportAuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true); setError('')
      try {
        let query = supabase.from('support_audit_events').select('*').order('created_at', { ascending: false }).limit(50)
        if (organizationId) query = query.eq('organization_id', organizationId)
        const { data, error: loadError } = await query
        if (loadError) throw new Error('Δεν ήταν δυνατή η φόρτωση του ιστορικού υποστήριξης.')
        if (!cancelled) setEvents((data ?? []) as SupportAuditEvent[])
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Σφάλμα φόρτωσης.') }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [organizationId, revision])
  return <Card>
    <h2 className="font-semibold text-ink">Ιστορικό πρόσβασης υποστήριξης</h2>
    <p className="mt-1 text-xs text-muted">Οι 50 πρόσφατες εγγραφές. Η πρόσβαση λήγει αυτόματα στην προγραμματισμένη ώρα, ακόμη και χωρίς ανοικτό browser.</p>
    <ErrorBox message={error} />
    {loading ? <Spinner /> : events.length === 0 ? <EmptyState title="Δεν υπάρχουν καταγραφές υποστήριξης" /> : (
      <ul className="mt-3 divide-y divide-line">
        {events.map((event) => <li key={event.id} className="space-y-1 py-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><strong>{actions[event.action] ?? event.action}{event.table_name ? ` · ${event.table_name}` : ''}</strong><span className="text-xs text-muted">{fmtDateTime(event.created_at)}</span></div>
          <p>{event.reason}</p>
          <p className="break-all text-xs text-muted">Χρήστης: {event.actor_id} · Κατάστημα: {event.store_id ?? 'Πλατφόρμα'}</p>
          {(event.before_data || event.after_data) && <details className="text-xs">
            <summary className="cursor-pointer font-medium text-brand">Παλιά / νέα τιμή · {event.record_id ?? 'εγγραφή'}</summary>
            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              <div><div className="font-semibold">Πριν</div><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2">{JSON.stringify(event.before_data, null, 2)}</pre></div>
              <div><div className="font-semibold">Μετά</div><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2">{JSON.stringify(event.after_data, null, 2)}</pre></div>
            </div>
          </details>}
        </li>)}
      </ul>
    )}
  </Card>
}
