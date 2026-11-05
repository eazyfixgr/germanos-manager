import { describe, expect, it } from 'vitest'
import writeExcelFile from 'write-excel-file/universal'
import { MAX_SPREADSHEET_BYTES, readWorkbook } from '../xlsx'

describe('Phase 0 spreadsheet adapter regression', () => {
  it('reads a real multi-sheet XLSX with Greek content, numbers and a date string', async () => {
    const blob = await writeExcelFile([
      { sheet: 'Πωλήσεις', data: [['Κατηγορία', 'Ποσότητα'], ['Κινητή', 12], ['Τζίρος', 1234.56]] },
      { sheet: 'Στόχοι', data: [['Μήνας', 'Στόχος'], ['2026-11', 20]] },
    ]).toBlob()
    const workbook = await readWorkbook(new File([blob], 'test.xlsx'))
    expect(workbook.sheetNames).toEqual(['Πωλήσεις', 'Στόχοι'])
    expect(workbook.read('Πωλήσεις')).toEqual({
      name: 'Πωλήσεις', headers: ['Κατηγορία', 'Ποσότητα'],
      rows: [['Κινητή', '12'], ['Τζίρος', '1234.56']],
    })
  })

  it('preserves quoted CSV separators, quotes, line breaks, and leading-zero product codes', async () => {
    const csv = '\uFEFFΚωδικός;Περιγραφή\r\n00123;"Όνομα; με διαχωριστικό"\r\n00456;"Δύο ""εισαγωγικά""\nκαι αλλαγή γραμμής"'
    const workbook = await readWorkbook(new File([csv], 'test.csv'))
    expect(workbook.read('CSV').rows).toEqual([
      ['00123', 'Όνομα; με διαχωριστικό'], ['00456', 'Δύο "εισαγωγικά"\nκαι αλλαγή γραμμής'],
    ])
  })

  it('rejects legacy files and oversize uploads before parsing', async () => {
    await expect(readWorkbook(new File(['bad'], 'test.xls'))).rejects.toThrow('μόνο')
    const file = new File(['not parsed'], 'large.xlsx')
    Object.defineProperty(file, 'size', { value: MAX_SPREADSHEET_BYTES + 1 })
    await expect(readWorkbook(file)).rejects.toThrow('10 MB')
  })
})
