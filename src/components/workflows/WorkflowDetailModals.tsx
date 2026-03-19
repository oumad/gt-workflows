import { Save } from 'lucide-react'
import type { WorkflowParams, WorkflowJson } from '@/types'
import SaveConfirmationModal from '@/components/modals/SaveConfirmationModal'
import ResetConfirmationModal from '@/components/modals/ResetConfirmationModal'
import DuplicateModal from '@/components/modals/DuplicateModal'
import DownloadModal from '@/components/modals/DownloadModal'
import ImportParamsModal from '@/components/modals/ImportParamsModal'
import HistoryModal from '@/components/modals/HistoryModal'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import DependencyAuditModal from '@/components/modals/DependencyAuditModal'
import type { DependencyAuditCache } from '@/components/modals/dependency-audit/types'
import { TestWorkflowModal } from '@/components/modals/TestWorkflowModal'
import type { useTestWorkflow } from '@/hooks/useTestWorkflow'
import { getServerUrls } from '@/utils/serverUrl'
import type { LastRunStatus } from '@/services/api/preferences'

interface WorkflowDetailModalsProps {
  name: string | undefined
  params: WorkflowParams | null
  originalParams: WorkflowParams | null
  workflowJson: WorkflowJson | null
  showSaveModal: boolean
  setShowSaveModal: (v: boolean) => void
  showResetModal: boolean
  setShowResetModal: (v: boolean) => void
  fileParams: WorkflowParams | null
  setFileParams: (v: WorkflowParams | null) => void
  hasExternalChanges: boolean
  externalParams: WorkflowParams | null
  hasUnsavedChanges: boolean
  showSuccessMessage: boolean
  showDuplicateModal: boolean
  setShowDuplicateModal: (v: boolean) => void
  showDownloadModal: boolean
  setShowDownloadModal: (v: boolean) => void
  showImportModal: boolean
  setShowImportModal: (v: boolean) => void
  importedParams: WorkflowParams | null
  setImportedParams: (v: WorkflowParams | null) => void
  importServerUrlPreserved: boolean
  handleImportConfirm: () => void
  showHistoryModal: boolean
  setShowHistoryModal: (v: boolean) => void
  onHistoryRestored: () => void
  logsServerUrl: string | null
  setLogsServerUrl: (v: string | null) => void
  showDependencyAudit: boolean
  setShowDependencyAudit: (v: boolean) => void
  dependencyAuditCache: DependencyAuditCache | null
  setDependencyAuditCache: (v: DependencyAuditCache | null) => void
  showTestWorkflow: boolean
  setShowTestWorkflow: (v: boolean) => void
  testServerUrls: string[]
  testWorkflowHook: ReturnType<typeof useTestWorkflow>
  handleSaveConfirm: () => Promise<void>
  handleReload: () => Promise<void>
  handleOverwrite: () => Promise<void>
  handleResetConfirm: () => Promise<void>
  onUpdate: () => void
  persistLastRun: (workflowName: string, type: 'test' | 'audit', timestamp: string, status?: LastRunStatus) => void
}

export function WorkflowDetailModals({
  name,
  params,
  originalParams,
  workflowJson,
  showSaveModal,
  setShowSaveModal,
  showResetModal,
  setShowResetModal,
  fileParams,
  setFileParams,
  hasExternalChanges,
  externalParams,
  hasUnsavedChanges,
  showSuccessMessage,
  showDuplicateModal,
  setShowDuplicateModal,
  showDownloadModal,
  setShowDownloadModal,
  showImportModal,
  setShowImportModal,
  importedParams,
  setImportedParams,
  importServerUrlPreserved,
  handleImportConfirm,
  showHistoryModal,
  setShowHistoryModal,
  onHistoryRestored,
  logsServerUrl,
  setLogsServerUrl,
  showDependencyAudit,
  setShowDependencyAudit,
  dependencyAuditCache,
  setDependencyAuditCache,
  showTestWorkflow,
  setShowTestWorkflow,
  testServerUrls,
  testWorkflowHook,
  handleSaveConfirm,
  handleReload,
  handleOverwrite,
  handleResetConfirm,
  onUpdate,
  persistLastRun,
}: WorkflowDetailModalsProps) {
  return (
    <>
      {showSaveModal && (
        <SaveConfirmationModal
          originalParams={originalParams}
          currentParams={params}
          hasExternalChanges={hasExternalChanges}
          externalParams={externalParams}
          onSave={handleSaveConfirm}
          onCancel={() => setShowSaveModal(false)}
          onReload={handleReload}
          onOverwrite={handleOverwrite}
        />
      )}

      {showResetModal && (
        <ResetConfirmationModal
          currentParams={params}
          fileParams={fileParams}
          hasUnsavedChanges={hasUnsavedChanges}
          onReset={handleResetConfirm}
          onCancel={() => {
            setShowResetModal(false)
            setFileParams(null)
          }}
        />
      )}

      {showSuccessMessage && (
        <div className="success-toast">
          <div className="success-toast-content">
            <Save size={20} />
            <span>Changes applied successfully!</span>
          </div>
        </div>
      )}

      {showDuplicateModal && name && params && (
        <DuplicateModal
          workflow={{
            name,
            folderPath: `/data/gt-workflows/${encodeURIComponent(name)}`,
            params,
            hasWorkflowFile: !!workflowJson,
          }}
          onClose={() => setShowDuplicateModal(false)}
          onSuccess={(newWorkflowName) => {
            setShowDuplicateModal(false)
            onUpdate()
            if (newWorkflowName) {
              window.location.href = `/workflows/workflow/${encodeURIComponent(newWorkflowName)}`
            }
          }}
          navigateToNew={false}
        />
      )}

      {showDownloadModal && name && params && (
        <DownloadModal
          workflow={{
            name,
            folderPath: `/data/gt-workflows/${encodeURIComponent(name)}`,
            params,
            hasWorkflowFile: !!workflowJson,
          }}
          onClose={() => setShowDownloadModal(false)}
        />
      )}

      {showImportModal && params && importedParams && (
        <ImportParamsModal
          currentParams={params}
          importedParams={importedParams}
          serverUrlPreserved={importServerUrlPreserved}
          onConfirm={handleImportConfirm}
          onCancel={() => {
            setShowImportModal(false)
            setImportedParams(null)
          }}
        />
      )}

      {showHistoryModal && name && (
        <HistoryModal
          workflowName={name}
          currentParams={params}
          onClose={() => setShowHistoryModal(false)}
          onRestored={() => {
            setShowHistoryModal(false)
            onHistoryRestored()
          }}
        />
      )}

      {logsServerUrl && (
        <ServerLogsModal serverUrl={logsServerUrl} onClose={() => setLogsServerUrl(null)} />
      )}

      {showDependencyAudit && workflowJson && params?.comfyui_config?.serverUrl && (
        <DependencyAuditModal
          workflowJson={workflowJson}
          serverUrls={getServerUrls(params.comfyui_config.serverUrl)}
          cached={dependencyAuditCache}
          onCacheUpdate={(cache) => {
            setDependencyAuditCache(cache)
            if (name && cache?.timestamp) {
              const hasServerError = cache.results.some((r) => r.serverError)
              const hasMissing = cache.results.some((r) =>
                r.nodes.some((n) => n.available === false) ||
                Object.values(r.models).some((items) => items.some((m) => m.available === false)) ||
                r.files.some((f) => f.available === false)
              )
              persistLastRun(name, 'audit', cache.timestamp, (cache.error || hasServerError || hasMissing) ? 'failed' : 'passed')
            }
          }}
          onClose={() => setShowDependencyAudit(false)}
        />
      )}

      {showTestWorkflow && workflowJson && params?.comfyui_config?.serverUrl && (
        <TestWorkflowModal
          state={testWorkflowHook.state}
          actions={testWorkflowHook.actions}
          isRunning={testWorkflowHook.isRunning}
          workflowNodeCount={testWorkflowHook.workflowNodeCount}
          serverUrls={testServerUrls}
          onClose={() => setShowTestWorkflow(false)}
        />
      )}
    </>
  )
}
