'use client'

// TODO(Phase2): エリアデータはRLSのみでサーバ側ゲート無し。
//   Free上位3件制限はフロントsliceのため全行がクライアントに渡る。
//   データ持ち逃げ抑制強化のため、将来 RPC/サーバ側フィルタの導入を検討。

import { useMemo } from 'react'
import {
  PLAN_ENTITLEMENTS,
  FREE_VISIBLE_AREA_LIMIT,
  type PlanId,
  type PlanEntitlements,
} from '@/lib/plans'

// 料金設計v2.1で Free が閲覧できるエリア数（上位N件）。plans.ts を単一の出所とする。
export { FREE_VISIBLE_AREA_LIMIT }

// 駅単位機能のマスターフラグ（既定 false）。
//   NEXT_PUBLIC_ なのでビルド時にクライアントへインライン展開される。
//   実利用可否は「Standard 等の権限(stationLevelEntitled)」AND「このフラグ」。
//   駅単位の実データ投入は 2026/7 予定のため、それまでは既定 false で封じる。
const STATION_LEVEL_FEATURE_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_STATION_LEVEL === 'true'

export interface PlanLimit extends PlanEntitlements {
  plan: PlanId
  // 駅単位の実利用可否 = 権限(stationLevelEntitled) AND マスターフラグ
  stationLevelEnabled: boolean
}

// 現在のプランから機能制限（エンタイトルメント）を導出するフック。
//   plan は呼び出し側（useSubscription 等）から渡す純粋な導出。
//   二重 fetch を避けるため、本フックは subscriptions を自前で読みに行かない。
export function usePlanLimit(plan: PlanId): PlanLimit {
  return useMemo(() => {
    const ent = PLAN_ENTITLEMENTS[plan] ?? PLAN_ENTITLEMENTS.free
    return {
      plan,
      ...ent,
      stationLevelEnabled: ent.stationLevelEntitled && STATION_LEVEL_FEATURE_ENABLED,
    }
  }, [plan])
}

// 上位N件のみ可視化し、残りをロック件数として返す純粋ヘルパー。
//   limit が null（無制限）または件数以下なら全件可視・lockedCount=0。
//
//   注意: これは「フロント slice」であり完全な保護ではない。areas には
//   既に全行がクライアントへ渡っているため、ロック分の実値（スコア等）も
//   メモリ上には存在する。表示側（MunicipalityList のロック行ブラー等）で
//   画面上は伏せるが、データ持ち逃げ自体は本ヘルパーでは防げない。
//   恒久対策は上部 TODO(Phase2) の RPC/サーバ側フィルタを参照。
export function applyAreaVisibilityLimit<T>(
  areas: T[],
  limit: number | null,
): { visible: T[]; lockedCount: number } {
  if (limit == null || areas.length <= limit) {
    return { visible: areas, lockedCount: 0 }
  }
  return { visible: areas.slice(0, limit), lockedCount: areas.length - limit }
}
