// =====================================================================
// PDF Blob を生成して端末にダウンロードさせる（ブラウザ専用）。
//   pdf(element).toBlob() → ObjectURL → a.click → revoke（pdf.tsx の作法に倣う）。
// =====================================================================

import { pdf } from '@react-pdf/renderer'

// pdf() が受け取る Document 要素の型（DocumentProps を直接 import せず一致させる）。
type PdfDocumentElement = Parameters<typeof pdf>[0]

export async function downloadPdf(element: PdfDocumentElement, fileName: string): Promise<void> {
  const blob = await pdf(element).toBlob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // 一部ブラウザで click 直後の revoke がダウンロードを中断するため、少し遅らせる。
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
