import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Spinner, SuccessBox } from '../components/ui'

type OrgRole = 'owner' | 'admin' | 'member'

const emptyForm = { name: '', code: '', address: '', phone: '', open_hours: '' }

export default function Organization() {
  const { store, stores, profile, setActiveStoreId, refreshProfile } = useAuth()
  const [org, setOrg] = useState<{ id: string; name: string } | null>(null)
  const [role, setRole] = useState<OrgRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!store || !profile) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('stores')
        .select('organization_id, organizations(id,name)')
        .eq('id', store.id)
        .single()
      const orgData = (data as { organizations: { id: string; name: string } | null } | null)?.organizations ?? null
      if (cancelled) return
      setOrg(orgData)
      if (orgData) {
        const { data: mem } = await supabase
          .from('organization_memberships')
          .select('role')
          .eq('organization_id', orgData.id)
          .eq('user_id', profile.id)
          .maybeSingle()
        if (!cancelled) setRole(((mem?.role as OrgRole | undefined) ?? null))
      } else {
        setRole(null)
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [store, profile])

  const canManage = role === 'owner' || role === 'admin' || profile?.role === 'master'

  function openNew() {
    setError(''); setSuccess('')
    setForm({ ...emptyForm })
    setModalOpen(true)
  }

  async function createStore(e: React.FormEvent) {
    e.preventDefault()
    if (!org) return
    setError(''); setSuccess('')
    if (!form.name.trim() || !form.code.trim()) {
      setError('Συμπληρώστε όνομα και κωδικό καταστήματος.')
      return
    }
    setBusy(true)
    const { error } = await supabase.rpc('create_org_store', {
      p_org: org.id,
      p_name: form.name.trim(),
      p_code: form.code.trim().toUpperCase(),
      p_address: form.address.trim() || null,
      p_phone: form.phone.trim() || null,
      p_open_hours: form.open_hours.trim() || null,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    setModalOpen(false)
    setForm({ ...emptyForm })
    setSuccess('Το κατάστημα δημιουργήθηκε και έγινε ενεργό.')
    await refreshProfile()
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Οργανισμός"
        title={org?.name ?? 'Οργανισμός'}
        subtitle="Διαχείριση καταστημάτων και πρόσβασης"
        actions={canManage && org ? <Button onClick={openNew}>Νέο κατάστημα</Button> : undefined}
      />

      <ErrorBox message={error} />
      <SuccessBox message={success} />

      {!org ? (
        <Card>
          <EmptyState
            title="Το κατάστημα δεν ανήκει σε οργανισμό"
            text="Η ένταξη σε οργανισμό γίνεται από τον master. Τα νέα καταστήματα που δημιουργούνται από τη σελίδα Καταστήματα μπορούν να συνδεθούν αργότερα."
          />
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm text-muted">Οργανισμός</div>
                <div className="text-lg font-semibold text-ink">{org.name}</div>
              </div>
              <Badge className={
                role === 'owner' ? 'bg-slate-900 text-white'
                : role === 'admin' ? 'bg-blue-100 text-blue-800'
                : role === 'member' ? 'bg-slate-100 text-slate-700'
                : 'bg-amber-100 text-amber-800'
              }>
                {role === 'owner' ? 'Ιδιοκτήτης'
                  : role === 'admin' ? 'Διαχειριστής'
                  : role === 'member' ? 'Μέλος'
                  : profile?.role === 'master' ? 'Master' : 'Χωρίς πρόσβαση οργανισμού'}
              </Badge>
            </div>
            {!canManage && (
              <p className="mt-3 text-xs text-slate-500">
                Έχεις πρόσβαση μόνο στα καταστήματα που σου έχουν ανατεθεί.
              </p>
            )}
          </Card>

          <Card>
            <h2 className="font-semibold text-ink">Καταστήματα</h2>
            <p className="mt-1 text-xs text-slate-500">
              Επίλεξε κατάστημα για να γίνει ενεργό. Τα δεδομένα των σελίδων ακολουθούν το ενεργό κατάστημα.
            </p>
            <ul className="mt-3 divide-y divide-line">
              {stores.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{s.name}</span>
                      {s.id === store?.id && <Badge className="bg-emerald-100 text-emerald-800">Ενεργό</Badge>}
                    </div>
                    <div className="text-xs text-slate-500">{s.code ?? 'Χωρίς κωδικό'}</div>
                  </div>
                  {s.id !== store?.id && (
                    <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => setActiveStoreId(s.id)}>
                      Μετάβαση
                    </Button>
                  )}
                </li>
              ))}
              {stores.length === 0 && (
                <li className="py-3 text-sm text-slate-500">Δεν υπάρχουν διαθέσιμα καταστήματα.</li>
              )}
            </ul>
          </Card>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Νέο κατάστημα">
        <form onSubmit={createStore} className="space-y-3">
          <Field label="Όνομα καταστήματος">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Germanos ..." />
          </Field>
          <Field label="Κωδικός καταστήματος">
            <Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="π.χ. G1234" />
          </Field>
          <Field label="Διεύθυνση">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label="Τηλέφωνο">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Ωράριο λειτουργίας">
            <Input value={form.open_hours} onChange={(e) => setForm({ ...form, open_hours: e.target.value })} placeholder="π.χ. Δευ-Παρ 09:00-21:00" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Άκυρο</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Δημιουργία…' : 'Δημιουργία'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
