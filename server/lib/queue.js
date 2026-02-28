import Queue from 'bull';
import { config } from '../config.js';

let statsQueue = null;

if (config.redisUrl) {
  try {
    statsQueue = new Queue(config.bullQueueName, config.redisUrl);
  } catch (err) {
    console.warn('[Stats] Bull queue init failed:', err.message);
  }
}

export function getStatsQueue() {
  return statsQueue;
}
