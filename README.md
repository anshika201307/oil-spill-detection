# OILTRACE AI - Satellite Maritime Intelligence & Oil Spill Tracking

AI-powered marine oil spill detection, synthetic aperture radar (SAR) analysis, ocean drift hindcast modeling, and vessel attribution.

## Project Architecture

The React/Vite frontend and its existing same-origin Express API remain at the
repository root. Python inference and the new versioned API live in
`ai-service/`; FastAPI route handlers are separated from the satellite,
weather, ocean-current, and AIS provider interfaces under `ai-service/app/`.
The current providers use sample data, while image detection reuses the existing
U-Net inference path. The existing `/analyze` route remains available for the
Express server. See [the AI service README](ai-service/README.md) for endpoints,
contracts, and Python setup.

## 🚀 How to Run Locally

This is a modern React + Vite + TypeScript application with an Express backend.

### Prerequisites
- **Node.js** (v18 or higher recommended)
- **npm** (comes with Node.js)

### Step 1: Install Dependencies
Open your terminal (or Command Prompt / PowerShell) in this project directory:
```bash
npm install
```

### Step 2: Start the Development Server
```bash
npm run dev
```
If port 3000 is already occupied, start on another port:
```cmd
set OILTRACE_PORT=3001&& npm run dev
```

For trained image detection, also start the Python service and train the U-Net
as described in [the AI service guide](ai-service/README.md). Keep both services
running while using the dashboard.

### Step 3: Open in Browser
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 🛠️ Scripts Reference

| Command | Description |
|---|---|
| `npm install` | Installs all required packages |
| `npm run dev` | Starts the app in development mode with live server |
| `npm run build` | Builds the production client bundle and server |
| `npm start` | Runs the production-built server |

---

## ⚠️ Why double-clicking `index.html` shows a blank screen:
This application uses **React, TypeScript, and ES modules**, which cannot run simply by opening the raw `index.html` file in a browser (`file:///...`). Browsers block modern JavaScript modules over the `file://` protocol due to CORS security policies. 

You must run it with `npm run dev` or a local development web server as explained above.
