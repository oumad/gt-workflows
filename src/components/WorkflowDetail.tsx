import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { WorkflowParams } from '../types'
import {
  getWorkflowParams,
  getWorkflowJson,
  saveWorkflowParams,
  uploadFile,
  deleteWorkflowFile,
} from '../api/workflows'
import { ArrowLeft, Save, FileJson, Settings, Eye, EyeOff, RotateCcw, Info, Tag, Image as ImageIcon, Upload, X } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import Editor from '@monaco-editor/react'
import NodeManager from './NodeManager'
import { compressImage } from '../utils/imageCompression'
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
  const [iconDragOver, setIconDragOver] = useState(false)
  const [workflowDragOver, setWorkflowDragOver] = useState(false)

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
                  <div className="info-item">
                    <label>Description</label>
                    <input
                      type="text"
                      value={params.description || ''}
                      onChange={(e) => handleParamsUpdate({ ...params, description: e.target.value || undefined })}
                      placeholder="Workflow description"
                      className="info-input"
                    />
                  </div>
                  <div className="info-item">
                    <label>Scope</label>
                    <select
                      value={params.scope || ''}
                      onChange={(e) => handleParamsUpdate({ ...params, scope: e.target.value || undefined })}
                      className="info-input"
                    >
                      <option value="">None</option>
                      <option value="item">Item</option>
                    </select>
                  </div>
                  <div className="info-item">
                    <label>Execution Name</label>
                    <input
                      type="text"
                      value={params.executionName || ''}
                      onChange={(e) => handleParamsUpdate({ ...params, executionName: e.target.value || undefined })}
                      placeholder="Execute button label"
                      className="info-input"
                    />
                  </div>
                  <div className="info-item">
                    <label>Timeout (seconds)</label>
                    <input
                      type="number"
                      value={params.timeout || ''}
                      onChange={(e) => handleParamsUpdate({ ...params, timeout: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="Not set"
                      className="info-input"
                      min="0"
                    />
                  </div>
                  <div className="info-item">
                    <label>Tags</label>
                    <input
                      type="text"
                      value={params.tags ? params.tags.join(', ') : ''}
                      onChange={(e) => {
                        const tags = e.target.value.split(',').map(t => t.trim()).filter(t => t);
                        handleParamsUpdate({ ...params, tags: tags.length > 0 ? tags : undefined });
                      }}
                      placeholder="Comma-separated tags"
                      className="info-input"
                    />
                  </div>
                  <div className="info-item">
                    <label>Dev Mode</label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={params.devMode || false}
                        onChange={(e) => handleParamsUpdate({ ...params, devMode: e.target.checked || undefined })}
                      />
                      <span>Enabled</span>
                    </label>
                  </div>
                  <div className="info-item info-item-full">
                    <label>Icon</label>
                    <div className="file-upload-area">
                      {params.icon ? (
                        <div className="file-info">
                          <span>{params.icon.replace(/^\.\//, '')}</span>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!name) return;
                              const iconFilename = params.icon.replace(/^\.\//, '');
                              try {
                                // Delete the icon file
                                await deleteWorkflowFile(name, iconFilename);
                                // Update params and save
                                const updatedParams = { ...params, icon: undefined };
                                handleParamsUpdate(updatedParams);
                                await saveWorkflowParams(name, updatedParams);
                                onUpdate();
                              } catch (error) {
                                console.error('Failed to delete icon:', error);
                                // Still remove from params even if file deletion fails
                                const updatedParams = { ...params, icon: undefined };
                                handleParamsUpdate(updatedParams);
                                await saveWorkflowParams(name, updatedParams);
                                onUpdate();
                              }
                            }}
                            className="btn-icon"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <label className="file-drop-zone">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file && name) {
                                try {
                                  // Compress image before uploading
                                  const compressedFile = await compressImage(file, 800, 0.85);
                                  const result = await uploadFile(name, compressedFile);
                                  const updatedParams = { ...params, icon: result.relativePath };
                                  handleParamsUpdate(updatedParams);
                                  // Automatically save params.json with the icon reference
                                  await saveWorkflowParams(name, updatedParams);
                                  onUpdate(); // Refresh the workflow list if needed
                                } catch (error) {
                                  alert('Failed to upload icon: ' + (error instanceof Error ? error.message : 'Unknown error'));
                                }
                              }
                            }}
                            style={{ display: 'none' }}
                          />
                          <Upload size={20} />
                          <span>Click or drop image</span>
                        </label>
                      )}
                    </div>
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
                  <div className="info-item">
                    <label>Server URL</label>
                    <input
                      type="text"
                      value={params.comfyui_config.serverUrl || ''}
                      onChange={(e) => handleParamsUpdate({
                        ...params,
                        comfyui_config: {
                          ...params.comfyui_config,
                          serverUrl: e.target.value || undefined
                        }
                      })}
                      placeholder="http://127.0.0.1:8188"
                      className="info-input"
                    />
                  </div>
                  <div className="info-item info-item-full">
                    <label>Workflow File</label>
                    <div className="file-upload-area">
                      {params.comfyui_config.workflow ? (
                        <div className="file-info">
                          <span>{params.comfyui_config.workflow.replace(/^\.\//, '')}</span>
                          <button
                            type="button"
                            onClick={() => handleParamsUpdate({
                              ...params,
                              comfyui_config: {
                                ...params.comfyui_config,
                                workflow: undefined
                              }
                            })}
                            className="btn-icon"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <label 
                          className={`file-drop-zone ${workflowDragOver ? 'drag-over' : ''}`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setWorkflowDragOver(true);
                          }}
                          onDragLeave={() => setWorkflowDragOver(false)}
                          onDrop={async (e) => {
                            e.preventDefault();
                            setWorkflowDragOver(false);
                            const file = e.dataTransfer.files[0];
                            if (file && file.name.endsWith('.json') && name) {
                              try {
                                const result = await uploadFile(name, file);
                                handleParamsUpdate({
                                  ...params,
                                  comfyui_config: {
                                    ...params.comfyui_config,
                                    workflow: result.relativePath
                                  }
                                });
                                // Reload workflow JSON after upload
                                const jsonData = await getWorkflowJson(name);
                                setWorkflowJson(jsonData);
                              } catch (error) {
                                alert('Failed to upload workflow file: ' + (error instanceof Error ? error.message : 'Unknown error'));
                              }
                            }
                          }}
                        >
                          <input
                            type="file"
                            accept=".json"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file && name) {
                                try {
                                  const result = await uploadFile(name, file);
                                  handleParamsUpdate({
                                    ...params,
                                    comfyui_config: {
                                      ...params.comfyui_config,
                                      workflow: result.relativePath
                                    }
                                  });
                                  // Reload workflow JSON after upload
                                  const jsonData = await getWorkflowJson(name);
                                  setWorkflowJson(jsonData);
                                } catch (error) {
                                  alert('Failed to upload workflow file: ' + (error instanceof Error ? error.message : 'Unknown error'));
                                }
                              }
                            }}
                            style={{ display: 'none' }}
                          />
                          <Upload size={20} />
                          <span>Click or drop JSON file</span>
                        </label>
                      )}
                    </div>
                  </div>
                  <div className="info-item">
                    <label>Save Output Path</label>
                    <input
                      type="text"
                      value={params.comfyui_config.saveOutputPath || ''}
                      onChange={(e) => handleParamsUpdate({
                        ...params,
                        comfyui_config: {
                          ...params.comfyui_config,
                          saveOutputPath: e.target.value || undefined
                        }
                      })}
                      placeholder="/path/to/output"
                      className="info-input"
                    />
                  </div>
                  <div className="info-item">
                    <label>Save Input Path</label>
                    <input
                      type="text"
                      value={params.comfyui_config.SAVE_INPUT_PATH || ''}
                      onChange={(e) => handleParamsUpdate({
                        ...params,
                        comfyui_config: {
                          ...params.comfyui_config,
                          SAVE_INPUT_PATH: e.target.value || undefined
                        }
                      })}
                      placeholder="/path/to/input"
                      className="info-input"
                    />
                  </div>
                  <div className="info-item">
                    <label>Accepted Image Formats</label>
                    <input
                      type="text"
                      value={params.comfyui_config.ACCEPTED_IMG_FORMATS ? params.comfyui_config.ACCEPTED_IMG_FORMATS.join(', ') : ''}
                      onChange={(e) => {
                        const formats = e.target.value.split(',').map(f => f.trim()).filter(f => f);
                        handleParamsUpdate({
                          ...params,
                          comfyui_config: {
                            ...params.comfyui_config,
                            ACCEPTED_IMG_FORMATS: formats.length > 0 ? formats : undefined
                          }
                        });
                      }}
                      placeholder="png, jpg, jpeg"
                      className="info-input"
                    />
                  </div>
                  <div className="info-item">
                    <label>Accepted Video Formats</label>
                    <input
                      type="text"
                      value={params.comfyui_config.ACCEPTED_VIDEO_FORMATS ? params.comfyui_config.ACCEPTED_VIDEO_FORMATS.join(', ') : ''}
                      onChange={(e) => {
                        const formats = e.target.value.split(',').map(f => f.trim()).filter(f => f);
                        handleParamsUpdate({
                          ...params,
                          comfyui_config: {
                            ...params.comfyui_config,
                            ACCEPTED_VIDEO_FORMATS: formats.length > 0 ? formats : undefined
                          }
                        });
                      }}
                      placeholder="mp4, mov"
                      className="info-input"
                    />
                  </div>
                  <div className="info-item">
                    <label>Accepted File Formats</label>
                    <input
                      type="text"
                      value={params.comfyui_config.ACCEPTED_FILE_FORMATS ? params.comfyui_config.ACCEPTED_FILE_FORMATS.join(', ') : ''}
                      onChange={(e) => {
                        const formats = e.target.value.split(',').map(f => f.trim()).filter(f => f);
                        handleParamsUpdate({
                          ...params,
                          comfyui_config: {
                            ...params.comfyui_config,
                            ACCEPTED_FILE_FORMATS: formats.length > 0 ? formats : undefined
                          }
                        });
                      }}
                      placeholder="txt, json"
                      className="info-input"
                    />
                  </div>
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

