import type { Workflow } from '@/types'
import QuickEditModal from '@/components/modals/QuickEditModal'
import BulkEditModal from '@/components/modals/BulkEditModal'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import DuplicateModal from '@/components/modals/DuplicateModal'
import DownloadModal from '@/components/modals/DownloadModal'

interface WorkflowListModalsProps {
  editingWorkflow: Workflow | null
  onCloseQuickEdit: () => void
  onSaveQuickEdit: () => void
  showBulkEdit: boolean
  selectedWorkflowsList: Workflow[]
  onCloseBulkEdit: () => void
  onSaveBulkEdit: () => void
  duplicatingWorkflow: Workflow | null
  onCloseDuplicate: () => void
  onSuccessDuplicate: () => void
  downloadingWorkflow: Workflow | null
  onCloseDownload: () => void
  logsServerUrl: string | null
  serverAliases: Record<string, string>
  onCloseLogs: () => void
}

export function WorkflowListModals({
  editingWorkflow, onCloseQuickEdit, onSaveQuickEdit,
  showBulkEdit, selectedWorkflowsList, onCloseBulkEdit, onSaveBulkEdit,
  duplicatingWorkflow, onCloseDuplicate, onSuccessDuplicate,
  downloadingWorkflow, onCloseDownload,
  logsServerUrl, serverAliases, onCloseLogs,
}: WorkflowListModalsProps) {
  return (
    <>
      {editingWorkflow && (
        <QuickEditModal
          workflowName={editingWorkflow.name}
          params={editingWorkflow.params}
          onClose={onCloseQuickEdit}
          onSave={onSaveQuickEdit}
        />
      )}
      {showBulkEdit && selectedWorkflowsList.length > 0 && (
        <BulkEditModal
          workflows={selectedWorkflowsList}
          onClose={onCloseBulkEdit}
          onSave={onSaveBulkEdit}
        />
      )}
      {duplicatingWorkflow && (
        <DuplicateModal
          workflow={duplicatingWorkflow}
          onClose={onCloseDuplicate}
          onSuccess={onSuccessDuplicate}
        />
      )}
      {downloadingWorkflow && (
        <DownloadModal
          workflow={downloadingWorkflow}
          onClose={onCloseDownload}
        />
      )}
      {logsServerUrl && (
        <ServerLogsModal
          serverUrl={logsServerUrl}
          serverAliases={serverAliases}
          onClose={onCloseLogs}
        />
      )}
    </>
  )
}
