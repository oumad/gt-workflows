import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { createBasicAuthMiddleware, createBlockGuestExceptStatsMiddleware, createRequireAdminMiddleware } from './middleware/auth.js';
import { createUploadMiddleware } from './middleware/upload.js';
import { readParamsJson, findWorkflowJson } from './services/workflowFs.js';
import { createPingRouter } from './routes/ping.js';
import { createServersRouter } from './routes/servers.js';
import { createWorkflowsRouter } from './routes/workflows.js';
import { createStatsRouter } from './routes/stats.js';
import { createPreferencesRouter } from './routes/preferences.js';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

export function createApp() {
  const app = express();
  const upload = createUploadMiddleware(config.workflowsPath);
  const basicAuth = createBasicAuthMiddleware(config);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
    // Disable COEP — it blocks cross-origin resources needed by ComfyUI asset loading
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  app.use('/api', apiLimiter);
  app.use('/data', apiLimiter);

  app.use('/api', basicAuth);
  app.use('/api', createBlockGuestExceptStatsMiddleware(config));
  app.use('/data', basicAuth);
  app.use('/data', createBlockGuestExceptStatsMiddleware(config));

  app.use('/api', createPingRouter(config));
  app.use('/api', createServersRouter());
  const requireAdmin = createRequireAdminMiddleware(config);
  app.use(
    '/api',
    createWorkflowsRouter({
      workflowsPath: config.workflowsPath,
      readParamsJson,
      findWorkflowJson,
      upload,
      requireAdmin,
    })
  );
  app.use('/api', createStatsRouter(config));
  app.use('/api', createPreferencesRouter(config));

  app.use('/data/gt-workflows', express.static(config.workflowsPath));

  return app;
}
