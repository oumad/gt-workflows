import logoSrc from '@/assets/logo.png'

interface AppLogoProps {
  size?: number
  className?: string
}

export function AppLogo({ size = 32, className }: AppLogoProps) {
  return (
    <img
      src={logoSrc}
      height={size}
      alt="GT Workflows Manager"
      className={className}
      aria-hidden="true"
      style={{ width: 'auto' }}
    />
  )
}
