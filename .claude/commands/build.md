Dispatch the build phase to the **generator** subagent so it runs in its own
clean, isolated context — do **not** implement the sprint in this conversation
yourself.

Launch the `generator` subagent now using the Agent tool (`subagent_type: generator`).
Pass it this task:

> Read `agents/generator.md`, the spec, sprint plan, sprint status, criteria,
> and any prior QA/mechanical-check reports, then build the current sprint:
> write its contract if missing, implement it, commit as you go, run
> `bun lint:harness`, write your self-evaluation, and mark the sprint
> "Ready for QA" per your instructions.
>
> Additional context: $ARGUMENTS

Why a subagent: the Generator builds and a separate Evaluator judges. Running
the generator in its own context (rather than role-playing it here) keeps this
session out of the Evaluator's context, so QA stays independent — the same
isolation the autonomous `./harness.sh` gets by launching each phase as a
separate process. All handoff is through files in `docs/`.

When the subagent returns, relay its summary to me — sprint number, what it
built, known gaps, and lint/status confirmation — and tell me the next step:
run `/qa` to evaluate the sprint. Do not re-do the build work in this thread.
