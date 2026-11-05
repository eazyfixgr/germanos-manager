import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDateTime } from '../lib/constants'
import { Badge, Button, Card, EmptyState, ErrorBox, Select, Spinner, SuccessBox } from './ui'
import type { OrganizationRole } from '../lib/access'

interface Person {
  user_id: string
  full_name: string
  email: string
  organization_role: OrganizationRole | null
}
interface AuditEvent {
  id: string
  target_user_id: string | null
  previous_role: OrganizationRole | null
  new_role: OrganizationRole | null
  created_at: string
}

const labels = { owner: 'Ιδιοκτήτης', admin: 'Διαχειριστής', member: 'Μέλος' }

export default function OrganizationMembers({ organizationId, canEdit, onChanged }: {
  organizationId: string
  canEdit: boolean
  onChanged: () => Promise<void>
}) {
  const [people, setPeople] = useState<Person[]>([])
  const [history, setHistory] = useState<AuditEvent[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [persons, audit] = await Promise.all([
        supabase.rpc('list_organization_people', { p_org: organizationId }),
        supabase.from('organization_audit_events').select('id,target_user_id,previous_role,new_role,created_at')
          .eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(20),
      ])
      if (persons.error || audit.error) throw new Error('Δεν ήταν δυνατή η φόρτωση των μελών και του ιστορικού.')
      const rows = (persons.data ?? []) as Person[]
      setPeople(rows)
      setHistory((audit.data ?? []) as AuditEvent[])
      setDrafts(Object.fromEntries(rows.map((p) => [p.user_id, p.organization_role ?? ''])))
    } catch (e) { setError(e instanceof Error ? e.message : 'Σφάλμα φόρτωσης.') }
    finally { setLoading(false) }
  }, [organizationId])

  useEffect(() => { void load() }, [load])

  async function save(person: Person) {
    const role = drafts[person.user_id] || null
    if (role === person.organization_role) return
    if (!window.confirm(`Αλλαγή ρόλου για ${person.full_name}: ${role ? labels[role as OrganizationRole] : 'Αφαίρεση από τον οργανισμό'};`)) return
    setBusy(person.user_id); setError(''); setSuccess('')
    try {
      const { error: mutationError } = await supabase.rpc('set_organization_member', {
        p_org: organizationId, p_user: person.user_id, p_role: role,
      })
      if (mutationError) throw new Error(mutationError.message)
      setSuccess('Η συμμετοχή ενημερώθηκε και καταγράφηκε στο ιστορικό.')
      await load()
      await onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : 'Η αλλαγή δεν αποθηκεύτηκε.') }
    finally { setBusy(null) }
  }

  return (
    <Card>
      <h2 className="font-semibold text-ink">Μέλη και δικαιώματα οργανισμού</h2>
      <p className="mt-1 text-xs text-muted">
        Μόνο ο ιδιοκτήτης αλλάζει ρόλους. Πρέπει να παραμένει τουλάχιστον ένας ενεργός ιδιοκτήτης.
        Η αφαίρεση ρόλου οργανισμού δεν διαγράφει τον λογαριασμό ή την πρόσβαση στο κατάστημα εργασίας του.
      </p>
      <ErrorBox message={error} />
      <SuccessBox message={success} />
      {loading ? <Spinner /> : people.length === 0 ? <EmptyState title="Δεν υπάρχει διαθέσιμο προσωπικό" /> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr className="border-b border-line"><th className="p-2">Λογαριασμός</th><th className="p-2">Ρόλος οργανισμού</th><th className="p-2">Ενέργεια</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {people.map((person) => (
                <tr key={person.user_id}>
                  <td className="p-2"><div className="font-medium">{person.full_name}</div><div className="text-xs text-muted">{person.email}</div></td>
                  <td className="p-2">
                    {canEdit ? <Select aria-label={`Ρόλος ${person.full_name}`}
                      value={drafts[person.user_id] ?? ''} disabled={busy !== null}
                      onChange={(e) => setDrafts((previous) => ({ ...previous, [person.user_id]: e.target.value }))}>
                      <option value="">Χωρίς ρόλο οργανισμού</option>
                      <option value="member">Μέλος</option><option value="admin">Διαχειριστής</option><option value="owner">Ιδιοκτήτης</option>
                    </Select> : <Badge>{person.organization_role ? labels[person.organization_role] : 'Χωρίς ρόλο'}</Badge>}
                  </td>
                  <td className="p-2">{canEdit && <Button variant="secondary" disabled={busy !== null || (drafts[person.user_id] || null) === person.organization_role}
                    onClick={() => void save(person)}>{busy === person.user_id ? 'Αποθήκευση…' : 'Εφαρμογή'}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history.length > 0 && <div className="mt-5 border-t border-line pt-3">
        <h3 className="text-sm font-semibold">Πρόσφατες αλλαγές ρόλων</h3>
        <ul className="mt-2 space-y-2 text-xs text-muted">
          {history.map((event) => <li key={event.id}>
            {people.find((p) => p.user_id === event.target_user_id)?.full_name ?? 'Λογαριασμός'}:
            {' '}{event.previous_role ? labels[event.previous_role] : 'Χωρίς ρόλο'} → {event.new_role ? labels[event.new_role] : 'Χωρίς ρόλο'}
            {' · '}{fmtDateTime(event.created_at)}
          </li>)}
        </ul>
      </div>}
    </Card>
  )
}
