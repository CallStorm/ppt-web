import type { MascotMood } from '../../lib/jobStageCopy'
import { cn } from '../../lib/cn'

type Props = {
  mood: Exclude<MascotMood, 'hidden'>
}

export function MascotCharacter({ mood }: Props) {
  const showSlide = mood === 'working'
  const showGear = mood === 'working'
  const celebrate = mood === 'celebrate'
  const error = mood === 'error'

  return (
    <div
      className={cn(
        'mascot-character relative flex h-28 w-28 items-center justify-center',
        mood === 'idle' && 'mascot-mood-idle',
        mood === 'working' && 'mascot-mood-working',
        mood === 'celebrate' && 'mascot-mood-celebrate',
        mood === 'error' && 'mascot-mood-error',
      )}
      aria-hidden
    >
      {celebrate && (
        <>
          <span className="mascot-sparkle mascot-sparkle-1" />
          <span className="mascot-sparkle mascot-sparkle-2" />
          <span className="mascot-sparkle mascot-sparkle-3" />
        </>
      )}

      <svg viewBox="0 0 112 112" className="h-full w-full drop-shadow-md" fill="none">
        {/* Antenna */}
        <line
          x1="56"
          y1="18"
          x2="56"
          y2="32"
          stroke="var(--ds-primary)"
          strokeWidth="3"
          strokeLinecap="round"
          className={cn(error && 'mascot-antenna-droopy')}
        />
        <circle
          cx="56"
          cy="14"
          r="5"
          className="mascot-antenna-led"
          fill="var(--ds-accent)"
        />

        {/* Left arm */}
        <g className={cn(celebrate && 'mascot-arm-up-left')}>
          <path
            d="M 28 58 Q 18 62 16 72"
            stroke="var(--ds-primary)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle cx="15" cy="74" r="6" fill="var(--ds-primary-muted)" stroke="var(--ds-primary)" strokeWidth="2" />
        </g>

        {/* Right arm + slide */}
        <g className={cn(celebrate && 'mascot-arm-up-right', showSlide && 'mascot-arm-slide')}>
          <path
            d="M 84 58 Q 94 62 96 72"
            stroke="var(--ds-primary)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle cx="97" cy="74" r="6" fill="var(--ds-primary-muted)" stroke="var(--ds-primary)" strokeWidth="2" />
          {showSlide && (
            <g className="mascot-slide">
              <rect x="88" y="64" width="18" height="14" rx="2" fill="var(--ds-surface-elevated)" stroke="var(--ds-primary)" strokeWidth="1.5" />
              <line x1="91" y1="69" x2="103" y2="69" stroke="var(--ds-accent)" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="91" y1="73" x2="99" y2="73" stroke="var(--ds-muted-fg)" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
            </g>
          )}
        </g>

        {/* Body */}
        <rect x="30" y="32" width="52" height="56" rx="14" fill="var(--ds-primary-muted)" stroke="var(--ds-primary)" strokeWidth="2.5" />

        {/* Screen face */}
        <rect x="38" y="40" width="36" height="30" rx="6" fill="var(--ds-surface-elevated)" stroke="var(--ds-primary)" strokeWidth="1.5" />

        {/* Eyes */}
        {error ? (
          <>
            <line x1="44" y1="50" x2="50" y2="56" stroke="var(--ds-danger)" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="50" y1="50" x2="44" y2="56" stroke="var(--ds-danger)" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="62" y1="50" x2="68" y2="56" stroke="var(--ds-danger)" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="68" y1="50" x2="62" y2="56" stroke="var(--ds-danger)" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M 46 62 Q 56 58 66 62" stroke="var(--ds-danger)" strokeWidth="2" strokeLinecap="round" fill="none" />
          </>
        ) : celebrate ? (
          <>
            <path d="M 44 52 Q 47 48 50 52" stroke="var(--ds-primary)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            <path d="M 62 52 Q 65 48 68 52" stroke="var(--ds-primary)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            <path d="M 46 60 Q 56 68 66 60" stroke="var(--ds-primary)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          </>
        ) : (
          <>
            <ellipse cx="47" cy="52" rx="4" ry="5" fill="var(--ds-primary)" className="mascot-eye-left" />
            <ellipse cx="65" cy="52" rx="4" ry="5" fill="var(--ds-primary)" className="mascot-eye-right" />
            <ellipse cx="48" cy="51" rx="1.5" ry="2" fill="var(--ds-surface-elevated)" />
            <ellipse cx="66" cy="51" rx="1.5" ry="2" fill="var(--ds-surface-elevated)" />
            {mood === 'working' && (
              <rect x="50" y="60" width="12" height="3" rx="1.5" fill="var(--ds-primary)" className="mascot-mouth-working" />
            )}
            {mood === 'idle' && (
              <line x1="50" y1="62" x2="62" y2="62" stroke="var(--ds-primary)" strokeWidth="2" strokeLinecap="round" />
            )}
          </>
        )}

        {/* Chest gear */}
        {showGear && (
          <g className="mascot-gear">
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 56 78"
              to="360 56 78"
              dur="2s"
              repeatCount="indefinite"
            />
            <circle cx="56" cy="78" r="7" fill="var(--ds-accent-muted)" stroke="var(--ds-accent)" strokeWidth="1.5" />
            <circle cx="56" cy="78" r="3" fill="var(--ds-accent)" />
            {[0, 60, 120, 180, 240, 300].map((deg) => (
              <rect
                key={deg}
                x="54.5"
                y="69"
                width="3"
                height="4"
                rx="0.5"
                fill="var(--ds-accent)"
                transform={`rotate(${deg} 56 78)`}
              />
            ))}
          </g>
        )}

        {/* Feet */}
        <rect x="38" y="86" width="14" height="6" rx="3" fill="var(--ds-primary)" />
        <rect x="60" y="86" width="14" height="6" rx="3" fill="var(--ds-primary)" />
      </svg>
    </div>
  )
}
