import Image from 'next/image'

type LogoSize = 'sm' | 'md' | 'lg'
type LogoVariant = 'color' | 'white'

/** マークの一辺(px)とワードマークの字面サイズ(px) */
const SIZE_MAP: Record<LogoSize, { mark: number; wordmark: number }> = {
  sm: { mark: 24, wordmark: 16 },
  md: { mark: 30, wordmark: 20 },
  lg: { mark: 42, wordmark: 28 },
}

type LogoProps = {
  size?: LogoSize
  variant?: LogoVariant
  showWordmark?: boolean
  className?: string
}

export function Logo({
  size = 'md',
  variant = 'color',
  showWordmark = true,
  className = '',
}: LogoProps) {
  const { mark, wordmark } = SIZE_MAP[size]
  const isWhite = variant === 'white'

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Image
        src={isWhite ? '/brand/areascore-mark-white.png' : '/brand/areascore-mark.png'}
        alt="AreaScore"
        width={mark}
        height={mark}
        priority
        style={{ width: mark, height: mark }}
      />
      {showWordmark && (
        <span
          aria-hidden="true"
          className={isWhite ? 'text-white' : 'text-brand-700'}
          style={{
            fontSize: wordmark,
            fontWeight: 500,
            letterSpacing: '0.01em',
            lineHeight: 1,
          }}
        >
          AreaScore
        </span>
      )}
    </span>
  )
}
