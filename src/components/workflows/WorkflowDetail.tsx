import { useState, useRef, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, FileJson, Settings, Eye, EyeOff, RotateCcw, AlertCircle, Copy, Download, Upload, History, Package, Play, MoreVertical, Info, Image as ImageIcon, Cpu, Code2, Layers, Undo2, ScrollText } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import Editor from '@monaco-editor/react'
import { useWorkflowDetail } from './useWorkflowDetail'
import { WorkflowGeneralInfo } from './WorkflowGeneralInfo'
import { WorkflowComfyUIConfig } from './WorkflowComfyUIConfig'
import { WorkflowDetailModals } from './WorkflowDetailModals'
import AuthImage from '@/components/ui/AuthImage'
import './WorkflowDetail.css'

interface WorkflowDetailProps {
  onUpdate: () => void
}

type SectionId = 'general' | 'dashboard' | 'selectors' | 'ui-config' | 'comfyui' | 'params-json' | 'workflow-json'

interface SidebarSection {
  id: SectionId
  label: string
  icon: React.ReactNode
  visible: boolean
}

export function WorkflowDetail({ onUpdate }: WorkflowDetailProps) {
  const detail = useWorkflowDetail(onUpdate)
  const {
    name, params, originalParams, workflowJson, loading, saving, error,
    showWorkflowJson, setShowWorkflowJson, showParamsJson, setShowParamsJson,
    editParamsJson, paramsText, setParamsText,
    setWorkflowHighlightRef, setWorkflowScrollRef,
    iconError, setIconError, iconDragOver, setIconDragOver,
    iconVersion, workflowDragOver, setWorkflowDragOver,
    hasExternalChanges, hasUnsavedChanges,
    handleParamsUpdate, handleSaveClick, handleResetClick,
    handleEditParamsJson, handleCancelEditParamsJson, handleSaveParamsJson,
    handleIconDelete, handleIconUpload, handleWorkflowFileUpload,
    handleImportParamsFile, handleImportConfirm,
    setLogsServerUrl, setShowTestWorkflow, setShowDependencyAudit,
    setShowDuplicateModal, setShowDownloadModal,
    isFieldChanged, persistWorkflowDetailUI,
  } = detail

  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const [activeSection, setActiveSection] = useState<SectionId>('general')
  const navigate = useNavigate()
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const pendingNavRef = useRef<string | null>(null)

  // Intercept navigation when unsaved changes exist
  const handleNavigation = useCallback((to: string | number, e?: React.MouseEvent) => {
    if (hasUnsavedChanges) {
      e?.preventDefault()
      pendingNavRef.current = to as string
      setShowLeaveModal(true)
    } else if (typeof to === 'number') {
      e?.preventDefault()
      navigate(to)
    }
    // If no unsaved changes and string, let default Link behavior proceed
  }, [hasUnsavedChanges, navigate])

  const handleLeaveConfirm = useCallback(() => {
    setShowLeaveModal(false)
    const target = pendingNavRef.current
    pendingNavRef.current = null
    if (target != null) {
      // Support both string paths and numeric (-1 for back)
      const num = Number(target)
      if (!Number.isNaN(num) && String(num) === target) {
        navigate(num)
      } else {
        navigate(target)
      }
    }
  }, [navigate])

  const handleDiscardChanges = () => {
    if (originalParams) {
      handleParamsUpdate(structuredClone(originalParams))
    }
  }

  // Section refs for scroll-to navigation
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (!showMoreMenu) return
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setShowMoreMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMoreMenu])

  // Track active section on scroll
  useEffect(() => {
    const handleScroll = () => {
      const entries = Object.entries(sectionRefs.current).filter(([, el]) => el !== null)
      let current: SectionId = 'general'
      for (const [id, el] of entries) {
        if (el && el.getBoundingClientRect().top <= 120) {
          current = id as SectionId
        }
      }
      setActiveSection(current)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToSection = (id: SectionId) => {
    const el = sectionRefs.current[id]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveSection(id)
    }
  }

  if (loading) {
    return <div className="loading-container"><p>Loading workflow...</p></div>
  }

  if (error && !params) {
    return (
      <div className="error-container">
        <p className="error-message">{error}</p>
        <Link to="/workflows" className="btn btn-primary"><ArrowLeft size={16} /> Back to List</Link>
      </div>
    )
  }

  // ComfyUI test/audit availability
  const comfyDisabledReason = params?.parser === 'comfyui' ? (() => {
    const missingServer = !params.comfyui_config?.serverUrl
    const missingWorkflow = !workflowJson
    if (missingServer && missingWorkflow) return 'Requires a ComfyUI server URL and workflow file'
    if (missingServer) return 'Requires a ComfyUI server URL'
    if (missingWorkflow) return 'Requires a workflow file (.json)'
    return null
  })() : null

  // Build sidebar sections based on what's visible
  const sidebarSections = ([
    { id: 'general' as SectionId, label: 'General Info', icon: <Info size={15} />, visible: !!params },
    { id: 'dashboard' as SectionId, label: 'Dashboard', icon: <Layers size={15} />, visible: !!(params && (params.dashboard || params.parser !== 'comfyui')) },
    { id: 'selectors' as SectionId, label: 'Selectors', icon: <Settings size={15} />, visible: !!(params && (params.selectors || params.parser !== 'comfyui')) },
    { id: 'ui-config' as SectionId, label: 'UI Config', icon: <Settings size={15} />, visible: !!(params && params.parser !== 'comfyui' && params.ui) },
    { id: 'comfyui' as SectionId, label: 'ComfyUI Config', icon: <Cpu size={15} />, visible: !!(params?.parser === 'comfyui' && params.comfyui_config) },
    { id: 'params-json' as SectionId, label: 'Params JSON', icon: <Code2 size={15} />, visible: true },
    { id: 'workflow-json' as SectionId, label: 'Workflow JSON', icon: <FileJson size={15} />, visible: !!workflowJson },
  ] as SidebarSection[]).filter(s => s.visible)

  return (
    <div className={`workflow-detail ${hasUnsavedChanges ? 'has-floating-apply' : ''}`}>
      {/* Hero Banner — sticky */}
      <div className="sticky top-14 z-30 mb-6">
        <div className="relative rounded-xl bg-[#1a2332] border border-[#2d3a4a]">
          {/* Background image (blurred, dimmed) */}
          <div className="absolute inset-0 rounded-xl overflow-hidden">
            {params?.icon && !iconError ? (
              <AuthImage
                workflowName={name || ''}
                iconPath={params.icon}
                alt=""
                className="w-full h-full object-cover opacity-15 blur-2xl scale-110"
                version={iconVersion}
                onError={() => setIconError(true)}
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-purple-900/20 to-[#1a2332]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-[#1a2332]/90 via-[#1a2332]/70 to-[#1a2332]/90" />
          </div>

          {/* Hero content */}
          <div className="relative z-10 px-5 py-3 flex items-center gap-4">
            {/* Back button */}
            <button type="button" onClick={(e) => handleNavigation(-1, e)} className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#243044]/60 text-[#8b9aab] hover:text-white hover:bg-purple-700/30 transition-colors duration-150 flex-shrink-0" title="Go back">
              <ArrowLeft size={16} />
            </button>

            {/* Icon */}
            <div className="flex-shrink-0 w-11 h-11 rounded-lg overflow-hidden border border-[#354556] bg-[#0f1419]">
              {params?.icon && !iconError ? (
                <AuthImage
                  workflowName={name || ''}
                  iconPath={params.icon}
                  alt={`${name} icon`}
                  className="w-full h-full object-cover"
                  version={iconVersion}
                  onError={() => setIconError(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#697784]">
                  <ImageIcon size={18} />
                </div>
              )}
            </div>

            {/* Title + meta */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-semibold text-[#e8ecf1] truncate leading-tight">
                {params?.label || name}
              </h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {params?.category && (
                  <span className="text-[14px] px-2 py-0.5 rounded-full bg-purple-700/10 text-purple-400/80 border border-purple-700/15">
                    {params.category}
                  </span>
                )}
                {params?.parser && (
                  <span className="text-[14px] text-[#697784]">
                    {params.parser === 'comfyui' ? 'ComfyUI' : 'Default'}
                  </span>
                )}
                {params?.tags?.map((tag: string) => (
                  <span key={tag} className="text-[14px] px-2 py-0.5 rounded-full bg-purple-700/10 text-purple-400/80 border border-purple-700/15">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Actions — far right */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* More Actions Dropdown */}
              <div ref={moreMenuRef} className="relative">
                <button
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  className="flex items-center gap-1 p-2 text-sm rounded-lg text-[#8b9aab] hover:text-[#e8ecf1] hover:bg-[#243044]/60 transition-colors duration-150"
                  aria-expanded={showMoreMenu}
                  title="More actions"
                >
                  <MoreVertical size={16} />
                </button>

                {showMoreMenu && (
                  <div className="absolute right-0 mt-2 bg-[#1a2332] border border-[#354556] rounded-lg shadow-xl z-[50] min-w-48 py-1.5">
                    {params?.parser === 'comfyui' && (
                      <>
                        <button
                          onClick={() => {
                            const u = params?.comfyui_config?.serverUrl
                            const url = Array.isArray(u) ? u[0] : u
                            if (url) setLogsServerUrl(url)
                            setShowMoreMenu(false)
                          }}
                          disabled={loading || !params?.comfyui_config?.serverUrl}
                          className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-purple-700/20 transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                          <ScrollText size={14} /> View Server Log
                        </button>
                        <button
                          onClick={() => { setShowTestWorkflow(true); setShowMoreMenu(false) }}
                          disabled={loading || !!comfyDisabledReason}
                          className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-purple-700/20 transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                          <Play size={14} /> Test Workflow
                        </button>
                        <button
                          onClick={() => { setShowDependencyAudit(true); setShowMoreMenu(false) }}
                          disabled={loading || !!comfyDisabledReason}
                          className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-purple-700/20 transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                          <Package size={14} /> Audit Dependencies
                        </button>
                        <div className="border-t border-[#354556] my-1" />
                      </>
                    )}
                    <button
                      onClick={() => { setShowDuplicateModal(true); setShowMoreMenu(false) }}
                      disabled={loading}
                      className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-purple-700/20 transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      <Copy size={14} /> Duplicate
                    </button>
                    <button
                      onClick={() => { setShowDownloadModal(true); setShowMoreMenu(false) }}
                      disabled={loading}
                      className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-purple-700/20 transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      <Download size={14} /> Download
                    </button>
                    <button
                      onClick={() => { handleImportParamsFile(); setShowMoreMenu(false) }}
                      disabled={loading}
                      className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-purple-700/20 transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      <Upload size={14} /> Import
                    </button>
                    <div className="border-t border-[#354556] my-1" />
                    <button
                      onClick={() => { detail.setShowHistoryModal(true); setShowMoreMenu(false) }}
                      disabled={loading}
                      className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-purple-700/20 transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      <History size={14} /> History
                    </button>
                    <button
                      onClick={() => { handleResetClick(); setShowMoreMenu(false) }}
                      disabled={loading || saving}
                      className="w-full text-left px-3 py-2 text-sm text-red-400/70 hover:bg-red-900/10 hover:text-red-400 transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      <RotateCcw size={14} /> Reset
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={handleSaveClick}
                disabled={saving}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${
                  hasUnsavedChanges
                    ? 'bg-purple-700 hover:bg-purple-800 text-white shadow-md'
                    : 'bg-purple-700/80 hover:bg-purple-700 text-white'
                }`}
                title={hasUnsavedChanges ? 'Save changes' : 'Save'}
              >
                <Save size={14} /> {saving ? 'Saving...' : 'Save'}
                {hasUnsavedChanges && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {hasExternalChanges && (
        <div className="external-changes-banner" role="alert">
          <AlertCircle size={16} />
          <span><strong>File changed externally.</strong> params.json was modified outside the editor — reload to use the new version or save to overwrite.</span>
        </div>
      )}

      {error && <div className="error-banner" role="alert"><p>{error}</p></div>}

      {/* Two-column layout: Content + Sidebar */}
      <div className="flex gap-6 items-start">
        {/* Main content */}
        <div className="flex-1 min-w-0 flex flex-col gap-5">
          {params && (
            <>
              <div ref={(el) => { sectionRefs.current['general'] = el }}>
                <WorkflowGeneralInfo
                  params={params}
                  handleParamsUpdate={handleParamsUpdate}
                  isFieldChanged={isFieldChanged}
                  iconDragOver={iconDragOver}
                  setIconDragOver={setIconDragOver}
                  handleIconDelete={handleIconDelete}
                  handleIconUpload={handleIconUpload}
                />
              </div>

              {/* Dashboard Config Section */}
              {(params.dashboard || params.parser !== 'comfyui') && (
                <div ref={(el) => { sectionRefs.current['dashboard'] = el }} className="detail-section">
                  <div className="section-header">
                    <Layers size={20} />
                    <h2>Dashboard Configuration</h2>
                    {!params.dashboard && (
                      <button onClick={() => handleParamsUpdate({ ...params, dashboard: {} })} className="btn btn-secondary" style={{ marginLeft: 'auto' }}>
                        Add Dashboard Config
                      </button>
                    )}
                  </div>
                  {params.dashboard && (
                    <div className="info-grid">
                      <div className="info-item">
                        <label>Disable Dashboard</label>
                        <label className="checkbox-label">
                          <input type="checkbox" checked={params.dashboard.disable || false} onChange={(e) => handleParamsUpdate({ ...params, dashboard: { ...params.dashboard, disable: e.target.checked || undefined } })} />
                          <span>Disable</span>
                        </label>
                      </div>
                      <div className="info-item">
                        <label>Break Size</label>
                        <input type="number" value={params.dashboard.breakSize || ''} onChange={(e) => handleParamsUpdate({ ...params, dashboard: { ...params.dashboard, breakSize: e.target.value ? Number(e.target.value) : undefined } })} placeholder="Panel size threshold" className="info-input" />
                        <small>Size at which dashboard appears</small>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Data Selectors Section */}
              {(params.selectors || params.parser !== 'comfyui') && (
                <div ref={(el) => { sectionRefs.current['selectors'] = el }} className="detail-section">
                  <div className="section-header">
                    <Settings size={20} />
                    <h2>Data Selectors</h2>
                    {!params.selectors && (
                      <button onClick={() => handleParamsUpdate({ ...params, use: {} })} className="btn btn-secondary" style={{ marginLeft: 'auto' }}>
                        Add Selectors
                      </button>
                    )}
                  </div>
                  {params.selectors && (
                    <>
                      <div className="info-grid">
                        <div className="info-item">
                          <label>Current Project</label>
                          <label className="checkbox-label">
                            <input type="checkbox" checked={!!params.selectors.currentProject} onChange={(e) => handleParamsUpdate({ ...params, use: { ...(params.selectors || {}), currentProject: e.target.checked ? (typeof params.selectors?.currentProject === 'object' ? params.selectors.currentProject : true) : undefined } })} />
                            <span>Enable</span>
                          </label>
                        </div>
                        <div className="info-item">
                          <label>App Config</label>
                          <label className="checkbox-label">
                            <input type="checkbox" checked={!!params.selectors.appConfig} onChange={(e) => handleParamsUpdate({ ...params, use: { ...(params.selectors || {}), appConfig: e.target.checked ? (typeof params.selectors?.appConfig === 'object' ? params.selectors.appConfig : true) : undefined } })} />
                            <span>Enable</span>
                          </label>
                        </div>
                        <div className="info-item">
                          <label>Items</label>
                          <label className="checkbox-label">
                            <input type="checkbox" checked={!!params.selectors.items} onChange={(e) => handleParamsUpdate({ ...params, use: { ...(params.selectors || {}), items: e.target.checked ? (typeof params.selectors?.items === 'object' ? params.selectors.items : true) : undefined } })} />
                            <span>Enable</span>
                          </label>
                        </div>
                        <div className="info-item">
                          <label>Selected Images</label>
                          <label className="checkbox-label">
                            <input type="checkbox" checked={!!params.selectors.selectedImages} onChange={(e) => handleParamsUpdate({ ...params, use: { ...(params.selectors || {}), selectedImages: e.target.checked ? (typeof params.selectors?.selectedImages === 'object' ? params.selectors.selectedImages : true) : undefined } })} />
                            <span>Enable</span>
                          </label>
                        </div>
                      </div>
                      <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                        <small style={{ color: 'var(--text-secondary)' }}>
                          Advanced selector configuration can be edited in the JSON editor below.
                        </small>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* UI Configuration Section */}
              {params.parser !== 'comfyui' && params.ui && (
                <div ref={(el) => { sectionRefs.current['ui-config'] = el }} className="detail-section">
                  <div className="section-header">
                    <Settings size={20} />
                    <h2>UI Configuration (Categories & Rows)</h2>
                  </div>
                  <div style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                    <p style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>
                      UI configuration allows you to organize parameters into categories and rows.
                      Use the JSON editor below to configure categories, rows, and parameter visibility.
                    </p>
                    <div style={{ marginTop: '12px' }}>
                      <strong>Available Categories:</strong>
                      <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
                        {Object.keys(params.ui).map(category => <li key={category}>{category}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              <div ref={(el) => { sectionRefs.current['comfyui'] = el }}>
                <WorkflowComfyUIConfig
                  params={params}
                  workflowJson={workflowJson}
                  handleParamsUpdate={handleParamsUpdate}
                  isFieldChanged={isFieldChanged}
                  workflowDragOver={workflowDragOver}
                  setWorkflowDragOver={setWorkflowDragOver}
                  setLogsServerUrl={setLogsServerUrl}
                  handleWorkflowFileUpload={handleWorkflowFileUpload}
                />
              </div>
            </>
          )}

          {/* Params JSON Editor */}
          <div ref={(el) => { sectionRefs.current['params-json'] = el }} className="detail-section">
            <div className="section-header">
              <Code2 size={20} />
              <h2>Parameters (params.json)</h2>
              <button
                onClick={() => setShowParamsJson((prev) => { const next = !prev; if (name) persistWorkflowDetailUI(name, detail.showWorkflowJson, next); return next })}
                className="btn-toggle"
              >
                {showParamsJson ? <EyeOff size={16} /> : <Eye size={16} />}
                {showParamsJson ? 'Hide' : 'Show'}
              </button>
            </div>
            {showParamsJson && (
              <>
                <div className="editor-container">
                  <Editor
                    key={editParamsJson ? 'editable' : 'readonly'}
                    height="500px"
                    language="json"
                    value={editParamsJson ? paramsText : JSON.stringify(params, null, 2)}
                    onChange={editParamsJson ? (value: string | undefined) => setParamsText(value || '') : undefined}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false }, fontSize: 14, lineNumbers: 'on', scrollBeyondLastLine: false,
                      automaticLayout: true, tabSize: 2, wordWrap: 'on', readOnly: !editParamsJson,
                      ...(editParamsJson ? { formatOnPaste: true, formatOnType: true } : {}),
                    }}
                  />
                </div>
                <div className="params-json-actions">
                  {!editParamsJson ? (
                    <button onClick={handleEditParamsJson} className="btn btn-secondary">Edit JSON</button>
                  ) : (
                    <>
                      <button onClick={handleSaveParamsJson} disabled={saving} className="btn btn-primary">
                        <Save size={16} />{saving ? 'Saving...' : 'Save JSON'}
                      </button>
                      <button onClick={handleCancelEditParamsJson} disabled={saving} className="btn btn-cancel">Cancel</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Workflow JSON Viewer */}
          {workflowJson && (
            <div ref={(el) => { sectionRefs.current['workflow-json'] = el }} className="detail-section">
              <div className="section-header">
                <FileJson size={20} />
                <h2>Workflow JSON</h2>
                <button
                  onClick={() => setShowWorkflowJson((prev) => { const next = !prev; if (name) persistWorkflowDetailUI(name, next, showParamsJson); return next })}
                  className="btn-toggle"
                >
                  {showWorkflowJson ? <EyeOff size={16} /> : <Eye size={16} />}
                  {showWorkflowJson ? 'Hide' : 'Show'}
                </button>
              </div>
              {showWorkflowJson && (
                <div className="editor-container">
                  <div className="code-viewer-wrapper" ref={setWorkflowScrollRef}>
                    <div ref={setWorkflowHighlightRef} className="syntax-highlight-background workflow-json-highlight">
                      <SyntaxHighlighter
                        language="json"
                        style={vscDarkPlus}
                        customStyle={{ margin: 0, padding: '1rem', background: 'transparent', minHeight: '100%' }}
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

        {/* Right Sidebar — sticky navigation */}
        <div className="hidden lg:block w-[200px] flex-shrink-0 sticky top-[8.5rem]">
          <nav className="flex flex-col bg-[#1a2332] border border-[#2d3a4a] rounded-xl p-3 gap-0.5">
            <p className="text-[14px] uppercase tracking-wider text-[#697784] font-semibold px-2.5 mb-2">Sections</p>
            {sidebarSections.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => scrollToSection(id)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-[14px] transition-all duration-150 ${
                  activeSection === id
                    ? 'bg-purple-700/20 text-purple-300 font-medium'
                    : 'text-[#8b9aab] hover:text-[#e8ecf1] hover:bg-[#243044]/50'
                }`}
              >
                <span className={activeSection === id ? 'text-purple-400' : 'text-[#697784]'}>{icon}</span>
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <WorkflowDetailModals
        name={name}
        params={params}
        originalParams={originalParams}
        workflowJson={workflowJson}
        showSaveModal={detail.showSaveModal}
        setShowSaveModal={detail.setShowSaveModal}
        showResetModal={detail.showResetModal}
        setShowResetModal={detail.setShowResetModal}
        fileParams={detail.fileParams}
        setFileParams={detail.setFileParams}
        hasExternalChanges={hasExternalChanges}
        externalParams={detail.externalParams}
        hasUnsavedChanges={hasUnsavedChanges}
        showSuccessMessage={detail.showSuccessMessage}
        showDuplicateModal={detail.showDuplicateModal}
        setShowDuplicateModal={setShowDuplicateModal}
        showDownloadModal={detail.showDownloadModal}
        setShowDownloadModal={setShowDownloadModal}
        showImportModal={detail.showImportModal}
        setShowImportModal={detail.setShowImportModal}
        importedParams={detail.importedParams}
        setImportedParams={detail.setImportedParams}
        importServerUrlPreserved={detail.importServerUrlPreserved}
        handleImportConfirm={handleImportConfirm}
        showHistoryModal={detail.showHistoryModal}
        setShowHistoryModal={detail.setShowHistoryModal}
        onHistoryRestored={detail.loadWorkflow}
        logsServerUrl={detail.logsServerUrl}
        setLogsServerUrl={setLogsServerUrl}
        showDependencyAudit={detail.showDependencyAudit}
        setShowDependencyAudit={setShowDependencyAudit}
        dependencyAuditCache={detail.dependencyAuditCache}
        setDependencyAuditCache={detail.setDependencyAuditCache}
        showTestWorkflow={detail.showTestWorkflow}
        setShowTestWorkflow={setShowTestWorkflow}
        testServerUrls={detail.testServerUrls}
        testWorkflowHook={detail.testWorkflowHook}
        handleSaveConfirm={detail.handleSaveConfirm}
        handleReload={detail.handleReload}
        handleOverwrite={detail.handleOverwrite}
        handleResetConfirm={detail.handleResetConfirm}
        onUpdate={onUpdate}
        persistLastRun={detail.persistLastRun}
      />

      {/* Floating Apply bar */}
      {hasUnsavedChanges && (
        <div className="floating-apply-bar">
          <span className="floating-apply-bar-label">You have unsaved changes</span>
          <button onClick={handleDiscardChanges} disabled={saving} className="btn btn-secondary floating-apply-btn" title="Discard changes">
            <Undo2 size={16} /> Discard
          </button>
          <button onClick={handleSaveClick} disabled={saving} className="btn btn-primary floating-apply-btn" title="Save changes">
            <Save size={16} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {/* Unsaved changes navigation guard modal */}
      {showLeaveModal && (
        <div className="modal-overlay modal-overlay--blur" onClick={() => { setShowLeaveModal(false); pendingNavRef.current = null }}>
          <div
            className="flex flex-col overflow-hidden rounded-xl border border-[#2d3a4a] bg-[#1a2332] shadow-2xl"
            style={{ maxWidth: '400px', width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 px-5 pt-5 pb-0">
              <AlertCircle size={18} className="text-yellow-400 flex-shrink-0" />
              <h2 className="text-base font-semibold text-[#e8ecf1] m-0">Unsaved Changes</h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-[#8b9aab] m-0 leading-relaxed">
                You have unsaved changes that will be lost if you leave this page.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button onClick={() => { setShowLeaveModal(false); pendingNavRef.current = null }} className="px-3 py-1.5 text-sm rounded-lg bg-[#243044] text-[#b8c4d0] hover:text-[#e8ecf1] hover:bg-[#2d3a4a] transition-colors border border-[#354556]">
                Stay
              </button>
              <button onClick={handleLeaveConfirm} className="px-3 py-1.5 text-sm rounded-lg bg-red-500/10 text-red-400/80 hover:bg-red-500/20 hover:text-red-300 transition-colors border border-red-500/15">
                Discard & Leave
              </button>
              <button
                onClick={async () => {
                  await handleSaveClick()
                  handleLeaveConfirm()
                }}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-purple-700 text-white hover:bg-purple-800 transition-colors disabled:opacity-50"
              >
                <Save size={13} /> Save & Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
