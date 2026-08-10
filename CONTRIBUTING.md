# Contributing

For designers and devs coworking on the AOIN site. The goal is to make it easy
to pull the repo, run it, make a change, and get it in — without stepping on
each other or breaking `main`.

## What you need

- **Node ≥ 22.12** — install from [nodejs.org](https://nodejs.org). On Windows it
  sometimes doesn't land on PATH; if `node`/`npm` aren't found, see the note in
  the [README](README.md#local-dev).
- **[GitHub Desktop](https://desktop.github.com/)** — the easiest way to clone,
  branch, commit, and push without the terminal. The CLI works too if you prefer.

## First-time setup

1. Clone the repo — GitHub Desktop: **File → Clone repository**; or
   `git clone <repo-url>`.
2. Install and run:
   ```bash
   cd frontend
   npm install
   npm run dev        # → http://localhost:4321
   ```
   `npm run dev` also prints a `Network:` URL you can open on a phone on the same
   Wi-Fi. Use `npm run dev:local` if you only want localhost.

## Day-to-day: branch → pull request

**Never commit straight to `main`.** It's the shared source of truth, and a
broken `main` blocks everyone.

1. **Branch** off `main` — GitHub Desktop: **Current Branch → New Branch**; or
   `git switch -c yourname/what-youre-changing`.
2. **Commit** small, self-contained changes with a short, plain message.
3. **Push** and open a **Pull Request** on GitHub. Ping someone for a quick look,
   then merge once it's green.
4. **Pull `main` often** so you're building on the latest — GitHub Desktop:
   **Fetch origin**; or `git pull`.

Keep branches short-lived: one change, merge, delete.

## Conventions

- **Design tokens are dialed.** Values in `frontend/src/styles/tokens.css` are
  from the Figma/brand source, not defaults — don't "round" them.
- **Load-bearing, don't rename or restructure:** `data-slug`, `data-unit`, the
  `.mask` wrapper, and the `frontend/src/lib/` engines (`flight.ts`,
  `hovercard.ts`, `home.controller.ts`). The flight + hover interactions hang off
  these; renaming them silently breaks the transitions.
- **Before you commit:** `npm run format` (Prettier) and, if you touched logic,
  `npm run check` (Astro/TS errors).
- **Never commit** `node_modules/`, `dist/`, `.astro/`, or `.env` — already
  ignored, just don't force them in.

## Assets

Brand fonts and artist stills live in `frontend/public/`. Optimize new images
(prefer `.webp`) — they ship to every visitor.
