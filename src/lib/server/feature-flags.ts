// サーバー専用の機能マスターフラグ。
//   クライアント用の NEXT_PUBLIC_FEATURE_* はビルド時にバンドルへインライン展開される
//   ため、サーバー側の封鎖には使えない。二層フラグ（原則13）として、UI 表示制御は
//   NEXT_PUBLIC_FEATURE_SHEETS_EXPORT が担い、サーバー側の存在封鎖は本フラグが担う。
//   模範は customer-list/server.ts の isCustomerListEnabled()（各ルート冒頭で検査）。

// Google Sheets 出力機能のサーバー側マスターフラグ。
//   ⚠ 既定は「有効」。PO が Vercel に FEATURE_SHEETS_EXPORT を追加する前に本コードが
//   マージされても本番の Sheets 出力が即死しないよう、未設定時は有効とし、明示的に
//   'false' のときだけ無効化する（isCustomerListEnabled の === 'true' とは意図的に逆の作法）。
//   OFF は「この機能はこの環境に存在しない」を意味するため、ルート側は 403 ではなく
//   404 'not_found' を返し、機能の存在自体を外部に晒さない。
export function isSheetsExportEnabled(): boolean {
  return process.env.FEATURE_SHEETS_EXPORT !== 'false'
}
