# PrintStudio

PrintStudio is a Next.js STL workspace built for agent-driven 3D modeling.

It gives a user a browser-based 3D print studio, a websocket connection to a local agent server, live tool-call logging, screenshot verification tools, and one-click STL export tuned for the Bambu Lab P1S workflow.

## What It Does

- Creates and edits parametric STL-ready scenes in the browser
- Imports existing `.stl` files for viewing and print prep
- Exposes an agent-discoverable tool manifest at `/api/agent-manifest`
- Lets the browser connect to an agent-hosted local websocket server and drive the UI live
- Streams tool calls, results, screenshots, and export status into the UI
- Exports STL files from the current scene
- Includes Bambu Lab P1S prep helpers and print-fit checks

## Architecture

- `src/app`: Next.js app router frontend and manifest route
- `src/components/print-studio-app.tsx`: main workspace UI and websocket client
- `src/components/studio-canvas.tsx`: 3D viewer
- `src/lib/agent-manifest.ts`: agent tool catalog and copied connect instructions
- `src/lib/studio-model.ts`: scene model, geometry helpers, STL export, P1S analysis
- `public/agent/connect.mjs`: helper script that starts a local websocket server + CLI for manual tool calls

## Local Development

Install dependencies:

```bash
npm install
```

Run the Next.js app:

```bash
npm run dev
```

Open `http://localhost:3000`.

The app defaults to `ws://127.0.0.1:8787`, which is intended to be a local websocket server started by the agent or by the helper script below.

## Agent Flow

1. Open the site.
2. Click `Connect To Claude Code / Agents`.
3. Paste the copied instructions into your agent.
4. The agent starts a local websocket server and discovers the tool manifest.
5. Tool calls stream into the UI while screenshots and STL exports close the loop.

You can also use the helper CLI:

```bash
curl -fsSL http://localhost:3000/agent/connect.mjs -o host-printstudio.mjs
npm i ws
node host-printstudio.mjs --port 8787 --session "<SESSION_ID>" --name "Claude Code"
```

Then send commands such as:

```text
call create_ice_cube_tray {"theme":"pokemon ice tray","rows":2,"columns":3,"label":"POKE ICE"}
call capture_scene_screenshot {}
call export_stl {"filename":"pokemon-ice-tray"}
```

## Verification

Lint:

```bash
npm run lint
```

Production build:

```bash
npm run build
```

## Deployment Notes

The frontend deploys cleanly to Vercel.

The intended production flow is:

1. The user opens the deployed HTTPS site.
2. The agent starts a websocket server on the user's machine, typically at `ws://127.0.0.1:8787`.
3. PrintStudio connects from the browser to that local agent server.

This avoids needing to host a long-lived websocket relay for the agent loop.
