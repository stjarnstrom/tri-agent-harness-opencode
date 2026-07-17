# Full-Stack Application Grading Criteria

Use these when evaluating complete applications (frontend + backend + data + AI features).

## Feature Completeness (weight: highest)

Does the implementation match the spec and sprint contract?

- Every user story should be testable end-to-end
- "Implemented" means it works when you actually use it, not that the code exists
- Partial implementations count as failures — stubs, placeholder text, and TODO comments are not features
- Test both creation and consumption flows (can I create a thing AND view/edit/delete it?)

## Product Depth (weight: high)

Does the application feel like a product, or a demo? Would the intended user
recognize this as something they'd actually use?

**Signals of depth:**

- Data persists across page refreshes
- Related features connect to each other (creating X in one place makes it available in another)
- The app handles the "second use" — not just first-time setup but ongoing work
- Settings and preferences actually affect behavior
- The tool's logic matches how the work actually gets done
- Information hierarchy is right for how people need to use it

**Demo-ware signals:**

- Features that work in isolation but don't connect
- No persistence (everything resets on refresh)
- Only the happy path works
- No consideration of the user's second session

## Visual Design

(See `criteria/frontend-design.md` for the full breakdown.)

Apply all four criteria: Design Quality, Originality, Craft, Functionality.

## Code Quality (weight: medium)

Not visible to users but affects maintainability and bug surface.

- Components are composable and single-responsibility
- State management is clean (no prop drilling > 2 levels without context)
- API endpoints are RESTful with consistent naming
- Error handling exists at API boundaries
- No console errors or warnings in normal use
- TypeScript types are meaningful (not `any` everywhere)

## AI Integration Quality (weight: medium, when applicable)

When the spec includes AI features:

- The AI agent has proper tool definitions that map to real app functions
- Tool calls produce visible results in the UI
- Streaming is implemented for good perceived performance
- Error states are handled gracefully (API failures, rate limits)
- The AI integration feels native, not bolted on
- The agent can complete meaningful multi-step tasks, not just answer questions