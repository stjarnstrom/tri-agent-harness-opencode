# Optional design input

Add visual direction before running the harness. If this folder is empty, the Planner defines the design language in `docs/spec.md` from your product prompt.

## Quick start

```bash
cp docs/templates/design-brief.md design/brief.md
# Edit brief.md; add mood images to design/references/ if helpful
./opencode-harness.sh "Your product prompt"
```

## Files

| File | Purpose |
|------|---------|
| `brief.md` | Primary design direction (authoritative) |
| `constraints.md` | Must-have / must-not rules |
| `references/` | Screenshots, logos, mood images (png, jpg, webp, svg) |

## Git

Commit `design/` when you want direction to persist. Add large private assets to `.gitignore` under `design/references/` if needed.
