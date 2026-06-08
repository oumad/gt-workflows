import { Modal } from '../../components/ui/Modal'
import { WorkflowForm } from './WorkflowForm'
import { WorkflowImportWizard } from './WorkflowImportWizard'
import type { Workflow, Server } from '../../types'

/** The three modals that float above the WorkflowsPage list — create, edit,
 *  and the import wizard. They share a `servers` list and the `reload` /
 *  `openDetail` handlers so the page shell stays slim. */
export function WorkflowsModalStack({
  servers,
  creating,
  editing,
  importTarget,
  onCloseCreating,
  onCloseEditing,
  onCloseImport,
  onReload,
  onOpenDetail,
  onCloseDetail,
}: {
  servers: Server[]
  creating: boolean
  editing: Workflow | null
  importTarget: { wf: Workflow; file: File } | null
  onCloseCreating: () => void
  onCloseEditing: () => void
  onCloseImport: () => void
  onReload: () => void
  onOpenDetail: (wf: Workflow) => void
  onCloseDetail: () => void
}) {
  return (
    <>
      {creating && (
        <Modal title="New workflow" onClose={onCloseCreating}>
          <WorkflowForm
            servers={servers}
            onSaved={(w) => {
              onCloseCreating()
              onReload()
              onOpenDetail(w)
            }}
            onCancel={onCloseCreating}
          />
        </Modal>
      )}

      {editing && (
        <Modal title={`Edit: ${editing.name}`} onClose={onCloseEditing}>
          <WorkflowForm
            initial={editing}
            servers={servers}
            onSaved={() => {
              onCloseEditing()
              onReload()
            }}
            onDeleted={() => {
              onCloseEditing()
              onCloseDetail()
              onReload()
            }}
            onCancel={onCloseEditing}
          />
        </Modal>
      )}

      {importTarget && (
        <WorkflowImportWizard
          wf={importTarget.wf}
          file={importTarget.file}
          servers={servers}
          onClose={onCloseImport}
          onDone={(updated) => {
            onCloseImport()
            onReload()
            onOpenDetail(updated)
          }}
        />
      )}
    </>
  )
}
