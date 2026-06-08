import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

export function ErrorAlert({ children }: Props) {
  return (
    <div className="login-err" role="alert">
      {children}
    </div>
  )
}
