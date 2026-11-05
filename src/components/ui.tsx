import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import Dialog from './Dialog'
import type { DialogProps } from './Dialog'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'dark'
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-control px-3.5 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50'
  const variants = {
    primary: 'bg-brand text-white shadow-sm hover:bg-brand-hover',
    secondary: 'border border-line bg-surface text-ink hover:bg-slate-50',
    danger: 'border border-red-200 bg-red-50 text-[#c83d4c] hover:bg-red-100',
    ghost: 'text-slate-600 hover:bg-slate-100',
    dark: 'bg-navy text-white hover:bg-navy-2',
  }
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="h-10 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
      {...props}
    />
  )
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
      {...props}
    />
  )
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className="h-10 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
      {...props}
    />
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-semibold text-ink/80">{label}</span>
      {children}
    </label>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-line bg-surface p-5 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ${className || 'bg-slate-100 text-slate-600'}`}>
      {children}
    </span>
  )
}

export function ProgressBar({ value, color = 'brand' }: { value: number; color?: 'brand' | 'green' | 'amber' | 'purple' }) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const colors = {
    brand: 'bg-brand',
    green: 'bg-success',
    amber: 'bg-warning',
    purple: 'bg-[#7c64d6]',
  }
  return (
    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full transition-all ${colors[color]}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand" />
    </div>
  )
}

export function Modal({
  wide = false, ...props
}: Omit<DialogProps, 'size'> & { wide?: boolean }) {
  return <Dialog {...props} size={wide ? 'lg' : 'sm'} />
}

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null
  return <div role="alert" className="mt-2 rounded-control border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div>
}

export function SuccessBox({ message }: { message: string }) {
  if (!message) return null
  return <div role="status" className="mt-2 rounded-control border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</div>
}

export function PageHeader({
  eyebrow, title, subtitle, actions,
}: { eyebrow?: string; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[1.1px] text-muted">{eyebrow}</div>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-end gap-2">{actions}</div>}
    </div>
  )
}

export function MetricCard({
  label, value, detail, icon, progress, accent = 'brand', trend, trendTone = 'up',
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  icon?: ReactNode
  progress?: number
  accent?: 'brand' | 'green' | 'amber' | 'purple'
  trend?: string
  trendTone?: 'up' | 'warn' | 'neutral'
}) {
  const iconBg = {
    brand: 'bg-blue-50 text-brand',
    green: 'bg-emerald-50 text-success',
    amber: 'bg-amber-50 text-warning',
    purple: 'bg-violet-50 text-[#7c64d6]',
  }
  const trendCls = {
    up: 'bg-emerald-50 text-success',
    warn: 'bg-amber-50 text-warning',
    neutral: 'bg-slate-100 text-slate-600',
  }
  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted">{label}</span>
        {icon && <span className={`grid h-8 w-8 place-items-center rounded-[10px] ${iconBg[accent]}`}>{icon}</span>}
      </div>
      <div className="mt-3 text-2xl font-bold tracking-tight text-ink tabular-nums">{value}</div>
      {detail && <div className="mt-1 text-xs text-muted">{detail}</div>}
      {trend && <div className="mt-2"><span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${trendCls[trendTone]}`}>{trend}</span></div>}
      {typeof progress === 'number' && <ProgressBar value={progress} color={accent} />}
    </div>
  )
}

export function EmptyState({ title, text }: { title: string; text?: string }) {
  return (
    <div className="py-10 text-center">
      <div className="text-sm font-semibold text-ink">{title}</div>
      {text && <p className="mt-1 text-sm text-muted">{text}</p>}
    </div>
  )
}

export function SearchInput({
  value, onChange, placeholder = 'Αναζήτηση…',
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-control border border-line bg-surface px-3 text-muted focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border-0 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
      />
    </label>
  )
}
