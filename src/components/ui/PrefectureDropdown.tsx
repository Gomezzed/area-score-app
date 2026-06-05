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
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 min-w-[10rem] px-3 py-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg text-sm font-medium text-white transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected.name}</span>
        <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 top-full mt-1 w-full min-w-[10rem] max-h-72 overflow-y-auto bg-slate-800 border border-slate-600 rounded-lg shadow-2xl z-[1200] py-1"
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
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    active ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'
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
