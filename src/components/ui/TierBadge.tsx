import { Tier } from '@/types'

const TIER_STYLES: Record<Tier, string> = {
  A: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700',
  B: 'bg-amber-900/60 text-amber-300 border border-amber-700',
  C: 'bg-red-900/60 text-red-300 border border-red-700',
}

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${TIER_STYLES[tier]}`}>
      Tier {tier}
    </span>
  )
}
