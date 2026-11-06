import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { Button, ErrorBox, Field, Input, SuccessBox } from '../components/ui'
import type { AccountType, StorePosition, StoreType } from '../lib/types'

export default function Login() {
  const { session, profile, signIn, signUp, signOut } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [accountType, setAccountType] = useState<AccountType>('user')
  const [storeType, setStoreType] = useState<StoreType>('franchise')
  const [storePosition, setStorePosition] = useState<StorePosition>('director')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [storeName, setStoreName] = useState('')
  const [storeCode, setStoreCode] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  if (session && profile?.active) return <Navigate to="/" replace />

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = await signIn(email, password)
    setBusy(false)
    if (res.error) setError(res.error)
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (password.length < 6) {
      setError('Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.')
      return
    }
    if (!fullName.trim() || !storeName.trim() || !storeCode.trim()) {
      setError('Συμπληρώστε όνομα, όνομα καταστήματος και κωδικό καταστήματος.')
      return
    }

    setBusy(true)
    const { data: foundRows, error: lookupError } = await supabase.rpc(accountType === 'admin' ? 'lookup_store_registration' : 'lookup_store_code', {
      p_code: storeCode.trim(),
    })
    if (accountType === 'admin' && lookupError) {
      setBusy(false)
      setError('Απαιτείται η migration ρόλων καταστήματος πριν από εγγραφή στελέχους.')
      return
    }
    const found = (foundRows as { id: string; name: string; store_type?: StoreType }[] | null)?.[0] ?? null

    if (accountType === 'user') {
      if (!found) {
        setBusy(false)
        setError(`Δεν βρέθηκε κατάστημα με κωδικό «${storeCode.trim()}». Ζητήστε τον σωστό κωδικό από τον υπεύθυνο.`)
        return
      }
      if (found.name.trim().toLowerCase() !== storeName.trim().toLowerCase()) {
        setBusy(false)
        setError(`Ο κωδικός ανήκει στο κατάστημα «${found.name}». Ελέγξτε το όνομα καταστήματος.`)
        return
      }
    } else if (found && found.name.trim().toLowerCase() !== storeName.trim().toLowerCase()) {
      setBusy(false)
      setError(`Ο κωδικός ανήκει στο κατάστημα «${found.name}». Ελέγξτε το όνομα καταστήματος.`)
      return
    } else if (found && found.store_type && found.store_type !== storeType) {
      setBusy(false)
      setError(`Το κατάστημα «${found.name}» είναι ${found.store_type === 'franchise' ? 'Franchise' : 'ιδιόκτητο'}. Επιλέξτε τον σωστό τύπο καταστήματος.`)
      return
    } else if (storePosition === 'owner' && storeType !== 'franchise') {
      setBusy(false)
      setError('Ο ρόλος Ιδιοκτήτη διατίθεται μόνο σε Franchise.')
      return
    } else if (!found && storeType === 'franchise' && storePosition !== 'owner') {
      setBusy(false)
      setError('Για νέο Franchise απαιτείται αίτηση Ιδιοκτήτη. Για τους υπόλοιπους ρόλους επιλέξτε υπάρχον κατάστημα.')
      return
    }

    const res = await signUp(email, password, fullName, accountType, storeName, storeCode,
      accountType === 'admin' ? storeType : undefined,
      accountType === 'admin' ? storePosition : 'employee')
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }

    await signOut()
    if (accountType === 'user') {
      setSuccess('Η αίτηση εστάλη. Θα εγκριθεί από υπεύθυνο του καταστήματος.')
    } else if (found) {
      setSuccess('Η αίτηση εστάλη. Θα εγκριθεί από υπεύθυνο του καταστήματος.')
    } else {
      setSuccess('Η αίτηση για νέο κατάστημα και λογαριασμό υπευθύνου στάλθηκε στον master για έγκριση.')
    }
    setStoreName('')
    setStoreCode('')
    setPassword('')
    setMode('login')
  }

  return (
    <div className="flex min-h-screen w-full flex-col lg:flex-row">
      <div className="flex flex-col justify-between bg-navy p-8 text-white lg:w-1/2 lg:p-12">
        <div className="text-sm font-semibold tracking-wide text-slate-300">ΓΕΡΜΑΝΟΣ MANAGER</div>
        <div className="py-10 lg:py-0">
          <h1 className="text-3xl font-bold leading-tight lg:text-4xl">
            Όλη η λειτουργία του καταστήματος σε ένα σημείο.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-300">
            Στόχοι, παραγγελίες και παραλαβές, πρόγραμμα προσωπικού και εγκρίσεις — οργανωμένα,
            χωρίς excel και χωρίς χαμένες παραγγελίες.
          </p>
        </div>
        <div className="text-xs text-slate-500">Εσωτερική εφαρμογή καταστήματος</div>
      </div>

      <div className="flex flex-1 items-center justify-center bg-canvas p-6 lg:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-slate-900">
              {mode === 'login' ? 'Σύνδεση' : 'Δημιουργία λογαριασμού'}
            </h2>
            <p className="text-sm text-slate-500">
              {mode === 'login' ? 'Συνδεθείτε στον λογαριασμό σας.' : 'Συμπληρώστε τα στοιχεία σας.'}
            </p>
          </div>

          <div className="mb-4 flex rounded-lg bg-slate-200 p-1">
            <button
              className={`flex-1 rounded-md py-2 text-sm font-medium ${mode === 'login' ? 'bg-white shadow' : 'text-slate-600'}`}
              onClick={() => { setMode('login'); setError(''); setSuccess('') }}
            >
              Είσοδος
            </button>
            <button
              className={`flex-1 rounded-md py-2 text-sm font-medium ${mode === 'register' ? 'bg-white shadow' : 'text-slate-600'}`}
              onClick={() => { setMode('register'); setError(''); setSuccess('') }}
            >
              Εγγραφή
            </button>
          </div>

          <ErrorBox message={error} />
          <SuccessBox message={success} />

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="mt-4 space-y-3">
              <Field label="Email">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.gr" />
              </Field>
              <Field label="Κωδικός">
                <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" />
              </Field>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Σύνδεση…' : 'Σύνδεση'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="mt-4 space-y-3">
              <Field label="Τύπος λογαριασμού">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAccountType('user')}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                      accountType === 'user'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-slate-600'
                    }`}
                  >
                    Υπάλληλος
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType('admin')}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                      accountType === 'admin'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-slate-600'
                    }`}
                  >
                    Στέλεχος καταστήματος
                  </button>
                </div>
              </Field>

              {accountType === 'admin' && <>
                <Field label="Τύπος καταστήματος">
                  <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={storeType}
                    onChange={(e) => { const value = e.target.value as StoreType; setStoreType(value); if (value === 'owned' && storePosition === 'owner') setStorePosition('director') }}>
                    <option value="franchise">Franchise</option>
                    <option value="owned">Ιδιόκτητο (ΑΦΜ ΓΕΡΜΑΝΟΣ)</option>
                  </select>
                </Field>
                <Field label="Ρόλος στο κατάστημα">
                  <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={storePosition}
                    onChange={(e) => setStorePosition(e.target.value as StorePosition)}>
                    {storeType === 'franchise' && <option value="owner">Ιδιοκτήτης Franchise</option>}
                    <option value="director">Διευθυντής καταστήματος</option>
                    <option value="assistant_director">Υποδιευθυντής</option>
                    <option value="supervisor">Προϊστάμενος καταστήματος</option>
                  </select>
                </Field>
              </>}

              <Field label="Ονοματεπώνυμο">
                <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Γιώργος Παπαδόπουλος" />
              </Field>
              <Field label="Email">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.gr" />
              </Field>
              <Field label="Κωδικός">
                <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Τουλάχιστον 6 χαρακτήρες" />
              </Field>
              <Field label="Όνομα καταστήματος">
                <Input required value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="Germanos Σαλαμίνα" />
              </Field>
              <Field label="Κωδικός καταστήματος">
                <Input
                  required
                  value={storeCode}
                  onChange={(e) => setStoreCode(e.target.value.toUpperCase())}
                  placeholder="π.χ. G1234"
                />
              </Field>

              <p className="text-xs text-slate-500">
                {accountType === 'user'
                  ? 'Χρειάζονται το σωστό όνομα και ο κωδικός του καταστήματος. Η εγγραφή εγκρίνεται από τον υπεύθυνο.'
                  : 'Η αίτηση εγκρίνεται από ανώτερο ρόλο του καταστήματος. Ιδιοκτήτης Franchise μπορεί να έχει πρόσβαση σε όλα τα καταστήματα του Franchise.'}
              </p>

              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Υποβολή…' : 'Δημιουργία λογαριασμού'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
