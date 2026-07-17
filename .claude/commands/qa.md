Dispatch the QA phase to the **evaluator** subagent so it runs in its own clean,
isolated context — do **not** evaluate the sprint in this conversation yourself.

Launch the `evaluator` subagent now using the Agent tool (`subagent_type: evaluator`).
Pass it this task:

> Read `agents/evaluator.md`, the spec, the sprint contract marked
> "Ready for QA", the mechanical-check results, criteria, and review personas.
> Start the app, test every acceptance criterion end-to-end with the Playwright
> MCP tools, grade with the weighted formula, write `docs/qa-report-sprint-[N].md`,
> and update `docs/sprint-status.md` with the result per your instructions.
> Be skeptical; find problems.
>
> Additional context: $ARGUMENTS

Why a subagent: the Evaluator's judgment must be independent of the Generator's.
Running it in its own context (rather than role-playing it here) means it hasn't
absorbed this session's history or the Generator's self-justification — the same
isolation the autonomous `./harness.sh` gets by launching each phase as a
separate process. It also gets its own Playwright MCP browser session. All
handoff is through files in `docs/`.

When the subagent returns, relay its summary to me — PASS/FAIL, weighted total,
any criteria below threshold, and the top blocking issues — and tell me the next
step: on PASS run `/build` for the next sprint; on FAIL run `/build fix the QA
failures`. Do not re-do the evaluation in this thread.
