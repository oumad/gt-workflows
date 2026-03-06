import { Link } from 'react-router-dom'
import { ArrowLeft, Save, FileJson, Settings, Eye, EyeOff, RotateCcw, AlertCircle, Copy, Download, Package, Play } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import Editor from '@monaco-editor/react'
import { useWorkflowDetail } from './useWorkflowDetail'
import { WorkflowGeneralInfo } from './WorkflowGeneralInfo'
import { WorkflowComfyUIConfig } from './WorkflowComfyUIConfig'
import { WorkflowDetailModals } from './WorkflowDetailModals'
import './WorkflowDetail.css'

interface WorkflowDetailProps {
  onUpdate: () => void
}

export function WorkflowDetail({ onUpdate }: WorkflowDetailProps) {
  const detail = useWorkflowDetail(onUpdate)
  const {
    name, params, originalParams, workflowJson, loading, saving, error,
    showWorkflowJson, setShowWorkflowJson, showParamsJson, setShowParamsJson,
    editParamsJson, paramsText, setParamsText,
    workflowHighlightRef, setWorkflowHighlightRef, workflowScrollRef, setWorkflowScrollRef,
    iconError, setIconError, iconDragOver, setIconDragOver,
    workflowDragOver, setWorkflowDragOver, iconVersion,
    hasExternalChanges, hasUnsavedChanges,
    lastTestRun, lastTestRunStatus, lastAuditRun, lastAuditRunStatus,
    handleParamsUpdate, handleSaveClick, handleResetClick,
    handleEditParamsJson, handleCancelEditParamsJson, handleSaveParamsJson,
    handleIconDelete, handleIconUpload, handleWorkflowFileUpload,
    setLogsServerUrl, setShowTestWorkflow, setShowDependencyAudit,
    setShowDuplicateModal, setShowDownloadModal,
    isFieldChanged, persistWorkflowDetailUI,
  } = detail

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

  return (
    <div className={`workflow-detail ${hasUnsavedChanges ? 'has-floating-apply' : ''}`}>
      {/* Header */}
      <div className="detail-header">
        <Link to="/workflows" className="btn btn-secondary"><ArrowLeft size={16} /> Back</Link>
        <div className="workflow-title-section">
          <h1 className="page-title"><FileJson size={24} />{params?.label || name}</h1>
        </div>
        <div className="header-actions">
          {params?.parser === 'comfyui' && workflowJson && params.comfyui_config?.serverUrl && (
            <>
              <button onClick={() => setShowTestWorkflow(true)} disabled={loading} className="btn btn-secondary" title="Test-execute workflow on ComfyUI server">
                <Play size={16} /> Test
              </button>
              <button onClick={() => setShowDependencyAudit(true)} disabled={loading} className="btn btn-secondary" title="Audit workflow dependencies against ComfyUI server(s)">
                <Package size={16} /> Audit
              </button>
            </>
          )}
          <button onClick={() => setShowDuplicateModal(true)} disabled={loading} className="btn btn-secondary" title="Duplicate workflow">
            <Copy size={16} /> Duplicate
          </button>
          <button onClick={() => setShowDownloadModal(true)} disabled={loading} className="btn btn-secondary" title="Download workflow">
            <Download size={16} /> Download
          </button>
          <button onClick={handleResetClick} disabled={loading || saving} className="btn btn-secondary" title="Reset to saved version">
            <RotateCcw size={16} /> Reset
          </button>
          {hasExternalChanges && (
            <div className="external-changes-indicator" title="params.json has been modified externally">
              <AlertCircle size={16} />
              <span>External Changes</span>
            </div>
          )}
          <button
            onClick={handleSaveClick}
            disabled={saving}
            className={`btn btn-primary ${hasUnsavedChanges ? 'has-changes' : ''}`}
            title={hasUnsavedChanges ? 'Apply changes' : 'View current state and apply'}
          >
            <Save size={16} /> {saving ? 'Applying...' : 'Apply'}
            {hasUnsavedChanges && <span className="unsaved-indicator" />}
          </button>
        </div>
      </div>

      {error && <div className="error-banner" role="alert"><p>{error}</p></div>}

      <div className="detail-content">
        {params && (
          <>
            <WorkflowGeneralInfo
              name={name || ''}
              params={params}
              handleParamsUpdate={handleParamsUpdate}
              isFieldChanged={isFieldChanged}
              iconError={iconError}
              setIconError={setIconError}
              iconDragOver={iconDragOver}
              setIconDragOver={setIconDragOver}
              iconVersion={iconVersion}
              handleIconDelete={handleIconDelete}
              handleIconUpload={handleIconUpload}
              lastTestRun={lastTestRun}
              lastTestRunStatus={lastTestRunStatus}
              lastAuditRun={lastAuditRun}
              lastAuditRunStatus={lastAuditRunStatus}
            />

            {/* Dashboard Config Section */}
            {(params.dashboard || params.parser !== 'comfyui') && (
              <div className="detail-section">
                <div className="section-header">
                  <Settings size={20} />
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

            {/* Use/Selectors Section */}
            {(params.use || params.parser !== 'comfyui') && (
              <div className="detail-section">
                <div className="section-header">
                  <Settings size={20} />
                  <h2>Data Selectors</h2>
                  {!params.use && (
                    <button onClick={() => handleParamsUpdate({ ...params, use: {} })} className="btn btn-secondary" style={{ marginLeft: 'auto' }}>
                      Add Selectors
                    </button>
                  )}
                </div>
                {params.use && (
                  <>
                    <div className="info-grid">
                      <div className="info-item">
                        <label>Current Project</label>
                        <label className="checkbox-label">
                          <input type="checkbox" checked={!!params.use.currentProject} onChange={(e) => handleParamsUpdate({ ...params, use: { ...(params.use || {}), currentProject: e.target.checked ? (typeof params.use?.currentProject === 'object' ? params.use.currentProject : true) : undefined } })} />
                          <span>Enable</span>
                        </label>
                      </div>
                      <div className="info-item">
                        <label>App Config</label>
                        <label className="checkbox-label">
                          <input type="checkbox" checked={!!params.use.appConfig} onChange={(e) => handleParamsUpdate({ ...params, use: { ...(params.use || {}), appConfig: e.target.checked ? (typeof params.use?.appConfig === 'object' ? params.use.appConfig : true) : undefined } })} />
                          <span>Enable</span>
                        </label>
                      </div>
                      <div className="info-item">
                        <label>Items</label>
                        <label className="checkbox-label">
                          <input type="checkbox" checked={!!params.use.items} onChange={(e) => handleParamsUpdate({ ...params, use: { ...(params.use || {}), items: e.target.checked ? (typeof params.use?.items === 'object' ? params.use.items : true) : undefined } })} />
                          <span>Enable</span>
                        </label>
                      </div>
                      <div className="info-item">
                        <label>Selected Images</label>
                        <label className="checkbox-label">
                          <input type="checkbox" checked={!!params.use.selectedImages} onChange={(e) => handleParamsUpdate({ ...params, use: { ...(params.use || {}), selectedImages: e.target.checked ? (typeof params.use?.selectedImages === 'object' ? params.use.selectedImages : true) : undefined } })} />
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
              <div className="detail-section">
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
          </>
        )}

        {/* Params JSON Editor */}
        <div className="detail-section">
          <div className="section-header">
            <Settings size={20} />
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
                    <button onClick={handleCancelEditParamsJson} disabled={saving} className="btn btn-secondary">Cancel</button>
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
                    {/* @ts-expect-error - react-syntax-highlighter has type compatibility issues */}
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
          <button onClick={handleSaveClick} disabled={saving} className="btn btn-primary floating-apply-btn" title="Apply changes">
            <Save size={16} /> {saving ? 'Applying...' : 'Apply'}
          </button>
        </div>
      )}
    </div>
  )
}
