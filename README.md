# GT Workflows Manager

A modern web UI for visualizing and managing ComfyUI workflows and default workflows for the Gear Tracker Workflow Studio.

## Features

- 📋 **Workflow List View**: See all workflows at a glance with key information (name, description, parser type, icon, tags)
- ✏️ **Edit Workflows**: View and edit `params.json` files with a JSON editor
- 👁️ **Workflow JSON Viewer**: View ComfyUI workflow JSON files
- ➕ **Create Workflows**: Create new workflows with a simple form
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

#### Setting Custom Workflow Location

By default, workflows are stored in `data/gt-workflows/` relative to the project root. To use a different location on a different computer, you can configure it using a `.env` file or environment variable.

**Using .env file (Recommended):**

1. Copy the example file:
```bash
cp .env.example .env
```

2. Edit `.env` and set your workflows path:
```env
GT_WORKFLOWS_PATH=C:\path\to\your\workflows
```

Or on Linux/macOS:
```env
GT_WORKFLOWS_PATH=/path/to/your/workflows
```

The `.env` file is automatically loaded when the server starts.

**Using Environment Variable:**

**Windows (PowerShell):**
```powershell
$env:GT_WORKFLOWS_PATH="C:\path\to\your\workflows"
npm run dev:server
```

**Windows (Command Prompt):**
```cmd
set GT_WORKFLOWS_PATH=C:\path\to\your\workflows
npm run dev:server
```

**Linux/macOS:**
```bash
export GT_WORKFLOWS_PATH="/path/to/your/workflows"
npm run dev:server
```

**Or set it inline:**
```bash
# Windows PowerShell
$env:GT_WORKFLOWS_PATH="C:\path\to\your\workflows"; npm run dev:server

# Linux/macOS
GT_WORKFLOWS_PATH="/path/to/your/workflows" npm run dev:server
```

The path can be absolute or relative. If not set, it defaults to `../data/gt-workflows` relative to the server file location.

#### Network Access

By default, both the backend and frontend servers are configured to accept connections from other machines on your network. You can access the application from other devices using your machine's IP address:

- Frontend: `http://<your-ip>:3010`
- Backend API: `http://<your-ip>:3011`

To restrict access to localhost only, you can set the `HOST` environment variable:
```bash
# Windows PowerShell
$env:HOST="localhost"; npm run dev:server

# Linux/macOS
HOST=localhost npm run dev:server
```

**Note:** Make sure your firewall allows incoming connections on ports 3010 and 3011 if you want to access the app from other machines.

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## Project Structure

```
gt-workflows/
├── data/
│   └── gt-workflows/          # Your workflows directory
│       ├── Workflow Name/
│       │   ├── params.json     # Workflow configuration
│       │   └── workflow.json   # ComfyUI workflow file
├── server/
│   └── index.js               # Express API server
├── src/
│   ├── api/
│   │   └── workflows.ts       # API client functions
│   ├── components/
│   │   ├── WorkflowList.tsx   # Workflow list view
│   │   ├── WorkflowDetail.tsx # Workflow detail/edit view
│   │   └── WorkflowCreate.tsx # Create workflow form
│   ├── types.ts               # TypeScript type definitions
│   ├── App.tsx                # Main app component
│   └── main.tsx               # Entry point
└── package.json
```

## API Endpoints

The backend server provides the following endpoints:

- `GET /api/workflows/list` - List all workflows
- `GET /api/workflows/:name/params` - Get workflow params.json
- `GET /api/workflows/:name/workflow` - Get workflow JSON file
- `PUT /api/workflows/:name/params` - Save workflow params.json
- `POST /api/workflows/create` - Create a new workflow
- `DELETE /api/workflows/:name` - Delete a workflow

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

### Adding New Features

The UI is built with React and TypeScript. Key files:

- `src/components/WorkflowList.tsx` - Main list view
- `src/components/WorkflowDetail.tsx` - Detail/edit view
- `src/components/WorkflowCreate.tsx` - Create form
- `server/index.js` - Backend API server

### Styling

Styles use CSS variables defined in `src/index.css`. The app uses a dark theme by default.

## License

MIT

