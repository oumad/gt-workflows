import { Router } from 'express';
import { createQueueRouter } from './stats/queue.js';
import { createActivityRouter } from './stats/activity.js';
import { createDoctorRouter } from './stats/doctor.js';
import { createCompletedRouter } from './stats/completed.js';
import { createUsageRouter } from './stats/usage.js';

export function createStatsRouter(config) {
  const router = Router();
  router.use(createQueueRouter(config));
  router.use(createActivityRouter(config));
  router.use(createDoctorRouter(config));
  router.use(createCompletedRouter(config));
  router.use(createUsageRouter(config));
  return router;
}
