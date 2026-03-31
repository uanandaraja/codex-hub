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

If you send image attachments, set `BODY_SIZE_LIMIT` in `apps/web/.env`. `@sveltejs/adapter-node`
defaults to `512K`, which is easy to exceed with screenshots. The local default in this repo is `5M`.
