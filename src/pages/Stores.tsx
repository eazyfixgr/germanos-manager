import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Button, Card, ErrorBox, Field, Input, PageHeader, SuccessBox } from '../components/ui'
import type { Store } from '../lib/types'

const emptyForm = { name: '', code: '', address: '', phone: '', open_hours: '' }

export default function Stores() {
  const { stores, refreshProfile } = useAuth()
  const [editingId, setEditingId] = useState<string | 'new'>('new')
  const [form, setForm] = useState({ ...emptyForm })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  function selectStore(s: Store) {
    setEditingId(s.id)
    setError(''); setSuccess('')
    setForm({
      name: s.name,
      code: s.code ?? '',
      address: s.address ?? '',
      phone: s.phone ?? '',
      open_hours: s.open_hours ?? '',
    })
  }

  function newStore() {
    setEditingId('new')
    setError(''); setSuccess('')
    setForm({ ...emptyForm })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSuccess('')
    if (!form.name.trim() || !form.code.trim()) {
      setError('Το όνομα και ο κωδικός είναι υποχρεωτικά.')
      return
    }
    setBusy(true)
    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      open_hours: form.open_hours.trim() || null,
    }
    const { error } = editingId === 'new'
      ? await supabase.from('stores').insert(payload)
      : await supabase.from('stores').update(payload).eq('id', editingId)
    setBusy(false)
    if (error) {
      if (error.code === '23505' || error.message.toLowerCase().includes('duplicate')) {
        setError('Ο κωδικός χρησιμοποιείται ήδη από άλλο κατάστημα.')
      } else {
        setError(error.message)
      }
      return
    }
    setSuccess(editingId === 'new' ? 'Το κατάστημα δημιουργήθηκε.' : 'Αποθηκεύτηκε.')
    if (editingId === 'new') setForm({ ...emptyForm })
    await refreshProfile()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Master"
        title="Καταστήματα"
        subtitle="Δημιουργία και διαχείριση όλων των καταστημάτων"
        actions={<Button variant="secondary" onClick={newStore}>Νέο κατάστημα</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <h2 className="mb-2 font-semibold text-slate-900">Λίστα ({stores.length})</h2>
          <ul className="divide-y divide-slate-100">
            {stores.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => selectStore(s)}
                  className={`w-full py-2 text-left ${editingId === s.id ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
                >
                  <div className="text-sm">{s.name}</div>
                  <div className="text-xs text-slate-500">{s.code ?? 'χωρίς κωδικό'}</div>
                </button>
              </li>
            ))}
            {stores.length === 0 && <li className="py-2 text-sm text-slate-500">Δεν υπάρχουν καταστήματα.</li>}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold text-slate-900">
            {editingId === 'new' ? 'Νέο κατάστημα' : 'Επεξεργασία καταστήματος'}
          </h2>
          <form onSubmit={save} className="space-y-3">
            <ErrorBox message={error} />
            <SuccessBox message={success} />
            <Field label="Όνομα">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Κωδικός">
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="π.χ. G1234" />
            </Field>
            <Field label="Διεύθυνση">
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label="Τηλέφωνο">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Ωράριο λειτουργίας">
              <Input value={form.open_hours} onChange={(e) => setForm({ ...form, open_hours: e.target.value })} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}
