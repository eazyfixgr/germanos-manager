import { useCallback, useEffect, useState } from 'react'
import Dialog from '../Dialog'
import { Badge, Button, EmptyState, ErrorBox, Spinner } from '../ui'
import { supabase } from '../../lib/supabase'
import { formatScheduleDate, todayInAthens, WEEKDAYS } from '../../lib/schedule/dates'
import { formatSegments, type ShiftTemplate, type StaffingRequirement } from '../../lib/schedule/intervals'
import type { ScheduleData } from '../../lib/schedule/model'
import TemplateEditor from './TemplateEditor'
import RequirementEditor, { EndRequirement } from './RequirementEditor'
import PatternSettings from './PatternSettings'

export default function WorkforceSettings({ data, onClose, onChanged }: { data: ScheduleData; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'hours' | 'templates' | 'requirements'>('templates')
  const [config, setConfig] = useState<{ templates: ShiftTemplate[]; requirements: StaffingRequirement[] } | null>(null)
  const [error, setError] = useState('')
  const [template, setTemplate] = useState<ShiftTemplate | 'new' | null>(null)
  const [requirement, setRequirement] = useState<StaffingRequirement | 'new' | null>(null)
  const [ending, setEnding] = useState<StaffingRequirement | null>(null)
  const [hoursOpen, setHoursOpen] = useState(false)
  const [archiving, setArchiving] = useState<ShiftTemplate | null>(null)
  const [busy, setBusy] = useState(false)
  const [today] = useState(todayInAthens)
  const load = useCallback(async () => {
    setError('')
    try {
      const { data: result, error: loadError } = await supabase.rpc('read_workforce_configuration', { p_store: data.store_id })
      if (loadError || !Array.isArray(result?.templates) || !Array.isArray(result?.requirements)) throw new Error('Δεν φορτώθηκαν οι ρυθμίσεις διαστημάτων. Ελέγξτε ότι εφαρμόστηκαν τα W2 migrations.')
      const config = result as { templates: ShiftTemplate[]; requirements: StaffingRequirement[] }
      if ([...config.templates, ...config.requirements].some((item) => item.store_id !== data.store_id)) throw new Error('Οι ρυθμίσεις δεν αντιστοιχούν στο ενεργό κατάστημα.')
      setConfig(config)
    } catch (e) { setConfig(null); setError(e instanceof Error ? e.message : 'Σφάλμα φόρτωσης ρυθμίσεων.') }
  }, [data.store_id])
  useEffect(() => { void load() }, [load])
  function saved() { setTemplate(null); setRequirement(null); setEnding(null); setArchiving(null); void load(); onChanged() }
  return <>
    <Dialog open size="xl" title="Ρυθμίσεις προγράμματος" description="Ωράριο, τύποι με πραγματικά διαστήματα και απαιτήσεις στελέχωσης" onClose={onClose}
      footer={<Button type="button" onClick={onClose}>Κλείσιμο</Button>}>
      <div className="mb-5 flex flex-wrap gap-2">{([['hours', 'Ωράριο καταστήματος'], ['templates', 'Τύποι βαρδιών'], ['requirements', 'Ανάγκες στελέχωσης']] as const).map(([value, label]) => <Button type="button" key={value} variant={tab === value ? 'primary' : 'secondary'} onClick={() => setTab(value)}>{label}</Button>)}</div>
      <ErrorBox message={error} />
      {!config ? error ? <Button type="button" variant="secondary" onClick={() => void load()}>Επανάληψη</Button> : <Spinner /> : tab === 'hours' ? <div className="space-y-4">
        <p className="text-sm text-muted">Τα ωράρια προέρχονται από τα μοτίβα ημέρας. Οι εξαιρέσεις ημερομηνίας στο ημερολόγιο καταστήματος υπερισχύουν.</p>
        <div className="grid gap-2 sm:grid-cols-2">{WEEKDAYS.map((name, index) => { const day = data.patterns.find((row) => row.weekday === index + 1); return <div key={name} className="flex justify-between rounded-control border border-line p-3 text-sm"><b>{name}</b><span>{day ? day.closed ? 'Κλειστό' : `${day.start_time ?? '—'}–${day.end_time ?? '—'}` : 'Δεν έχει οριστεί'}</span></div> })}</div>
        <Button type="button" onClick={() => setHoursOpen(true)}>Επεξεργασία ωραρίου</Button>
      </div> : tab === 'templates' ? <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">Οι εκδόσεις κρατούν τα πραγματικά ωράρια των παλιών αναθέσεων.</p><Button type="button" onClick={() => setTemplate('new')}>Νέος τύπος βάρδιας</Button></div>
        {config.templates.length === 0 && <EmptyState title="Ορίστε τον πρώτο τύπο βάρδιας" text="Ξεκινήστε με το πραγματικό πρωινό, απογευματινό ή σπαστό του καταστήματός σας." />}
        {config.templates.map((item) => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4"><div><div className="flex items-center gap-2"><span className="h-3 w-3 rounded" style={{ backgroundColor: item.color }} /><b>{item.name}</b><Badge>{item.short_label}</Badge>{!item.active && <Badge>Αρχειοθετημένο</Badge>}</div><p className="mt-2 text-sm">{formatSegments(item.segments)}</p><p className="mt-1 text-xs text-muted">{formatScheduleDate(item.valid_from)} → {item.valid_to ? formatScheduleDate(item.valid_to) : 'Χωρίς λήξη'} · έκδοση {item.revision}</p></div>
          {item.active && (!item.valid_to || item.valid_to >= today) && <div className="flex gap-2"><Button type="button" variant="secondary" className="!text-xs" onClick={() => setTemplate(item)}>Έκδοση / επεξεργασία</Button><Button type="button" variant="ghost" className="!text-xs" onClick={() => setArchiving(item)}>Αρχείο</Button></div>}</article>)}
      </div> : <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">Απαιτήσεις ανά ημέρα και χρονικό διάστημα, με σαφή περίοδο ισχύος.</p><Button type="button" onClick={() => setRequirement('new')}>Νέα ανάγκη</Button></div>
        {config.requirements.length === 0 && <EmptyState title="Δεν έχουν οριστεί ανάγκες στελέχωσης" text="Δηλώστε πόσα άτομα χρειάζονται σε κάθε διάστημα του ωραρίου." />}
        {config.requirements.map((item) => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4"><div><b>{WEEKDAYS[item.weekday - 1]} · {item.start_time}–{item.end_time}</b><p className="mt-1 text-sm">{item.minimum} άτομα · {item.template_code ? config.templates.find((type) => type.code === item.template_code)?.name ?? item.template_code : 'Οποιαδήποτε βάρδια'}</p><p className="mt-1 text-xs text-muted">{formatScheduleDate(item.valid_from)} → {item.valid_to ? formatScheduleDate(item.valid_to) : 'Χωρίς λήξη'}</p></div>
          {(!item.valid_to || item.valid_to >= today) && <div className="flex gap-2">{item.valid_from >= today && <Button type="button" variant="secondary" className="!text-xs" onClick={() => setRequirement(item)}>Επεξεργασία</Button>}<Button type="button" variant="ghost" className="!text-xs" onClick={() => setEnding(item)}>Ορισμός λήξης</Button></div>}</article>)}
      </div>}
    </Dialog>
    {template && <TemplateEditor storeId={data.store_id} existing={template === 'new' ? undefined : template} onClose={() => setTemplate(null)} onSaved={saved} />}
    {requirement && config && <RequirementEditor storeId={data.store_id} templates={config.templates} existing={requirement === 'new' ? undefined : requirement} onClose={() => setRequirement(null)} onSaved={saved} />}
    {ending && <EndRequirement storeId={data.store_id} requirement={ending} onClose={() => setEnding(null)} onSaved={saved} />}
    {hoursOpen && <PatternSettings open storeId={data.store_id} patterns={data.patterns} minStaff={data.min_staff} onClose={() => setHoursOpen(false)} onSaved={() => { setHoursOpen(false); onChanged() }} />}
    {archiving && <Dialog open title="Αρχειοθέτηση τύπου" description={archiving.name} onClose={() => setArchiving(null)} busy={busy} footer={<><Button type="button" variant="secondary" disabled={busy} onClick={() => setArchiving(null)}>Ακύρωση</Button><Button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError('')
      try { const { error: saveError } = await supabase.rpc('archive_shift_template', { p_store: data.store_id, p_id: archiving.id, p_revision: archiving.revision }); if (saveError) throw new Error(saveError.message); saved() }
      catch (e) { setError(e instanceof Error ? e.message : 'Η αρχειοθέτηση απέτυχε.'); setArchiving(null) } finally { setBusy(false) }
    }}>Αρχειοθέτηση</Button></>}><p className="text-sm leading-relaxed">Ο τύπος παραμένει στο ιστορικό και στις παλιές αναθέσεις, αλλά δεν θα είναι διαθέσιμος για νέες αναθέσεις. Οι δηλωμένες ανάγκες στελέχωσης παραμένουν μέχρι τη λήξη τους.</p></Dialog>}
  </>
}
