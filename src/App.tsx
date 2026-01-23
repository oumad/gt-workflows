import { useState, useEffect, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'
import { Workflow } from './types'
import { listWorkflows } from './api/workflows'
import WorkflowList from './components/WorkflowList'
import WorkflowDetail from './components/WorkflowDetail'
import WorkflowCreate from './components/WorkflowCreate'
import Settings from './components/Settings'
import './App.css'

function App() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadingRef = useRef(false)

  useEffect(() => {
    loadWorkflows()
  }, [])

  const loadWorkflows = async () => {
    // Prevent concurrent requests
    if (loadingRef.current) {
      return
    }

    try {
      loadingRef.current = true
      setLoading(true)
      setError(null)
      const data = await listWorkflows()
      setWorkflows(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflows')
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }

  return (
    <Router>
      <div className="app">
        <header className="app-header">
          <div className="header-content">
            <h1>GT Workflows Manager</h1>
            <nav>
              <Link to="/" className="nav-link">Workflows</Link>
              <Link to="/create" className="nav-link">Create New</Link>
              <Link to="/settings" className="nav-link">Settings</Link>
            </nav>
          </div>
        </header>

        <main className="app-main">
          <Routes>
            <Route
              path="/"
              element={
                <WorkflowList
                  workflows={workflows}
                  loading={loading}
                  error={error}
                  onRefresh={loadWorkflows}
                />
              }
            />
            <Route
              path="/workflow/:name"
              element={<WorkflowDetail onUpdate={loadWorkflows} />}
            />
            <Route
              path="/create"
              element={<WorkflowCreate onCreated={loadWorkflows} />}
            />
            <Route
              path="/settings"
              element={<Settings />}
            />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

export default App

