import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Button, ErrorBox, Field, Input, SuccessBox } from '../components/ui'

export default function Login() {
  const { session, profile, signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [storeName, setStoreName] = useState('')
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
    setBusy(true)
    const res = await signUp(email, password, fullName, storeName)
    setBusy(false)
    if (res.error) {
      setError(res.error)
    } else {
      setSuccess('Η εγγραφή ολοκληρώθηκε! Ο διαχειριστής θα εγκρίνει τον λογαριασμό σου. Ο πρώτος χρήστης γίνεται αυτόματα Admin.')
      setMode('login')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-6 text-center">
          <div className="text-3xl">📱</div>
          <h1 className="mt-2 text-xl font-bold text-slate-900">Γερμανός Manager</h1>
          <p className="text-sm text-slate-500">Διαχείριση καταστήματος</p>
        </div>

        <div className="mb-4 flex rounded-lg bg-slate-100 p-1">
          <button
            className={`flex-1 rounded-md py-2 text-sm font-medium ${mode === 'login' ? 'bg-white shadow' : 'text-slate-500'}`}
            onClick={() => { setMode('login'); setError(''); setSuccess('') }}
          >
            Είσοδος
          </button>
          <button
            className={`flex-1 rounded-md py-2 text-sm font-medium ${mode === 'register' ? 'bg-white shadow' : 'text-slate-500'}`}
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
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="onom@email.gr" />
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
            <Field label="Ονοματεπώνυμο">
              <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Γιώργος Παπαδόπουλος" />
            </Field>
            <Field label="Email">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="onom@email.gr" />
            </Field>
            <Field label="Κωδικός">
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Τουλάχιστον 6 χαρακτήρες" />
            </Field>
            <Field label="Όνομα καταστήματος">
              <Input required value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="Γερμανός Σύνταγμα" />
            </Field>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Δημιουργία…' : 'Δημιουργία λογαριασμού'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
