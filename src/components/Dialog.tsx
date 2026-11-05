import { createContext, useContext, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface DialogProps {
  open: boolean; onClose: () => void; title: string; description?: string
  children: ReactNode; footer?: ReactNode; size?: 'sm' | 'lg' | 'xl'
  busy?: boolean; dirty?: boolean
}
const stack: HTMLElement[] = []
const depths = new WeakMap<HTMLElement, number>()
const DialogDepth = createContext(0)
let previousOverflow = ''
let rootOpener: HTMLElement | null = null
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
function focusable(panel: HTMLElement) {
  return [...panel.querySelectorAll<HTMLElement>(focusableSelector)].filter((node) => {
    const style = getComputedStyle(node)
    return node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[hidden], [inert]')
      && style.display !== 'none' && style.visibility !== 'hidden'
  })
}

export default function Dialog(props: DialogProps) {
  const depth = useContext(DialogDepth)
  return props.open ? <DialogDepth.Provider value={depth + 1}><OpenDialog {...props} depth={depth} /></DialogDepth.Provider> : null
}

function OpenDialog({ onClose, title, description, children, footer, size = 'sm', busy = false, dirty = false, depth }: DialogProps & { depth: number }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onClose, busy, dirty })
  const previousField = useRef<HTMLElement | null>(null)
  const [discard, setDiscard] = useState(false)
  const titleId = useId()
  const descriptionId = useId()
  useLayoutEffect(() => { callbacks.current = { onClose, busy, dirty } })

  function requestClose() {
    if (callbacks.current.busy) return
    if (callbacks.current.dirty) {
      previousField.current = document.activeElement as HTMLElement | null
      setDiscard(true)
    } else callbacks.current.onClose()
  }

  useLayoutEffect(() => {
    const panel = panelRef.current!
    const opener = document.activeElement as HTMLElement | null
    if (stack.length === 0) { previousOverflow = document.body.style.overflow; rootOpener = opener; document.body.style.overflow = 'hidden' }
    depths.set(panel, depth)
    stack.push(panel)
    stack.sort((a, b) => depths.get(a)! - depths.get(b)!)
    for (const item of stack) {
      if (item !== stack.at(-1)) { item.setAttribute('inert', ''); item.setAttribute('aria-hidden', 'true') }
      else { item.removeAttribute('inert'); item.removeAttribute('aria-hidden') }
    }
    const initial = panel.querySelector<HTMLElement>('[data-autofocus]')
      ?? panel.querySelector<HTMLElement>('input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled)')
      ?? panel
    if (stack.at(-1) === panel) initial.focus()

    const close = () => {
      if (callbacks.current.busy) return
      if (callbacks.current.dirty) { previousField.current = document.activeElement as HTMLElement | null; setDiscard(true) }
      else callbacks.current.onClose()
    }
    const keydown = (event: KeyboardEvent) => {
      if (stack.at(-1) !== panel) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      if (event.key === 'Tab') {
        const controls = focusable(panel)
        const first = controls[0]
        const last = controls.at(-1)
        if (!first) { event.preventDefault(); panel.focus(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
          event.preventDefault(); first.focus()
        }
      }
    }
    const focusin = (event: FocusEvent) => {
      if (stack.at(-1) === panel && !panel.contains(event.target as Node)) (focusable(panel)[0] ?? panel).focus()
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', focusin)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', focusin)
      const index = stack.indexOf(panel)
      if (index >= 0) stack.splice(index, 1)
      const top = stack.at(-1)
      top?.removeAttribute('inert'); top?.removeAttribute('aria-hidden')
      if (stack.length === 0) {
        document.body.style.overflow = previousOverflow
        if (rootOpener?.isConnected) rootOpener.focus()
        rootOpener = null
      } else if (opener?.isConnected && top?.contains(opener)) opener.focus()
      else top?.focus()
    }
  }, [depth])

  const sizes = { sm: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-6xl' }
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0d1628]/50 p-2 backdrop-blur-sm sm:p-5"
      onClick={(event) => { if (event.target === event.currentTarget && stack.at(-1) === panelRef.current) requestClose() }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined} aria-busy={busy || undefined} tabIndex={-1}
        className={`flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-2xl border border-white/50 bg-surface text-ink shadow-2xl outline-none sm:max-h-[92dvh] ${sizes[size]}`}>
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-4 py-4 sm:px-6 sm:py-5">
          <div><h2 id={titleId} className="text-lg font-bold tracking-tight">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-muted">{description}</p>}</div>
          <button type="button" onClick={requestClose} disabled={busy} aria-label="Κλείσιμο παραθύρου"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-control border border-line text-muted hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-40">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">{children}</div>
        {discard ? <div role="alert" className="shrink-0 border-t border-amber-200 bg-amber-50 px-4 py-4 sm:px-6">
          <p className="text-sm font-semibold">Υπάρχουν μη αποθηκευμένες αλλαγές.</p>
          <p className="mt-1 text-xs text-slate-600">Θέλετε να συνεχίσετε την επεξεργασία ή να τις απορρίψετε;</p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" autoFocus className="rounded-control border border-line bg-white px-3 py-2 text-sm font-semibold"
              onClick={() => { setDiscard(false); const field = previousField.current; queueMicrotask(() => { if (field?.isConnected) field.focus() }) }}>Συνέχεια επεξεργασίας</button>
            <button type="button" disabled={busy} className="rounded-control bg-danger px-3 py-2 text-sm font-semibold text-white"
              onClick={() => { if (!callbacks.current.busy) callbacks.current.onClose() }}>Απόρριψη αλλαγών</button>
          </div>
        </div> : footer && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-slate-50/60 px-4 py-3 sm:px-6 sm:py-4">{footer}</footer>}
      </div>
    </div>, document.body,
  )
}
