import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Button, Card, ErrorBox, Field, Input, PageHeader, SuccessBox } from '../components/ui'

export default function Account() {
  const { profile, refreshProfile } = useAuth()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [profileMsg, setProfileMsg] = useState('')
  const [profileErr, setProfileErr] = useState('')

  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [passMsg, setPassMsg] = useState('')
  const [passErr, setPassErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setProfileErr('')
    setProfileMsg('')
    if (!profile) return
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null })
      .eq('id', profile.id)
    if (error) { setProfileErr(error.message); return }
    setProfileMsg('Αποθηκεύτηκε.')
    await refreshProfile()
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setPassErr('')
    setPassMsg('')
    if (pass.length < 6) { setPassErr('Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.'); return }
    if (pass !== pass2) { setPassErr('Οι κωδικοί δεν ταιριάζουν.'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pass })
    setBusy(false)
    if (error) { setPassErr(error.message); return }
    setPass('')
    setPass2('')
    setPassMsg('Ο κωδικός άλλαξε.')
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Λογαριασμός" title="Στοιχεία λογαριασμού" subtitle="Προσωπικά στοιχεία και ασφάλεια πρόσβασης" />

      <Card>
        <h2 className="font-semibold text-slate-900">Στοιχεία</h2>
        <form onSubmit={saveProfile} className="mt-3 space-y-3">
          <ErrorBox message={profileErr} />
          <SuccessBox message={profileMsg} />
          <Field label="Email">
            <Input value={profile?.email ?? ''} disabled />
          </Field>
          <Field label="Ονοματεπώνυμο">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Τηλέφωνο">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit">Αποθήκευση</Button>
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900">Αλλαγή κωδικού</h2>
        <form onSubmit={changePassword} className="mt-3 space-y-3">
          <ErrorBox message={passErr} />
          <SuccessBox message={passMsg} />
          <Field label="Νέος κωδικός">
            <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Τουλάχιστον 6 χαρακτήρες" />
          </Field>
          <Field label="Επανάληψη κωδικού">
            <Input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? 'Αλλαγή…' : 'Αλλαγή κωδικού'}</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
