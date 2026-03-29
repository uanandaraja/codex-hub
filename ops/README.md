# Ops Notes

This repo is set up for a tailnet-only deployment with no extra app auth.

## 1. Prepare env files

```bash
cp apps/gateway/.env.example apps/gateway/.env
cp apps/web/.env.example apps/web/.env
```

Adjust paths and ports as needed.

## 2. Build once

```bash
bun run build
```

## 3. Install the user services

```bash
mkdir -p ~/.config/systemd/user
cp ops/systemd/codex-hub-gateway.service ~/.config/systemd/user/
cp ops/systemd/codex-hub-web.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now codex-hub-gateway.service
systemctl --user enable --now codex-hub-web.service
```

## 4. Expose only the web app on the tailnet

```bash
tailscale serve --bg --set-path / http://127.0.0.1:4321
```

Keep the gateway on localhost. Keep `codex app-server` on localhost.

## 5. Check the running services

```bash
systemctl --user status codex-hub-gateway.service
systemctl --user status codex-hub-web.service
curl http://127.0.0.1:8787/v1/status
curl -I http://127.0.0.1:4321
```
