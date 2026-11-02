import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Button, Card, ErrorBox, Field, Input, PageHeader, SuccessBox } from '../components/ui'

interface AllowRow { email: string; note: string | null }

export default function Security() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<AllowRow[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [promoteEmail, setPromoteEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('master_allowlist').select('email, note').order('email')
    setRows((data as AllowRow[]) ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  async function addEmail(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSuccess('')
    const email = newEmail.trim().toLowerCase()
    if (!email) return
    const { error } = await supabase.from('master_allowlist').insert({ email })
    if (error && !error.message.toLowerCase().includes('duplicate')) { setError(error.message); return }
    setNewEmail('')
    setSuccess('Το email προστέθηκε στη λίστα master.')
    await load()
  }

  async function removeEmail(email: string) {
    if (email === profile?.email) { setError('Δεν μπορείτε να αφαιρέσετε τον εαυτό σας.'); return }
    if (!window.confirm(`Αφαίρεση του ${email} από τη λίστα master;`)) return
    setError(''); setSuccess('')
    const { error } = await supabase.from('master_allowlist').delete().eq('email', email)
    if (error) { setError(error.message); return }
    await load()
  }

  async function promote(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSuccess('')
    const email = promoteEmail.trim().toLowerCase()
    if (!email) return
    if (!window.confirm(`Ορισμός του ${email} ως master;`)) return

    await supabase.from('master_allowlist').insert({ email }).then(() => {}, () => {})
    const { data, error } = await supabase
      .from('profiles')
      .update({ role: 'master', store_id: null, active: true, is_primary: true })
      .eq('email', email)
      .select('id')
    if (error) { setError(error.message); return }
    if (!data || data.length === 0) { setError('Δεν βρέθηκε χρήστης με αυτό το email.'); return }
    setPromoteEmail('')
    setSuccess('Ο λογαριασμός ορίστηκε ως master.')
    await load()
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Master" title="Ασφάλεια master" subtitle="Έλεγχος ποιοι λογαριασμοί μπορούν να έχουν ρόλο master" />

      <Card>
        <h2 className="font-semibold text-slate-900">Master allowlist</h2>
        <p className="mt-1 text-xs text-slate-500">
          Μόνο emails σε αυτή τη λίστα μπορούν να έχουν ρόλο master.
        </p>
        <ul className="mt-3 divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.email} className="flex items-center justify-between py-2">
              <span className="text-sm text-slate-800">{r.email}</span>
              {r.email !== profile?.email ? (
                <button className="text-xs font-medium text-red-600 hover:underline" onClick={() => removeEmail(r.email)}>
                  Αφαίρεση
                </button>
              ) : (
                <span className="text-xs text-slate-400">(εσύ)</span>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={addEmail} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Προσθήκη email"><Input type="email" value={newEmail} onChange={(ev) => setNewEmail(ev.target.value)} placeholder="email@example.gr" /></Field>
          </div>
          <Button type="submit" variant="secondary">Προσθήκη</Button>
        </form>
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900">Ορισμός master σε υπάρχοντα χρήστη</h2>
        <form onSubmit={promote} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Email χρήστη"><Input type="email" value={promoteEmail} onChange={(ev) => setPromoteEmail(ev.target.value)} placeholder="email@example.gr" /></Field>
          </div>
          <Button type="submit" variant="danger">Ορισμός ως master</Button>
        </form>
      </Card>

      <ErrorBox message={error} />
      <SuccessBox message={success} />
    </div>
  )
}
