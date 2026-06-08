import { useData } from '../context/DataContext'

export function useServers() {
  const { servers, serversLoading: loading, serversError: error, reloadServers: reload } = useData()
  return { servers, loading, error, reload }
}
