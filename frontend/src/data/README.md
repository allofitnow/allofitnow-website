# src/data — hardcoded, Payload-shaped content (phase 1)

Each file exports exactly the objects the components consume, in the shape the
Payload collections will eventually mirror. This proves the component seams with
no CMS in the loop. In phase 2 these exports get swapped for Payload REST/GraphQL
fetches — the shape stays, the source changes.

Model the data here **first**, then mirror it in Payload. Not the other way
round — modelling the CMS first means inventing field shapes and bending
components to fit them.

Planned:

- **`home.ts`** — bleed-carousel tiles (artist + still), the selected-clients
  roster, the four capabilities, hero copy, footer info, and the Vimeo reel id
  (currently the `1153696598` stand-in).
