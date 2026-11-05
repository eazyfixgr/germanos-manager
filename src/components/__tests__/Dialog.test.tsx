// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import Dialog from '../Dialog'

afterEach(cleanup)
function Example({ dirty = false, busy = false }: { dirty?: boolean; busy?: boolean }) {
  const [open, setOpen] = useState(false)
  return <><button onClick={() => setOpen(true)}>Άνοιγμα</button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Δοκιμή" description="Περιγραφή δοκιμής" dirty={dirty} busy={busy}
      footer={<button onClick={() => setOpen(false)}>Τέλος</button>}>
      <label>Τίτλος<input defaultValue="Αρχικός" /></label>
    </Dialog></>
}
describe('shared Dialog', () => {
  it('labels the dialog, focuses a field, locks scroll and restores the opener on Escape', () => {
    render(<Example />)
    const opener = screen.getByText('Άνοιγμα'); opener.focus(); fireEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Δοκιμή' }).getAttribute('aria-describedby')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Τίτλος'))
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).toBe('')
  })
  it('wraps Tab within the dialog and refuses external focus', () => {
    render(<Example />); fireEvent.click(screen.getByText('Άνοιγμα'))
    screen.getByText('Τέλος').focus(); fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Κλείσιμο παραθύρου' }))
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByText('Τέλος'))
    act(() => { screen.getByText('Άνοιγμα').focus() })
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })
  it('preserves dirty field values until the user explicitly discards', async () => {
    render(<Example dirty />); fireEvent.click(screen.getByText('Άνοιγμα'))
    fireEvent.change(screen.getByLabelText('Τίτλος'), { target: { value: 'Αλλαγμένος' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('alert').textContent).toContain('μη αποθηκευμένες')
    fireEvent.click(screen.getByText('Συνέχεια επεξεργασίας'))
    await act(async () => { await Promise.resolve() })
    expect((screen.getByLabelText('Τίτλος') as HTMLInputElement).value).toBe('Αλλαγμένος')
    fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(screen.getByText('Απόρριψη αλλαγών'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('does not close during a busy operation', () => {
    render(<Example busy />); fireEvent.click(screen.getByText('Άνοιγμα'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('true')
    expect((screen.getByRole('button', { name: 'Κλείσιμο παραθύρου' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('handles Escape on the topmost dialog only', () => {
    const outerClose = vi.fn(); const innerClose = vi.fn()
    render(<Dialog open title="Εξωτερικό" onClose={outerClose}>
      <Dialog open title="Εσωτερικό" onClose={innerClose}><p>Περιεχόμενο</p></Dialog>
    </Dialog>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(innerClose).toHaveBeenCalledOnce()
    expect(outerClose).not.toHaveBeenCalled()
  })
})
