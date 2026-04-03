import { Cpu, Zap } from 'lucide-react'
import type { LocalHealth } from './types'

export function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function VramBar({ vramTotal, vramFree }: { vramTotal: number; vramFree: number }) {
  const used = vramTotal - vramFree
  const pct = Math.round((used / vramTotal) * 100)
  const color = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#10b981'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-muted">
        <span>VRAM</span>
        <span className="tabular-nums" style={{ color }}>
          {formatBytes(used)} / {formatBytes(vramTotal)} ({pct}%)
        </span>
      </div>
      <div className="h-2 rounded-full bg-[rgba(45,58,74,0.6)] overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  )
}

interface ServerHealthStripProps {
  health: LocalHealth | null
}

export default function ServerHealthStrip({ health }: ServerHealthStripProps) {
  const sys = health?.systemInfo
  if (!sys) return null

  return (
    <div className="px-5 py-4 border-b border-default flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
        {sys.gpuName && (
          <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
            <Cpu size={13} className="text-muted shrink-0" />
            <span className="text-sm text-primary truncate" title={sys.gpuName}>{sys.gpuName}</span>
          </div>
        )}
        {sys.comfyVersion && (
          <div className="text-sm text-muted">
            ComfyUI <span className="text-primary">{sys.comfyVersion}</span>
          </div>
        )}
        {health?.latencyMs != null && (
          <div className="flex items-center gap-1 text-sm text-muted">
            <Zap size={12} className="shrink-0" />
            <span
              className="tabular-nums"
              style={{
                color: health.latencyMs < 100 ? 'var(--success)' : health.latencyMs < 500 ? 'var(--warning, #f59e0b)' : 'var(--error)',
              }}
            >
              {health.latencyMs}ms
            </span>
          </div>
        )}
      </div>
      {sys.vramTotal && sys.vramFree != null && (
        <VramBar vramTotal={sys.vramTotal} vramFree={sys.vramFree} />
      )}
    </div>
  )
}
