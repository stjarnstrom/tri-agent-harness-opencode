# Guardrail proposal: empty-state-checklist

> **Example only.** Draft from the anti-slop loop when a lesson hits 2 strikes across runs.

**Lesson:** Every list-first screen must ship an empty state in the same sprint as the list. (2 strikes: Taskflow sprint 2, Kanban demo sprint 1)  
**Mechanism:** review-persona checklist item  
**Status:** proposed — a human reviews, commits the guardrail, then sets the ledger entry's status to `graduated`.

## Draft implementation

Add to `review-personas/frontend-architecture.md` under **First-run & empty states**:

```markdown
- [ ] Every route whose primary content is a list or grid includes a designed empty state (copy + primary action) when the collection is empty — not a blank main area.
- [ ] Empty state is verified in QA for the same sprint that introduces the list.
```

## Why this beats a lesson

Prompt-reading alone did not stop the Generator from marking Sprint 2 Ready for QA without an empty state. A checklist item on the Evaluator's review path catches it before sign-off.
