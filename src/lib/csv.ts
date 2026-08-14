import { MunicipalityWithStats, Prefecture } from '@/types'
import {
  MUNICIPALITY_EXPORT_HEADERS,
  municipalityExportRows,
} from '@/lib/export-columns'

export function generateMunicipalityCSV(
  municipalities: MunicipalityWithStats[],
  prefecture: Prefecture,
): string {
  // 列見出し・各セルの値は export-columns.ts を唯一の出所とする（Sheets 出力と共有）。
  // 生値の式は従来と 1:1 のため、CSV 出力バイト列は不変。
  const headers = MUNICIPALITY_EXPORT_HEADERS
  const rows = municipalityExportRows(municipalities, {
    prefectureName: prefecture.name,
  })

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  return '﻿' + csvContent // BOM for Excel Japanese support
}

export function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
