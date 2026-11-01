export type CsvValue = string | number | null | undefined

function esc(v: CsvValue): string {
  const s = v == null ? '' : String(v)
  return `"${s.replace(/"/g, '""')}"`
}

export function downloadCsv(filename: string, headers: string[], rows: CsvValue[][]) {
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))]
  const csv = '\uFEFF' + lines.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
