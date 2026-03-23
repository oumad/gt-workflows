import { Router } from 'express';
import { createHealthCheckRouter } from './healthCheck.js';
import { createDependencyAuditRouter } from './dependencyAudit.js';
import { createTestWorkflowRouter } from './testWorkflow.js';
import { createMonitoringRouter } from './monitoring.js';

export function createServersRouter() {
  const router = Router();
  router.use(createHealthCheckRouter());
  router.use(createDependencyAuditRouter());
  router.use(createTestWorkflowRouter());
  router.use(createMonitoringRouter());
  return router;
}
