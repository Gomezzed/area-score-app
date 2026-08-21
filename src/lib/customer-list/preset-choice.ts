// 保存済み column_mapping から「前回のプリセット選択」を復元するための純関数（PR-F preset 復元）。
//   UI の CSV 形式セレクタ（CustomersClient の PresetChoice）と 1:1 対応する値を返す。
//   ⛔ 認可・突合ロジックには一切関与しない。表示初期値の復元だけを担う。

// CSV 形式セレクタの選択値。'' = 未選択 / 'hausudo' = ハウスドゥ形式 / 'other' = その他（自動判定）。
export type PresetChoice = '' | 'hausudo' | 'other'

// customer_lists.column_mapping（jsonb）から前回のプリセット選択を導出する。
//   保存形式は [id]/import の buildColumnMappingV2 が書く v:2 nested 形:
//     { v:2, columns:{...}, resolve_route, preset_id? }
//   - v:2 かつ preset_id==='hausudo'         → 'hausudo'（?preset=hausudo で取り込んだ）
//   - v:2 かつ preset_id 無し（キーごと省略） → 'other'（?preset= を付けず自動判定で取り込んだ）
//   - v:2 でない（レガシー flat 形 or 未取込で column_mapping=null）→ ''（プリセット概念が無い＝再選択）
//   - v:2 だが未知の preset_id                → ''（未知 preset を UI に復元しない）
export function presetChoiceFromMapping(mapping: unknown): PresetChoice {
  if (!mapping || typeof mapping !== 'object') return ''
  const m = mapping as Record<string, unknown>
  // v:2 以外（レガシー flat 形）はプリセット選択の概念が無いため復元しない。
  if (m.v !== 2) return ''
  if (m.preset_id === 'hausudo') return 'hausudo'
  // v:2 で preset_id が無い＝?preset= を付けずに取り込んだ＝「その他（自動判定）」。
  if (m.preset_id == null || m.preset_id === '') return 'other'
  // 既知でない preset_id は未選択に落とす（未知 preset を静かに復元しない）。
  return ''
}
