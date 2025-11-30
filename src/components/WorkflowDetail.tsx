import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { WorkflowParams } from '../types'
import {
  getWorkflowParams,
  getWorkflowJson,
  saveWorkflowParams,
} from '../api/workflows'
import { ArrowLeft, Save, FileJson, Settings, Eye, EyeOff, RotateCcw, Info, Tag, Image as ImageIcon } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import Editor from '@monaco-editor/react'
import NodeManager from './NodeManager'
import './WorkflowDetail.css'

interface WorkflowDetailProps {
  onUpdate: () => void
}

export default function WorkflowDetail({ onUpdate }: WorkflowDetailProps) {
  const { name } = useParams<{ name: string }>()
  const [params, setParams] = useState<WorkflowParams | null>(null)
  const [workflowJson, setWorkflowJson] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWorkflowJson, setShowWorkflowJson] = useState(false)
  const [showParamsJson, setShowParamsJson] = useState(false)
  const [editParamsJson, setEditParamsJson] = useState(false)
  const [paramsText, setParamsText] = useState('')
  const [workflowHighlightRef, setWorkflowHighlightRef] = useState<HTMLDivElement | null>(null)
  const [workflowScrollRef, setWorkflowScrollRef] = useState<HTMLDivElement | null>(null)
  const [iconError, setIconError] = useState(false)

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

  useEffect(() => {
    if (params && !editParamsJson) {
      setParamsText(JSON.stringify(params, null, 2))
    }
  }, [params, editParamsJson])

  const loadWorkflow = async () => {
    if (!name) return
    try {
      setLoading(true)
      setError(null)
      setEditParamsJson(false)
      const [paramsData, jsonData] = await Promise.all([
        getWorkflowParams(name),
        getWorkflowJson(name).catch(() => null),
      ])
      setParams(paramsData)
      setParamsText(JSON.stringify(paramsData, null, 2))
      setWorkflowJson(jsonData)
      setIconError(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!name || !params) return
    try {
      setSaving(true)
      setError(null)
      await saveWorkflowParams(name, params)
      onUpdate()
      alert('Workflow saved successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveParamsJson = async () => {
    if (!name || !paramsText) return
    try {
      setSaving(true)
      setError(null)
      const parsedParams = JSON.parse(paramsText)
      await saveWorkflowParams(name, parsedParams)
      setParams(parsedParams)
      setEditParamsJson(false)
      setParamsText(JSON.stringify(parsedParams, null, 2))
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

  const handleEditParamsJson = () => {
    setEditParamsJson(true)
    setParamsText(JSON.stringify(params, null, 2))
  }

  const handleCancelEditParamsJson = () => {
    setEditParamsJson(false)
    setParamsText(JSON.stringify(params, null, 2))
  }

  const handleParamsUpdate = (updatedParams: WorkflowParams) => {
    setParams(updatedParams)
    if (!editParamsJson) {
      setParamsText(JSON.stringify(updatedParams, null, 2))
    }
  }

  const handleReset = async () => {
    if (!name) return
    if (!confirm('Are you sure you want to reset? All unsaved changes will be lost.')) {
      return
    }
    try {
      setLoading(true)
      setError(null)
      const freshParams = await getWorkflowParams(name)
      setParams(freshParams)
      setParamsText(JSON.stringify(freshParams, null, 2))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset workflow')
    } finally {
      setLoading(false)
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
        <div className="workflow-title-section">
          <h1>{name}</h1>
        </div>
        <div className="header-actions">
          <button
            onClick={handleReset}
            disabled={loading || saving}
            className="btn btn-secondary"
            title="Reset to saved version"
          >
            <RotateCcw size={16} /> Reset
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
          >
            <Save size={16} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <p>{error}</p>
        </div>
      )}

      <div className="detail-content">
        {params && (
          <>
            {/* General Info Section */}
            <div className="detail-section">
              <div className="section-header">
                <Info size={20} />
                <h2>General Info</h2>
              </div>
              <div className="general-info-content">
                {(params.icon || !iconError) && (
                  <div className="workflow-icon-large">
                    {params.icon && !iconError ? (
                      <img 
                        src={`/data/gt-workflows/${encodeURIComponent(name || '')}/${params.icon.replace(/^\.\//, '')}`}
                        alt={`${name} icon`}
                        className="workflow-icon-image"
                        onError={() => {
                          setIconError(true)
                        }}
                      />
                    ) : (
                      <div className="workflow-icon-placeholder-large">
                        <ImageIcon size={48} />
                      </div>
                    )}
                  </div>
                )}
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
                <div className="info-item">
                  <label>Timeout</label>
                  <span>{params.timeout ? `${params.timeout}s` : 'Not set'}</span>
                </div>
                {params.tags && params.tags.length > 0 && (
                  <div className="info-item">
                    <label>Tags</label>
                    <div className="tags-list">
                      {params.tags.map((tag, idx) => (
                        <span key={idx} className="tag-badge">
                          <Tag size={12} />
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="info-item">
                  <label>Dev Mode</label>
                  <span>{params.devMode ? 'Yes' : 'No'}</span>
                </div>
                </div>
              </div>
            </div>

            {/* ComfyUI Config Section */}
            {params.parser === 'comfyui' && params.comfyui_config && (
              <div className="detail-section">
                <div className="section-header">
                  <Settings size={20} />
                  <h2>ComfyUI Config</h2>
                </div>
                <div className="info-grid">
                  {params.comfyui_config.serverUrl && (
                    <div className="info-item">
                      <label>Server URL</label>
                      <span>{params.comfyui_config.serverUrl}</span>
                    </div>
                  )}
                  {params.comfyui_config.workflow && (
                    <div className="info-item">
                      <label>Workflow File</label>
                      <span>{params.comfyui_config.workflow}</span>
                    </div>
                  )}
                  {params.comfyui_config.saveOutputPath && (
                    <div className="info-item">
                      <label>Save Output Path</label>
                      <span>{params.comfyui_config.saveOutputPath}</span>
                    </div>
                  )}
                  {params.comfyui_config.SAVE_INPUT_PATH && (
                    <div className="info-item">
                      <label>Save Input Path</label>
                      <span>{params.comfyui_config.SAVE_INPUT_PATH}</span>
                    </div>
                  )}
                  {params.comfyui_config.ACCEPTED_IMG_FORMATS && (
                    <div className="info-item">
                      <label>Accepted Image Formats</label>
                      <span>{params.comfyui_config.ACCEPTED_IMG_FORMATS.join(', ')}</span>
                    </div>
                  )}
                  {params.comfyui_config.ACCEPTED_VIDEO_FORMATS && (
                    <div className="info-item">
                      <label>Accepted Video Formats</label>
                      <span>{params.comfyui_config.ACCEPTED_VIDEO_FORMATS.join(', ')}</span>
                    </div>
                  )}
                  {params.comfyui_config.ACCEPTED_FILE_FORMATS && (
                    <div className="info-item">
                      <label>Accepted File Formats</label>
                      <span>{params.comfyui_config.ACCEPTED_FILE_FORMATS.join(', ')}</span>
                    </div>
                  )}
                </div>

                {/* Node Manager inside ComfyUI section */}
                {workflowJson && (
                  <NodeManager
                    workflowJson={workflowJson}
                    params={params}
                    onUpdateParams={handleParamsUpdate}
                  />
                )}
              </div>
            )}
          </>
        )}

        {/* Params JSON Editor */}
        <div className="detail-section">
          <div className="section-header">
            <Settings size={20} />
            <h2>Parameters (params.json)</h2>
            <button
              onClick={() => setShowParamsJson(!showParamsJson)}
              className="btn-toggle"
            >
              {showParamsJson ? <EyeOff size={16} /> : <Eye size={16} />}
              {showParamsJson ? 'Hide' : 'Show'}
            </button>
          </div>
          {showParamsJson && (
            <>
              {!editParamsJson ? (
                <div className="editor-container">
                  <Editor
                    key="readonly"
                    height="500px"
                    language="json"
                    value={JSON.stringify(params, null, 2)}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 2,
                      wordWrap: 'on',
                      readOnly: true,
                    }}
                  />
                </div>
              ) : (
                <div className="editor-container">
                  <Editor
                    key="editable"
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
                      readOnly: false,
                      formatOnPaste: true,
                      formatOnType: true,
                    }}
                  />
                </div>
              )}
              <div className="params-json-actions">
                {!editParamsJson ? (
                  <button
                    onClick={handleEditParamsJson}
                    className="btn btn-secondary"
                  >
                    <Settings size={16} /> Edit JSON
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleCancelEditParamsJson}
                      className="btn btn-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveParamsJson}
                      disabled={saving}
                      className="btn btn-primary"
                    >
                      <Save size={16} /> {saving ? 'Saving...' : 'Save JSON'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Workflow JSON Viewer */}
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
                    {/* @ts-expect-error - react-syntax-highlighter has type compatibility issues */}
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
      </div>
    </div>
  )
}

