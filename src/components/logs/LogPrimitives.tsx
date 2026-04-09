import { useState, useRef, useEffect } from 'react'
import { Search } from 'lucide-react'
import { colorizeJson } from '@/utils/logFormat'

export const CLS_LOG_PRE =
  'm-0 px-3 py-[0.6rem] bg-primary border border-default rounded-lg text-sm leading-[1.55] text-primary font-mono whitespace-pre-wrap break-words overflow-x-auto overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm'

const CLS_SEARCH =
  'pl-[1.5rem] pr-7 py-[0.2rem] text-xs border border-default rounded bg-primary text-primary placeholder:text-muted focus:outline-none focus:border-accent transition-[border-color] w-[160px]'

function SearchInput({
  value,
  onChange,
  placeholder,
  count,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  count: number | null
}) {
  return (
    <div className="relative flex items-center">
      <Search size={12} className="absolute left-2 text-muted pointer-events-none" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={CLS_SEARCH}
      />
      {count !== null && (
        <span className="absolute right-2 text-[10px] text-muted tabular-nums pointer-events-none">
          {count}
        </span>
      )}
    </div>
  )
}

/** Plain-text log lines with search/filter and optional auto-scroll to bottom on load. */
export function SearchableLogLines({
  lines,
  maxHeight = '360px',
  autoScroll = false,
}: {
  lines: string[]
  maxHeight?: string
  autoScroll?: boolean
}) {
  const [search, setSearch] = useState('')
  const preRef = useRef<HTMLPreElement>(null)

  const filtered = search.trim()
    ? lines.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
    : lines

  const count = search.trim() ? filtered.length : null
  const text =
    filtered.length > 0
      ? filtered.join('\n')
      : search.trim()
        ? `No lines match "${search}".`
        : 'No log entries.'

  useEffect(() => {
    if (!autoScroll || !preRef.current || search) return
    preRef.current.scrollTop = preRef.current.scrollHeight
  }, [lines, autoScroll, search])

  return (
    <div className="flex flex-col gap-[0.35rem]">
      {lines.length > 0 && (
        <div className="flex justify-end">
          <SearchInput value={search} onChange={setSearch} placeholder="Filter lines…" count={count} />
        </div>
      )}
      <pre ref={preRef} className={CLS_LOG_PRE} style={{ maxHeight }}>
        {text}
      </pre>
    </div>
  )
}

/** JSON pre with syntax highlighting and search/filter. */
export function ColoredJsonPre({
  json,
  maxHeight = '300px',
}: {
  json: string
  maxHeight?: string
}) {
  const [search, setSearch] = useState('')

  const lines = json.split('\n')
  const filtered = search.trim()
    ? lines.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
    : lines
  const count = search.trim() ? filtered.length : null
  const displayJson = filtered.join('\n')

  return (
    <div className="flex flex-col gap-[0.35rem]">
      <div className="flex justify-end">
        <SearchInput value={search} onChange={setSearch} placeholder="Search fields…" count={count} />
      </div>
      {search.trim() && filtered.length === 0 ? (
        <p className="text-sm text-muted m-0">No fields match "{search}".</p>
      ) : (
        <pre
          className={CLS_LOG_PRE}
          style={{ maxHeight }}
          // colorizeJson escapes all HTML before adding spans — safe to use here
          dangerouslySetInnerHTML={{ __html: colorizeJson(displayJson) }}
        />
      )}
    </div>
  )
}
