# Interface prototype

`easycut.html` is a single self-contained file — no build, no server. Open it in a
browser and the whole product is walkable: marketing homepage, the app shell with
its sidebar, the dashboard, the guided upload, the twelve processing stages, the
result screen and the timeline editor.

It is a **design artifact, not the product**. Nothing in it touches the pipeline in
`src/`; the numbers, transcript and B-roll picks are fixtures chosen to match what
a real short-form run actually produces. It exists so the flow can be argued about
before it is built into the Next.js app.

Two things it is deliberately strict about:

- The upload asks **one question per screen** (footage → format → how finished →
  look). The earlier version stacked all five sections on one page, which is a
  form, not a flow — and the promise of the product is that there is almost
  nothing to decide.
- The last step is a **studio**, not a panel: the sidebar stays, and everything
  to its right becomes an ordinary editor — tools across the top, the picture in
  the middle, a docked timeline underneath. Nothing about that layout is novel,
  which is the point. Someone who has opened any editor before already knows
  where things are, and the one thing they should have to learn here is that
  they mostly do not need it.
- The timeline is the real interaction model, not a picture of one: one clock
  shared by the preview and the tracks, clips that drag, trim, snap and collide,
  and an export that reads back the edited document. The preview and the tracks
  are single DOM nodes that move between layouts rather than being duplicated —
  one animation loop, one playhead, one document, wherever they are mounted.
