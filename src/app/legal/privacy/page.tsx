import type { Metadata } from 'next'
import { LegalShell, LegalHeading, LegalParagraph } from '@/components/legal/LegalShell'

export const metadata: Metadata = {
  title: 'プライバシーポリシー ｜ AreaScore',
  description: 'エリアスコアのプライバシーポリシー',
}

const ol = 'list-decimal pl-5 space-y-1.5 text-[15px] text-slate-700 leading-relaxed mt-2'
const ul = 'list-disc pl-5 space-y-1.5 text-[15px] text-slate-700 leading-relaxed mt-2'

const tableWrap = 'overflow-hidden rounded-xl border border-slate-200 mt-3'
const table = 'w-full border-collapse text-[15px]'
const th = 'bg-slate-50 text-left font-semibold text-slate-700 px-3 sm:px-4 py-2.5 border-b border-slate-200'
const td = 'text-slate-700 px-3 sm:px-4 py-2.5 border-b border-slate-200 leading-relaxed break-words align-top'

export default function PrivacyPage() {
  return (
    <LegalShell title="プライバシーポリシー" established="制定：2026年6月11日／最終改定：2026年8月23日">
      <LegalParagraph>
        Crouching Style（以下「当方」といいます）は、当方が提供する「エリアスコア」（以下「本サービス」といいます）における個人情報の取扱いについて、以下のとおりプライバシーポリシーを定めます。
      </LegalParagraph>

      <section>
        <LegalHeading>第1条（事業者情報）</LegalHeading>
        <ul className={ul}>
          <li>事業者名：Crouching Style</li>
          <li>運営責任者：ご本人からの求めに応じて遅滞なく開示します</li>
          <li>個人情報保護管理者：運営責任者が兼務します</li>
          <li>お問い合わせ窓口：info@crouchingstyle.com（または本サービスのお問い合わせフォーム）</li>
        </ul>
      </section>

      <section>
        <LegalHeading>第2条（本ポリシーの適用範囲と、2種類の個人情報）</LegalHeading>
        <LegalParagraph>
          当方は、本サービスで取り扱う個人情報を、次の2つの立場に分けて管理します。
        </LegalParagraph>
        <p className="text-[15px] text-slate-700 leading-relaxed mt-3 font-semibold">
          (A) 当方が自ら取得する情報 ── 当方が個人情報取扱事業者（管理者）となるもの
        </p>
        <LegalParagraph>
          利用者（利用企業の担当者）ご本人に関する情報です。当方が利用目的を定めて取り扱います。
        </LegalParagraph>
        <p className="text-[15px] text-slate-700 leading-relaxed mt-3 font-semibold">
          (B) 利用企業がアップロードする顧客名簿 ── 当方が委託先となるもの
        </p>
        <LegalParagraph>
          利用企業が自社の顧客について保有する個人データを、当方のシステム上でお預かりして処理します。利用目的を定めるのは利用企業であり、当方は利用企業の指示の範囲でのみ取り扱います。詳細な取扱条件は、利用企業との間で締結する「個人データの取扱いに関する覚書」（以下「本覚書」といいます）に定めます。
        </LegalParagraph>
        <LegalParagraph>
          なお、(B) の個人データについて、顧客ご本人に対する説明責任は利用企業に帰属します。利用企業は、特に第7条（外国にある第三者への提供）を必ずご確認ください。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第3条（取得する情報）</LegalHeading>
        <p className="text-[15px] text-slate-700 leading-relaxed font-semibold">
          (A) 当方が自ら取得する情報
        </p>
        <ol className={ol}>
          <li>アカウント情報：メールアドレス、パスワード（ハッシュ化して保存し、当方は平文を保持しません）、所属組織。Google アカウント連携を利用する場合は Google が提供する基本プロフィール情報</li>
          <li>決済情報：契約プラン、課金状態、請求履歴。クレジットカード番号は決済代行会社（Stripe, Inc.）が直接取得・保管し、当方のサーバーを経由せず、当方は保持しません。銀行振込の場合は振込元名義および入金記録</li>
          <li>お問い合わせ情報：会社名、担当者名、メールアドレス、電話番号、お問い合わせ内容</li>
          <li>利用状況に関する情報：アクセスログ、IPアドレス、Cookie、利用端末・ブラウザに関する情報、操作履歴、エラー情報</li>
        </ol>
        <p className="text-[15px] text-slate-700 leading-relaxed mt-4 font-semibold">
          (B) 利用企業がアップロードする顧客名簿
        </p>
        <LegalParagraph>
          利用企業が CSV 等で取り込む情報のうち、当方のシステムが保存するのは次の項目に限られます。
        </LegalParagraph>
        <ul className={ul}>
          <li>顧客管理番号（利用企業側の ID）</li>
          <li>氏名</li>
          <li>住所（および当方が正規化した住所・町域・学校区の判定結果）</li>
          <li>反響日・更新日</li>
          <li>反響媒体、顧客種別（売主・買主）、担当者名</li>
          <li>希望条件（希望校区、希望市区町村）</li>
          <li>配信可否等のフラグ（メール配信不可 等）</li>
        </ul>
        <LegalParagraph>
          次の項目は、CSV に含まれていても取り込み時に破棄し、保存しません：フリガナ、電話番号、メールアドレス、生年月日、同居人情報、勤務先、年収。分析に不要な機微情報は、そもそもシステムに保存しない設計としています。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第4条（利用目的）</LegalHeading>
        <p className="text-[15px] text-slate-700 leading-relaxed font-semibold">
          (A) について
        </p>
        <ol className={ol}>
          <li>本サービスの提供、本人確認、認証</li>
          <li>利用料金の請求および決済</li>
          <li>障害対応、不正利用の検知および防止</li>
          <li>本サービスの改善、新機能の開発、利用状況の分析</li>
          <li>お問い合わせへの対応、重要なお知らせ（規約変更・メンテナンス等）の通知</li>
        </ol>
        <p className="text-[15px] text-slate-700 leading-relaxed mt-4 font-semibold">
          (B) について
        </p>
        <LegalParagraph>
          利用企業が本サービス上で行うエリア分析および顧客リスト管理の目的に限ります。当方が自らの目的（第三者への提供、独自の統計作成、機械学習その他のモデル改善のための利用等）で利用することはありません。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第5条（第三者への提供）</LegalHeading>
        <LegalParagraph>
          当方は、次の場合を除き、あらかじめご本人の同意を得ることなく個人データを第三者に提供しません。
        </LegalParagraph>
        <ol className={ol}>
          <li>法令に基づく場合</li>
          <li>人の生命、身体または財産の保護のために必要がある場合であって、本人の同意を得ることが困難であるとき</li>
          <li>公衆衛生の向上または児童の健全な育成の推進のために特に必要がある場合であって、本人の同意を得ることが困難であるとき</li>
          <li>国の機関もしくは地方公共団体またはその委託を受けた者が法令の定める事務を遂行することに対して協力する必要がある場合であって、本人の同意を得ることにより当該事務の遂行に支障を及ぼすおそれがあるとき</li>
        </ol>
        <LegalParagraph>
          (B) の顧客名簿を、当該利用企業以外の利用企業が閲覧できる状態にすることはありません。同一の利用企業内では、組織単位でデータが共有されます（同じ組織に所属する利用者は相互に閲覧できます。取込・削除等の操作は作成者に限られます）。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第6条（業務委託先）</LegalHeading>
        <LegalParagraph>
          当方は、利用目的の達成に必要な範囲で、以下の事業者に業務を委託し、法令上必要な監督を行います。委託先を追加・変更した場合は、本条の表を更新します。
        </LegalParagraph>
        <div className={tableWrap}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>委託先</th>
                <th className={th}>委託する業務</th>
                <th className={th}>所在国・地域</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={td}>Supabase Inc.</td>
                <td className={td}>データベース、認証基盤</td>
                <td className={td}>シンガポール</td>
              </tr>
              <tr>
                <td className={td}>Vercel Inc.</td>
                <td className={td}>アプリケーションの実行環境、配信</td>
                <td className={td}>米国</td>
              </tr>
              <tr>
                <td className={td}>Stripe, Inc.</td>
                <td className={td}>決済処理（クレジットカード決済分）</td>
                <td className={td}>米国</td>
              </tr>
              <tr>
                <td className={td}>Resend</td>
                <td className={td}>メール送信（認証・通知メール。送信処理は東京リージョン）</td>
                <td className={td}>米国</td>
              </tr>
              <tr>
                <td className={td}>Sentry</td>
                <td className={td}>障害検知、エラーログの収集（個人情報を送信しない設定を適用）</td>
                <td className={td}>米国</td>
              </tr>
              <tr>
                <td className={td}>Google LLC</td>
                <td className={td}>Google アカウント認証（利用者が選択した場合）</td>
                <td className={td}>米国</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <LegalHeading>第7条（外国にある第三者への提供）</LegalHeading>
        <LegalParagraph>
          当方は、本サービスのデータベースをシンガポール共和国（Supabase）に設置しています。これは第2条 (A) (B) の両方が対象です。
        </LegalParagraph>
        <LegalParagraph>
          シンガポールには個人情報保護法（Personal Data Protection Act 2012）が存在し、監督機関として個人情報保護委員会（PDPC）が設置されています。ただし、日本の個人情報保護法において十分性認定の対象となっているのは EU および英国であり、シンガポールはこれに含まれません。
        </LegalParagraph>
        <LegalParagraph>
          当方は、個人情報の保護に関する法律第28条に基づき、相当措置の継続的な実施を確保するために必要な措置を講じます。具体的には次のとおりです。
        </LegalParagraph>
        <ol className={ol}>
          <li>委託先が日本の法令と同等の水準で個人データを取り扱う体制にあることを年1回以上確認し、記録を残します</li>
          <li>ご本人から求めがあったときは、移転先の国名、当該国の個人情報保護制度、講じている措置について遅滞なく情報提供します</li>
          <li>相当措置の実施に支障が生じた場合は必要な対応を行い、対応が困難なときは当該提供を停止します</li>
        </ol>
        <LegalParagraph>
          利用企業の皆さまへ：(B) の顧客名簿も本条の対象です。貴社の社内規程等で顧客データの国内保存が求められている場合は、ご利用開始前に必ず当方へお申し出ください（本覚書の締結時の確認事項に含みます）。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第8条（保有期間および削除）</LegalHeading>
        <div className={tableWrap}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>対象</th>
                <th className={th}>保有期間</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={td}>アカウント情報</td>
                <td className={td}>契約期間中および解約後6ヶ月</td>
              </tr>
              <tr>
                <td className={td}>決済・請求記録</td>
                <td className={td}>法令の定める期間</td>
              </tr>
              <tr>
                <td className={td}>(B) 顧客名簿</td>
                <td className={td}>利用企業による削除操作、または利用契約の終了から30日以内に削除し、削除の完了を通知します</td>
              </tr>
              <tr>
                <td className={td}>利用ログ</td>
                <td className={td}>取得から12ヶ月</td>
              </tr>
            </tbody>
          </table>
        </div>
        <LegalParagraph>
          利用企業は、本サービスの管理画面からいつでも顧客名簿を削除できます。再取込時に前回名簿から欠落した顧客の行は非表示化のうえ、30日経過後に削除します。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第9条（安全管理措置）</LegalHeading>
        <ol className={ol}>
          <li>アクセス制御：利用者の権限に応じてデータベース層でアクセスを制限しています。権限のないデータは、画面上で隠すのではなく、そもそもサーバーから送信されません</li>
          <li>通信の暗号化：すべての通信を TLS で暗号化しています</li>
          <li>認証情報の保護：パスワードはハッシュ化して保存し、当方は平文を保持しません</li>
          <li>統計表示における匿名化：反響件数等の統計表示にあたっては、町域・学校区それぞれの集計単位ごとに独立して判定し、同一単位・12ヶ月間で5件未満のデータは、件数そのものを含めて表示しません。個々の顧客を特定できる粒度（丁目単位・地図上のピン留め等）での表示は行いません</li>
          <li>データ最小化：分析に不要な項目は取込時に破棄し（第3条 (B)）、画面・API の応答にも必要最小限の情報のみを含めます</li>
          <li>委託先の監督：第6条の委託先に対し、契約により安全管理措置を求めています</li>
        </ol>
      </section>

      <section>
        <LegalHeading>第10条（Cookie 等の利用）</LegalHeading>
        <LegalParagraph>
          本サービスは、ログイン状態の維持に必要な Cookie を使用します。広告目的の Cookie や、外部のアクセス解析ツールは使用していません。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第11条（開示・訂正・利用停止等のご請求）</LegalHeading>
        <LegalParagraph>
          <span className="font-semibold">(A) について</span>：第1条の窓口までご連絡ください。ご本人であることを確認のうえ、法令に従って対応します。
        </LegalParagraph>
        <LegalParagraph>
          <span className="font-semibold">(B) について</span>：当方は委託先であるため、直接のご対応ができません。データを保有する利用企業（お客様がお取引された不動産会社等）へお問い合わせください。当方は、利用企業からの求めに応じて速やかに協力します。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第12条（統計データ・外部データの取扱い）</LegalHeading>
        <LegalParagraph>
          本サービスは、政府統計（e-Stat）、国土交通省国土数値情報、国土交通省不動産情報ライブラリ等の公的データを利用しています。学校区データについては、出典・基準年度を画面上に表示するとともに、通学区域は変更される場合があるため、最新の情報は各自治体にご確認いただく必要がある旨を明示しています。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第13条（本ポリシーの改定）</LegalHeading>
        <LegalParagraph>
          本ポリシーの内容は、法令の改正またはサービス内容の変更に応じて改定することがあります。重要な変更を行う場合は、本サービス上でお知らせします。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第14条（制定・改定履歴）</LegalHeading>
        <ul className={ul}>
          <li>2026年6月11日 制定</li>
          <li>2026年8月5日 改定</li>
          <li>2026年8月23日 改定（顧客名簿の取扱い、業務委託先と外国における取扱い、保有期間、安全管理措置の具体化ほか全面改訂）</li>
        </ul>
      </section>
    </LegalShell>
  )
}
