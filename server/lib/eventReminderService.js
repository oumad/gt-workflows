import { readEvents, updateEvent } from './eventsFs.js';

const CHECK_INTERVAL_MS = 60_000; // check every minute
const DISCORD_COLOR_PURPLE = 0x7A4DB0;

function formatDuration(hours) {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? '1 day' : `${days} days`;
  }
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

class EventReminderService {
  constructor() {
    this.dataDir = null;
    this.appConfig = null;
    this.timer = null;
  }

  init(dataDir, appConfig) {
    this.dataDir = dataDir;
    this.appConfig = appConfig;
    this.timer = setInterval(() => {
      this._checkReminders().catch((err) =>
        console.error('[EventReminder] Check error:', err.message)
      );
    }, CHECK_INTERVAL_MS);
    console.log('[EventReminder] Started — checking event reminders every minute');
  }

  async _checkReminders() {
    if (!this.dataDir) return;
    const events = await readEvents(this.dataDir);
    const now = Date.now();

    for (const event of events) {
      if (!event.discordReminder) continue;

      // Compute event start timestamp as local server time
      const [year, month, day] = event.date.split('-').map(Number);
      const eventDate = new Date(year, month - 1, day, event.hour, 0, 0, 0);
      const eventTs = eventDate.getTime();

      // Skip past events
      if (eventTs <= now) continue;

      const timeUntil = eventTs - now;
      const oneDay = 24 * 60 * 60 * 1000;
      const thirtyMin = 30 * 60 * 1000;

      // 1-day reminder: fire once as soon as the event is ≤24h away
      if (!event._reminder1daySent && timeUntil <= oneDay) {
        try {
          await this._sendReminder(event, '1 day');
          await updateEvent(this.dataDir, event.id, { _reminder1daySent: true });
        } catch (err) {
          console.error(`[EventReminder] Failed to send 1-day reminder for "${event.title}":`, err.message);
        }
      }

      // 30-min reminder: fire once as soon as the event is ≤30min away
      if (!event._reminder30minSent && timeUntil <= thirtyMin) {
        try {
          await this._sendReminder(event, '30 minutes');
          await updateEvent(this.dataDir, event.id, { _reminder30minSent: true });
        } catch (err) {
          console.error(`[EventReminder] Failed to send 30-min reminder for "${event.title}":`, err.message);
        }
      }
    }
  }

  async _sendReminder(event, timeLabel) {
    const webhookUrl = this.appConfig?.discordWebhookUrl;
    if (!webhookUrl) {
      console.log(`[EventReminder] No Discord webhook configured — skipping reminder for "${event.title}"`);
      return;
    }

    const appName = this.appConfig?.appName;
    const fields = [
      {
        name: '📅 Date & Time',
        value: `${event.date} at ${String(event.hour).padStart(2, '0')}:00`,
        inline: true,
      },
      {
        name: '⏱️ Duration',
        value: formatDuration(event.durationHours),
        inline: true,
      },
    ];

    if (event.affectedServers?.length > 0) {
      fields.push({
        name: `🖥️ Affected Server${event.affectedServers.length > 1 ? 's' : ''}`,
        value: event.affectedServers.join('\n'),
        inline: false,
      });
    }

    const embed = {
      title: `📅 Reminder (in ${timeLabel}): ${event.title}`,
      color: DISCORD_COLOR_PURPLE,
      fields,
      timestamp: new Date().toISOString(),
    };
    if (appName) embed.footer = { text: appName };

    const payload = JSON.stringify({ embeds: [embed] });
    console.log(`[EventReminder] Sending Discord reminder for "${event.title}" (in ${timeLabel})`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      if (res.ok) {
        console.log(`[EventReminder] Reminder sent (HTTP ${res.status})`);
      } else {
        throw new Error(`Discord webhook returned HTTP ${res.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

// Singleton — initialized in server/index.js alongside monitoringService
export const eventReminderService = new EventReminderService();
