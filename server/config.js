import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const GT_WF_AUTH = process.env.GT_WF_AUTH;
const AUTH_USER = process.env.GT_WF_AUTH_USER;
const AUTH_PASS = process.env.GT_WF_AUTH_PASSWORD;
// Auth is enabled only when GT_WF_AUTH is not explicitly "false" and credentials are set
const AUTH_ENABLED =
  GT_WF_AUTH !== 'false' &&
  typeof AUTH_USER === 'string' &&
  AUTH_USER.length > 0 &&
  typeof AUTH_PASS === 'string';

export const config = Object.freeze({
  port: 3011,
  host: process.env.HOST || '0.0.0.0',
  workflowsPath: process.env.GT_WORKFLOWS_PATH
    ? path.resolve(process.env.GT_WORKFLOWS_PATH)
    : path.join(__dirname, '../data/gt-workflows'),
  redisUrl: process.env.REDIS_URL || process.env.REDIS_HOST,
  bullQueueName: process.env.BULL_QUEUE_NAME || 'workflow-studio-comfyui-process-queue',
  auth: {
    enabled: AUTH_ENABLED,
    user: AUTH_USER,
    pass: AUTH_PASS,
  },
  sessionMaxTime: Math.max(60, parseInt(process.env.SESSION_MAX_TIME, 10) || 86400),
});
