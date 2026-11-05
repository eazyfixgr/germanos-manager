import type { ScheduleDay } from '../../lib/schedule/model'

export default function CoveragePanel({ day }: { day: ScheduleDay }) {
  const coverage = day.coverage
  if (!coverage) return null
  const tone = coverage.status === 'covered' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : coverage.status === 'missing' || coverage.status === 'partial' ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-blue-100 bg-blue-50/50 text-slate-700'
  return <section className={`mb-4 rounded-xl border p-4 ${tone}`}>
    <h3 className="text-sm font-bold">{coverage.label}</h3>
    <p className="mt-1 text-xs leading-relaxed">Ο έλεγχος χρησιμοποιεί τα πραγματικά διαστήματα εργασίας και δεν μετρά το κενό του σπαστού ως εργασία.</p>
    {coverage.unresolved > 0 && <p className="mt-2 text-xs font-semibold">{coverage.unresolved} βάρδιες χωρίς επιβεβαιωμένα διαστήματα δεν προσμετρώνται στην κάλυψη.</p>}
    {coverage.requirements.length === 0 && <p className="mt-2 text-xs">Δεν έχουν οριστεί ανάγκες για αυτή την ημέρα και περίοδο.</p>}
    {coverage.gaps.length > 0 && <ul className="mt-3 space-y-1 text-xs">{coverage.gaps.map((gap, index) => <li key={`${index}-${gap.start}`}>{gap.start}–{gap.end} · {gap.actual} από {gap.required} άτομα{gap.templateCode ? ' του δηλωμένου τύπου' : ''}</li>)}</ul>}
    <p className="mt-2 text-[11px]">Η ένδειξη αφορά τις ανάγκες που έχουν ρυθμιστεί για αυτή την περίοδο.</p>
  </section>
}
