import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Button, ErrorBox } from './ui'

export default function SupportBanner() {
  const { isMaster, store, supportSession, endSupport, switching } = useAuth()
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState('')
  useEffect(() => {
    if (!supportSession) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [supportSession])
  if (!isMaster) return null
  if (!supportSession) return <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-slate-50 p-3 text-sm">
    <span>Λειτουργία πλατφόρμας · χωρίς πρόσβαση σε δεδομένα καταστήματος.</span>
    <Link className="font-semibold text-brand" to="/support">Πρόσβαση υποστήριξης</Link>
  </div>
  const remaining = Math.max(0, Math.ceil((supportSession.localDeadline - now) / 1000))
  return <div role="status" className="mb-4 space-y-2 rounded-control border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <strong>Ενεργή υποστήριξη · {store?.name} · {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</strong>
      <Button variant="secondary" disabled={switching} onClick={async () => { setError(''); const result = await endSupport(); if (result.error) setError(result.error) }}>Τερματισμός πρόσβασης</Button>
    </div>
    <p className="break-words">Αιτιολογία: {supportSession.reason}</p>
    <p className="text-xs">Οι αλλαγές καταγράφονται με actor, συνεδρία και παλιά/νέα τιμή.</p>
    <ErrorBox message={error} />
  </div>
}
