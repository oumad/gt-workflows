import { useState } from 'react'
import { Clock, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import { useIncidentTimeline } from '@/contexts/IncidentTimelineContext'

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const ACTION_LABELS: Record<string, string> = {
  'queue.interrupt': 'Interrupted job',
  'queue.delete': 'Removed queue job',
  'vram.free': 'Freed VRAM',
  'server.restart': 'Restarted server',
}

export default function IncidentTimeline() {
  const { events, clearEvents } = useIncidentTimeline()
  const [open, setOpen] = useState(false)

  if (events.length === 0 && !open) return null

  return (
    <div className="fixed bottom-5 left-5 z-[150] flex flex-col items-start" style={{ maxWidth: 340 }}>
      {open && (
        <div className="mb-1 w-full bg-secondary border border-default rounded-xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: 320 }}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-default shrink-0">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted flex-1">Session Activity</span>
            <button
              type="button"
              onClick={clearEvents}
              className="flex items-center gap-1 text-xs text-muted hover:text-semantic-error transition-colors bg-transparent border-none cursor-pointer p-0"
              title="Clear timeline"
            >
              <Trash2 size={11} /> Clear
            </button>
          </div>
          <div className="overflow-y-auto flex-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-[#354556]">
            {events.length === 0 ? (
              <p className="text-xs text-muted px-3 py-3">No actions yet this session.</p>
            ) : (
              [...events].reverse().map((e) => (
                <div key={e.id} className="flex items-start gap-2 px-3 py-[0.4rem] border-b border-default/40 last:border-b-0">
                  <span className="text-[10px] tabular-nums text-muted/60 shrink-0 mt-[1px] w-[52px]">{formatTs(e.ts)}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-primary">{ACTION_LABELS[e.action] ?? e.action}</span>
                    {e.detail && (
                      <p className="text-[10px] text-muted truncate mt-[1px]" title={e.detail}>{e.detail}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-default text-xs text-muted hover:text-primary transition-colors shadow-lg cursor-pointer"
      >
        <Clock size={12} />
        <span>Timeline</span>
        {events.length > 0 && (
          <span className="ml-0.5 px-1.5 py-0 rounded-full bg-accent/20 text-accent-light text-[10px] font-semibold tabular-nums">
            {events.length}
          </span>
        )}
        {open ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
      </button>
    </div>
  )
}
