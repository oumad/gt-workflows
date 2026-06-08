import { Upload } from 'lucide-react'

/**
 * Full-cover overlay shown while a file is dragged over a drop zone. Render it
 * conditionally from a `useFileDrop` flag: `{fileDragOver && <FileDropOverlay/>}`.
 * The host element must be `position: relative`.
 */
export function FileDropOverlay({
  label = 'Drop to import',
  hint = 'params.json · workflow.json · .zip',
  inset = 0,
  radius = 'inherit',
  zIndex = 20,
}: {
  label?: string
  hint?: string
  inset?: number
  radius?: number | string
  zIndex?: number
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset,
        zIndex,
        borderRadius: radius,
        background: 'color-mix(in oklab, var(--accent) 16%, var(--surface))',
        border: '2px dashed var(--accent)',
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <div className="col" style={{ alignItems: 'center', gap: 3 }}>
        <Upload size={22} style={{ color: 'var(--accent-ink)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent-ink)' }}>{label}</span>
        <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{hint}</span>
      </div>
    </div>
  )
}
