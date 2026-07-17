# HTML Field Guide — docs/guide.html

**Date:** 2026-07-14
**Status:** Approved design

## Goal

A single, visually polished, self-contained HTML page that teaches someone how
to use the tri-agent harness — more approachable than the README, styled in the
spirit of the openchamber-01 stack docs (`~/Code/openchamber-01/docs/stack-*.html`)
but with this project's own identity.

## Decisions

| Question | Decision |
|----------|----------|
| Scope | Single page: `docs/guide.html` |
| Styling | Same editorial system as openchamber docs (eyebrows, plates, timeline, console blocks), own identity |
| Dependencies | None — one self-contained file, zero JS, zero external requests |

## Visual identity

- Paper: warm cream `#faf7f2`; ink: deep green-black `#1c2420`
- Accents: deep green `#2d6a4f` (build/judge loop), rust amber `#b4540a` (learning loop)
- Type: serif display headings (Iowan Old Style / Palatino stack), system-sans
  body, `ui-monospace` for eyebrows/labels/code — deliberately inverts the
  reference's serif-body/sans-display pairing
- Components carried over from the reference system: mono uppercase eyebrows,
  `.plate` SVG diagram panels with captions/legends, card grids, animated-pulse
  timeline (disabled under `prefers-reduced-motion`), dark console code blocks,
  mono-header tables

## Content outline

1. Masthead + mono anchor nav
2. Hero: eyebrow "Field guide", headline, thesis (separate creation from
   judgment; the harness learns between runs), doc-meta
3. **The loop** — SVG: Planner → Generator → Pre-QA Gate → Evaluator with
   fail-arrow back to Generator; Retrospector at the end feeding LESSONS.md
   back to the start. Legend: create / judge / learn.
4. **The four agents** — card grid with model tags (Fable ×3, Sonnet)
5. **Quick start** — console block: `bun install && bun run setup`,
   `./harness.sh "prompt"`, resume-by-rerun; design-scout pause note
6. **Anatomy of a run** — timeline: planning → contract → build → gate → QA
   rounds → pass/halt → retro, with rough durations
7. **Usage modes** — autonomous vs interactive (`/project:plan|build|qa|retro`);
   note on Cursor/OpenCode runners
8. **Artifacts map** — table: file → written by → what it tells you
9. **The learning loop** — amber section, small SVG (candidates → ledger →
   LESSONS.md → 2-strike proposals → graduation), `lessons:*` commands
10. **Controls** — env-var reference table
11. Footer: pointers to README, runtime-contract, AGENT-INSTRUCTIONS

## Constraints

- Content must match current reality: 4 phases, model policy, env vars incl.
  `HARNESS_RETRO`/`HARNESS_RETRO_MODEL`, lessons commands, 25-lesson cap
- Responsive: plates/tables scroll inside their own containers; timeline rail
  collapses on mobile; no horizontal body scroll at 375px
- A11y: focus-visible outlines, reduced-motion support, semantic headings

## Verification

- Open in browser at desktop (1280) and mobile (375) widths
- All nav anchors land on their sections
- No console errors; no external network requests
- Link the guide from README's documentation map
