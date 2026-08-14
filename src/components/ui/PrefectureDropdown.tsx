'use client'

import { useEffect, useRef, useState } from 'react'
import { Prefecture } from '@/types'
import { ChevronDown, Check } from 'lucide-react'

interface Props {
  prefectures: Prefecture[]          // 選択中リージョンの都道府県のみ
  selectedCode: string
  onSelect: (code: string) => void
}

export function PrefectureDropdown({ prefectures, selectedCode, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = prefectures.find((p) => p.code === selectedCode) ?? prefectures[0]

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  if (!selected) return null

  return (
    <div ref={ref} className="relative w-full sm:w-auto">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 w-full sm:w-auto sm:min-w-[10rem] px-3 min-h-[44px] sm:min-h-0 py-2 sm:py-1.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-sm font-medium text-slate-900 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected.name}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 top-full mt-1 w-full min-w-[10rem] max-h-72 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-lg z-[1200] py-1"
        >
          {prefectures.map((p) => {
            const active = p.code === selected.code
            return (
              <li key={p.code} role="option" aria-selected={active}>
                <button
                  onClick={() => {
                    onSelect(p.code)
                    setOpen(false)
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 min-h-[44px] sm:min-h-0 py-2 text-left text-sm transition-colors ${
                    active ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>{p.name}</span>
                  {active && <Check className="w-4 h-4" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
