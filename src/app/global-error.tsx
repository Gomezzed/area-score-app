"use client";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="ja">
      <body>
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h2>エラーが発生しました</h2>
          <p>問題が続く場合はお問い合わせください。</p>
        </div>
      </body>
    </html>
  );
}
