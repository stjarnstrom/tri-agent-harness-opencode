# Design input (optional)

Provide design direction before running the harness. If this folder is empty, the
Planner will propose three directions in `docs/design-options.md` for you to pick.

## Quick start

```bash
cp docs/templates/design-brief.md design/brief.md
# Edit brief.md; add mood images to design/references/
./opencode-harness.sh "Your product prompt"
```

## Files

| File | Purpose |
|------|---------|
| `brief.md` | Primary design direction (authoritative) |
| `constraints.md` | Must-have / must-not rules |
| `selected-direction.md` | Your pick after reviewing `docs/design-options.md` |
| `references/` | Screenshots, logos, mood images (png, jpg, webp, svg) |

## Propose-and-pick flow

When no brief is provided:

1. Run the harness — Planner writes `docs/design-options.md` only
2. Review the three options
3. Create `design/selected-direction.md` (e.g. `Option B — Terminal Brutalism. Prefer amber accents.`)
4. Re-run with the same product prompt

## Git

Commit `design/` when you want direction to persist. Add large private assets to
`.gitignore` under `design/references/` if needed.
