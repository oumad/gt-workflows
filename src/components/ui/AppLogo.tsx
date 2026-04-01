import logoSrc from '@/assets/logo.png'

interface AppLogoProps {
  size?: number
  className?: string
}

export function AppLogo({ size = 32, className }: AppLogoProps) {
  return (
    <img
      src={logoSrc}
      alt="GT Coffee Maker"
      className={className}
      aria-hidden="true"
      style={{ height: `${size}px`, width: 'auto', maxHeight: `${size}px` }}
    />
  )
}
