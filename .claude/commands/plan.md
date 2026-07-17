Dispatch the planning phase to the **planner** subagent so it runs in its own
clean, isolated context — do **not** plan in this conversation yourself.

Launch the `planner` subagent now using the Agent tool (`subagent_type: planner`).
Pass it this task:

> Read `agents/planner.md` and your other required inputs, then expand the
> following product prompt into a full spec, sprint plan, and status tracker
> (or design options if in scout mode), writing all files per your instructions.
>
> Product prompt: $ARGUMENTS

Why a subagent: the Planner, Generator, and Evaluator are meant to be
independent. Running the planner in its own context (rather than role-playing it
here) keeps this session from leaking into the Generator's and Evaluator's
context later — the same isolation the autonomous `./harness.sh` gets by
launching each phase as a separate process. All handoff is through files in
`docs/`.

When the subagent returns, relay its summary to me and tell me the next step
(run `/build` to start Sprint 1, or — in design-scout mode — pick a direction
in `docs/design-options.md` and re-run planning). Do not re-do the planning work
in this thread.
