import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, FileJson, Image as ImageIcon, Archive, Download } from 'lucide-react'
import type { Workflow } from '@/types'
import { downloadWorkflow, getWorkflowJson, getWorkflowParams } from '@/services/api/workflows'
import { fetchWithAuth } from '@/utils/auth'

interface DownloadModalProps {
  workflow: Workflow
  onClose: () => void
}

const CLS_OPTION = [
  'flex items-start gap-3 w-full px-4 py-3',
  'bg-primary border border-default rounded-lg',
  'cursor-pointer text-left transition-all duration-150',
  'hover:border-accent/40 hover:bg-tertiary/30',
  'disabled:opacity-50 disabled:cursor-not-allowed',
].join(' ')

export default function DownloadModal({
  workflow,
  onClose,
}: DownloadModalProps) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDownload = async (type: 'all' | 'workflow' | 'params' | 'icon') => {
    try {
      setDownloading(true)
      setError(null)

      switch (type) {
        case 'all':
          await downloadWorkflow(workflow.name)
          break

        case 'workflow':
          if (!workflow.hasWorkflowFile) throw new Error('No workflow file found')
          const workflowJson = await getWorkflowJson(workflow.name)
          const workflowBlob = new Blob([JSON.stringify(workflowJson, null, 2)], { type: 'application/json' })
          const workflowUrl = URL.createObjectURL(workflowBlob)
          const workflowLink = document.createElement('a')
          workflowLink.href = workflowUrl
          workflowLink.download = `${workflow.name}-workflow.json`
          document.body.appendChild(workflowLink)
          workflowLink.click()
          document.body.removeChild(workflowLink)
          URL.revokeObjectURL(workflowUrl)
          break

        case 'params':
          const params = await getWorkflowParams(workflow.name)
          if (params?.comfyui_config?.serverUrl) params.comfyui_config.serverUrl = 'http://127.0.0.1:8188'
          const paramsBlob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' })
          const paramsUrl = URL.createObjectURL(paramsBlob)
          const paramsLink = document.createElement('a')
          paramsLink.href = paramsUrl
          paramsLink.download = `${workflow.name}-params.json`
          document.body.appendChild(paramsLink)
          paramsLink.click()
          document.body.removeChild(paramsLink)
          URL.revokeObjectURL(paramsUrl)
          break

        case 'icon':
          if (!workflow.params.icon) throw new Error('No icon found')
          const iconPath = workflow.params.icon.replace(/^\.\//, '')
          const iconUrl = `${workflow.folderPath}/${iconPath}`
          const iconResponse = await fetchWithAuth(iconUrl)
          if (!iconResponse.ok) throw new Error('Failed to fetch icon')
          const iconBlob = await iconResponse.blob()
          const iconBlobUrl = URL.createObjectURL(iconBlob)
          const iconLink = document.createElement('a')
          iconLink.href = iconBlobUrl
          iconLink.download = iconPath
          document.body.appendChild(iconLink)
          iconLink.click()
          document.body.removeChild(iconLink)
          URL.revokeObjectURL(iconBlobUrl)
          break
      }

      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download')
    } finally {
      setDownloading(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-secondary border border-default rounded-xl w-full flex flex-col overflow-hidden shadow-2xl"
        style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-default shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/[0.15] flex items-center justify-center shrink-0">
              <Download size={15} className="text-accent-light" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-primary m-0">Download Workflow</h2>
              <p className="text-xs text-muted mt-0.5 m-0">{workflow.params.label || workflow.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted hover:text-primary hover:bg-tertiary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 px-5 py-4 flex flex-col gap-2.5">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-semantic-error/[0.08] border border-semantic-error/20 text-sm text-semantic-error">
              {error}
            </div>
          )}

          <button onClick={() => handleDownload('all')} disabled={downloading} className={CLS_OPTION}>
            <Archive size={18} className="text-accent-light shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-primary">All Files (ZIP)</span>
              <span className="text-xs text-muted">Download all workflow files as a zip archive</span>
            </div>
          </button>

          <button
            onClick={() => handleDownload('workflow')}
            disabled={downloading || !workflow.hasWorkflowFile}
            className={CLS_OPTION}
            title={!workflow.hasWorkflowFile ? 'No workflow file available' : ''}
          >
            <FileJson size={18} className={`shrink-0 mt-0.5 ${workflow.hasWorkflowFile ? 'text-accent-light' : 'text-muted'}`} />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-primary">Workflow File</span>
              <span className="text-xs text-muted">Download workflow.json only</span>
              {!workflow.hasWorkflowFile && <span className="text-xs text-muted italic">Not available</span>}
            </div>
          </button>

          <button onClick={() => handleDownload('params')} disabled={downloading} className={CLS_OPTION}>
            <FileJson size={18} className="text-accent-light shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-primary">Params File</span>
              <span className="text-xs text-muted">Download params.json only</span>
            </div>
          </button>

          <button
            onClick={() => handleDownload('icon')}
            disabled={downloading || !workflow.params.icon}
            className={CLS_OPTION}
            title={!workflow.params.icon ? 'No icon available' : ''}
          >
            <ImageIcon size={18} className={`shrink-0 mt-0.5 ${workflow.params.icon ? 'text-accent-light' : 'text-muted'}`} />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-primary">Icon</span>
              <span className="text-xs text-muted">Download icon image only</span>
              {!workflow.params.icon && <span className="text-xs text-muted italic">Not available</span>}
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-5 py-4 border-t border-default shrink-0">
          <button
            onClick={onClose}
            disabled={downloading}
            className="px-3.5 py-1.5 text-sm rounded-lg bg-tertiary text-secondary border border-default hover:text-primary transition-colors disabled:opacity-40"
          >
            {downloading ? 'Downloading...' : 'Close'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
