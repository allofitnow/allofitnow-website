---
name: Portfolio Addition
about: Request a new portfolio project on the staging site
title: "[Portfolio] NEW ARTIST"
labels: ["frontend-integration"]
---

## Request

**Artist/Title:** <!-- e.g. BAD BUNNY -->
**Client/Label:** <!-- e.g. LIVE NATION -->
**Year:** <!-- e.g. 2024 -->

## Content Fields (per wiki: Adding a New Portfolio Project to the Staging Site)

| Field | Value |
|---|---|
| `slug` | <!-- kebab-case, e.g. bad-bunny --> |
| `role` | <!-- REAL-TIME CONTENT / SCREENS PRODUCTION / MIXED REALITY / EQUIPMENT RENTAL --> |
| `scope` | <!-- e.g. LED / PLAYBACK --> |
| `capabilities` | <!-- 1–4 of the taxonomy, comma-separated --> |
| `tour` | <!-- ALL CAPS, e.g. WORLD TOUR --> |
| `collaborator` | <!-- e.g. ALL OF IT NOW X PHNTM --> |
| `body` | <!-- long description --> |
| `summary` | <!-- short lede (home/project page) --> |
| `writeup.lead` | <!-- lede paragraph --> |
| `writeup.body` | <!-- 1–3 paragraphs --> |
| `stats` | <!-- label/value pairs, e.g. LED SURFACE / 1,240m² --> |
| `credits` | <!-- credit groups + IG handles --> |

## Media Assets

<!-- Attach or link the following (thumb/hero can be the same file):
  - thumb.webp (≤1MB, ~1200×800)
  - hero.webp (optional, same as thumb OK)
  - gallery.webp (1–6 stills)
-->

- [ ] thumb attached
- [ ] gallery stills attached (if any)

## Acceptance

- [ ] Project visible at `http://192.168.30.245/work/<slug>`
- [ ] Content matches the values above (live CMS data, not placeholders)
- [ ] Renders consistent with existing portfolio pages (pixel-parity gate)
