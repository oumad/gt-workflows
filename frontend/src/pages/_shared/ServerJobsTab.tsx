import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import {
  type Row,
  type WfJob,
  type LoraJob,
  wfToRow,
  loraToRow,
  JobModal,
  LiveJobsTables,
} from '../jobs/shared'
import type { Server as ServerType } from '../../types'

type JobsResponse =
  | { type: 'workflow'; active: WfJob[]; waiting: WfJob[] }
  | { type: 'lora'; active: LoraJob[]; waiting: LoraJob[] }

export function ServerJobs({ server }: { server: ServerType }) {
  const [data, setData] = useState<JobsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [openRow, setOpenRow] = useState<Row | null>(null)
  const [avgDurations, setAvgDurations] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr(null)
    api
      .get<JobsResponse>(`/api/servers/${server.id}/jobs`)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load jobs')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [server.id])

  // Per-workflow avg duration powers the ETA column. Only meaningful for
  // workflow servers (LoRA jobs don't have a comparable per-name lookup).
  useEffect(() => {
    if (server.type === 'lora') return
    let cancelled = false
    api
      .get<Record<string, number>>('/api/wf-jobs/avg-duration')
      .then((d) => {
        if (!cancelled) setAvgDurations(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [server.type])

  if (loading)
    return (
      <div className="card card-pad" style={{ color: 'var(--ink-3)' }}>
        Loading jobs…
      </div>
    )
  if (err) return <div className="alert alert-error">{err}</div>
  if (!data) return null

  const now = Date.now()
  const running =
    data.type === 'workflow'
      ? data.active.map((j) => wfToRow(j, now))
      : data.active.map((j) => loraToRow(j, now))
  const waiting =
    data.type === 'workflow'
      ? data.waiting.map((j) => wfToRow(j, now))
      : data.waiting.map((j) => loraToRow(j, now))

  return (
    <>
      <LiveJobsTables
        running={running}
        waiting={waiting}
        onSelect={setOpenRow}
        loading={loading}
        hideServer
        avgDurations={server.type === 'workflow' ? avgDurations : undefined}
      />
      {openRow && <JobModal row={openRow} onClose={() => setOpenRow(null)} />}
    </>
  )
}
