import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-slate-900 text-white hover:bg-slate-700',
    secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-100',
    danger: 'bg-red-600 text-white hover:bg-red-500',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
      {...props}
    />
  )
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
      {...props}
    />
  )
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none bg-white"
      {...props}
    />
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl bg-white shadow-sm border border-slate-200 p-4 ${className}`}>{children}</div>
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-900" />
    </div>
  )
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Κλείσιμο">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null
  return <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{message}</div>
}

export function SuccessBox({ message }: { message: string }) {
  if (!message) return null
  return <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">{message}</div>
}
