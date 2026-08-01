'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Logo } from '@/components/Logo'

// ① Header（sticky）
//   スクロール時に bg-white/85 + backdrop-blur へ切り替える。
//   アンカー: 機能 / 料金 / FAQ / お問い合わせ
const NAV = [
  { href: '#features', label: '機能' },
  { href: '#pricing', label: '料金' },
  { href: '#faq', label: 'FAQ' },
  { href: '#contact', label: 'お問い合わせ' },
]

export function Header() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`sticky top-0 z-50 transition-colors duration-300 ${
        scrolled ? 'bg-white/85 backdrop-blur-md border-b border-slate-200' : 'bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="#top" className="flex items-center gap-2">
          <Logo size="md" />
        </Link>

        <nav className="hidden md:flex items-center gap-6">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="hidden sm:inline text-sm text-slate-500 hover:text-slate-900 transition-colors px-2 py-1"
          >
            ログイン
          </Link>
          <a
            href="#contact"
            className="text-sm bg-brand-700 hover:bg-brand-500 text-white font-medium rounded-lg px-3 sm:px-4 py-2 transition-colors"
          >
            無料でデモを見る
          </a>
        </div>
      </div>
    </header>
  )
}
