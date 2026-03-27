# Codex Hub

Thin-client Codex workspace for a single always-on machine.

## What This Starter Includes

- `apps/gateway`: a local Bun service that starts `codex app-server` over `stdio://`
- `apps/web`: a SvelteKit UI served from this machine
- one-machine topology intended to sit behind `tailscale serve`

The gateway keeps `codex app-server` on localhost and exposes a smaller HTTP/SSE API to the web app.

## Requirements

- `bun`
- `codex`
- a working Codex login on this machine
- Tailscale on this machine and on the client devices you want to use

## Install

```bash
bun install
```

Optional:

```bash
cp apps/gateway/.env.example apps/gateway/.env
cp apps/web/.env.example apps/web/.env
```

## Run In Development

```bash
bun run dev
```

This starts:

- web UI on `http://127.0.0.1:3000`
- gateway on `http://127.0.0.1:8787`

## Build And Run

```bash
bun run build
bun run start
```

## Expose The Web App Over Tailscale

Expose only the web app, not the gateway:

```bash
tailscale serve --bg --set-path / http://127.0.0.1:3000
```

The gateway should stay on localhost. `codex app-server` also stays on localhost.

## Run It As A Service

User-service templates live in `ops/systemd/`.

Deployment steps are in [ops/README.md](./ops/README.md).

## Useful Environment Variables

Gateway:

- `PORT`: gateway port, default `8787`
- `HOST`: gateway bind host, default `127.0.0.1`
- `CODEX_BIN`: codex binary path, default `codex`
- `DEFAULT_THREAD_CWD`: default working directory for new threads, default current repo root
- `PROJECTS_ROOT`: project sidebar root, default `~/Dev`
- `DEFAULT_APPROVAL_POLICY`: default `never`
- `DEFAULT_SANDBOX_MODE`: default `danger-full-access`
- `AUTO_APPROVE_SERVER_REQUESTS`: default `false`

Web:

- `PORT`: web port, default `3000`
- `GATEWAY_BASE_URL`: default `http://127.0.0.1:8787`

## Notes

- This starter uses the supported `stdio://` app-server transport rather than the experimental websocket listener.
- The default trust model is personal-server oriented. Review the approval and sandbox defaults before wider use.
- If `codex app-server` reports auth or approval issues, fix them on this machine first; the web UI is only a client layer.
