Dispatch the retrospective to the **retrospector** subagent so it runs in its
own clean, isolated context — do **not** distill lessons in this conversation
yourself.

Launch the `retrospector` subagent now using the Agent tool
(`subagent_type: retrospector`). Pass it this task:

> Read `agents/retrospector.md` and your other required inputs. Distill the
> `LESSON-CANDIDATES` blocks from all QA reports into `harness/lessons.jsonl`,
> regenerate `harness/LESSONS.md` via `node scripts/render-lessons.mjs`, run
> `node scripts/validate-lessons.mjs`, draft guardrail proposals for lessons at
> 2+ strikes, and commit.
>
> Additional context: $ARGUMENTS

Why a subagent: distillation should judge the run's artifacts cold, without
this session's context biasing which failures feel important. All handoff is
through files: the ledger, `harness/LESSONS.md`, and `docs/proposals/`.

When the subagent returns, relay its summary to me: lessons added/updated,
lessons retired, proposals drafted (these need my review), and validation
status.
