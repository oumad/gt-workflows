/**
 * Analytics HTTP routes. Thin adapter onto services/analytics.ts — each
 * handler parses query params, calls the service, returns JSON. All SQL
 * lives in repositories/analytics.ts; all caching + response shaping lives
 * in services/analytics.ts.
 */
import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth.js'
import {
  parseDays,
  parseTop,
  parsePage,
  parseLimit,
  parsePerfMetric,
  parseTimeseriesGroup,
  parseDistGroup,
  parseEntityKind,
} from '../validators/analytics.js'
import * as analyticsService from '../services/analytics.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// ── GET /analytics — headline aggregates ──────────────
app.get('/', requireAuth, async (c) => {
  const days = parseDays(c.req.query('days'))
  return c.json(await analyticsService.mainAggregate(days))
})

// ── GET /analytics/duration-buckets ───────────────────
app.get('/duration-buckets', requireAuth, async (c) => {
  const days = parseDays(c.req.query('days'))
  return c.json(await analyticsService.durationBuckets(days))
})

// ── GET /analytics/perf-daily ─────────────────────────
app.get('/perf-daily', requireAuth, async (c) => {
  const days = parseDays(c.req.query('days'))
  const top = parseTop(c.req.query('top'))
  const metric = parsePerfMetric(c.req.query('metric') ?? 'runs')
  if (!metric) return c.json({ error: 'metric must be one of runs|dur|p95|fail' }, 400)
  return c.json(await analyticsService.perfDaily(days, top, metric))
})

// ── GET /analytics/by-user ────────────────────────────
app.get('/by-user', requireAuth, async (c) => {
  const days = parseDays(c.req.query('days'))
  return c.json(await analyticsService.byUser(days))
})

// ── GET /analytics/by-error ───────────────────────────
app.get('/by-error', requireAuth, async (c) => {
  const days = parseDays(c.req.query('days'))
  return c.json(await analyticsService.byError(days))
})

// ── GET /analytics/timeseries ─────────────────────────
app.get('/timeseries', requireAuth, async (c) => {
  const days = parseDays(c.req.query('days'))
  const top = parseTop(c.req.query('top'))
  const groupBy = parseTimeseriesGroup(c.req.query('groupBy'))
  const metric = c.req.query('metric') === 'gpu' ? 'gpu' : 'runs'
  return c.json(await analyticsService.timeseries(groupBy, metric, days, top))
})

// ── GET /analytics/distribution ───────────────────────
app.get('/distribution', requireAuth, async (c) => {
  const days = parseDays(c.req.query('days'))
  const groupBy = parseDistGroup(c.req.query('groupBy'))
  return c.json(await analyticsService.distribution(groupBy, days))
})

// ── GET /analytics/slow-jobs ──────────────────────────
app.get('/slow-jobs', requireAuth, async (c) => {
  const limit = parseLimit(c.req.query('limit'))
  const page = parsePage(c.req.query('page'))
  const days = parseDays(c.req.query('days'))
  return c.json(await analyticsService.slowJobs(days, page, limit))
})

// ── GET /analytics/slow-jobs/diagnose ─────────────────
// Returns per-rule predicate match counts + the 5 longest WF jobs in range.
// Use when the Slow tab appears empty to confirm whether it's a data issue
// (every count zero) or a predicate / query bug (counts non-zero but total
// from /slow-jobs is zero).
app.get('/slow-jobs/diagnose', requireAuth, async (c) => {
  const days = parseDays(c.req.query('days'))
  return c.json(await analyticsService.slowJobsDiagnose(days))
})

// ── GET /analytics/entity ─────────────────────────────
app.get('/entity', requireAuth, async (c) => {
  const days = parseDays(c.req.query('days'))
  const kind = parseEntityKind(c.req.query('kind'))
  const id = (c.req.query('id') ?? '').trim()
  if (!kind || !id) {
    return c.json({ error: 'kind ∈ {error,workflow,server,user} and id are required' }, 400)
  }
  return c.json(await analyticsService.entityDrilldown(kind, id, days))
})

// ── GET /analytics/repartition ────────────────────────
app.get('/repartition', requireAuth, async (c) => {
  const days = parseDays(c.req.query('days'))
  return c.json(await analyticsService.repartition(days))
})

export default app
