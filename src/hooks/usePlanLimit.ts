'use client'

// エリア閲覧のゲート（Free 閲覧ルール v3）はサーバー側 get_municipalities_gated RPC ＋
//   census テーブルのプラン別 RLS で確定する（H1 封鎖済み）。本フックは残る UI ゲート
//   （CSV=standard+ / PDF=starter+ / ヒートマップ / 駅・相場のマスターフラグ AND 判定）を担う。

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

// 相場・公示価格機能のマスターフラグ（既定 false・T8）。挙動は駅単位と同じ AND 設計。
const MARKET_METRICS_FEATURE_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_MARKET_METRICS === 'true'

export interface PlanLimit extends PlanEntitlements {
  plan: PlanId
  // 駅単位の実利用可否 = 権限(stationLevelEntitled) AND マスターフラグ
  stationLevelEnabled: boolean
  // 相場・公示価格の実利用可否 = 権限(marketMetricsEntitled) AND マスターフラグ
  marketMetricsEnabled: boolean
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
      marketMetricsEnabled: ent.marketMetricsEntitled && MARKET_METRICS_FEATURE_ENABLED,
    }
  }, [plan])
}
