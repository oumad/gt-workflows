import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Server, LayoutGrid, FileText, Search } from 'lucide-react'
import type { Workflow } from '@/types'
import AuthImage from '@/components/ui/AuthImage'
import { getServerUrls } from '@/utils/serverUrl'
import { ROUTES } from '@/app/routes'
import './ServerWorkflowsModal.css'

interface ServerWorkflowsModalProps {
  serverUrl: string
  serverAliases: Record<string, string>
  workflows: Workflow[]
  onClose: () => void
}

export default function ServerWorkflowsModal({
  serverUrl,
  serverAliases,
  workflows,
  onClose,
}: ServerWorkflowsModalProps) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const norm = serverUrl.replace(/\/$/, '')
  const serverName = serverAliases[norm] || norm.replace(/^https?:\/\//, '')

  const serverWorkflows = workflows.filter((wf) => {
    const urls = getServerUrls(wf.params?.comfyui_config?.serverUrl)
    return urls.some((u) => u.replace(/\/$/, '') === norm)
  })

  const query = search.trim().toLowerCase()
  const filtered = query
    ? serverWorkflows.filter((wf) =>
        (wf.params.label || wf.name).toLowerCase().includes(query) ||
        wf.name.toLowerCase().includes(query),
      )
    : serverWorkflows

  const handleWorkflowClick = (name: string) => {
    onClose()
    navigate(ROUTES.workflow(name))
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content server-workflows-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="server-workflows-title">
            <Server size={20} />
            <div className="server-workflows-title-info">
              {serverAliases[norm] && <span className="server-workflows-title-name">{serverAliases[norm]}</span>}
              <span className="server-workflows-title-url">{norm.replace(/^https?:\/\//, '')}</span>
            </div>
            <span className="server-workflows-count">
              <LayoutGrid size={14} />
              {serverWorkflows.length} workflow{serverWorkflows.length !== 1 ? 's' : ''}
            </span>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body server-workflows-body">
          {serverWorkflows.length > 0 && (
            <div className="server-workflows-search">
              <Search size={15} className="server-workflows-search-icon" />
              <input
                type="text"
                className="server-workflows-search-input"
                placeholder="Search workflows…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="server-workflows-empty">
              <LayoutGrid size={32} />
              <p>{serverWorkflows.length === 0 ? 'No workflows use this server' : 'No workflows match your search'}</p>
            </div>
          ) : (
            <div className="server-workflows-grid">
              {filtered.map((wf) => (
                <button
                  key={wf.name}
                  type="button"
                  className="server-wf-card"
                  onClick={() => handleWorkflowClick(wf.name)}
                  title={`Open ${wf.params.label || wf.name}`}
                >
                  <div className="server-wf-card-icon">
                    {wf.params.icon ? (
                      <AuthImage workflowName={wf.name} iconPath={wf.params.icon} alt={wf.name} />
                    ) : (
                      <FileText size={24} className="server-wf-card-icon-fallback" />
                    )}
                  </div>
                  <div className="server-wf-card-info">
                    <span className="server-wf-card-label">{wf.params.label || wf.name}</span>
                    {wf.params.label && wf.params.label !== wf.name && (
                      <span className="server-wf-card-name">{wf.name}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
