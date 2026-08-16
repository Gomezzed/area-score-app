'use client'

import {
  SCHOOL_TYPES,
  SCHOOL_TYPE_LABELS,
  SCHOOL_DISTRICT_UNAVAILABLE,
  type SchoolType,
} from '@/lib/school-districts'

// M2-0 / SD-27: 学区図トグル（既定OFF）＋ 小/中切替（既定＝小学校区）。
//   境界線の「表示制御 UI」のみ。濃淡・凡例・モード切替・ランキングは STEP4 の管轄で持たない。
//   未公開（選択中の市区町村に公開校区が無い）ときはトグルを disabled にし理由を表示する。

interface Props {
  // トグル
  overlayOn: boolean
  onToggle: (on: boolean) => void
  // 選択中の市区町村で公開されている校種（無ければトグル disabled）
  availableTypes: SchoolType[]
  // 市区町村が未選択（学区は市区町村選択が前提）
  noMuniSelected: boolean
  // 校種切替
  schoolType: SchoolType
  onChangeType: (t: SchoolType) => void
  // 未公開文言を出すか（市全体が未公開 / 選択校種が未公開）
  showUnavailable: boolean
  // 取得中
  loading: boolean
}

export function SchoolDistrictControl({
  overlayOn,
  onToggle,
  availableTypes,
  noMuniSelected,
  schoolType,
  onChangeType,
  showUnavailable,
  loading,
}: Props) {
  // 市未選択、または選択市に公開校区が1つも無い → トグル不可。
  const toggleDisabled = noMuniSelected || availableTypes.length === 0

  return (
    <div className="absolute top-20 left-3 z-[1000] w-56 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
      {/* トグル行 */}
      <label
        className={`flex items-center justify-between gap-2 ${
          toggleDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
        }`}
      >
        <span className="text-xs font-semibold text-slate-700">学区図</span>
        <input
          type="checkbox"
          className="h-4 w-4 accent-blue-600"
          checked={overlayOn && !toggleDisabled}
          disabled={toggleDisabled}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label="学区図を表示"
        />
      </label>

      {/* 小/中切替（ON かつ利用可能なときだけ表示） */}
      {overlayOn && !toggleDisabled && (
        <div className="mt-2 flex gap-1" role="radiogroup" aria-label="校種切替">
          {SCHOOL_TYPES.map((t) => {
            const enabled = availableTypes.includes(t)
            const active = schoolType === t
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!enabled}
                onClick={() => enabled && onChangeType(t)}
                className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                  active
                    ? 'bg-blue-600 text-white'
                    : enabled
                      ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      : 'cursor-not-allowed bg-slate-50 text-slate-300'
                }`}
              >
                {SCHOOL_TYPE_LABELS[t]}
              </button>
            )
          })}
        </div>
      )}

      {/* 取得中 */}
      {overlayOn && !toggleDisabled && loading && (
        <p className="mt-2 text-xs text-slate-400">読み込み中…</p>
      )}

      {/* 未公開文言（一言一句固定・SD-27） */}
      {showUnavailable && (
        <p className="mt-2 text-xs leading-snug text-slate-500">{SCHOOL_DISTRICT_UNAVAILABLE}</p>
      )}
    </div>
  )
}
