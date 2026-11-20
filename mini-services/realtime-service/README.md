# realtime-service

Socket.IO mini-service for dashboard + companion realtime events. Listens on
**3003** (WebSocket) and **3004** (HTTP `/emit` relay).

## The one rule: share `JWT_ACCESS_SECRET` with the SaaS

The service verifies the SAME HS256 access JWTs the Next.js app mints
(`src/lib/api/with-auth.ts`). If `JWT_ACCESS_SECRET` here differs from the
SaaS value, every socket `auth` fails with `invalid or expired token`
(baseline finding B-013 — the default dev secret only works when the SaaS
also runs with its default, which never happens once `.env.local` is set).

### Local development

```bash
# from the repo root — export the SAME secret as .env.local
set -a; source .env.local; set +a
cd mini-services/realtime-service
bun install
REALTIME_EMIT_SECRET="${REALTIME_EMIT_SECRET:-dev-emit-secret}" bun index.ts
# ws  → http://127.0.0.1:3003  (socket.io path '/')
# emit → http://127.0.0.1:3004/emit  (header x-emit-secret, body {channel, event, payload})
```

The repo's Phase-0 boot script (`scripts/phase0/boot_local_stack.sh`) does
exactly this. Probe script: `scripts/phase0/socket_probe.js` (register → login
→ auth-ok → /emit → room delivery → bad-secret 401; 6/6 = wired correctly).

### Production

- Run as a long-lived process (VM/container/Caddy upstream on port 3003 —
  `?XTransformPort=3003` routes through the gateway). Vercel serverless
  functions CANNOT host it; without a host, dashboards fall back to REST
  polling (KNOWN_LIMITATIONS P1-3).
- Env: `JWT_ACCESS_SECRET` (same value as the Vercel app), `REALTIME_EMIT_SECRET`
  (same as the app), `CORS_ALLOWED_ORIGINS` (comma list — defaults to `*` in dev,
  set it explicitly in production).
- Channels are `shop:<shopId>` only; `/emit` rejects anything else and requires
  the emit secret (timing-safe compare).
