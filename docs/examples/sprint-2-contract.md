# Sprint Contract — Sprint 2: Habits + check-in

> **Example only.** Generator output before QA.

## Scope

**Sprint goal:** Users can create habits, see them on the home screen, and mark today complete with persistence across refresh.

**Features from spec:** Habit list home (#1), quick check-in (#2), habit create/edit (#4).

## Implementation approach

- Zustand store with `localStorage` sync on every mutation
- `Habit` type: `id`, `name`, `emoji?`, `completions: string[]` (ISO date strings)
- Home route `/` lists habits; `/habits/new` and `/habits/:id/edit` for CRUD
- Check-in toggles today's date in `completions` (idempotent)

## Acceptance criteria

### Feature: Habit list home
- [ ] Home shows all habits with name and emoji (or default icon)
- [ ] Each row shows done/undone state for **today**
- [ ] Empty state when no habits exist, with link to create first habit

### Feature: Quick check-in
- [ ] Clicking row or checkbox marks habit done for today
- [ ] Second click same day undoes check-in (toggle)
- [ ] After refresh, done state matches last action

### Feature: Habit create/edit
- [ ] User can create habit with name (required) and optional emoji
- [ ] User can edit name/emoji and delete habit (confirm dialog)

## Design requirements

- [ ] Midnight ledger palette from spec (navy surfaces, amber primary)
- [ ] Check-in uses 180ms ease-out animation per spec
- [ ] Mobile layout: single column, 44px min touch targets

## Out of scope

- Streak calculation (Sprint 3)
- AI naming (Sprint 4)
- Backend / accounts

## Test setup notes

- Seed: optional — empty store is valid for empty-state test
- Run: `cd app && npm run dev` (port 5173)
- Clear data: DevTools → Application → localStorage → `taskflow-habits`

## Definition of done

- All acceptance criteria pass via Playwright
- No console errors on happy path
- Commits with descriptive messages

---

## Generator self-evaluation

- [x] Habit CRUD routes implemented
- [x] Check-in toggle persists to localStorage
- [x] Empty state on home
- [x] Design tokens applied (navy/amber)
- [ ] Streak display — **deferred to Sprint 3** (not in this contract)
