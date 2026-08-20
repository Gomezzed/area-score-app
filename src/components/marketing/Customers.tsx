import Image from 'next/image'

/**
 * ご利用いただいている会社（導入企業ロゴ）
 *
 * 配置：Hero 内のトラスト行（e-Stat・国土交通省 公式データ使用 ／ 先行申込受付中）の直下、
 *       ダッシュボード画像の手前。ヒーローの一部として置くため背景色・区切り線は持たせない。
 *       上下の余白は呼び出し側の className で調整する（このファイルは触らない）。
 *
 * 掲載は先方の許諾を得たものに限る。掲載終了の連絡を受けたら
 * CUSTOMERS から該当行を削除するだけで本番から消える。
 *
 * ロゴ素材は public/brand/partners/ に置く。
 * width / height は素材の実寸（intrinsic size）。表示サイズは h-10 / sm:h-11 で制御している。
 *
 * 現在の素材は先方提供の JPEG（白背景・非透過）をそのまま使用している。
 * LP のヒーロー背景が純白 #FFFFFF のため見た目は透過版と同一だが、
 * このブロックに背景色を敷くと白い矩形が出る。
 * 先方から SVG / AI / EPS の原本を入手したら logo のパスと width/height を差し替えること。
 */
type Customer = {
  /** 正式名称。alt テキストにそのまま入る */
  name: string
  /** public/ からの絶対パス */
  logo: string
  /** 会社サイト。未設定ならリンクなしで表示する */
  href?: string
  /** 素材の実寸（px） */
  width: number
  height: number
}

const CUSTOMERS: Customer[] = [
  {
    name: '株式会社ハウスジャパン',
    logo: '/brand/partners/house-japan.jpg',
    href: 'https://www.house-japan.co.jp',
    width: 1235,
    height: 224,
  },
]

export default function Customers({ className = '' }: { className?: string }) {
  if (CUSTOMERS.length === 0) return null

  return (
    <div className={`text-center ${className}`}>
      <p className="text-xs font-medium tracking-[0.2em] text-slate-500">
        ご利用いただいている会社
      </p>

      <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
        {CUSTOMERS.map((customer) => (
          <li key={customer.name} className="flex items-center">
            <CustomerLogo customer={customer} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function CustomerLogo({ customer }: { customer: Customer }) {
  const logo = (
    <Image
      src={customer.logo}
      alt={customer.name}
      width={customer.width}
      height={customer.height}
      className="h-10 w-auto sm:h-11"
    />
  )

  if (!customer.href) return logo

  return (
    <a
      href={customer.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${customer.name}のウェブサイトを開く`}
      className="inline-flex rounded-md opacity-90 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none"
    >
      {logo}
    </a>
  )
}
