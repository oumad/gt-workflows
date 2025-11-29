import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { WorkflowParams } from '../types'
import {
  getWorkflowParams,
  getWorkflowJson,
  saveWorkflowParams,
} from '../api/workflows'
import { ArrowLeft, Save, FileJson, Settings, Eye, EyeOff } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import Editor from '@monaco-editor/react'
import './WorkflowDetail.css'

interface WorkflowDetailProps {
  onUpdate: () => void
}

export default function WorkflowDetail({ onUpdate }: WorkflowDetailProps) {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [params, setParams] = useState<WorkflowParams | null>(null)
  const [workflowJson, setWorkflowJson] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWorkflowJson, setShowWorkflowJson] = useState(false)
  const [paramsText, setParamsText] = useState('')
  const [workflowHighlightRef, setWorkflowHighlightRef] = useState<HTMLDivElement | null>(null)
  const [workflowScrollRef, setWorkflowScrollRef] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (workflowScrollRef && workflowHighlightRef) {
      const syncScroll = () => {
        if (workflowHighlightRef && workflowScrollRef) {
          workflowHighlightRef.scrollTop = workflowScrollRef.scrollTop
          workflowHighlightRef.scrollLeft = workflowScrollRef.scrollLeft
        }
      }
      workflowScrollRef.addEventListener('scroll', syncScroll)
      return () => workflowScrollRef.removeEventListener('scroll', syncScroll)
    }
  }, [workflowScrollRef, workflowHighlightRef])

  useEffect(() => {
    if (name) {
      loadWorkflow()
    }
  }, [name])

  const loadWorkflow = async () => {
    if (!name) return
    try {
      setLoading(true)
      setError(null)
      const [paramsData, jsonData] = await Promise.all([
        getWorkflowParams(name),
        getWorkflowJson(name).catch(() => null),
      ])
      setParams(paramsData)
      setParamsText(JSON.stringify(paramsData, null, 2))
      setWorkflowJson(jsonData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!name || !paramsText) return
    try {
      setSaving(true)
      setError(null)
      const parsedParams = JSON.parse(paramsText)
      await saveWorkflowParams(name, parsedParams)
      setParams(parsedParams)
      onUpdate()
      alert('Workflow saved successfully!')
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON format')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save workflow')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="loading-container">
        <p>Loading workflow...</p>
      </div>
    )
  }

  if (error && !params) {
    return (
      <div className="error-container">
        <p className="error-message">{error}</p>
        <Link to="/" className="btn btn-primary">
          <ArrowLeft size={16} /> Back to List
        </Link>
      </div>
    )
  }

  return (
    <div className="workflow-detail">
      <div className="detail-header">
        <Link to="/" className="btn btn-secondary">
          <ArrowLeft size={16} /> Back
        </Link>
        <h1>{name}</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary"
        >
          <Save size={16} /> {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <p>{error}</p>
        </div>
      )}

      <div className="detail-content">
        <div className="detail-section">
          <div className="section-header">
            <Settings size={20} />
            <h2>Parameters (params.json)</h2>
          </div>
          <div className="editor-container">
            <Editor
              height="500px"
              language="json"
              value={paramsText}
              onChange={(value: string | undefined) => setParamsText(value || '')}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: 'on',
                formatOnPaste: true,
                formatOnType: true,
              }}
            />
          </div>
        </div>

        {workflowJson && (
          <div className="detail-section">
            <div className="section-header">
              <FileJson size={20} />
              <h2>Workflow JSON</h2>
              <button
                onClick={() => setShowWorkflowJson(!showWorkflowJson)}
                className="btn-toggle"
              >
                {showWorkflowJson ? <EyeOff size={16} /> : <Eye size={16} />}
                {showWorkflowJson ? 'Hide' : 'Show'}
              </button>
            </div>
            {showWorkflowJson && (
              <div className="editor-container">
                <div className="code-viewer-wrapper" ref={setWorkflowScrollRef}>
                  <div
                    ref={setWorkflowHighlightRef}
                    className="syntax-highlight-background workflow-json-highlight"
                  >
                    <SyntaxHighlighter
                      language="json"
                      style={vscDarkPlus}
                      customStyle={{
                        margin: 0,
                        padding: '1rem',
                        background: 'transparent',
                        minHeight: '100%',
                      }}
                      PreTag="div"
                    >
                      {JSON.stringify(workflowJson, null, 2)}
                    </SyntaxHighlighter>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {params && (
          <div className="detail-section">
            <div className="section-header">
              <h2>Quick Info</h2>
            </div>
            <div className="info-grid">
              <div className="info-item">
                <label>Parser Type</label>
                <span>{params.parser === 'comfyui' ? 'ComfyUI' : 'Default'}</span>
              </div>
              {params.description && (
                <div className="info-item">
                  <label>Description</label>
                  <span>{params.description}</span>
                </div>
              )}
              {params.scope && (
                <div className="info-item">
                  <label>Scope</label>
                  <span>{params.scope}</span>
                </div>
              )}
              {params.executionName && (
                <div className="info-item">
                  <label>Execution Name</label>
                  <span>{params.executionName}</span>
                </div>
              )}
              {params.comfyui_config?.serverUrl && (
                <div className="info-item">
                  <label>ComfyUI Server</label>
                  <span>{params.comfyui_config.serverUrl}</span>
                </div>
              )}
              {params.comfyui_config?.workflow && (
                <div className="info-item">
                  <label>Workflow File</label>
                  <span>{params.comfyui_config.workflow}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

