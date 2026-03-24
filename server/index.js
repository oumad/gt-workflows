import { config } from './config.js';
import { createApp } from './app.js';
import './lib/queue.js'; // ensure queue is initialized
import { monitoringService } from './lib/monitoringService.js';

const app = createApp();
const { port, host, workflowsPath } = config;

app.listen(port, host, () => {
  console.log(`Server running on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  if (host === '0.0.0.0') {
    console.log(`Server accessible from network at http://<your-ip>:${port}`);
  }
  console.log(`Workflows directory: ${workflowsPath}`);
  monitoringService.init(config.dataDir, config).catch((err) =>
    console.error('[Monitoring] Init error:', err.message)
  );
});
