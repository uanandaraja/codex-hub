# Web App

SvelteKit frontend for the local Codex Hub deployment.

This app is meant to be served from this machine and reached over Tailscale. It does not talk to `codex app-server` directly; it calls the local gateway over `GATEWAY_BASE_URL`.

Use the repo-root commands for normal operation:

```bash
bun run dev
bun run check
bun run build
bun run start
```
