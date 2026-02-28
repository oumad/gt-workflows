import type { ReactElement } from 'react'
import { BrowserRouter as Router } from 'react-router-dom'
import { AuthProvider } from '@/features/auth'
import { AppRoutes } from './router'

export function AppProviders(): ReactElement {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  )
}
