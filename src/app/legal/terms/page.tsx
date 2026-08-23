import type { Metadata } from 'next'
import { LegalShell, LegalHeading, LegalParagraph } from '@/components/legal/LegalShell'

export const metadata: Metadata = {
  title: '利用規約 ｜ AreaScore',
  description: 'エリアスコアの利用規約',
}

const ol = 'list-decimal pl-5 space-y-1.5 text-[15px] text-slate-700 leading-relaxed mt-2'

export default function TermsPage() {
  return (
    <LegalShell title="利用規約" established="制定：2026年6月11日／最終改定：2026年8月23日">
      <LegalParagraph>
        この利用規約(以下「本規約」といいます)は、Crouching Style（以下「当方」といいます）が提供する地域分析サービス「エリアスコア」（以下「本サービス」といいます）の利用条件を定めるものです。利用者は、本規約に同意のうえ本サービスを利用するものとします。
      </LegalParagraph>

      <section>
        <LegalHeading>第1条（適用）</LegalHeading>
        <LegalParagraph>
          本規約は、利用者と当方との間の本サービスの利用に関わる一切の関係に適用されます。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第2条（アカウント登録）</LegalHeading>
        <ol className={ol}>
          <li>本サービスの利用を希望する者は、本規約に同意のうえ、当方の定める方法によりアカウント登録を行うものとします。</li>
          <li>
            当方は、登録申請者に以下の事由があると判断した場合、登録を承認しないことがあります。
            <div className="mt-1">
              (1) 虚偽の事項を届け出た場合　(2) 過去に本規約に違反したことがある場合　(3) その他、当方が登録を適当でないと判断した場合
            </div>
          </li>
        </ol>
      </section>

      <section>
        <LegalHeading>第3条（アカウントの管理）</LegalHeading>
        <ol className={ol}>
          <li>利用者は、自己の責任において認証情報を適切に管理するものとします。</li>
          <li>利用者は、自己に発行されたアカウントの認証情報を、第三者に共有・譲渡・貸与してはなりません。</li>
        </ol>
      </section>

      <section>
        <LegalHeading>第4条（利用料金および支払方法）</LegalHeading>
        <ol className={ol}>
          <li>利用者は、本サービスの対価として、当方が別途定める利用料金（税抜表示・別途消費税）を、当方の指定する方法（クレジットカード決済または当方が別途認める方法（銀行振込等））により支払うものとします。</li>
          <li>利用料金は、契約期間の開始時に前払いで決済され、解約手続きが行われない限り自動的に更新・決済されます。</li>
          <li>銀行振込による場合の支払時期・支払方法および解約時の取扱いは、当方と利用者との間の個別の合意によります。</li>
        </ol>
      </section>

      <section>
        <LegalHeading>第5条（解約・返金）</LegalHeading>
        <ol className={ol}>
          <li>利用者は、カスタマーポータルを通じていつでも解約手続きを行うことができます。</li>
          <li>解約後も、当該請求期間の末日まで本サービスを利用できます。</li>
          <li>役務の性質上、支払済みの利用料金は、日割り計算による返金を含め、理由のいかんを問わず返金しません。</li>
        </ol>
      </section>

      <section>
        <LegalHeading>第6条（データの取扱いと免責）</LegalHeading>
        <ol className={ol}>
          <li>本サービスが提供するスコア・統計データ等は、政府統計（e-Stat）、国土交通省国土数値情報、国土交通省不動産情報ライブラリ等の公開データをもとに当方が加工・算出したものです。</li>
          <li>当方は、提供する情報の最新性、正確性、完全性を保証しません。本サービスの情報は意思決定の参考情報であり、その利用により生じた損害（営業判断・投資判断の結果を含みます）について、当方は責任を負いません。</li>
          <li>このサービスは、国土交通省不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません。</li>
        </ol>
      </section>

      <section>
        <LegalHeading>第7条（禁止事項）</LegalHeading>
        <LegalParagraph>
          利用者は、本サービスの利用にあたり、以下の行為をしてはなりません。
        </LegalParagraph>
        <ol className={ol}>
          <li>法令または公序良俗に違反する行為</li>
          <li>本サービスのデータを、契約プランで許可された範囲を超えて複製、再配布、転売、または第三者に提供する行為</li>
          <li>スクレイピング等の自動化された手段により本サービスのデータを大量取得する行為</li>
          <li>本サービスのサーバーまたはネットワークに過度な負荷をかける行為、リバースエンジニアリング行為</li>
          <li>当方または第三者の知的財産権、プライバシーその他の権利を侵害する行為</li>
          <li>その他、当方が不適切と判断する行為</li>
        </ol>
      </section>

      <section>
        <LegalHeading>第8条（サービスの変更・中断・終了）</LegalHeading>
        <ol className={ol}>
          <li>当方は、利用者に事前に通知することなく、本サービスの内容を変更し、または提供を中断・終了することができます。</li>
          <li>当方は、本サービスの変更・中断・終了により利用者に生じた損害について、責任を負いません。</li>
          <li>当方が試験的に提供する機能は、予告なく仕様変更・提供終了となる場合があります。</li>
        </ol>
      </section>

      <section>
        <LegalHeading>第9条（利用制限および登録抹消）</LegalHeading>
        <LegalParagraph>
          当方は、利用者が本規約に違反した場合、事前の通知なく、本サービスの利用を制限し、または登録を抹消することができます。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第10条（損害賠償の上限）</LegalHeading>
        <LegalParagraph>
          当方が利用者に対して損害賠償責任を負う場合であっても、その賠償額は、当該利用者が直近1か月間に当方に支払った利用料金の額を上限とします。ただし、当方に故意または重過失がある場合はこの限りではありません。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第11条（規約の変更）</LegalHeading>
        <LegalParagraph>
          当方は、必要と判断した場合、利用者への通知をもって本規約を変更できるものとします。変更後に本サービスを利用した場合、変更後の規約に同意したものとみなします。
        </LegalParagraph>
      </section>

      <section>
        <LegalHeading>第12条（顧客データのアップロードと取扱い）</LegalHeading>
        <ol className={ol}>
          <li>利用者は、当方所定の「個人データの取扱いに関する覚書」（以下「本覚書」といいます）を当方と締結した場合に限り、自己が保有する顧客に関するデータ（以下「顧客データ」といいます）を本サービスにアップロードできるものとします。</li>
          <li>当方は、顧客データに含まれる個人データを、個人情報の保護に関する法律上の委託を受けた者として、利用者の指示および本覚書・プライバシーポリシーの定める範囲でのみ取り扱い、自らの目的のために利用しません。</li>
          <li>利用者は、顧客データを適法に取得したこと、および本サービスへの提供（外国にある第三者への提供を含みます）について必要な対応を行っていることを保証し、顧客本人からの開示・訂正・利用停止等の請求には利用者が対応するものとします。</li>
          <li>顧客データは、利用者による削除操作または利用契約の終了から30日以内に、当方が削除します。</li>
        </ol>
      </section>

      <section>
        <LegalHeading>第13条（準拠法・裁判管轄）</LegalHeading>
        <LegalParagraph>
          本規約は日本法に準拠し、本サービスに関して紛争が生じた場合、大阪地方裁判所を第一審の専属的合意管轄裁判所とします。
        </LegalParagraph>
      </section>
    </LegalShell>
  )
}
