import { Area, City } from '@/types'

function fmt(n: number): string {
  return n.toLocaleString()
}

export function generateCSV(areas: Area[], city: City): string {
  const headers = [
    '市区町村名',
    '地域',
    '人口（最新）',
    '人口増減数（前回比）',
    '人口増減率（%）',
  ]

  const rows = areas.map((area) => [
    area.name,
    city.name,
    fmt(area.transaction_count),
    area.avg_price_level >= 0
      ? `+${fmt(Math.round(area.avg_price_level))}`
      : fmt(Math.round(area.avg_price_level)),
    area.population_delta >= 0
      ? `+${area.population_delta.toFixed(2)}`
      : area.population_delta.toFixed(2),
  ])

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  return '﻿' + csvContent
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
