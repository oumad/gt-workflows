import { config } from './config.js';
import { createApp } from './app.js';
import './lib/queue.js'; // ensure queue is initialized

const app = createApp();
const { port, host, workflowsPath } = config;

app.listen(port, host, () => {
  console.log(`Server running on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  if (host === '0.0.0.0') {
    console.log(`Server accessible from network at http://<your-ip>:${port}`);
  }
  console.log(`Workflows directory: ${workflowsPath}`);
});
