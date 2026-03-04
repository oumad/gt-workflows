import { useMemo } from 'react';
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

  if (showFormattedView) {
    return (
      <div className="server-logs-body">
        <div className="server-logs-formatted">
          <div className="server-logs-formatted-head">
            <span className="server-logs-formatted-time">Time</span>
            <span className="server-logs-formatted-msg">Message</span>
          </div>
          {(logEntries as LogEntry[]).map((entry, i) => (
            <div key={i} className="server-logs-formatted-row">
              <span
                className="server-logs-formatted-time"
                title={entry.t ?? ''}
              >
                {formatLogTimestamp(entry.t)}
              </span>
              <span className="server-logs-formatted-msg">{entry.m ?? ''}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="server-logs-body">
      <pre className="server-logs-pre">{displayContent}</pre>
    </div>
  );
}
