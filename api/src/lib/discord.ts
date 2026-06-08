// Proxy is handled globally by src/lib/proxy.ts (HTTP_PROXY / HTTPS_PROXY / NO_PROXY).
// This module just formats payloads and posts to the webhook URL.

import { config } from '../config/index.js'

const WEBHOOK_URL = config.DISCORD_WEBHOOK_URL ?? ''

export type DiscordEmbed = {
  title?: string
  description?: string
  color?: number
  fields?: { name: string; value: string; inline?: boolean }[]
  footer?: { text: string }
  timestamp?: string
}

export type DiscordPayload = {
  content?: string
  username?: string
  embeds?: DiscordEmbed[]
}

export async function sendWebhook(payload: DiscordPayload): Promise<void> {
  if (!WEBHOOK_URL) return

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Discord webhook failed: ${res.status} ${text}`)
  }
}

const COLORS = {
  red: 0xed4245,
  yellow: 0xfee75c,
  green: 0x57f287,
  blue: 0x5865f2,
}

export async function sendServerReport(opts: {
  serverName: string
  serverUrl: string
  reporter: string
  message: string
}): Promise<void> {
  await sendWebhook({
    username: 'coffee-maker',
    embeds: [
      {
        title: '🔧 Server Issue Report',
        color: COLORS.yellow,
        description: opts.message,
        fields: [
          { name: 'Server', value: opts.serverName, inline: true },
          { name: 'Reporter', value: opts.reporter, inline: true },
          { name: 'URL', value: opts.serverUrl, inline: false },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'coffee-maker · server report' },
      },
    ],
  })
}

const FINDING_EMOJI: Record<string, string> = { bad: '🔴', warn: '🟡', info: 'ℹ️' }

export async function sendJobReport(opts: {
  jobId: string
  jobType: 'wf' | 'lora'
  jobName: string | null
  status: string
  server: string | null
  reporter: string
  message: string
  findings?: Array<{ code: string; severity: 'info' | 'warn' | 'bad'; title: string; body: string }>
}): Promise<void> {
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Job', value: opts.jobName ?? opts.jobId, inline: true },
    { name: 'Type', value: opts.jobType === 'wf' ? 'Workflow' : 'LoRA training', inline: true },
    { name: 'Status', value: opts.status, inline: true },
    { name: 'Reporter', value: opts.reporter, inline: true },
  ]
  if (opts.server) fields.push({ name: 'Server', value: opts.server, inline: true })
  fields.push({ name: 'Job ID', value: opts.jobId, inline: false })
  if (opts.findings && opts.findings.length > 0) {
    const text = opts.findings
      .map((f) => `${FINDING_EMOJI[f.severity] ?? '•'} **${f.title}** \`${f.code}\``)
      .join('\n')
    fields.push({ name: 'Seto Findings', value: text.slice(0, 1024), inline: false })
  }

  await sendWebhook({
    username: 'coffee-maker',
    embeds: [
      {
        title: '🐞 Job Issue Report',
        color: COLORS.yellow,
        description: opts.message,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'coffee-maker · job report' },
      },
    ],
  })
}

export async function sendCalendarReminder(opts: {
  title: string
  category: string
  date: string
  start: string
  end: string
  owner: string | null
  location: string | null
  minutesUntil: number
}): Promise<void> {
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'When', value: `${opts.date} · ${opts.start}–${opts.end}`, inline: true },
    { name: 'Category', value: opts.category, inline: true },
  ]
  if (opts.owner) fields.push({ name: 'Owner', value: opts.owner, inline: true })
  if (opts.location) fields.push({ name: 'Location', value: opts.location, inline: true })

  await sendWebhook({
    username: 'coffee-maker',
    embeds: [
      {
        title: `🔔 Upcoming: ${opts.title}`,
        color: COLORS.blue,
        description: `Starts in about ${opts.minutesUntil} minute${opts.minutesUntil === 1 ? '' : 's'}.`,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'coffee-maker · calendar reminder' },
      },
    ],
  })
}

export type ServerAlertEvent =
  | { kind: 'down'; serverId: string; name: string; url: string; reason: string }
  | { kind: 'recovered'; serverId: string; name: string; url: string; downForMs: number }
  | {
      kind: 'still_down'
      serverId: string
      name: string
      url: string
      downForMs: number
      reminder: number
    }

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export async function sendServerStatusAlert(events: ServerAlertEvent[]): Promise<void> {
  if (events.length === 0) return

  const down = events.filter((e) => e.kind === 'down')
  const recovered = events.filter((e) => e.kind === 'recovered')
  const reminders = events.filter((e) => e.kind === 'still_down')

  const embeds: DiscordEmbed[] = []

  if (down.length > 0) {
    embeds.push({
      title: down.length === 1 ? '🚨 Server Down' : `🚨 Servers Down (${down.length})`,
      color: COLORS.red,
      description: down.map((e) => `**${e.name}** — ${e.reason}\n\`${e.url}\``).join('\n\n'),
      timestamp: new Date().toISOString(),
      footer: { text: 'coffee-maker · health monitor' },
    })
  }

  if (recovered.length > 0) {
    embeds.push({
      title:
        recovered.length === 1
          ? '✅ Server Recovered'
          : `✅ Servers Recovered (${recovered.length})`,
      color: COLORS.green,
      description: recovered
        .map((e) => `**${e.name}** — was down for ${fmtDuration(e.downForMs)}\n\`${e.url}\``)
        .join('\n\n'),
      timestamp: new Date().toISOString(),
      footer: { text: 'coffee-maker · health monitor' },
    })
  }

  if (reminders.length > 0) {
    embeds.push({
      title: reminders.length === 1 ? '⏰ Still Down' : `⏰ Still Down (${reminders.length})`,
      color: COLORS.yellow,
      description: reminders
        .map(
          (e) =>
            `**${e.name}** — down for ${fmtDuration(e.downForMs)} (reminder #${e.reminder})\n\`${e.url}\``,
        )
        .join('\n\n'),
      timestamp: new Date().toISOString(),
      footer: { text: 'coffee-maker · health monitor' },
    })
  }

  await sendWebhook({ username: 'coffee-maker', embeds })
}
