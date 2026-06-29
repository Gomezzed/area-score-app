'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MapPin } from 'lucide-react'

const NAV = [
  { href: '#features', label: '機能' },
  { href: '#pricing', label: '料金' },
  { href: '#faq', label: 'FAQ' },
  { href: '#contact', label: 'お問い合わせ' },
]

export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-slate-900/80 backdrop-blur-md border-b border-white/10 shadow-lg shadow-black/20'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg text-white">エリアスコア</span>
        </Link>

        <nav className="hidden md:flex items-center gap-6">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-sm text-slate-300 hover:text-white transition-colors"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="hidden sm:inline text-sm text-slate-300 hover:text-white transition-colors px-2 py-1"
          >
            ログイン
          </Link>
          <Link
            href="/register"
            className="text-sm bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg px-3 sm:px-4 py-2 transition-colors"
          >
            ログイン / 無料登録
          </Link>
        </div>
      </div>
    </header>
  )
}
