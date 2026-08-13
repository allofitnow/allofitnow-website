# All Of It Now — Website

Redesign and rebuild of the AOIN (All Of It Now) site — an LA real-time content
and show production studio. **Astro frontend + Payload CMS backend** in a
single monorepo, deployed as two cooperating services behind nginx.

**Staging (current):**
- Site → http://192.168.30.245
- CMS Admin → http://192.168.30.245/admin
- API → http://192.168.30.245/api
- Static media → http://192.168.30.245/media/

> Staging runs on the `.245` container at its static IP. Production will be a
> separate branch/deployment later — nothing here assumes a public domain.

---

## Architecture

```
:80   nginx ──► /            → Astro static build (/opt/aoin-astro)
      │        /api/*        → Payload :3000 (reverse proxy)
      │        /admin        → Payload :3000 (reverse proxy)
      │        /media/*      → Payload :3000 (reverse proxy)
:3000 Payload CMS (internal only, not directly reachable)
```

- **Frontend:** Astro 5, static output (SSG) — content is fetched from the
  Payload REST API **at build time** and baked into static HTML.
- **Backend:** Payload CMS 2.32 (Express + MongoDB 7, db `payload`) — the
  single source of truth for all site content.
- **Traffic flow:** nginx owns port 80 and routes by path. The frontend build
  fetches `http://192.168.30.245/api/projects` during `astro build`; the
  rendered pages then point at `/media/...` URLs that nginx proxies back to
  Payload.

---

## Repo shape

```
allofitnow-website/            # repo root (npm workspaces)
├─ frontend/                   # Astro app (SSG build)
│  ├─ public/
│  │  ├─ fonts/                # brand OTFs: Denim INK WD, SN Ja Mono, OO Theran
│  │  └─ assets/               # artist stills, AOIN icon / logo / wordmark
│  ├─ src/
│  │  ├─ styles/tokens.css     # dialed :root token blocks + @font-face
│  │  ├─ lib/                  # engines: flight.ts, hovercard.ts, payload.ts
│  │  ├─ data/projects.ts      # TYPE definitions + re-export of API accessors
│  │  ├─ layouts/Base.astro    # shell: nav, cursor, flight layer
│  │  ├─ components/           # Presenter components (designer-owned)
│  │  └─ pages/                # Container pages (engineering-owned)
│  └─ .env                     # PAYLOAD_URL=http://192.168.30.245 (gitignored)
├─ backend/                    # Payload CMS 2 (Express + MongoDB)
│  ├─ collections/             # Projects, Media, Users
│  ├─ globals/                 # Homepage, Settings
│  ├─ scripts/                 # upload-thumbs.js, seed-projects.js (ops tools)
│  └─ payload.config.ts        # cors *, serverURL :80
├─ .gitlab/issue_templates/    # portfolio_addition.md (structured intake)
└─ package.json                # npm workspaces root
```

**Container/Presenter split (Y-Combinator strategy):** `src/components/` holds
dumb Presenter components owned by the designer; `src/pages/` holds Container
pages owned by engineering. Content flows from Payload → `src/lib/payload.ts`
→ page props → presenters. The designer works in isolation on GitHub; the
engineering repo mirrors via `git subtree` (see wiki).

---

## Links & Documentation (GitLab wiki)

- [Adding a New Portfolio Project to the Staging Site](http://gitlab.someofitlater.com/website/allofitnow-website/-/wikis/Adding-a-New-Portfolio-Project-to-the-Staging-Site) — operational runbook
- [Payload Schema Contract](http://gitlab.someofitlater.com/website/allofitnow-website/-/wikis/Payload-Schema-Contract)
- [Database Schema Consolidation Spec](http://gitlab.someofitlater.com/website/allofitnow-website/-/wikis/Database-Schema-Consolidation-Spec)
- [Monorepo Integration Plan](http://gitlab.someofitlater.com/website/allofitnow-website/-/wikis/Monorepo-Integration-Plan)
- [Production Data Extraction](http://gitlab.someofitlater.com/website/allofitnow-website/-/wikis/Production-Data-Extraction)

---

## Adding a Portfolio Project
 
 **Short version** (full runbook on the wiki):
 
-1. **Via MCP (Recommended)**: Use the `create_portfolio` macro via Claude Code to ingest content and trigger the automatic Astro build loop (no terminal access needed).
-2. **Via Admin UI**: `http://192.168.30.245/admin`. Flipping the status to `published` automatically triggers an SSG rebuild hook.
-3. **Manual CLI**: Scp media and run `publish.sh` locally on the `.245` box. (See full runbook logic inside GitLab).
+You can add projects using any of these three methods (MCP is optional):
+
+**Option A: Via MCP (Agentic)**
+Use the `create_portfolio` macro via Claude Code to ingest content and trigger the automatic Astro build loop (no terminal access needed).
+
+**Option B: Via Admin UI (Zero-Touch Build)**
+1. Go to `http://192.168.30.245/admin` → Media → Create New, then Projects → Create New. 
+2. `code` is auto-derived — leave placeholder as `TEMP`.
+3. Flipping the status to `published` automatically triggers the SSG rebuild hook in the background.
+
+**Option C: Manual / Scripted**
+1. Open a **Portfolio Addition** issue on GitLab using the `portfolio_addition` template.
+2. Run `backend/scripts/upload-thumbs.js` + `seed-projects.js` to seed the database.
+3. Rebuild & deploy directly on the staging host:
+   ```bash
+   ssh root@192.168.30.245
+   cd /root/projects/aoin-deploy
+   deploy/publish.sh
+   ```
+
+**Payload shape gotchas** (fail the build/seed otherwise):
+- `writeup.body` must be `[{paragraph: "..."}, ...]` — never plain strings
+- `gallery` must be `[{image: "<mediaId>"}, ...]`
+- `thumb`/`hero` send the raw media ID string
+- `capabilities` is a closed taxonomy: `REAL-TIME CONTENT`, `SCREENS PRODUCTION`, `MIXED REALITY`, `EQUIPMENT RENTAL`
 
 ---

## Local dev

Requires **Node ≥ 22.12** (Astro 5 hard requirement).

```bash
cd frontend
npm install
npm run dev          # LAN-exposed dev server → http://localhost:4321
```

`npm run dev` prints a `Network:` URL you can open on a phone on the same
Wi-Fi. Other scripts: `npm run build` (→ `dist/`), `npm run preview`,
`npm run check` (Astro/TS), `npm run format` (Prettier).

> The frontend's `.env` sets `PAYLOAD_URL=http://192.168.30.245` — dev and
> build both read from the live staging CMS. To build against a different
> backend, change that one line.

## Backend ops

```bash
# Start Payload (staging .245) — port 3000 internal, nginx on :80
cd /root/projects/allofitnow-website/backend
nohup npx ts-node --transpile-only server.ts > /tmp/payload2.log 2>&1 &

# Restart (after deploying collection changes)
lsof -ti:3000 | xargs kill -9 && # then start again as above

# nginx config lives at /etc/nginx/sites-available/aoin-staging
```

Deploying a backend change: edit on the dev host, `scp` the changed files to
`.245`, restart Payload. **Never `git pull` on `.245`** — its checkout stays on
a stale branch; scp only.

---

## Optional: Portfolio MCP Server

For agentic usage (such as the frontend designer using Claude Code), the `aoin-portfolio-mcp` provides a FastMCP server offering 12 tools to manage projects, assets, and trigger SSG rebuilds automatically.

**Installation & Execution (.245 host):**
1. Requires Python 3.10+
2. Build the virtual environment:
   ```bash
   python3 -m venv /opt/aoin-mcp-venv
   /opt/aoin-mcp-venv/bin/pip install fastmcp httpx uvicorn starlette pydantic
   ```
3. Set the required secrets in `/etc/aoin-mcp.env` (`PAYLOAD_URL`, `PAYLOAD_ADMIN_EMAIL`, `PAYLOAD_ADMIN_PASSWORD`, `MCP_BEARER_TOKEN`, `MCP_WEBHOOK_SECRET`).
4. Run the server (or map to a systemd service pointing to Nginx):
   ```bash
   /opt/aoin-mcp-venv/bin/uvicorn aoin_mcp.server:app --host 127.0.0.1 --port 8788 --app-dir /path/to/repo
   ```

**Connecting Clients:**
Clients must use the streamable HTTP/SSE transport, accept the `Bearer` token configured above, and point to the host domain proxy (`http://192.168.30.245/mcp`). 

---

## The flight transition

The clone-and-fly page transition is the product on this site. The engine is
`frontend/src/lib/flight.ts`, wired into Astro's `<ClientRouter />`. The
ordered project roster is baked into `data-flight-order` on the persistent
flight layer by `Base.astro` at build time (client JS cannot fetch).

Load-bearing, do not rename or restructure: `data-slug`, `data-unit`, the
`.mask` wrapper, and radius placement (same element in tile and hero).

---

## Branches

- `main` — designer's baseline (GitHub), pulled into the monorepo via subtree
- `integration` — engineering's active branch: CMS wiring, deployment, ops
- Production deployment will get its own branch when the time comes

## Coworking

New here? Start with **[CONTRIBUTING.md](CONTRIBUTING.md)** — setup, the
branch → pull-request flow, and the few conventions (dialed tokens, load-bearing
hooks).
