# Taskflow — Spec excerpt

> **Example only.** Abbreviated Planner output. Full spec would include all features, data model, and AI integration.

---

## Overview

Taskflow helps people build daily routines by making check-ins frictionless and streaks visible. The product should feel calm and intentional — a private ritual tracker, not a gamified social feed.

**Primary user:** someone maintaining 3–8 personal habits who wants streak feedback without account setup.

## Design Language

**Aesthetic:** *Midnight ledger* — deep navy surfaces, warm amber accents, monospace streak numerals.

| Role | Value |
|------|--------|
| Background | `#0f1419` |
| Surface | `#1a2332` |
| Primary action | `#f59e0b` (amber) |
| Text | `#e7ecf3` / `#8b9cb3` muted |

**Typography:** "Fraunces" display for habit names; "IBM Plex Sans" body. **Motion:** 180ms ease-out on check-in; streak number ticks with a subtle scale pulse.

**Signature element:** Streak flame icon that fills with amber as the streak grows (empty ring at 0).

## Features (selected)

1. **Habit list home** — today's habits with done/undone state; empty state when no habits.
2. **Quick check-in** — tap row or checkbox to mark done; persists across refresh.
3. **Streak display** — current streak per habit; longest streak stored.
4. **Habit create/edit** — name, emoji optional; delete with confirm.
5. **AI habit naming** *(Sprint 4)* — user describes a goal; Claude returns 3 name suggestions.

## Stack

React 18 + TypeScript (strict), Vite, Tailwind, Zustand, React Router v6, Framer Motion. localStorage persistence for v1.

## Sprint plan (summary)

| Sprint | Title | Done when |
|--------|-------|-----------|
| 1 | Shell + design system | App runs, nav works, tokens applied |
| 2 | Habits + check-in | Create habits, mark done, data persists |
| 3 | Streaks + analytics | Streak counts correct; weekly chart |
| 4 | AI + polish | Naming helper works; mobile-responsive |
