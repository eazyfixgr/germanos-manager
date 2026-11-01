import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Button, Card, ErrorBox, Field, Input, Spinner, SuccessBox } from '../components/ui'
import type { Store } from '../lib/types'

export default function StoreSettings() {
  const { store, isMaster, refreshProfile } = useAuth()
  const [stores, setStores] = useState<Store[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState({ name: '', code: '', address: '', phone: '', open_hours: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    ;(async () => {
      if (isMaster) {
        const { data } = await supabase.from('stores').select('*').order('name')
        const list = (data as Store[]) ?? []
        setStores(list)
        const initial = store?.id && list.some((s) => s.id === store.id) ? store.id : list[0]?.id ?? ''
        setSelectedId(initial)
      } else if (store) {
        setStores([store])
        setSelectedId(store.id)
      }
      setLoading(false)
    })()
  }, [isMaster, store])

  useEffect(() => {
    const s = stores.find((x) => x.id === selectedId)
    if (s) {
      setForm({
        name: s.name,
        code: s.code ?? '',
        address: s.address ?? '',
        phone: s.phone ?? '',
        open_hours: s.open_hours ?? '',
      })
    }
  }, [selectedId, stores])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!form.name.trim() || !form.code.trim()) {
      setError('Το όνομα και ο κωδικός καταστήματος είναι υποχρεωτικά.')
      return
    }
    setBusy(true)
    const { error } = await supabase
      .from('stores')
      .update({
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        open_hours: form.open_hours.trim() || null,
      })
      .eq('id', selectedId)
    setBusy(false)
    if (error) {
      if (error.code === '23505' || error.message.toLowerCase().includes('duplicate')) {
        setError('Ο κωδικός χρησιμοποιείται ήδη από άλλο κατάστημα.')
      } else {
        setError(error.message)
      }
      return
    }
    setSuccess('Αποθηκεύτηκε.')
    await refreshProfile()
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Στοιχεία καταστήματος</h1>

      {isMaster && stores.length > 0 && (
        <Field label="Κατάστημα (master)">
          <select
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.code ? ` (${s.code})` : ''}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Card>
        <form onSubmit={save} className="space-y-3">
          <ErrorBox message={error} />
          <SuccessBox message={success} />
          <Field label="Όνομα καταστήματος">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Germanos Σαλαμίνα" />
          </Field>
          <Field label="Κωδικός καταστήματος">
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="π.χ. G1234"
            />
          </Field>
          <p className="text-xs text-slate-500">
            Ο κωδικός χρησιμοποιείται από τους υπαλλήλους κατά την εγγραφή ώστε να συνδεθούν στο
            σωστό κατάστημα.
          </p>
          <Field label="Διεύθυνση">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label="Τηλέφωνο">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Ωράριο λειτουργίας">
            <Input value={form.open_hours} onChange={(e) => setForm({ ...form, open_hours: e.target.value })} placeholder="π.χ. Δευ-Παρ 09:00-21:00" />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !selectedId}>
              {busy ? 'Αποθήκευση…' : 'Αποθήκευση'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
