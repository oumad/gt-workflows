# GT Workflows Manager

A modern web UI for visualizing and managing ComfyUI workflows and default workflows for the Gear Tracker Workflow Studio.

## Features

- 🔐 **Login & session**: Optional HTTP Basic Auth (login screen first); configurable session timeout and disconnect
- 📋 **Workflow List View**: See all workflows at a glance with key information (name, description, parser type, icon, tags)
- ✏️ **Edit Workflows**: View and edit `params.json` files with a JSON editor
- 👁️ **Workflow JSON Viewer**: View ComfyUI workflow JSON files
- ➕ **Create Workflows**: Create new workflows with a simple form
- 📊 **Job stats**: Optional dashboard for Bull queue usage (workflow runs, servers, users)
- 🎨 **Modern UI**: Clean, dark-themed interface with responsive design

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

1. Install dependencies:
```bash
npm install
```

### Running the Application

#### Development Mode (Frontend + Backend)

Run both the frontend and backend together:
```bash
npm run dev:all
```

This will start:
- Backend API server on `http://localhost:3011` (accessible from network at `http://<your-ip>:3011`)
- Frontend dev server on `http://localhost:3010` (accessible from network at `http://<your-ip>:3010`, opens automatically)

When auth is enabled (see [Authentication](#authentication)), opening the app shows the login screen first (`/login`). After login you use the main app at `/main` (workflows, job stats, create, settings). You can disconnect via the logout icon in the header.

#### Run Separately

**Backend only:**
```bash
npm run dev:server
```

**Frontend only:**
```bash
npm run dev
```

### Configuration

Use a `.env` file in the project root (copy from `.env.template`). The server loads it automatically when started.

```bash
cp .env.template .env
# Edit .env with your values
```

#### Workflows path

By default, workflows are stored in `data/gt-workflows/` relative to the project root. Set `GT_WORKFLOWS_PATH` to use another location:

```env
# Absolute path (Windows)
GT_WORKFLOWS_PATH=C:\path\to\your\workflows

# Absolute path (Linux/macOS)
GT_WORKFLOWS_PATH=/path/to/your/workflows
```

The path can be absolute or relative. If not set, it defaults to `../data/gt-workflows` relative to the server file.

#### Authentication

To protect the app with a login screen and HTTP Basic Auth, set both:

```env
GT_WF_AUTH_USER=admin
GT_WF_AUTH_PASSWORD=your-secure-password
```

- The app shows the login page first (`/` redirects to `/login`). After login, the main UI is at `/main`.
- All `/api` and `/data` requests require this username and password.
- Optional: `SESSION_MAX_TIME` (seconds) logs out the user after that much inactivity (default: 86400 = 24 hours). Only applies when auth is enabled.

#### Job stats (optional)

To enable the “Job stats” dashboard (Bull queue usage), set:

```env
REDIS_URL=redis://localhost:6379
BULL_QUEUE_NAME=workflow-studio-comfyui-process-queue
```

Use the same Redis URL and queue name as the Workflow Studio plugin. If not set, the dashboard shows a “not configured” message.

#### Network access

By default, both servers accept connections from other machines. Access from another device using your machine’s IP:

- Frontend: `http://<your-ip>:3010`
- Backend API: `http://<your-ip>:3011`

To bind the backend to localhost only, set `HOST=localhost` in `.env` or when starting the server. Ensure your firewall allows ports 3010 and 3011 if you need network access.

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## Project structure

```
gt-workflows/
├── .env                       # Your config (copy from .env.template)
├── .env.template              # Template env vars (workflows path, auth, Redis, etc.)
├── data/
│   └── gt-workflows/          # Default workflows directory (overridable via GT_WORKFLOWS_PATH)
│       └── Workflow Name/
│           ├── params.json   # Workflow configuration
│           └── workflow.json # ComfyUI workflow file
├── server/
│   └── index.js              # Express API server (auth, workflows, stats, static)
├── src/
│   ├── api/
│   │   ├── workflows.ts      # Workflow API client
│   │   ├── stats.ts          # Job stats API
│   │   └── servers.ts        # ComfyUI server logs API
│   ├── components/
│   │   ├── Login.tsx         # Login screen
│   │   ├── AuthGuard.tsx     # Legacy auth wrapper
│   │   ├── WorkflowList.tsx  # Workflow list view
│   │   ├── WorkflowDetail.tsx# Workflow detail/edit view
│   │   ├── WorkflowCreate.tsx# Create workflow form
│   │   ├── Dashboard.tsx     # Job stats dashboard
│   │   └── Settings.tsx      # Settings
│   ├── contexts/
│   │   └── AuthContext.tsx   # Auth state (login, session timeout)
│   ├── hooks/
│   │   └── useServerHealthCheck.ts
│   ├── utils/
│   │   └── auth.ts           # Auth storage, fetchWithAuth, session expiry
│   ├── types.ts
│   ├── App.tsx               # Routes: / → /login, /main (workflows, dashboard, create, settings)
│   └── main.tsx
└── package.json
```

## API endpoints

All `/api` (and `/data`) routes require HTTP Basic Auth when authentication is enabled (see [Authentication](#authentication)).

- `GET /api/ping` – Auth check; returns `sessionMaxTime` when auth is enabled
- `GET /api/workflows/list` – List all workflows
- `GET /api/workflows/:name/params` – Get workflow params.json
- `GET /api/workflows/:name/workflow` – Get workflow JSON file
- `PUT /api/workflows/:name/params` – Save workflow params.json
- `POST /api/workflows/create` – Create a new workflow
- `POST /api/workflows/:name/duplicate` – Duplicate a workflow
- `DELETE /api/workflows/:name` – Delete a workflow
- `POST /api/workflows/:name/upload` – Upload file (e.g. icon, workflow JSON)
- `DELETE /api/workflows/:name/file/:filename` – Delete a file in a workflow
- `GET /api/workflows/:name/download` – Download workflow as zip
- `GET /api/stats/queue` – Bull queue counts (requires REDIS_URL)
- `GET /api/stats/usage` – Workflow/server/user usage (requires REDIS_URL)
- `POST /api/servers/health-check` – ComfyUI server health check
- `GET /api/servers/logs` – Proxy ComfyUI server logs

## Workflow Structure

Each workflow should be in its own folder under `data/gt-workflows/`:

```
Workflow Name/
├── params.json              # Required: Workflow configuration
├── workflow.json            # Optional: ComfyUI workflow file
└── icon.png                 # Optional: Workflow icon
```

### params.json Structure

For ComfyUI workflows:
```json
{
  "parser": "comfyui",
  "description": "Workflow description",
  "comfyui_config": {
    "serverUrl": "http://127.0.0.1:8188",
    "workflow": "workflow.json"
  }
}
```

For default workflows:
```json
{
  "process": "python",
  "main": "main.py",
  "parameters": {},
  "ui": {},
  "use": {}
}
```

See the Workflow Studio documentation for complete parameter specifications.

## Development

The UI is built with React and TypeScript. Key areas:

- `src/App.tsx` – Routes (`/`, `/login`, `/main`, `/main/*`), auth wrappers, main layout and logout
- `src/contexts/AuthContext.tsx` – Auth state and session timeout
- `src/utils/auth.ts` – Stored auth, `fetchWithAuth`, session expiry
- `src/components/WorkflowList.tsx`, `WorkflowDetail.tsx`, `WorkflowCreate.tsx` – Workflow CRUD
- `src/components/Dashboard.tsx` – Job stats
- `src/components/Login.tsx` – Login form
- `server/index.js` – Express server (auth middleware, workflows, stats, uploads, static)

Styles use CSS variables in `src/index.css` (dark theme by default).

## License

MIT

