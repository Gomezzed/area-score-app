import type { ReactNode } from 'react'

/**
 * md 以上でのみ改行する。モバイルは自動折り返しに任せる。
 * 日本語は文字単位で折り返すため、意図した位置に改行を固定するために使う。
 */
export function Br() {
  return <br className="hidden md:inline" />
}

/**
 * 語中で分断させたくない語句を包む。
 * 例: 出典: 国土交通省 <NoBreak>不動産情報ライブラリ</NoBreak>
 */
export function NoBreak({ children }: { children: ReactNode }) {
  return <span className="inline-block">{children}</span>
}
