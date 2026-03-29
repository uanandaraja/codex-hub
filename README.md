# Codex Hub

Thin web client for `codex app-server`, meant to run on one always-on machine and be used from other devices over Tailscale.

## What It Is

- `apps/gateway`: local Bun API that starts and talks to `codex app-server` over `stdio://`
- `apps/web`: SvelteKit UI for projects, chats, streaming turns, tool activity, approvals, and prompt controls
- `ops/systemd`: user services for running web + gateway on this machine

This repo assumes:

- repos live on this machine, usually under `~/Dev`
- `codex app-server` stays local
- only the web app gets exposed to your tailnet

## Features

- project sidebar grouped by repo/directory
- chat list per project
- live streaming assistant messages
- compact tool-call rendering
- stop/interruption flow
- model, thinking, mode, and permission controls in the prompt
- approval / follow-up question UI
- dark-only UI, tuned for desktop and mobile

## Repo Structure

```text
apps/
  gateway/   Bun server in front of codex app-server
  web/       SvelteKit app
ops/
  systemd/   user service files
```

Useful files:

- `codex-remote-workspace-plan.md`: original product/architecture notes
- `ops/README.md`: service setup notes

## Requirements

- `bun`
- `codex`
- Codex already logged in on this machine
- Tailscale on this machine, plus any client devices

## Install

```bash
bun install
cp apps/gateway/.env.example apps/gateway/.env
cp apps/web/.env.example apps/web/.env
```

Recommended gateway env:

```bash
DEFAULT_THREAD_CWD=/home/nizzy/Dev
PROJECTS_ROOT=/home/nizzy/Dev
```

## Run

Dev:

```bash
bun run dev
```

Prod-style:

```bash
bun run build
bun run start
```

Default local addresses:

- web: `http://127.0.0.1:4321`
- gateway: `http://127.0.0.1:8787`

## Tailscale

Expose only the web app:

```bash
tailscale serve --bg --set-path / http://127.0.0.1:4321
```

Keep the gateway local. Keep `codex app-server` local.

## Services

Service templates are in `ops/systemd/`.

See [ops/README.md](./ops/README.md) for the short setup flow.

## Env

Gateway:

- `HOST`: default `127.0.0.1`
- `PORT`: default `8787`
- `CODEX_BIN`: default `codex`
- `DEFAULT_THREAD_CWD`: default cwd for new threads
- `PROJECTS_ROOT`: root used for project grouping
- `DEFAULT_APPROVAL_POLICY`: default `never`
- `DEFAULT_SANDBOX_MODE`: default `danger-full-access`
- `AUTO_APPROVE_SERVER_REQUESTS`: default `false`

Web:

- `HOST`: default `0.0.0.0`
- `PORT`: default `4321`
- `GATEWAY_BASE_URL`: default `http://127.0.0.1:8787`

## Scripts

- `bun run dev`: run gateway + web in watch mode
- `bun run build`: build gateway + web
- `bun run start`: run built gateway + web
- `bun run check`: typecheck gateway + web

## References

- Codex app-server README:
  `https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md`
- T3Chat-style UI inspiration:
  `https://github.com/pingdotgg/t3code`
- Streaming/chat UI inspiration:
  `https://github.com/uanandaraja/svelting`

## Notes

- this uses the supported `stdio://` app-server path, not websocket transport
- this is meant for personal tailnet use, not public exposure
- if Codex auth or approvals break, fix them on this machine first
