import { useState } from 'react'
import { X, FileJson, Image as ImageIcon, Archive } from 'lucide-react'
import { Workflow } from '../types'
import { downloadWorkflow, getWorkflowJson, getWorkflowParams } from '../api/workflows'
import { fetchWithAuth } from '../utils/auth'
import './DownloadModal.css'

interface DownloadModalProps {
  workflow: Workflow
  onClose: () => void
}

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
          // Download all workflow files as zip
          await downloadWorkflow(workflow.name)
          break

        case 'workflow':
          // Download workflow.json file only
          if (!workflow.hasWorkflowFile) {
            throw new Error('No workflow file found')
          }
          const workflowJson = await getWorkflowJson(workflow.name)
          const workflowBlob = new Blob([JSON.stringify(workflowJson, null, 2)], {
            type: 'application/json',
          })
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
          // Download params.json file only
          const params = await getWorkflowParams(workflow.name)
          const paramsBlob = new Blob([JSON.stringify(params, null, 2)], {
            type: 'application/json',
          })
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
          // Download icon file only
          if (!workflow.params.icon) {
            throw new Error('No icon found')
          }
          const iconPath = workflow.params.icon.replace(/^\.\//, '')
          const iconUrl = `${workflow.folderPath}/${iconPath}`
          
          // Fetch the icon as a blob to handle cross-origin properly
          const iconResponse = await fetchWithAuth(iconUrl)
          if (!iconResponse.ok) {
            throw new Error('Failed to fetch icon')
          }
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content download-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Download Workflow</h2>
          <button onClick={onClose} className="modal-close">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="error-banner">
              <p>{error}</p>
            </div>
          )}

          <div className="download-options">
            <button
              onClick={() => handleDownload('all')}
              disabled={downloading}
              className="download-option"
            >
              <Archive size={24} />
              <div className="download-option-content">
                <h3>All Files (ZIP)</h3>
                <p>Download all workflow files as a zip archive</p>
              </div>
            </button>

            <button
              onClick={() => handleDownload('workflow')}
              disabled={downloading || !workflow.hasWorkflowFile}
              className="download-option"
              title={!workflow.hasWorkflowFile ? 'No workflow file available' : ''}
            >
              <FileJson size={24} />
              <div className="download-option-content">
                <h3>Workflow File</h3>
                <p>Download workflow.json only</p>
                {!workflow.hasWorkflowFile && (
                  <small className="unavailable">Not available</small>
                )}
              </div>
            </button>

            <button
              onClick={() => handleDownload('params')}
              disabled={downloading}
              className="download-option"
            >
              <FileJson size={24} />
              <div className="download-option-content">
                <h3>Params File</h3>
                <p>Download params.json only</p>
              </div>
            </button>

            <button
              onClick={() => handleDownload('icon')}
              disabled={downloading || !workflow.params.icon}
              className="download-option"
              title={!workflow.params.icon ? 'No icon available' : ''}
            >
              <ImageIcon size={24} />
              <div className="download-option-content">
                <h3>Icon</h3>
                <p>Download icon image only</p>
                {!workflow.params.icon && (
                  <small className="unavailable">Not available</small>
                )}
              </div>
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary" disabled={downloading}>
            {downloading ? 'Downloading...' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
