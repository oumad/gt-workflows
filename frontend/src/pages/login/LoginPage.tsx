import { LoginSide } from './LoginSide'
import { LoginForm } from './LoginForm'

export function LoginPage() {
  return (
    <div className="login-stage">
      <LoginSide />
      <main className="login-main">
        <LoginForm />
      </main>
    </div>
  )
}
