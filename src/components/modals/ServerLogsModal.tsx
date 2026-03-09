import { useState, useEffect, useCallback } from 'react';
import { X, FileText, RefreshCw, Timer } from 'lucide-react';
import { fetchServerLogs } from '@/services/api/servers';
import { ServerLogsBody, type ServerLogsViewMode } from '@/components/logs/ServerLogsBody';
import './ServerLogsModal.css';

const AUTO_REFRESH_INTERVALS = [5, 10, 30, 60] as const;

interface ServerLogsModalProps {
  serverUrl: string;
  serverAliases?: Record<string, string>;
  onClose: () => void;
}

function serverDisplayLabel(
  serverUrl: string,
  serverAliases?: Record<string, string>
): string {
  const alias = serverAliases?.[serverUrl]?.trim();
  return alias ? `${alias} - ${serverUrl}` : serverUrl;
}

export default function ServerLogsModal({
  serverUrl,
  serverAliases,
  onClose,
}: ServerLogsModalProps): React.ReactElement {
  const [content, setContent] = useState<string | null>(null);
  const [contentType, setContentType] = useState<'text/plain' | 'text/html'>('text/plain');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(10);
  const [viewMode, setViewMode] = useState<ServerLogsViewMode>('formatted');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchServerLogs(serverUrl);
      setContent(res.content);
      setContentType(res.contentType);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
      setContent(null);
    } finally {
      setLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const ms = autoRefreshInterval * 1000;
    const id = setInterval(load, ms);
    return () => clearInterval(id);
  }, [autoRefresh, autoRefreshInterval, load]);

  return (
    <div className="modal-overlay server-logs-overlay" onClick={onClose}>
      <div className="modal-content server-logs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="server-logs-header">
          <div className="server-logs-title">
            <FileText size={20} />
            <span>Server logs</span>
            <span className="server-logs-url" title={serverUrl}>
              {serverDisplayLabel(serverUrl, serverAliases)}
            </span>
          </div>
          <div className="server-logs-actions">
            {contentType !== 'text/html' && (
              <button
                type="button"
                className="btn btn-toolbar"
                onClick={() =>
                  setViewMode((v) => (v === 'raw' ? 'formatted' : 'raw'))
                }
                title={
                  viewMode === 'raw'
                    ? 'Show formatted log view (timestamp | message)'
                    : 'Show raw JSON'
                }
              >
                {viewMode === 'raw' ? 'Raw' : 'Formatted'}
              </button>
            )}
            <div className="server-logs-auto-refresh">
              <button
                type="button"
                className={`btn btn-toolbar ${autoRefresh ? 'active' : ''}`}
                onClick={() => setAutoRefresh((v) => !v)}
                title={
                  autoRefresh ? 'Stop auto-refresh' : 'Enable auto-refresh'
                }
              >
                <Timer size={18} />
                <span>Auto-refresh</span>
              </button>
              <select
                className="server-logs-interval"
                value={autoRefreshInterval}
                onChange={(e) =>
                  setAutoRefreshInterval(Number(e.target.value))
                }
                title="Refresh interval"
                aria-label="Auto-refresh interval"
              >
                {AUTO_REFRESH_INTERVALS.map((s) => (
                  <option key={s} value={s}>
                    Every {s}s
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn btn-toolbar"
              onClick={load}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw size={18} className={loading ? 'spin' : ''} />
              Refresh
            </button>
            <button type="button" className="server-logs-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>
        <ServerLogsBody
          content={content}
          contentType={contentType}
          loading={loading}
          error={error}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
}
