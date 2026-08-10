# AOIN frontend (Astro)

The Astro app for the All Of It Now site. Project overview, repo shape, and the
flight-transition notes live in the [root README](../README.md); the coworking
workflow is in [CONTRIBUTING](../CONTRIBUTING.md).

## Commands

Run from this `frontend/` folder (Node ≥ 22.12):

| Command             | Action                                        |
| :------------------ | :-------------------------------------------- |
| `npm install`       | Install dependencies                          |
| `npm run dev`       | Dev server (LAN-exposed) → `localhost:4321`   |
| `npm run dev:local` | Dev server, localhost only                    |
| `npm run build`     | Production build → `./dist/`                  |
| `npm run preview`   | Preview the production build                  |
| `npm run check`     | Astro + TypeScript diagnostics                |
| `npm run format`    | Prettier (writes `src/**`)                    |

## Layout

```
src/
├─ styles/tokens.css   # dialed :root tokens + @font-face — do not "round" values
├─ lib/                # flight.ts, hovercard.ts, home.controller.ts (framework-agnostic)
├─ data/               # hardcoded, Payload-shaped content (phase 1)
├─ layouts/            # Base.astro (ClientRouter, persisted chrome, flyer + hover card)
├─ components/         # chrome/, home/, work/
└─ pages/              # index.astro, work/
```
