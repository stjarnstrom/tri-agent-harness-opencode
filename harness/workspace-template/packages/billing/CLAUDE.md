# Billing Domain — Agent Instructions (CLAUDE.md)

You are working inside the `billing` package. Claude Code reads this file automatically when you work in this directory. It contains rules specific to billing code that don't apply elsewhere in the project.

## What This Package Does

The billing domain handles:
- Subscription creation and management
- Checkout flows (Stripe, PayPal)
- Invoice generation and history
- Payment method storage

## Domain-Specific Rules for Agents

### Data Models

All billing types live in `packages/shared-types/src/enums.ts` under the `BillingPlan` and `InvoiceStatus` namespaces. **Do not redefine these.** Import from shared-types.

```typescript
import { BillingPlan, InvoiceStatus } from '@app/shared-types';
```

### Fetching Data

Use the canonical network helper — never bare `fetch()`:

```typescript
// Correct:
const plan = await fetchWithTimeout('/api/plans', { timeoutMs: 5000 });

// Wrong:
const response = await fetch('/api/plans');
```

See `packages/utils/src/network.ts` for the implementation. If you need a new endpoint pattern, add it there — not in billing.

### Error Handling

Billing errors must be user-facing and actionable:

| Error | User Message | Log Level |
|-------|-------------|-----------|
| Card declined | "Your card was declined. Please try another payment method." | error |
| Subscription already exists | "You already have an active subscription." | warn |
| Network timeout | "We couldn't reach our payment processor. Try again in a moment." | error + retry |

Do not expose raw error messages from Stripe or your payment provider to the user.

### Testing

Billing tests must use test doubles for payment providers — never call real APIs:

```typescript
// Use the mock factory:
import { createMockPaymentProvider } from '@test-helpers/billing';

const provider = createMockPaymentProvider({ status: 'succeeded' });
```

## What Other Packages May Import From You

Only what's exported through `src/index.ts`. If another team needs billing data, they import the public API — not internal implementation details.

**Do not export:**
- Internal checkout state machines
- Stripe webhook handlers (internal only)
- Raw payment provider types

## Review Checklist

When submitting PRs that touch billing code:
1. Did you use `fetchWithTimeout` for all network calls?
2. Are error messages user-friendly, not raw provider errors?
3. Did you add tests with mocked payment providers (not real API calls)?
4. Did you only export what belongs in the public API?
