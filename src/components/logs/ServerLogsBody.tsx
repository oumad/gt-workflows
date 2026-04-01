import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Copy, Check, ArrowDownToLine } from 'lucide-react';
import {
  tryParseLogEntries,
  formatLogTimestamp,
  tryPrettifyJson,
  type LogEntry,
} from '@/utils/logFormat';
import './ServerLogsBody.css';

export type ServerLogsViewMode = 'formatted' | 'raw';

export interface ServerLogsBodyProps {
  content: string | null;
  contentType: 'text/plain' | 'text/html';
  loading: boolean;
  error: string | null;
  viewMode: ServerLogsViewMode;
}

type LogLevel = 'error' | 'warn' | 'info' | 'debug'

function parseLogLevel(msg: string | undefined): LogLevel | null {
  if (!msg) return null
  const prefix = msg.slice(0, 60).toUpperCase()
  if (/\b(ERROR|CRITICAL|FATAL)\b/.test(prefix)) return 'error'
  if (/\b(WARN(?:ING)?)\b/.test(prefix)) return 'warn'
  if (/\bINFO\b/.test(prefix)) return 'info'
  if (/\b(DEBUG|TRACE)\b/.test(prefix)) return 'debug'
  return null
}

/**
 * Shared log body: loading state, error, formatted table (Time | Message), raw JSON, or HTML iframe.
 * Reused by ServerLogsModal and TestWorkflowModal logs tab.
 */
export function ServerLogsBody({
  content,
  contentType,
  loading,
  error,
  viewMode,
}: ServerLogsBodyProps): React.ReactElement {
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)

  const displayContent = useMemo(() => {
    if (content == null) return '';
    if (contentType === 'text/html') return content;
    return tryPrettifyJson(content);
  }, [content, contentType]);

  const logEntries = useMemo(() => tryParseLogEntries(content), [content]);
  const showFormattedView =
    viewMode === 'formatted' &&
    logEntries != null &&
    contentType !== 'text/html';

  const filteredEntries = useMemo((): LogEntry[] | null => {
    if (!logEntries) return null;
    const q = search.trim().toLowerCase();
    if (!q) return logEntries;
    return logEntries.filter(
      (e) => e.m?.toLowerCase().includes(q) || e.t?.toLowerCase().includes(q)
    );
  }, [logEntries, search]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    wasAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  // Auto-scroll to bottom when content refreshes (only if already at bottom)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !wasAtBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
    setIsAtBottom(true);
  }, [content]);

  const scrollToBottom = useCallback(() => {
    wasAtBottomRef.current = true;
    setIsAtBottom(true);
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content ?? '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [content]);

  // ── Early states ────────────────────────────────────────────────────────────

  if (loading && !content) {
    return (
      <div className="server-logs-body">
        <div className="server-logs-loading">Loading logs…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="server-logs-body">
        <div className="server-logs-error">{error}</div>
      </div>
    );
  }

  if (contentType === 'text/html') {
    return (
      <div className="server-logs-body">
        <iframe
          title="Server logs"
          className="server-logs-iframe"
          srcDoc={content ?? ''}
          sandbox="allow-same-origin"
        />
      </div>
    );
  }

  // ── Content ─────────────────────────────────────────────────────────────────

  const entryCount = logEntries?.length ?? null;
  const lineCount = entryCount ?? (content ? content.split('\n').length : 0);

  return (
    <div className="server-logs-body">
      {/* Sub-toolbar: search + actions */}
      <div className="server-logs-subtoolbar">
        {showFormattedView ? (
          <div className="server-logs-search-wrap">
            <Search size={13} className="server-logs-search-icon" />
            <input
              type="text"
              className="server-logs-search-input"
              placeholder="Filter entries…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <>
                <span className="server-logs-match-count">
                  {filteredEntries?.length ?? 0} / {logEntries?.length ?? 0}
                </span>
                <button
                  type="button"
                  className="server-logs-search-clear"
                  onClick={() => setSearch('')}
                  title="Clear filter"
                >
                  <X size={12} />
                </button>
              </>
            )}
          </div>
        ) : (
          <span />
        )}
        <div className="server-logs-subtoolbar-actions">
          {lineCount > 0 && (
            <span className="server-logs-entry-count">
              {lineCount.toLocaleString()} {entryCount != null ? 'entries' : 'lines'}
            </span>
          )}
          <button
            type="button"
            className="server-logs-action-btn"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy all'}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            type="button"
            className="server-logs-action-btn"
            onClick={scrollToBottom}
            title="Jump to bottom"
          >
            <ArrowDownToLine size={14} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="server-logs-scroll-wrap">
      <div className="server-logs-scroll" ref={scrollRef} onScroll={handleScroll}>
        {showFormattedView ? (
          <div className="server-logs-formatted">
            <div className="server-logs-formatted-head">
              <span className="server-logs-formatted-time">Time</span>
              <span className="server-logs-formatted-msg">Message</span>
            </div>
            {(filteredEntries as LogEntry[]).length === 0 ? (
              <div className="server-logs-no-results">No entries match "{search}"</div>
            ) : (
              (filteredEntries as LogEntry[]).map((entry, i) => {
                const level = parseLogLevel(entry.m)
                return (
                  <div
                    key={i}
                    className={`server-logs-formatted-row${level ? ` server-logs-row--${level}` : ''}`}
                  >
                    <span className="server-logs-formatted-time" title={entry.t ?? ''}>
                      {formatLogTimestamp(entry.t)}
                    </span>
                    <span className="server-logs-formatted-msg">{entry.m ?? ''}</span>
                  </div>
                )
              })
            )}
          </div>
        ) : (
          <pre className="server-logs-pre">{displayContent}</pre>
        )}
      </div>
      {!isAtBottom && (
        <button
          type="button"
          className="server-logs-jump-btn"
          onClick={scrollToBottom}
          title="Scroll to bottom"
        >
          <ArrowDownToLine size={13} />
          <span>Jump to bottom</span>
        </button>
      )}
      </div>
    </div>
  );
}
