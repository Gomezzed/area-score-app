// 顧客名簿の削除導線（O86）の純ロジック。React/DB 非依存でユニットテスト可能にする。
//   表示可否判定・確認ダイアログの文言組み立て・削除エラーの日本語化をここに集約する。
//   ⚠ ここは表示層の補助であって認可ではない。削除の認可は
//      DELETE /api/customer-lists/[id] の guardFeature('townAcquisitionPriority') と
//      RLS(cl_delete_own) が別に担保する（原則12）。⛔ その判定には触れない。

// 削除ボタンを出してよいか（D108 の表示上のヒント）。作成者本人のときだけ true。
//   ⚠ is_owner=false でも API/RLS が実際の削除を拒否する。これは見た目の出し分けにすぎない。
export function canDeleteList(isOwner: boolean): boolean {
  return isOwner === true
}

// 確認ダイアログに出す名簿の要約（リスト名・件数ラベル）。
//   row_count=0（未取込）は件数を「未取込（0件）」と明示し、数値だけの誤解を避ける。
//   ⚠ 取り消せない旨の警告文は静的なので呼び出し側(JSX)で持つ（ここでは組み立てない）。
export function describeListForDelete(input: {
  name: string
  rowCount: number
}): { name: string; rowsLabel: string } {
  const name = input.name.trim() || '（無題のリスト）'
  const rowsLabel =
    input.rowCount > 0 ? `${input.rowCount.toLocaleString()}件` : '未取込（0件）'
  return { name, rowsLabel }
}

// 削除 API のエラーを日本語へ（D49 エンベロープの code / HTTP ステータスから）。
//   DELETE /api/customer-lists/[id] は { error: 'not_found' | 'delete_failed' } を返す。
//   guardFeature 拒否は 403、未ログインは 401。⛔ サーバーが返さない情報は補完しない。
export function mapDeleteError(code: unknown, status: number): string {
  switch (code) {
    case 'not_found':
      return '対象が見つかりませんでした。すでに削除されたか、権限がない可能性があります。'
    case 'delete_failed':
      return 'リストの削除に失敗しました。時間をおいて再度お試しください。'
    default:
      if (status === 403) return 'この機能は Platinum プラン限定です。'
      if (status === 401) return 'ログインが必要です。'
      if (status === 404)
        return '対象が見つかりませんでした。すでに削除された可能性があります。'
      return 'リストの削除に失敗しました。時間をおいて再度お試しください。'
  }
}
