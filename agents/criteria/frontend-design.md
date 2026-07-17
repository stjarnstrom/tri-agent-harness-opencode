# Frontend Design Grading Criteria

Use these criteria when evaluating frontend design quality. Both the Generator and Evaluator should internalize these.

## Design Quality (weight: highest)

Does the design feel like a coherent whole rather than a collection of parts?

Strong work means the colors, typography, layout, imagery, and details combine to create a distinct mood and identity. The best designs are museum quality — they have a point of view and commit to it.

**Signals of quality:**

- Consistent visual rhythm across the page
- Color palette that creates mood, not just contrast
- Typography that has personality, not just hierarchy
- Whitespace used with intention, not just as gaps between elements
- Micro-interactions and transitions that feel considered

**Red flags:**

- Different sections feel like different apps
- Colors chosen for "safety" rather than expression
- Every element has the same visual weight
- Layout follows a grid but has no personality within it

## Originality (weight: high)

Is there evidence of custom decisions, or is this template layouts, library defaults, and AI-generated patterns?

A human designer should recognize deliberate creative choices. Unmodified stock components — or telltale signs of AI generation — fail here.

**AI slop patterns to actively penalize:**

- Purple/blue gradients on white card layouts
- Generic hero sections with "Welcome to [Product]"
- Rounded cards with identical padding and shadow
- Gradient text on dark backgrounds (the default "modern" AI aesthetic)
- Feature grids with icon + heading + description in equal columns
- Testimonial carousels with circular avatar photos
- Generic dashboard layouts with sidebar + cards + charts

**What originality looks like:**

- An unexpected layout choice that serves the content
- A color palette that wouldn't be the first suggestion
- Typography pairing that creates a specific feeling
- Navigation patterns that match the product's metaphor
- Use of illustration, texture, or imagery that's distinctive

## Craft (weight: medium)

Technical execution of design fundamentals. This is competence, not creativity.

**Check for:**

- Typography: Clear hierarchy (h1 > h2 > h3 > body). Consistent line heights. Appropriate font sizes.
- Spacing: Consistent padding/margin scale. Elements align to a visible grid. No orphaned elements.
- Color: Sufficient contrast (WCAG AA minimum). Harmonious palette. Consistent use of accent colors.
- Responsive: Layout adapts sensibly to different viewport widths. No horizontal scroll. Touch targets are sized appropriately on mobile.

## Functionality (weight: medium)

Usability independent of aesthetics.

**Check for:**

- Primary actions are immediately findable
- Navigation is predictable
- Form validation provides helpful feedback
- Loading states exist where needed
- Error states are informative, not cryptic
- Empty states guide the user on what to do next