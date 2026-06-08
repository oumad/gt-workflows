/** Loading + error placeholders shared by every analytics tab. */
export function Loading() {
  return <div style={{ color: 'var(--ink-3)', padding: 32, textAlign: 'center' }}>Loading…</div>
}

export function ErrorView({ msg }: { msg: string }) {
  return <div style={{ color: 'var(--bad)', padding: 32, textAlign: 'center' }}>{msg}</div>
}
