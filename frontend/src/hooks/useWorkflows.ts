import { useData } from '../context/DataContext'

export function useWorkflows() {
  const {
    workflows,
    workflowsLoading: loading,
    workflowsError: error,
    reloadWorkflows: reload,
  } = useData()
  return { workflows, loading, error, reload }
}
