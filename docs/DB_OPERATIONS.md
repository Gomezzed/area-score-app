# DB Operations Policy

## Production Applies

本番 DB への DDL/DML 適用は Supabase コネクタの `apply_migration` / `execute_sql` 経由に限定する。

`supabase db push` および SQL エディタでの手動適用は、台帳の自動記録を欠落させるため恒久的に禁止する。

## Migration Ledger

`supabase_migrations.schema_migrations.version` は「適用時刻」流儀を採用する。

この値は Supabase コネクタ準拠の適用時刻であり、migration ファイル名 prefix とは一致しない仕様とする。

## H5 Ledger Repair

2026/7/4 に、手動適用済みだが台帳未記録だった migration 17 件を遡及記録した。

対象レコードは `created_by='H5-ledger-repair'` で識別できる。

証拠表は H5 の PR を参照する。

## Pending Applies（未適用・PO 適用待ち）

| version（ファイル prefix） | 内容 | 状態 |
|---|---|---|
| `20260706000000_add_user_integrations` | `public.user_integrations`（Google 連携 refresh_token 暗号保管・RLS 自分の行のみ） | **未適用**。feat/sheets-export の PR。本番適用は Supabase コネクタ `apply_migration` 経由で PO が実施する（SQL エディタ手動適用は禁止）。 |
