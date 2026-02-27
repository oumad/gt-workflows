import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const GT_WF_AUTH = process.env.GT_WF_AUTH;
const ADMIN_USER = process.env.GT_WF_ADMIN_USER;
const ADMIN_PASSWORD = process.env.GT_WF_ADMIN_PASSWORD;
const GUEST_USER = process.env.GT_WF_GUEST_USER;
const GUEST_PASSWORD = process.env.GT_WF_GUEST_PASSWORD;
/** When true (default), job-stats user names are anonymised for guest users. Set to false or 0 to disable. */
const ANONYMIZE_JOB_STATS_USERS =
  process.env.GT_WF_ANONYMIZE_JOB_STATS_USERS !== 'false' && process.env.GT_WF_ANONYMIZE_JOB_STATS_USERS !== '0';

const hasAdmin =
  typeof ADMIN_USER === 'string' &&
  ADMIN_USER.length > 0 &&
  typeof ADMIN_PASSWORD === 'string' &&
  ADMIN_PASSWORD.length > 0;
const hasGuest =
  typeof GUEST_USER === 'string' &&
  GUEST_USER.length > 0 &&
  typeof GUEST_PASSWORD === 'string' &&
  GUEST_PASSWORD.length > 0;
const AUTH_ENABLED = GT_WF_AUTH !== 'false' && (hasAdmin || hasGuest);

/** List of { user, pass } pairs for validation; used to set req.authUsername to the matched username. */
const AUTH_CREDENTIALS = [];
if (hasAdmin) AUTH_CREDENTIALS.push({ user: ADMIN_USER, pass: ADMIN_PASSWORD });
if (hasGuest) AUTH_CREDENTIALS.push({ user: GUEST_USER, pass: GUEST_PASSWORD });

const dataDir = path.join(__dirname, '..', 'data');
export const config = Object.freeze({
  port: 3011,
  host: process.env.HOST || '0.0.0.0',
  adminUser: ADMIN_USER || null,
  workflowsPath: process.env.GT_WORKFLOWS_PATH
    ? path.resolve(process.env.GT_WORKFLOWS_PATH)
    : path.join(__dirname, '../data/gt-workflows'),
  /** Directory for app state (e.g. user preferences). One JSON file per user. */
  preferencesPath: process.env.GT_PREFERENCES_PATH
    ? path.resolve(process.env.GT_PREFERENCES_PATH)
    : path.join(dataDir, 'preferences'),
  redisUrl: process.env.REDIS_URL || process.env.REDIS_HOST,
  bullQueueName: process.env.BULL_QUEUE_NAME || 'workflow-studio-comfyui-process-queue',
  auth: {
    enabled: AUTH_ENABLED,
    credentials: AUTH_CREDENTIALS,
  },
  sessionMaxTime: Math.max(60, parseInt(process.env.SESSION_MAX_TIME, 10) || 86400),
  guestUser: GUEST_USER || null,
  anonymiseJobStatsUsers: ANONYMIZE_JOB_STATS_USERS,
});
