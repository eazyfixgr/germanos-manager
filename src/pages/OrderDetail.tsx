import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDateTime, ORDER_FLOW, ORDER_STATUS } from '../lib/constants'
import { logActivity } from '../lib/activity'
import { scanInvoiceFile, useScanner } from '../lib/scanner'
import type { Order, OrderEvent, OrderStatus } from '../lib/types'
import { Badge, Button, Card, PageHeader, Spinner } from '../components/ui'

const NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  new: 'ordered',
  ordered: 'in_transit',
  in_transit: 'received',
  received: 'ready',
  ready: 'notified',
  notified: 'completed',
}

export default function OrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile, store } = useAuth()
  const [order, setOrder] = useState<Order | null>(null)
  const [events, setEvents] = useState<OrderEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [scanMode, setScanMode] = useState(false)
  const [scanNote, setScanNote] = useState('')
  const [slipOpen, setSlipOpen] = useState(false)
  const [qr, setQr] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    const [o, ev] = await Promise.all([
      supabase.from('orders').select('*').eq('id', id).single(),
      supabase.from('order_events').select('*').eq('order_id', id).order('created_at', { ascending: false }),
    ])
    setOrder(o.data as Order | null)
    setEvents((ev.data as OrderEvent[]) ?? [])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`order-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_events', filter: `order_id=eq.${id}` }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id, load])

  async function setStatus(status: OrderStatus, note?: string) {
    if (!order || !profile || !store) return
    setBusy(true)
    await supabase.from('orders').update({ status }).eq('id', order.id)
    await supabase.from('order_events').insert({
      order_id: order.id, status, note: note ?? null, actor_id: profile.id,
    })
    await logActivity('Αλλαγή κατάστασης παραγγελίας', `${order.product_name} → ${ORDER_STATUS[status].label}`)
    setBusy(false)
    setScanMode(false)
    setScanNote('')
    await load()
  }

  const handleScan = useCallback(
    async (text: string) => {
      if (!order || !store) return
      const code = text.trim()
      // Βρες όλες τις ανοιχτές παραγγελίες με αυτόν τον κωδικό
      const { data } = await supabase
        .from('orders')
        .select('*')
        .eq('store_id', store.id)
        .eq('product_code', code)
        .not('status', 'in', '(completed,cancelled)')
        .order('created_at', { ascending: true })

      const matches = (data as Order[]) ?? []
      if (matches.length === 0) {
        setScanNote(`Δεν βρέθηκε ανοιχτή παραγγελία με κωδικό "${code}".`)
        return
      }
      if (matches.length === 1 && matches[0].id === order.id) {
        await setStatus('received', `Σκαναρίστηκε στο τιμολόγιο: ${code}`)
        return
      }
      setScanNote(`Βρέθηκαν ${matches.length} παραγγελία(ες) με κωδικό "${code}". Επέλεξε τη σωστή.`)
      if (matches.length === 1) {
        await setStatus('received', `Σκαναρίστηκε: ${code}`)
      }
    },
    [order, store],
  )

  const scanner = useScanner(handleScan)

  async function openSlip() {
    if (!order) return
    setSlipOpen(true)
    try {
      const mod: any = await import('qrcode')
      const QRCode = mod.default ?? mod
      const text = [
        `Παραγγελία: ${order.id.slice(0, 8)}`,
        `${order.product_name} (${order.product_code})`,
        `Πελάτης: ${order.customer_name}`,
        order.customer_phone ? `Τηλ: ${order.customer_phone}` : '',
      ].filter(Boolean).join('\n')
      setQr(await QRCode.toDataURL(text, { margin: 1, width: 220 }))
    } catch {
      setQr('')
    }
  }

  if (loading) return <Spinner />
  if (!order) return <div className="text-sm text-slate-500">Η παραγγελία δεν βρέθηκε.</div>

  const statusIdx = ORDER_FLOW.indexOf(order.status)
  const nextStatus = NEXT[order.status]

  return (
    <div className="space-y-4">
      <button className="text-sm text-slate-500 hover:underline" onClick={() => navigate('/orders')}>← Πίσω στις παραγγελίες</button>

      <Card>
        <PageHeader
          eyebrow="Παραγγελία"
          title={order.product_name}
          subtitle={`Κωδικός: ${order.product_code}`}
          actions={<Badge className={ORDER_STATUS[order.status].color}>{ORDER_STATUS[order.status].label}</Badge>}
        />
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div><span className="text-slate-500">Πελάτης:</span> <strong>{order.customer_name}</strong></div>
          {order.customer_phone && <div><span className="text-slate-500">Τηλέφωνο:</span> <strong>{order.customer_phone}</strong></div>}
          <div><span className="text-slate-500">Δημιουργήθηκε:</span> {fmtDateTime(order.created_at)}</div>
          <div><span className="text-slate-500">Ενημερώθηκε:</span> {fmtDateTime(order.updated_at)}</div>
        </div>
        {order.notes && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{order.notes}</p>}
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900">Πορεία παραγγελίας</h2>
        <div className="mt-3 flex flex-wrap gap-1">
          {ORDER_FLOW.map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  i <= statusIdx ? ORDER_STATUS[s].color : 'bg-slate-100 text-slate-400'
                }`}
              >
                {i + 1}. {ORDER_STATUS[s].label}
              </span>
              {i < ORDER_FLOW.length - 1 && <span className="text-slate-300">→</span>}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {nextStatus && (
            <Button onClick={() => setStatus(nextStatus)} disabled={busy}>
              {busy ? '…' : `Επόμενο: ${ORDER_STATUS[nextStatus].label}`}
            </Button>
          )}
          {order.status !== 'cancelled' && order.status !== 'completed' && (
            <Button variant="danger" onClick={() => setStatus('cancelled', 'Ακυρώθηκε')} disabled={busy}>
              Ακύρωση
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Ετικέτα παραλαβής</h2>
          <Button variant="secondary" onClick={openSlip}>Εκτύπωση ετικέτας</Button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Δημιουργεί slip με QR για την παραγγελία του πελάτη.</p>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Σκαναρίσματος τιμολογίου</h2>
          <Button variant="secondary" onClick={() => { setScanMode(!scanMode); if (scanMode) { scanner.stop() } else { scanner.start('scan-area') } }}>
            {scanMode ? 'Σταμάτημα' : 'Σκανάρισμα κωδικού'}
          </Button>
        </div>
        {scanMode && (
          <div className="mt-3">
            <div id="scan-area" className="overflow-hidden rounded-lg" />
            {scanner.error && <p className="mt-2 text-sm text-red-600">{scanner.error}</p>}
            <label className="mt-3 block text-sm">
              Ή φόρτωσε φωτογραφία τιμολογίου:
              <input
                type="file"
                accept="image/*"
                className="mt-1 block text-sm text-slate-500"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  try {
                    await scanInvoiceFile(f, handleScan)
                  } catch {
                    setScanNote('Δεν βρέθηκε barcode στην εικόνα.')
                  }
                }}
              />
            </label>
          </div>
        )}
        {scanNote && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{scanNote}</p>}
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900">Ιστορικό</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Δεν υπάρχουν καταγραφές.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {events.map((ev) => (
              <li key={ev.id} className="flex items-center gap-2 text-sm">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS[ev.status as OrderStatus]?.color ?? 'bg-slate-100'}`}>
                  {ORDER_STATUS[ev.status as OrderStatus]?.label ?? ev.status}
                </span>
                {ev.note && <span className="text-slate-500">— {ev.note}</span>}
                <span className="ml-auto text-xs text-slate-400">{fmtDateTime(ev.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {slipOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSlipOpen(false)}>
          <div
            id="print-slip"
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <div className="text-base font-bold text-slate-900">Γερμανός Manager</div>
              <div className="text-xs text-slate-500">Απόδειξη παραγγελίας πελάτη</div>
            </div>
            {qr && <img src={qr} alt="QR" className="mx-auto mt-4 h-44 w-44" />}
            <div className="mt-3 space-y-1 text-sm text-slate-800">
              <div><span className="text-slate-500">Κωδικός:</span> {order.id.slice(0, 8).toUpperCase()}</div>
              <div><span className="text-slate-500">Προϊόν:</span> {order.product_name}</div>
              <div><span className="text-slate-500">Κωδικός είδους:</span> {order.product_code}</div>
              <div><span className="text-slate-500">Πελάτης:</span> {order.customer_name}</div>
              {order.customer_phone && <div><span className="text-slate-500">Τηλ:</span> {order.customer_phone}</div>}
              <div><span className="text-slate-500">Ημερομηνία:</span> {fmtDateTime(order.created_at)}</div>
            </div>
            <div className="no-print mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSlipOpen(false)}>Κλείσιμο</Button>
              <Button onClick={() => window.print()}>Εκτύπωση</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
