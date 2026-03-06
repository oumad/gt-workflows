import { Router } from 'express';
import { createWorkflowsCrudRouter } from './crudRoutes.js';
import { createWorkflowsFileRouter } from './fileRoutes.js';

export function createWorkflowsRouter({ workflowsPath, readParamsJson, findWorkflowJson, upload, requireAdmin }) {
  const router = Router();
  const admin = requireAdmin || ((_req, _res, next) => next());

  router.use(createWorkflowsCrudRouter({ workflowsPath, readParamsJson, findWorkflowJson, admin }));
  router.use(createWorkflowsFileRouter({ workflowsPath, readParamsJson, upload, admin }));

  return router;
}
