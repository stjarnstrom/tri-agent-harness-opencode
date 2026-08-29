# Pre-plan input (from another chat — not canonical)

> **Example only.** This is the kind of messy brief you might paste into
> `./opencode-harness.sh "…"`. The Planner still writes the authoritative
> `docs/spec.md` and sprint plan.

---

Build **Taskflow** — a habit tracker where people log daily habits and see streak analytics.

**Users:** individuals building routines (exercise, reading, meditation).

**Must have:**
- Add habits with name + optional emoji
- One-tap "done today" on the home screen
- Streak count per habit (current + longest)
- Dark, calm UI — not generic startup purple

**Nice to have:**
- Weekly bar chart of completion rate
- Claude suggests habit names from a short goal description

**Stack:** React, Vite, Tailwind — keep it simple, local-first (localStorage ok for v1).

**Do not** over-scope: no social, no accounts, no mobile app store — web only.

**Sprints (rough idea — harness will re-slice):**
1. Shell + nav + design tokens
2. CRUD habits + check-in
3. Streaks + analytics
4. AI naming helper + polish
