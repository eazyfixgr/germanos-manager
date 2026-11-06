import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Card, ErrorBox, Field, Input, Select, Spinner, SuccessBox } from './ui'
import type {
  EmployeePointCategoryTarget, PointCategory, PointCategoryAdjustment, PointCategoryKey,
  PointCategoryScore, Profile, ServiceCategory, StorePointCategoryTarget, StorePointRule,
} from '../lib/types'

type RuleDraft = { categoryKey: string; rate: string }

const rank: Record<Profile['store_position'], number> = {
  owner: 0, director: 1, assistant_director: 2, supervisor: 3, employee: 4,
}

function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function amount(value: number | string | undefined) {
  return new Intl.NumberFormat('el-GR', { maximumFractionDigits: 2 }).format(Number(value ?? 0))
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`))
}

export default function PointCategoryPanel({ storeId, month, actor, employees, isAdmin, isMaster, canConfigure }: {
  storeId: string; month: string; actor: Profile; employees: Profile[]; isAdmin: boolean; isMaster: boolean; canConfigure: boolean
}) {
  const [categories, setCategories] = useState<PointCategory[]>([])
  const [services, setServices] = useState<ServiceCategory[]>([])
  const [rules, setRules] = useState<StorePointRule[]>([])
  const [storeTargets, setStoreTargets] = useState<StorePointCategoryTarget[]>([])
  const [employeeTargets, setEmployeeTargets] = useState<EmployeePointCategoryTarget[]>([])
  const [scores, setScores] = useState<PointCategoryScore[]>([])
  const [adjustments, setAdjustments] = useState<PointCategoryAdjustment[]>([])
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, RuleDraft>>({})
  const [selectedUser, setSelectedUser] = useState(actor.id)
  const [actorPosition, setActorPosition] = useState<Profile['store_position']>(actor.store_position)
  const [ruleEffectiveFrom, setRuleEffectiveFrom] = useState(today())
  const [adjustDate, setAdjustDate] = useState(today())
  const [adjustCategory, setAdjustCategory] = useState<PointCategoryKey>('fixed')
  const [adjustDelta, setAdjustDelta] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const [categoryResult, serviceResult, ruleResult, storeTargetResult, employeeTargetResult, scoreResult, adjustmentResult, positionResult] = await Promise.all([
      supabase.from('point_categories').select('*').order('sort_order'),
      supabase.from('service_categories').select('*').order('sort_order'),
      supabase.from('store_point_rules').select('*').eq('store_id', storeId),
      supabase.from('store_point_category_targets').select('*').eq('store_id', storeId).eq('month', month),
      supabase.from('employee_point_category_targets').select('*').eq('store_id', storeId).eq('month', month),
      supabase.rpc('read_point_category_scores', { p_store: storeId, p_month: month, p_user: null }),
      supabase.from('point_category_adjustments').select('*').eq('store_id', storeId)
        .gte('date', `${month}-01`).lt('date', nextMonth(month)).order('created_at', { ascending: false }).limit(30),
      supabase.rpc('my_store_position', { p_store: storeId }),
    ])
    const failed = [categoryResult, serviceResult, ruleResult, storeTargetResult, employeeTargetResult, scoreResult, adjustmentResult, positionResult]
      .some((result) => result.error)
    if (failed) {
      setError('Δεν φορτώθηκαν οι πόντοι ανά κατηγορία. Εφάρμοσε πρώτα το store_point_categories migration.')
      setLoading(false); return
    }
    setCategories((categoryResult.data ?? []) as PointCategory[])
    setServices((serviceResult.data ?? []) as ServiceCategory[])
    setRules((ruleResult.data ?? []) as StorePointRule[])
    setStoreTargets((storeTargetResult.data ?? []) as StorePointCategoryTarget[])
    setEmployeeTargets((employeeTargetResult.data ?? []) as EmployeePointCategoryTarget[])
    setScores((scoreResult.data ?? []) as PointCategoryScore[])
    setAdjustments((adjustmentResult.data ?? []) as PointCategoryAdjustment[])
    setActorPosition((positionResult.data ?? actor.store_position) as Profile['store_position'])
    setLoading(false)
  }, [actor.store_position, month, storeId])

  useEffect(() => { void load() }, [load])

  const rankedEmployees = useMemo(() => employees.filter((person) => isMaster || rank[actorPosition] < rank[person.store_position]),
    [actorPosition, employees, isMaster])
  const currentUser = isAdmin
    ? rankedEmployees.find((person) => person.id === selectedUser) ?? rankedEmployees[0]
    : actor

  useEffect(() => {
    if (isAdmin && currentUser && selectedUser !== currentUser.id) setSelectedUser(currentUser.id)
  }, [currentUser, isAdmin, selectedUser])

  function currentRule(serviceId: string) {
    return rules.filter((rule) => rule.service_category_id === serviceId && rule.valid_from <= today())
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]
  }
  function score(category: PointCategoryKey, userId?: string, field: 'sales_points'|'adjustments'|'total_points'='total_points') {
    return scores.filter((row) => row.category_key === category && (!userId || row.user_id === userId))
      .reduce((sum, row) => sum + Number(row[field]), 0)
  }
  function target(category: PointCategoryKey, userId?: string) {
    return userId
      ? employeeTargets.find((row) => row.category_key === category && row.user_id === userId)?.target ?? 0
      : storeTargets.find((row) => row.category_key === category)?.target ?? 0
  }

  async function saveRule(service: ServiceCategory, categoryKey: string, rate: string) {
    setBusy(true); setError(''); setSuccess('')
    const { error: saveError } = await supabase.rpc('save_store_point_rule', {
      p_store: storeId, p_service_category: service.id, p_point_category: categoryKey || null,
      p_points_per_unit: Number(rate) || 0, p_effective_from: ruleEffectiveFrom,
    })
    setBusy(false)
    if (saveError) { setError(saveError.message); return }
    setRuleDrafts((previous) => { const next={...previous}; delete next[service.id]; return next })
    setSuccess(`Αποθηκεύτηκε η βαθμολόγηση για ${service.name}.`)
    await load()
  }

  async function saveTarget(category: PointCategoryKey, value: string, userId?: string) {
    setError(''); setSuccess('')
    const { error: saveError } = await supabase.rpc('save_point_category_target', {
      p_store: storeId, p_user: userId ?? null, p_category: category, p_month: month, p_target: Number(value) || 0,
    })
    if (saveError) { setError(saveError.message); return }
    setSuccess('Ο στόχος κατηγορίας ενημερώθηκε.')
    await load()
  }

  async function saveAdjustment(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('')
    const { error: saveError } = await supabase.rpc('adjust_point_category', {
      p_store: storeId, p_user: isAdmin ? currentUser?.id : actor.id, p_category: adjustCategory,
      p_date: adjustDate, p_delta: Number(adjustDelta), p_reason: adjustReason.trim(),
    })
    setBusy(false)
    if (saveError) { setError(saveError.message); return }
    setAdjustDelta(''); setAdjustReason(''); setSuccess('Η προσαρμογή καταγράφηκε στο ιστορικό.')
    await load()
  }

  if (loading) return <Spinner />
  const canSetSellerTarget = Boolean(currentUser && (isMaster || (currentUser.id !== actor.id && rank[actorPosition] < rank[currentUser.store_position])))
  const teamScores = categories.map((category) => ({ category, points: score(category.category_key) }))
  const unconfiguredRules=services.filter((service)=>{
    const rule=currentRule(service.id)
    return rule?.point_category_key && Number(rule.points_per_unit)===0
  })
  return <div className="space-y-4">
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-semibold text-slate-900">Πόντοι ανά κατηγορία</h2>
          <p className="mt-1 text-xs text-slate-500">Πρόταση από πωλήσεις + καταγεγραμμένες διορθώσεις. Το συνολικό σκορ παραμένει ανεξάρτητο.</p></div>
        {isAdmin && <Field label="Εργαζόμενος"><Select value={currentUser?.id ?? ''} onChange={(event) => setSelectedUser(event.target.value)}>
          {rankedEmployees.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
        </Select></Field>}
      </div>
      <ErrorBox message={error} /><SuccessBox message={success} />
      {unconfiguredRules.length>0 && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        {unconfiguredRules.length} υπηρεσίες έχουν αντιστοίχιση αλλά συντελεστή 0. Ρύθμισε τους πόντους ανά μονάδα πριν χρησιμοποιηθούν ως πρόταση.
      </p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm"><thead><tr className="border-b border-line text-left text-xs text-muted">
          <th className="p-2">Κατηγορία πόντων</th>{isAdmin && <th className="p-2 text-right">Στόχος καταστήματος</th>}
          {isAdmin && <th className="p-2 text-right">Πόντοι ομάδας</th>}
          <th className="p-2 text-right">Στόχος εργαζομένου</th><th className="p-2 text-right">Από πωλήσεις</th>
          <th className="p-2 text-right">Διορθώσεις</th><th className="p-2 text-right">Τελικοί πόντοι</th>
        </tr></thead><tbody className="divide-y divide-line">
          {categories.map((category) => <tr key={category.category_key}>
            <td className="p-2 font-medium">{category.name}</td>
            {isAdmin && <td className="p-2 text-right"><Input type="number" min="0" step="0.01" key={`${category.category_key}-${target(category.category_key)}-${month}`}
              defaultValue={target(category.category_key)} disabled={busy} className="ml-auto max-w-28 text-right"
              onBlur={(event) => void saveTarget(category.category_key,event.target.value)} /></td>}
            {isAdmin && <td className="p-2 text-right">{amount(teamScores.find((row)=>row.category.category_key===category.category_key)?.points)}</td>}
            <td className="p-2 text-right">{canSetSellerTarget ? <Input type="number" min="0" step="0.01" key={`${category.category_key}-${target(category.category_key,currentUser?.id)}-${currentUser?.id}-${month}`}
              defaultValue={target(category.category_key,currentUser?.id)} disabled={busy} className="ml-auto max-w-28 text-right"
              onBlur={(event)=>void saveTarget(category.category_key,event.target.value,currentUser?.id)} /> : amount(target(category.category_key,currentUser?.id))}</td>
            <td className="p-2 text-right">{amount(score(category.category_key,currentUser?.id,'sales_points'))}</td>
            <td className="p-2 text-right">{amount(score(category.category_key,currentUser?.id,'adjustments'))}</td>
            <td className="p-2 text-right font-semibold">{amount(score(category.category_key,currentUser?.id))}</td>
          </tr>)}
        </tbody></table>
      </div>
      {categories.length===0 && <p className="py-4 text-center text-sm text-muted">Δεν έχουν οριστεί κατηγορίες πόντων.</p>}
    </Card>

    <Card>
      <h3 className="font-semibold text-slate-900">Χειροκίνητη προσαρμογή</h3>
      <p className="mt-1 text-xs text-slate-500">Προσθέτει ή αφαιρεί πόντους πάνω στην αυτόματη πρόταση και κρατά αιτιολογία/ιστορικό.</p>
      <form onSubmit={saveAdjustment} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        {isAdmin && <Field label="Εργαζόμενος"><Select required value={currentUser?.id ?? ''} onChange={(event)=>setSelectedUser(event.target.value)}>
          {rankedEmployees.map((person)=><option key={person.id} value={person.id}>{person.full_name}</option>)}
        </Select></Field>}
        <Field label="Ημερομηνία"><Input required type="date" value={adjustDate} onChange={(event)=>setAdjustDate(event.target.value)} /></Field>
        <Field label="Κατηγορία"><Select value={adjustCategory} onChange={(event)=>setAdjustCategory(event.target.value as PointCategoryKey)}>
          {categories.map((category)=><option key={category.category_key} value={category.category_key}>{category.name}</option>)}
        </Select></Field>
        <Field label="Προσαρμογή πόντων (+/−)"><Input required type="number" step="0.01" value={adjustDelta} onChange={(event)=>setAdjustDelta(event.target.value)} placeholder="π.χ. 2 ή -1" /></Field>
        <Field label="Αιτιολογία"><Input required minLength={5} maxLength={1000} value={adjustReason} onChange={(event)=>setAdjustReason(event.target.value)} /></Field>
        <div className="lg:col-span-5 flex justify-end"><Button type="submit" disabled={busy||!currentUser}>{busy?'Αποθήκευση…':'Καταχώρηση προσαρμογής'}</Button></div>
      </form>
      {adjustments.length>0 && <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Ιστορικό διορθώσεων ({adjustments.length})</summary>
        <ul className="mt-2 divide-y divide-line text-xs">{adjustments.map((row)=><li key={row.id} className="flex flex-wrap justify-between gap-2 py-2">
          <span>{dateLabel(row.date)} · {categories.find((category)=>category.category_key===row.category_key)?.name} · {employees.find((person)=>person.id===row.user_id)?.full_name ?? 'Εργαζόμενος'}</span>
          <span className="font-semibold">{Number(row.points_delta)>0?'+':''}{amount(row.points_delta)} · {row.reason}</span>
        </li>)}</ul>
      </details>}
    </Card>

    {canConfigure && <Card>
      <details>
        <summary className="cursor-pointer font-semibold">Ρύθμιση βαθμολόγησης αυτού του καταστήματος</summary>
        <p className="mt-2 text-xs text-slate-500">Οι πόντοι πρότασης = τεμάχια πώλησης × πόντοι/μονάδα. Οι αλλαγές ισχύουν από την επιλεγμένη ημερομηνία. Δεν ορίστηκαν αυθαίρετες τιμές.</p>
        <Field label="Ισχύει από"><Input className="mt-2 max-w-56" type="date" value={ruleEffectiveFrom} onChange={(event)=>setRuleEffectiveFrom(event.target.value)} /></Field>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-line text-left text-xs text-muted">
          <th className="p-2">Υπηρεσία πωλήσεων</th><th className="p-2">Bucket πόντων</th><th className="p-2">Πόντοι ανά μονάδα</th><th className="p-2">Ισχύουσα ρύθμιση</th><th />
        </tr></thead><tbody className="divide-y divide-line">{services.map((service)=>{
          const rule=currentRule(service.id)
          const draft=ruleDrafts[service.id] ?? {categoryKey:rule?.point_category_key??'',rate:String(rule?.points_per_unit??0)}
          return <tr key={service.id}><td className="p-2">{service.name}<span className="ml-1 text-xs text-muted">({service.unit==='currency'?'€':'τεμ.'})</span></td>
            <td className="p-2"><Select aria-label={`Bucket ${service.name}`} value={draft.categoryKey}
              disabled={busy} className="min-w-44" onChange={(event)=>setRuleDrafts((previous)=>({...previous,[service.id]:{...draft,categoryKey:event.target.value}}))}>
                <option value="">Χωρίς πόντους</option>{categories.map((category)=><option key={category.category_key} value={category.category_key}>{category.name}</option>)}
              </Select></td>
            <td className="p-2"><Input aria-label={`Πόντοι ανά μονάδα ${service.name}`} type="number" min="0" step="0.01" disabled={busy}
              value={draft.rate} onChange={(event)=>setRuleDrafts((previous)=>({...previous,[service.id]:{...draft,rate:event.target.value}}))} /></td>
            <td className="p-2 text-xs text-muted">{rule ? `${rule.point_category_key??'χωρίς bucket'} · από ${dateLabel(rule.valid_from)}` : 'Μη ρυθμισμένη'}</td>
            <td className="p-2 text-right"><Button variant="secondary" disabled={busy} onClick={()=>void saveRule(service,draft.categoryKey,draft.rate)}>Αποθήκευση</Button></td>
          </tr>
        })}</tbody></table></div>
      </details>
    </Card>}
  </div>
}

function nextMonth(month: string) {
  const [year, value] = month.split('-').map(Number)
  return value===12 ? `${year+1}-01-01` : `${year}-${String(value+1).padStart(2,'0')}-01`
}
