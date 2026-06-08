import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'default' | 'primary' | 'accent' | 'ghost'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'icon'
  children: ReactNode
}

const variantClass: Record<Variant, string> = {
  default: 'btn',
  primary: 'btn btn-primary',
  accent: 'btn btn-accent',
  ghost: 'btn btn-ghost',
}

export function Button({ variant = 'default', size, className = '', children, ...rest }: Props) {
  const classes = [
    variantClass[variant],
    size === 'sm' ? 'btn-sm' : '',
    size === 'icon' ? 'btn-icon' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  )
}
