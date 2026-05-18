import { Area, City } from '@/types'

export function generateSalesforceCSV(areas: Area[], city: City): string {
  const headers = [
    'エリア名',
    '都市',
    'Tier',
    'スコア',
    '取引件数',
    '人口増減率(%)',
    '平均価格水準(万円/㎡)',
    'Salesforce_Lead_Source',
    'Salesforce_Description',
  ]

  const rows = areas.map((area) => [
    area.name,
    city.name,
    area.tier,
    area.score.toFixed(2),
    area.transaction_count,
    area.population_delta.toFixed(1),
    area.avg_price_level.toFixed(1),
    'Area Score Dashboard',
    `Tier ${area.tier} エリア - スコア ${area.score.toFixed(1)}`,
  ])

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
