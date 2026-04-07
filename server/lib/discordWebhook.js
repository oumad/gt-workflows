import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * POST a JSON payload to a Discord webhook URL via curl.
 * curl natively respects HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars,
 * so this works correctly behind a proxy without extra configuration.
 */
export async function sendDiscordWebhook(webhookUrl, payload) {
  await execFileAsync('curl', [
    '--silent', '--show-error',
    '--max-time', '15',
    '--request', 'POST',
    '--header', 'Content-Type: application/json',
    '--data', payload,
    webhookUrl,
  ]);
}
