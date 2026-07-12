import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    />
  )
}

export function IconBot(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="8" width="14" height="11" rx="2" />
      <path d="M12 8V5" />
      <circle cx="12" cy="3.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
      <path d="M9 17h6" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
    </Icon>
  )
}

export function IconPalette(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8.5" cy="10" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="14" cy="14.5" r="1.25" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function IconLogOut(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </Icon>
  )
}
