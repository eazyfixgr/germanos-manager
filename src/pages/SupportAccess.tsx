import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, Select } from '../components/ui'
import SupportHistory from '../components/SupportHistory'

export default function SupportAccess() {
  const { supportSession, supportStores, startSupport, switching } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [storeId, setStoreId] = useState(() => params.get('store') ?? supportSession?.store_id ?? supportStores[0]?.id ?? '')
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [error, setError] = useState('')

  async function start(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (!supportStores.some((store) => store.id === storeId)) { setError('Επιλέξτε διαθέσιμο κατάστημα.'); return }
    const result = await startSupport(storeId, reason.trim(), minutes)
    if (result.error) setError(result.error)
    else navigate('/')
  }

  return <div className="space-y-4">
    <PageHeader eyebrow="Master" title="Πρόσβαση υποστήριξης" subtitle="Περιορισμένη στο επιλεγμένο κατάστημα, με αιτιολογία, χρονικό όριο και ιστορικό" />
    <Card>
      <h2 className="font-semibold text-ink">{supportSession ? 'Νέα συνεδρία υποστήριξης' : 'Έναρξη υποστήριξης'}</h2>
      <p className="mt-1 text-sm text-muted">Μία συνεδρία ανά master, έως 60 λεπτά. Νέα συνεδρία τερματίζει την προηγούμενη σε όλα τα tabs/συσκευές. Οι ρόλοι οργανισμού διαχειρίζονται από τον ιδιοκτήτη.</p>
      <ErrorBox message={error} />
      {supportStores.length === 0 ? <EmptyState title="Δεν υπάρχουν διαθέσιμα καταστήματα" /> : <form onSubmit={start} className="mt-4 space-y-3">
        <Field label="Κατάστημα"><Select required value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={switching}>
          <option value="" disabled>Επιλέξτε κατάστημα</option>
          {supportStores.map((store) => <option key={store.id} value={store.id}>{store.name} · {store.code ?? 'Χωρίς κωδικό'}</option>)}
        </Select></Field>
        <Field label="Αιτιολογία πρόσβασης (10–1000 χαρακτήρες)"><Input required minLength={10} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Περιγράψτε το πρόβλημα ή το αίτημα υποστήριξης" disabled={switching} /></Field>
        <Field label="Διάρκεια"><Select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} disabled={switching}>
          {[5, 15, 30, 60].map((value) => <option key={value} value={value}>{value} λεπτά</option>)}
        </Select></Field>
        <Button type="submit" disabled={switching}>{switching ? 'Ενεργοποίηση…' : 'Έναρξη καταγεγραμμένης πρόσβασης'}</Button>
      </form>}
    </Card>
    <SupportHistory revision={supportSession?.id ?? 'platform'} />
  </div>
}
