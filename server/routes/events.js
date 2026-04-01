import { Router } from 'express';
import { readEvents, addEvent, updateEvent, deleteEvent } from '../lib/eventsFs.js';

const VALID_COLORS = new Set([
  '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899',
]);

/**
 * Validate and sanitize event fields from request body.
 * Returns { ok, fields, error }.
 */
function parseEventBody(body) {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
  if (!title) return { ok: false, error: 'title is required' };

  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date : null;
  if (!date) return { ok: false, error: 'date must be YYYY-MM-DD' };

  const hour = Number.isInteger(body.hour) && body.hour >= 0 && body.hour <= 23
    ? body.hour : null;
  if (hour === null) return { ok: false, error: 'hour must be 0–23' };

  const durationHours = typeof body.durationHours === 'number' && body.durationHours > 0
    ? body.durationHours : null;
  if (!durationHours) return { ok: false, error: 'durationHours must be > 0' };

  const affectedServers = Array.isArray(body.affectedServers)
    ? body.affectedServers
        .filter((s) => typeof s === 'string' && s.trim().length > 0)
        .map((s) => s.trim())
        .slice(0, 20)
    : [];

  const discordReminder = typeof body.discordReminder === 'boolean' ? body.discordReminder : false;

  const color = typeof body.color === 'string' && VALID_COLORS.has(body.color)
    ? body.color : '#f59e0b';

  return { ok: true, fields: { title, date, hour, durationHours, affectedServers, discordReminder, color } };
}

/** Strip internal reminder-tracking fields before sending to client. */
function toPublic(event) {
  const { _reminder1daySent, _reminder30minSent, ...pub } = event;
  return pub;
}

export function createEventsRouter(config) {
  const { dataDir } = config;
  const router = Router();

  /** GET /api/events — list all events, newest first */
  router.get('/events', async (_req, res) => {
    try {
      const events = await readEvents(dataDir);
      // Sort by date ascending so clients get chronological order
      events.sort((a, b) => {
        const ta = new Date(`${a.date}T${String(a.hour).padStart(2, '0')}:00:00`).getTime();
        const tb = new Date(`${b.date}T${String(b.hour).padStart(2, '0')}:00:00`).getTime();
        return ta - tb;
      });
      res.json(events.map(toPublic));
    } catch (err) {
      console.error('[Events] Read error:', err.message);
      res.status(500).json({ error: 'Failed to read events' });
    }
  });

  /** POST /api/events — create a new event */
  router.post('/events', async (req, res) => {
    const parsed = parseEventBody(req.body || {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const event = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ...parsed.fields,
      createdAt: new Date().toISOString(),
      _reminder1daySent: false,
      _reminder30minSent: false,
    };

    try {
      await addEvent(dataDir, event);
      res.status(201).json(toPublic(event));
    } catch (err) {
      console.error('[Events] Create error:', err.message);
      res.status(500).json({ error: 'Failed to create event' });
    }
  });

  /** PUT /api/events/:id — full replace of mutable fields */
  router.put('/events/:id', async (req, res) => {
    const { id } = req.params;
    const parsed = parseEventBody(req.body || {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    // Reset reminder flags whenever the event is edited (date/time may have changed)
    const patch = { ...parsed.fields, _reminder1daySent: false, _reminder30minSent: false };

    try {
      const updated = await updateEvent(dataDir, id, patch);
      if (!updated) return res.status(404).json({ error: 'Event not found' });
      res.json(toPublic(updated));
    } catch (err) {
      console.error('[Events] Update error:', err.message);
      res.status(500).json({ error: 'Failed to update event' });
    }
  });

  /** DELETE /api/events/:id */
  router.delete('/events/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const deleted = await deleteEvent(dataDir, id);
      if (!deleted) return res.status(404).json({ error: 'Event not found' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[Events] Delete error:', err.message);
      res.status(500).json({ error: 'Failed to delete event' });
    }
  });

  return router;
}
