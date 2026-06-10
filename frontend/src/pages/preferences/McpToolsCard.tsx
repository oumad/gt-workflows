import { useEffect, useState, useMemo } from 'react'
import { ChevronRight, ChevronDown, BookOpen, AlertCircle, Eye, Pencil, Skull } from 'lucide-react'
import { api } from '../../lib/api'

/* ─── Wire shape (mirrors api/src/mcp/tools/index.ts:ToolCatalogEntry) ─── */
type ToolEntry = {
  name: string
  section: string
  title: string
  description: string
  readOnly: boolean
  destructive: boolean
  idempotent: boolean
}

type Catalog = {
  total: number
  sections: { name: string; count: number }[]
  tools: ToolEntry[]
  knownSections: string[]
}

/* ─── Component ───────────────────────────────────────────────── */
export function McpToolsCard() {
  const [data, setData] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openSections, setOpenSections] = useState<Set<string>>(new Set())
  const [openTools, setOpenTools] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    api
      .get<Catalog>('/api/mcp-catalog')
      .then((c) => {
        setData(c)
        // Open the first section by default so the card isn't a wall of
        // collapsed headers — gives users an immediate "this is what's in
        // here" preview without forcing them to click.
        if (c.sections.length > 0) setOpenSections(new Set([c.sections[0].name]))
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load tool catalog'))
      .finally(() => setLoading(false))
  }, [])

  const toolsBySection = useMemo(() => {
    const m = new Map<string, ToolEntry[]>()
    if (!data) return m
    for (const t of data.tools) {
      const arr = m.get(t.section) ?? []
      arr.push(t)
      m.set(t.section, arr)
    }
    return m
  }, [data])

  function toggleSection(name: string) {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function toggleTool(name: string) {
    setOpenTools((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="card card-pad col" style={{ gap: 12 }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <BookOpen size={14} style={{ color: 'var(--accent)' }} />
        <div className="card-title">MCP tools</div>
        <span className="chip" style={{ fontSize: 10, fontWeight: 600 }}>
          {data?.total ?? '—'}
        </span>
        <span className="spacer" />
        {data && (
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {data.sections.length} sections
          </span>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
        Every tool the MCP server exposes to AI clients. Use a personal token (above) to connect
        Claude Desktop / Claude Code; once connected the model can call any of these tools to
        inspect or edit workflows on your behalf.
      </div>

      {error && (
        <div
          className="row"
          style={{
            gap: 8,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'var(--bad-soft)',
            color: 'var(--bad)',
            fontSize: 12,
          }}
        >
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Loading catalog…</div>
      ) : (
        <div className="col" style={{ gap: 4 }}>
          {data?.sections.map((s) => {
            const isOpen = openSections.has(s.name)
            const tools = toolsBySection.get(s.name) ?? []
            return (
              <div
                key={s.name}
                style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}
              >
                <button
                  type="button"
                  onClick={() => toggleSection(s.name)}
                  className="row"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'var(--surface-2)',
                    border: 0,
                    cursor: 'pointer',
                    textAlign: 'left',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <strong style={{ fontSize: 12.5 }}>{s.name}</strong>
                  <span className="chip" style={{ fontSize: 10 }}>
                    {s.count}
                  </span>
                </button>
                {isOpen && (
                  <div className="col" style={{ gap: 0 }}>
                    {tools.map((t) => (
                      <ToolRow
                        key={t.name}
                        tool={t}
                        open={openTools.has(t.name)}
                        onToggle={() => toggleTool(t.name)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─── Individual tool row ─────────────────────────────────────── */
function ToolRow({
  tool,
  open,
  onToggle,
}: {
  tool: ToolEntry
  open: boolean
  onToggle: () => void
}) {
  return (
    <div style={{ borderTop: '1px solid var(--line)' }}>
      <button
        type="button"
        onClick={onToggle}
        className="row"
        style={{
          width: '100%',
          padding: '7px 10px',
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          textAlign: 'left',
          gap: 8,
          alignItems: 'center',
        }}
      >
        {open ? (
          <ChevronDown size={11} style={{ color: 'var(--ink-3)' }} />
        ) : (
          <ChevronRight size={11} style={{ color: 'var(--ink-3)' }} />
        )}
        <code style={{ fontSize: 11.5, fontWeight: 600 }}>{tool.name}</code>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>· {tool.title}</span>
        <span className="spacer" />
        {tool.readOnly && (
          <span
            title="Read-only tool — no side effects"
            className="chip"
            style={{ fontSize: 9.5, color: 'var(--info)', gap: 3 }}
          >
            <Eye size={10} /> read
          </span>
        )}
        {!tool.readOnly && !tool.destructive && (
          <span
            title="Write tool — snapshots before disk write"
            className="chip"
            style={{ fontSize: 9.5, color: 'var(--accent)', gap: 3 }}
          >
            <Pencil size={10} /> write
          </span>
        )}
        {tool.destructive && (
          <span
            title="Destructive tool — requires explicit confirmation"
            className="chip"
            style={{ fontSize: 9.5, color: 'var(--bad)', gap: 3 }}
          >
            <Skull size={10} /> destructive
          </span>
        )}
      </button>
      {open && (
        <div
          style={{
            padding: '6px 12px 12px 30px',
            fontSize: 11.5,
            color: 'var(--ink-2)',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}
        >
          {tool.description || <em style={{ color: 'var(--ink-3)' }}>No description provided.</em>}
        </div>
      )}
    </div>
  )
}
