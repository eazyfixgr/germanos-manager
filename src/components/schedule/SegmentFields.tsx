import { Field, Input } from '../ui'
import type { WorkSegment } from '../../lib/schedule/intervals'

export default function SegmentFields({ value, onChange, disabled }: { value: WorkSegment[]; onChange: (value: WorkSegment[]) => void; disabled?: boolean }) {
  return <div className="space-y-3">{value.map((segment, index) => <div key={index} className="rounded-xl border border-line bg-slate-50 p-3">
    <p className="mb-2 text-xs font-bold">{value.length > 1 ? `${index + 1}ο διάστημα εργασίας` : 'Διάστημα εργασίας'}</p>
    <div className="grid grid-cols-2 gap-3"><Field label={`Έναρξη ${index + 1}`}><Input type="time" required value={segment.start} disabled={disabled}
      onChange={(event) => onChange(value.map((item, i) => i === index ? { ...item, start: event.target.value } : item))} /></Field>
      <Field label={`Λήξη ${index + 1}`}><Input type="time" required value={segment.end} disabled={disabled}
        onChange={(event) => onChange(value.map((item, i) => i === index ? { ...item, end: event.target.value } : item))} /></Field></div>
  </div>)}</div>
}
