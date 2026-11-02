export interface SheetData {
  name: string
  headers: string[]
  rows: string[][]
}

export interface WorkbookReader {
  sheetNames: string[]
  read: (name: string) => SheetData
}

async function loadXlsx(): Promise<any> {
  const mod: any = await import('xlsx')
  return mod.default ?? mod
}

export async function readWorkbook(file: File): Promise<WorkbookReader> {
  const XLSX = await loadXlsx()
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', raw: false, cellDates: false })
  const sheetNames: string[] = wb.SheetNames

  function read(name: string): SheetData {
    const ws = wb.Sheets[name]
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1, defval: '', raw: false, blankrows: false,
    }) as unknown[][]

    // Εντοπισμός γραμμής κεφαλίδων: πρώτη γραμμή με >=2 μη κενά κελιά
    let headerIdx = 0
    for (let i = 0; i < aoa.length; i++) {
      const filled = (aoa[i] ?? []).filter((c) => String(c ?? '').trim() !== '').length
      if (filled >= 2) { headerIdx = i; break }
    }
    const headerRow = aoa[headerIdx] ?? []
    const headers = headerRow.map((h, i) => {
      const t = String(h ?? '').trim()
      return t || `Στήλη ${i + 1}`
    })

    const rows = aoa.slice(headerIdx + 1)
      .map((r) => headers.map((_, i) => String(r?.[i] ?? '').trim()))
      .filter((r) => r.some((c) => c !== ''))

    return { name, headers, rows }
  }

  return { sheetNames, read }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export interface XlsxSheet {
  name: string
  headers: (string | number)[]
  rows: (string | number | null)[][]
}

export async function downloadXlsx(filename: string, sheets: XlsxSheet[]) {
  const XLSX = await loadXlsx()
  const wb = XLSX.utils.book_new()
  sheets.forEach((s, idx) => {
    const aoa = [s.headers, ...s.rows]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const safe = (s.name || `Sheet${idx + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, safe)
  })
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  triggerDownload(blob, filename)
}
