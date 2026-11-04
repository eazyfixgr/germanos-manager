import { describe, it, expect } from 'vitest'
import { toNumber, parseDateFlexible, isExcelError, normText } from '../normalize'

describe('toNumber', () => {
  it('parses Greek decimal and thousand formats', () => {
    expect(toNumber('1.234,56')).toBe(1234.56)
    expect(toNumber('12,5')).toBe(12.5)
    expect(toNumber('1.234')).toBe(1234)
    expect(toNumber('1.234.567')).toBe(1234567)
    expect(toNumber('€ 1.234')).toBe(1234)
    expect(toNumber('(123,45)')).toBe(-123.45)
    expect(toNumber('  ')).toBeNull()
  })

  it('rejects Excel error cells', () => {
    expect(toNumber('#REF!')).toBeNull()
    expect(toNumber('#DIV/0!')).toBeNull()
    expect(toNumber('#N/A')).toBeNull()
  })
})

describe('parseDateFlexible', () => {
  it('parses ISO, Greek day-first and short years', () => {
    expect(parseDateFlexible('2026-11-02')).toBe('2026-11-02')
    expect(parseDateFlexible('02/11/2026')).toBe('2026-11-02')
    expect(parseDateFlexible('2-11-26')).toBe('2026-11-02')
    expect(parseDateFlexible('13/02/2026')).toBe('2026-02-13')
    expect(parseDateFlexible('11/13/2026')).toBe('2026-11-13')
    expect(parseDateFlexible('#N/A')).toBeNull()
  })
})

describe('isExcelError', () => {
  it('detects spreadsheet error values', () => {
    expect(isExcelError('#REF!')).toBe(true)
    expect(isExcelError('#DIV/0!')).toBe(true)
    expect(isExcelError('123')).toBe(false)
  })
})

describe('normText', () => {
  it('removes accents and normalizes spaces', () => {
    expect(normText('  Κατηγορία  ')).toBe('κατηγορια')
    expect(normText('ΠΩΛΗΤΗΣ')).toBe('πωλητης')
  })
})
