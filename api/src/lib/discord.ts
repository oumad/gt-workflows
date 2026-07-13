// Proxy is handled globally by src/lib/proxy.ts (HTTP_PROXY / HTTPS_PROXY / NO_PROXY).
// This module just formats payloads and posts to the webhook URL.

import { config } from '../config/index.js'
import { fmtDurationMs } from './format.js'
import { portOf } from './serverUrl.js'

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

  // Plain fetch on purpose (internet target — goes through the proxy). The
  // timeout keeps a wedged proxy from stalling the alert path / sync tick.
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
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

const FINDING_EMOJI: Record<string, string> = { bad: '🔴', warn: '🟡', info: 'ℹ️', ok: '🟢' }

export async function sendServerReport(opts: {
  serverName: string
  serverUrl: string
  reporter: string
  message: string
  /** Seto findings snapshot — included so the Discord report carries the
   *  same diagnosis the reporter was looking at. */
  findings?: { severity: string; title: string }[]
}): Promise<void> {
  const fields = [
    { name: 'Server', value: opts.serverName, inline: true },
    { name: 'Reporter', value: opts.reporter, inline: true },
    { name: 'URL', value: opts.serverUrl, inline: false },
  ]
  if (opts.findings && opts.findings.length > 0) {
    fields.push({
      name: 'Seto checks',
      // Discord caps embed field values at 1024 chars — trim defensively.
      value: opts.findings
        .slice(0, 12)
        .map((f) => `${FINDING_EMOJI[f.severity] ?? '•'} ${f.title}`)
        .join('\n')
        .slice(0, 1024),
      inline: false,
    })
  }
  await sendWebhook({
    username: 'coffee-maker',
    embeds: [
      {
        title: '🔧 Server Issue Report',
        color: COLORS.yellow,
        description: opts.message,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'coffee-maker · server report' },
      },
    ],
  })
}

export async function sendJobReport(opts: {
  jobId: string
  jobType: 'wf' | 'lora'
  jobName: string | null
  status: string
  server: string | null
  reporter: string
  message: string
  findings?: Array<{
    code: string
    severity: 'ok' | 'info' | 'warn' | 'bad'
    title: string
    body: string
  }>
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

// Server (physical host) vs Service (a ported process on it) — the same URL-
// shape rule the rest of the app uses: a port means service, port-less means
// host. Lets the alert say which kind is down instead of a generic "Server".
function recordKind(url: string): 'Server' | 'Service' {
  return portOf(url) ? 'Service' : 'Server'
}

/** Title noun for a batch: the shared kind when uniform, else generic. */
function titleNoun(events: ServerAlertEvent[]): string {
  const kinds = new Set(events.map((e) => recordKind(e.url)))
  return kinds.size === 1 ? [...kinds][0]! : 'Record'
}

/** One embed per non-empty event bucket. Emoji/verb/colour and the per-event
 *  line vary by bucket; title pluralisation+count and footer/timestamp are
 *  shared. Generic over the narrowed event type so each `line` sees its variant. */
function alertEmbed<E extends ServerAlertEvent>(
  emoji: string,
  verb: string,
  color: number,
  events: E[],
  line: (e: E) => string,
): DiscordEmbed | null {
  if (events.length === 0) return null
  const noun = titleNoun(events)
  const many = events.length > 1
  return {
    title: `${emoji} ${noun}${many ? 's' : ''} ${verb}${many ? ` (${events.length})` : ''}`,
    color,
    description: events.map(line).join('\n\n'),
    timestamp: new Date().toISOString(),
    footer: { text: 'coffee-maker · health monitor' },
  }
}

export async function sendServerStatusAlert(events: ServerAlertEvent[]): Promise<void> {
  if (events.length === 0) return

  const embeds = [
    alertEmbed(
      '🚨',
      'Down',
      COLORS.red,
      events.filter((e) => e.kind === 'down'),
      (e) => `**${e.name}** · ${recordKind(e.url)} — ${e.reason}\n\`${e.url}\``,
    ),
    alertEmbed(
      '✅',
      'Recovered',
      COLORS.green,
      events.filter((e) => e.kind === 'recovered'),
      (e) =>
        `**${e.name}** · ${recordKind(e.url)} — was down for ${fmtDurationMs(e.downForMs)}\n\`${e.url}\``,
    ),
    alertEmbed(
      '⏰',
      'Still Down',
      COLORS.yellow,
      events.filter((e) => e.kind === 'still_down'),
      (e) =>
        `**${e.name}** · ${recordKind(e.url)} — down for ${fmtDurationMs(e.downForMs)} (reminder #${e.reminder})\n\`${e.url}\``,
    ),
  ].filter((x): x is DiscordEmbed => x !== null)

  await sendWebhook({ username: 'coffee-maker', embeds })
}
