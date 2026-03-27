# Codex Remote Workspace Plan

## Goal

Use this machine as the always-on source of truth for:

- project files
- Codex threads and sessions
- shell and tool execution
- the web UI

Laptop and phone clients connect to this machine over your Tailnet and continue work from the same backend state.

## Stack

- Frontend repo uses Bun
- UI is SvelteKit
- Serve the web app from this machine
- Use Tailscale as the only network access layer

## High-Level Architecture

1. Main server: this machine
   - Stores repos and Codex session data
   - Runs `codex app-server`
   - Runs a small local gateway in front of `codex app-server`
   - Runs the SvelteKit web app
   - Runs Tailscale

2. Tailnet access
   - Laptop and phone connect through Tailscale
   - Browser loads the web app from this machine
   - Only the web app is exposed on the tailnet

3. Thin client behavior
   - One responsive web app for desktop and mobile
   - Show threads, files, command output, and live agent updates
   - Reconnect and resume existing threads

## Request Flow

`phone/laptop browser on tailnet -> SvelteKit on this machine -> local gateway -> codex app-server`

## Build Plan

1. Prepare this machine
   - Keep project repos here
   - Choose persistent directories for repos and Codex data
   - Add backups if the data matters

2. Run Codex centrally
   - Install Codex on this machine
   - Start `codex app-server`
   - Keep it private on localhost

3. Build the local gateway
   - Expose a small HTTP API for the local web app
   - Talk to `codex app-server` locally
   - Normalize streaming, auth handoff, and retries

4. Build the frontend
   - Use Bun for package management, scripts, and CI
   - Build the app in SvelteKit
   - Use a local server adapter such as `adapter-node`
   - Implement thread list, resume flow, chat, streaming output, file browser, and mobile layout

5. Publish this machine safely
   - Install Tailscale on this machine
   - Join this machine to your tailnet
   - Use `tailscale serve` to expose only the SvelteKit web app
   - Keep the gateway private on localhost
   - Do not expose `codex app-server` directly

6. Handle sync model
   - Treat this machine as the only source of truth
   - Support reconnect from any device
   - Prevent conflicting simultaneous edits where possible

7. Ship safely
   - Require tailnet membership for access
   - Optionally add app-level auth if multiple tailnet users will use it
   - Restrict shell and file operations by user or session

## First MVP

- This machine as the main server
- One local gateway service on this machine
- One SvelteKit app on this machine
- One Tailscale node on this machine
- One `tailscale serve` endpoint for the web app
- Login
- List, start, and resume threads
- Stream agent output
- Read and write files
- Resume from phone or laptop

## Notes

- Bun is the local toolchain for the web app.
- Direct browser-to-app-server is not the best default; keep a gateway in front of it.
- Keep both `codex app-server` and the gateway private on this machine.
- Expose only the web app over Tailscale.
- This is simpler than the Cloudflare version because there is no public ingress layer.
- Multi-device continuity is realistic if every client talks to this machine.
- “Synced” means shared backend state, not automatic conflict-free concurrent editing.
