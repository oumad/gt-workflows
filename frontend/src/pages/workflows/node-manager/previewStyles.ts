import type React from 'react'

export const DARK = {
  bg: '#1a1814',
  surface: '#23211c',
  surface2: '#2c2924',
  line: '#3a3630',
  ink: '#e8e4dc',
  ink2: '#a8a294',
  ink3: '#6f6a5e',
  accent: '#d4a373',
}

export const inputBase: React.CSSProperties = {
  width: '100%',
  background: DARK.surface,
  border: `1px solid ${DARK.line}`,
  color: DARK.ink,
  borderRadius: 8,
  padding: '7px 10px',
  font: '13px var(--font-ui)',
  outline: 'none',
}
