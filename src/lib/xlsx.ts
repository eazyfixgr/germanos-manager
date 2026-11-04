export interface SheetData {
  name: string
  headers: string[]
  rows: string[][]
}

export interface WorkbookReader {
  sheetNames: string[]
  read: (name: string) => SheetData
}

export interface XlsxSheet {
  name: string
  headers: (string | number)[]
  rows: (string | number | null)[][]
}

export const ACCEPTED_SPREADSHEET_EXTENSIONS = '.xlsx,.csv'

function pad(n: number) { return String(n).padStart(2, '0') }

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.error === 'string') return o.error
    if (typeof o.text === 'string') return o.text
    if (typeof o.value === 'string' || typeof o.value === 'number') return String(o.value)
  }
  return String(value)
}

function toSheetData(name: string, aoa: unknown[][]): SheetData {
  let headerIdx = 0
  for (let i = 0; i < aoa.length; i++) {
    const filled = (aoa[i] ?? []).filter((c) => cellToString(c) !== '').length
    if (filled >= 2) { headerIdx = i; break }
  }
  const headerRow = aoa[headerIdx] ?? []
  const headers = headerRow.map((h, i) => cellToString(h) || `Στήλη ${i + 1}`)
  const rows = aoa.slice(headerIdx + 1)
    .map((r) => headers.map((_, i) => cellToString(r?.[i])))
    .filter((r) => r.some((c) => c !== ''))
  return { name, headers, rows }
}

function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
  const firstLine = clean.split(/\r?\n/)[0] ?? ''
  const commaCount = (firstLine.match(/,/g) ?? []).length
  const semicolonCount = (firstLine.match(/;/g) ?? []).length
  const delimiter = semicolonCount > commaCount ? ';' : ','

  const rows: string[][] = []
  let row: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = false
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(current); current = ''
    } else if (ch === '\n') {
      row.push(current); rows.push(row); row = []; current = ''
    } else if (ch !== '\r') {
      current += ch
    }
  }
  row.push(current)
  if (row.some((c) => c !== '')) rows.push(row)
  return rows
}

export async function readWorkbook(file: File): Promise<WorkbookReader> {
  if (/\.csv$/i.test(file.name) || file.type.includes('csv')) {
    const text = await file.text()
    const data = toSheetData('CSV', parseCsv(text))
    return {
      sheetNames: ['CSV'],
      read: (name) => (name === 'CSV' ? data : { name, headers: [], rows: [] }),
    }
  }

  const mod: any = await import('read-excel-file/browser')
  const readXlsxFile = mod.default ?? mod
  const buffer = await file.arrayBuffer()
  const sheets: { sheet: string; data: unknown[][] }[] = await readXlsxFile(buffer)

  const map: Record<string, SheetData> = {}
  const names: string[] = []
  for (const s of sheets) {
    names.push(s.sheet)
    map[s.sheet] = toSheetData(s.sheet, s.data)
  }

  return {
    sheetNames: names,
    read: (name) => map[name] ?? { name, headers: [], rows: [] },
  }
}

export async function downloadXlsx(filename: string, sheets: XlsxSheet[]) {
  const mod: any = await import('write-excel-file/browser')
  const writeXlsxFile = mod.default ?? mod

  if (sheets.length === 1) {
    const data = [sheets[0].headers, ...sheets[0].rows]
    await writeXlsxFile(data, { sheet: sheets[0].name }).toFile(filename)
    return
  }

  const multi = sheets.map((s) => ({
    sheet: s.name,
    data: [s.headers, ...s.rows],
  }))
  await writeXlsxFile(multi).toFile(filename)
}
