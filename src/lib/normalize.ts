/** Αναγνώριση σφαλμάτων Excel (#REF!, #DIV/0!, #N/A, #VALUE!, ...) */
export function isExcelError(v: unknown): boolean {
  const s = String(v ?? '').trim()
  if (!s.startsWith('#')) return false
  return /^#(REF|DIV\/0|N\/A|VALUE|NAME|NUM|NULL|SPILL|CALC|GETTING_DATA|FIELD)[!?]?$/i.test(s) || s.length <= 12
}

/** Μετατροπή σε αριθμό με υποστήριξη ελληνικών δεκαδικών/χιλιάδων και νομίσματος. */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v ?? '').trim()
  if (!s || isExcelError(s)) return null

  let negative = false
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1) }

  s = s.replace(/[€\s\u00A0]/g, '')
  s = s.replace(/[^0-9.,\-]/g, '')
  if (s === '' || s === '-' || s === '.' || s === ',') return null

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    s = s.replace(/,/g, '.')
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, '')
  } else if (/^\d{1,3}\.\d{3}$/.test(s)) {
    // Ελληνική μορφή χιλιάδων, π.χ. 1.234 -> 1234
    s = s.replace('.', '')
  }

  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

function pad(n: number) { return String(n).padStart(2, '0') }

/** Ευέλικτη ανάγνωση ημερομηνίας (ISO, DD/MM/YYYY, Excel serial). */
export function parseDateFlexible(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  }
  const s = String(v ?? '').trim()
  if (!s || isExcelError(s)) return null

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)

  // Excel serial
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    if (n > 20000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000)
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    }
    return null
  }

  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (m) {
    let a = Number(m[1])
    let b = Number(m[2])
    let y = Number(m[3])
    if (y < 100) y += 2000
    let day: number
    let month: number
    if (a > 12) { day = a; month = b }
    else if (b > 12) { month = a; day = b }
    else { day = a; month = b } // ελληνική σειρά: ημέρα/μήνας
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${y}-${pad(month)}-${pad(day)}`
  }

  return null
}

/** Κανονικοποίηση κειμένου για αντιστοίχιση (πεζά, χωρίς τόνους/κενά άκρα). */
export function normText(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
}

export function normEmail(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}
