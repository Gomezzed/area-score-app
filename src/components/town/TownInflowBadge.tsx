/**
 * ============================================================================
 *  src/components/town/TownInflowBadge.tsx
 *  「若返りエリア」バッジ
 * ============================================================================
 */
import { Sparkles } from 'lucide-react'

interface Props {
  active:  boolean
  /** スコア値を併記表示する場合に渡す (0-100) */
  score?:  number | null
  compact?: boolean
}

export function TownInflowBadge({ active, score, compact = false }: Props) {
  if (!active) {
    return (
      <span className="inline-flex items-center text-[10px] text-slate-500 font-medium">
        —
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
      } bg-gradient-to-r from-pink-500/20 to-amber-500/20 text-pink-300 ring-1 ring-pink-500/40`}
      title="人口増 / 世帯増の差・20-49歳ファミリー世代の流入が閾値を超えたエリア"
    >
      <Sparkles className="w-3 h-3" aria-hidden />
      若返りエリア
      {score != null && !compact && (
        <span className="ml-1 text-pink-200/80 font-normal">
          ({score.toFixed(1)})
        </span>
      )}
    </span>
  )
}
