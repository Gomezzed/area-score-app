import { MunicipalityWithStats, Prefecture } from '@/types'

export function generateMunicipalityCSV(
  municipalities: MunicipalityWithStats[],
  prefecture: Prefecture,
): string {
  const headers = [
    '都道府県',
    '市区町村',
    '市区町村コード',
    '人口(2025年・速報)',
    '人口(2020年)',
    '人口(2015年)',
    '世帯数(2025年・速報)',
    '人口増減数(2020→2025)',
    '人口増減率(%)(2020→2025)',
    '駅乗降客数合計(最新)',
  ]

  const rows = municipalities.map((m) => [
    prefecture.name,
    m.name,
    m.city_code ?? '',
    m.popLatest ?? '',
    m.popPrev ?? '',
    m.popPrev2 ?? '',
    m.householdsLatest ?? '',
    m.delta ?? '',
    m.deltaRate ?? '',
    m.stationPassengersTotal || '',
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
