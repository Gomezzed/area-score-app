import { Area, City } from '@/types'

function fmtPop(n: number): string {
  return n.toLocaleString()
}

export function generateCSV(areas: Area[], city: City): string {
  const headers = ['市区町村名', '地域', '人口（最新）', '人口増減数（前回比）', '人口増減率（%）']

  const rows = areas.map((a) => [
    a.name,
    city.name,
    fmtPop(a.transaction_count),
    a.avg_price_level >= 0
      ? `+${fmtPop(Math.round(a.avg_price_level))}`
      : fmtPop(Math.round(a.avg_price_level)),
    a.population_delta >= 0
      ? `+${a.population_delta.toFixed(2)}`
      : a.population_delta.toFixed(2),
  ])

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  return '﻿' + csv   // BOM for Excel
}

export function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href     = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
