'use client'

// =====================================================================
// PR-BM-7: 売主向けシート PDF の orchestrator（ブラウザ・クリック時に動的 import）。
//   display.ts（表示ゲート）→ model.ts（タイトル・条件行・ファイル名）→
//   document.tsx（A4横2枚）→ heatmap-pdf/download.ts（Blob→ダウンロード）。
//   ⛔ heatmap-pdf は1行も変更せず、downloadPdf / formatGeneratedAt を再利用する。
//   ⛔ 画面と同じ display.ts を通す（抑止の判定を2箇所に書かない）。
//   失敗時は Sentry.withScope でタグ feature=buyer-match-pdf を付けて captureException
//   （heatmap-pdf/index.ts と同じ作法・グローバル setTag 禁止）。
// =====================================================================

import * as Sentry from '@sentry/nextjs'
import { downloadPdf } from '@/lib/heatmap-pdf/download'
import { formatGeneratedAt, type LegendRow } from '@/lib/heatmap-pdf/model'
import { buildCellsDisplay, buildCountDisplays } from '@/lib/buyer-match/display'
import type {
  BuyerMatchCards,
  BuyerMatchCell,
  BuyerMatchSummary,
  SellerCondition,
} from '@/lib/buyer-match/types'
import { SellerSheetDocument } from './document'
import {
  buildBuyerCardsPageModel,
  buildConditionLines,
  buildSellerSheetFileName,
  buildSellerSheetTitle,
} from './model'

export interface SellerSheetMapInput {
  pngDataUrl: string
  attributions: string[]
  tilesFailed: boolean
}

export interface ExportSellerSheetInput {
  // 売主が入力した物件条件（⛔ 顧客側の情報は入らない）。
  condition: SellerCondition
  // k 抑止済みの2つの数（⛔ unknown_area_count は型に無い）。
  summary: BuyerMatchSummary
  // 内訳セル（k=5 未満のセルは RPC が行ごと返さない）。
  cells: BuyerMatchCell[]
  // 学区図パネル。未取得なら null（PDF からパネルごと落とす）。
  map: SellerSheetMapInput | null
  legend: LegendRow[]
  // 学区図の免責（SCHOOL_DISTRICT_DISCLAIMER）。学区図が無いときは null。
  mapDisclaimer: string | null
  // 差し替え可能なロゴ（裁定32）。省略＝自社マーク。
  //   ⚠ 顧客ロゴ経路（P1-5）が確定したら logoSrc を渡すだけで差し替わる。
  //     置き場は public/brand/partners/ の見込み。本 PR の呼び出し側は undefined を渡す。
  logoSrc?: string
  // PR-BM-9b-3: 2枚目を匿名カード面に差し替えるデータ源（裁定88/89）。
  //   BuyerMatchPanel が「買い手を見る」判定のため既に取得済みの cards レスポンスを渡す
  //   （⛔ PDF 生成時に追加 fetch はしない）。null／未指定なら従来のセル集計2枚目のまま。
  //   ⚠ 画面（専用画面）と PDF は cards を別々に取得するため、同条件でも 6人が異なり得る（裁定89）。
  cards?: BuyerMatchCards | null
  // property_type code → label_ja（バッジ・見出しの種別解決／Panel の typeList 由来）。
  labelByCode?: Record<string, string>
  // muni_code_5 → muni_name（段4 見出しの市区町村名解決／Panel の areaList 由来）。
  muniNameByCode?: Record<string, string>
  now?: Date
}

// PDF を生成してダウンロードし、ファイル名を返す。
export async function exportSellerSheetPdf(input: ExportSellerSheetInput): Promise<string> {
  const now = input.now ?? new Date()
  try {
    // 抑止・セル選抜の判定は画面とまったく同じ関数を通す。
    const counts = buildCountDisplays(input.summary)
    const cellsView = buildCellsDisplay(input.cells)

    // 2枚目の出し分け（裁定88）。cards が無ければ undefined＝従来のセル集計2枚目のまま。
    //   3分岐（cards/suppressed/legacy）の判定は model.ts が display.ts で済ませる。
    const cardsPage = input.cards
      ? buildBuyerCardsPageModel(
          input.cards,
          input.labelByCode ?? {},
          input.muniNameByCode ?? {},
        )
      : undefined

    const element = SellerSheetDocument({
      title: buildSellerSheetTitle(input.condition),
      conditionLines: buildConditionLines(input.condition),
      generatedAtLabel: formatGeneratedAt(now),
      counts,
      cells: cellsView.cells,
      cellsEmptyMessage: cellsView.emptyMessage,
      overflowLabel: cellsView.overflowLabel,
      mapPngDataUrl: input.map?.pngDataUrl ?? null,
      mapTilesFailed: input.map?.tilesFailed ?? false,
      legend: input.legend,
      attributions: input.map?.attributions ?? [],
      mapDisclaimer: input.map ? input.mapDisclaimer : null,
      logoSrc: input.logoSrc,
      cardsPage,
    })

    const fileName = buildSellerSheetFileName(
      input.condition.muniCode5,
      input.condition.propertyType,
      now,
    )
    await downloadPdf(element, fileName)
    return fileName
  } catch (error) {
    Sentry.withScope((scope) => {
      scope.setTag('feature', 'buyer-match-pdf')
      Sentry.captureException(error)
    })
    throw error
  }
}
