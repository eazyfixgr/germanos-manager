import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

export function useScanner(onResult: (text: string) => void) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')

  const stop = useCallback(async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) await scannerRef.current.stop()
        scannerRef.current.clear()
      } catch { /* ignore */ }
    }
    setScanning(false)
  }, [])

  const start = useCallback(
    async (elementId: string) => {
      setError('')
      const scanner = new Html5Qrcode(elementId)
      scannerRef.current = scanner
      try {
        setScanning(true)
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 150 },
          },
          (decoded) => {
            onResult(decoded)
          },
          () => { /* no-op */ },
        )
      } catch {
        setError('Δεν ήταν δυνατή η πρόσβαση στην κάμερα.')
        setScanning(false)
      }
    },
    [onResult],
  )

  useEffect(() => () => { stop() }, [stop])

  return { start, stop, scanning, error }
}

export function scanInvoiceFile(
  file: File,
  onResult: (text: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let el = document.getElementById('scan-file-hidden')
    if (!el) {
      el = document.createElement('div')
      el.id = 'scan-file-hidden'
      el.style.display = 'none'
      document.body.appendChild(el)
    }
    const scanner = new Html5Qrcode('scan-file-hidden')
    scanner
      .scanFile(file, true)
      .then((decoded) => {
        onResult(decoded)
        scanner.clear()
        resolve()
      })
      .catch((e) => {
        scanner.clear()
        reject(e)
      })
  })
}
