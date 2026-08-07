import type { ExportCell } from '@/lib/export-columns'

// ============================================================
// Google Sheets 出力ヘルパー（drive.file スコープ・アプリ作成ファイルのみ）。
//   ① スプレッドシート新規作成 → ② 値書込（RAW・数値は数値のまま）
//   → ③ 先頭行の太字＋行固定を batchUpdate で 1 回。
//   通信はすべて fetch。サーバー専用。
// ============================================================

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'

// 出力先シート（タブ）名。範囲指定と batchUpdate の対象を固定するため明示。
const SHEET_TITLE = 'エリアスコア'
const SHEET_ID = 0

async function ensureOk(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    let detail = ''
    try {
      detail = await res.text()
    } catch {
      // ignore
    }
    throw new Error(`${context} に失敗しました (${res.status}): ${detail.slice(0, 300)}`)
  }
}

// 新規スプレッドシートを作成し、ヘッダー＋データを書き込み、URL を返す。
export async function createAreaScoreSpreadsheet(
  accessToken: string,
  spreadsheetTitle: string,
  headers: string[],
  rows: ExportCell[][],
): Promise<string> {
  const authHeader = { Authorization: `Bearer ${accessToken}` }

  // ① 作成（シートタブ名・sheetId を固定）。
  const createRes = await fetch(SHEETS_API, {
    method: 'POST',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: spreadsheetTitle },
      sheets: [
        {
          properties: {
            sheetId: SHEET_ID,
            title: SHEET_TITLE,
          },
        },
      ],
    }),
  })
  await ensureOk(createRes, 'スプレッドシートの作成')
  const created = (await createRes.json()) as {
    spreadsheetId?: string
    spreadsheetUrl?: string
  }
  if (!created.spreadsheetId || !created.spreadsheetUrl) {
    throw new Error('スプレッドシートの作成応答が不正です')
  }

  // ② 値書込（valueInputOption=RAW。number はそのまま数値セルになる）。
  const range = `'${SHEET_TITLE}'!A1`
  const values: ExportCell[][] = [headers, ...rows]
  const valuesRes = await fetch(
    `${SHEETS_API}/${created.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    },
  )
  await ensureOk(valuesRes, '値の書き込み')

  // ③ 先頭行 太字 ＋ 行固定（batchUpdate 1 回）。
  const batchRes = await fetch(
    `${SHEETS_API}/${created.spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: SHEET_ID,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: { textFormat: { bold: true } },
              },
              fields: 'userEnteredFormat.textFormat.bold',
            },
          },
          {
            updateSheetProperties: {
              properties: {
                sheetId: SHEET_ID,
                gridProperties: { frozenRowCount: 1 },
              },
              fields: 'gridProperties.frozenRowCount',
            },
          },
        ],
      }),
    },
  )
  await ensureOk(batchRes, '書式設定')

  return created.spreadsheetUrl
}
