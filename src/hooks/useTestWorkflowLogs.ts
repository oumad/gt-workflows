import { useState, useCallback, useMemo } from 'react';
import { fetchServerLogs } from '@/services/api/servers';
import { tryParseLogEntries, type LogEntry } from '@/utils/logFormat';

export type ServerLogsContentType = 'text/plain' | 'text/html';

export interface UseTestWorkflowLogsResult {
  logContent: string | null;
  logContentType: ServerLogsContentType | null;
  logLoading: boolean;
  logError: string | null;
  logEntries: LogEntry[] | null;
  loadLogs: () => Promise<void>;
  clearLogs: () => void;
}

/**
 * Encapsulates server log state and loading for the test workflow modal.
 * Call loadLogs when the user switches to the logs tab.
 */
export function useTestWorkflowLogs(selectedServer: string | null): UseTestWorkflowLogsResult {
  const [logContent, setLogContent] = useState<string | null>(null);
  const [logContentType, setLogContentType] = useState<ServerLogsContentType | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const loadLogs = useCallback(async (): Promise<void> => {
    if (!selectedServer) return;
    setLogLoading(true);
    setLogError(null);
    try {
      const res = await fetchServerLogs(selectedServer);
      setLogContent(res.content);
      setLogContentType(res.contentType);
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Failed to load logs');
      setLogContent(null);
      setLogContentType(null);
    } finally {
      setLogLoading(false);
    }
  }, [selectedServer]);

  const clearLogs = useCallback((): void => {
    setLogContent(null);
    setLogContentType(null);
    setLogError(null);
  }, []);

  const logEntries = useMemo(() => tryParseLogEntries(logContent), [logContent]);

  return {
    logContent,
    logContentType,
    logLoading,
    logError,
    logEntries,
    loadLogs,
    clearLogs,
  };
}
