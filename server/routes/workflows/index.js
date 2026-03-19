import { Router } from 'express';
import { createWorkflowsCrudRouter } from './crudRoutes.js';
import { createWorkflowsFileRouter } from './fileRoutes.js';
import { createWorkflowsHistoryRouter } from './historyRoutes.js';

export function createWorkflowsRouter({ workflowsPath, readParamsJson, findWorkflowJson, upload, requireAdmin, preferencesPath, historyPath }) {
  const router = Router();
  const admin = requireAdmin || ((_req, _res, next) => next());

  router.use(createWorkflowsCrudRouter({ workflowsPath, readParamsJson, findWorkflowJson, admin, preferencesPath, historyPath }));
  router.use(createWorkflowsFileRouter({ workflowsPath, readParamsJson, upload, admin, historyPath }));
  if (historyPath) {
    router.use(createWorkflowsHistoryRouter({ workflowsPath, historyPath, admin }));
  }

  return router;
}
