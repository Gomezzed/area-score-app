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
