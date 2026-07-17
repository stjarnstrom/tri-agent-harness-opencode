Dispatch this to the **claude-md-optimizer** subagent so it runs in its own
clean, isolated context — do **not** analyze or rewrite the CLAUDE.md in this
conversation yourself.

Parse `$ARGUMENTS` for two optional things:
- A **target path** — a `CLAUDE.md` file or a project directory containing one.
  Default to `./CLAUDE.md` if none is given.
- The word **`apply`** — if present, run in apply mode (overwrite the target in
  place); otherwise run in propose mode (write a sibling `CLAUDE.optimized.md`
  and leave the original untouched).

Launch the `claude-md-optimizer` subagent now using the Agent tool
(`subagent_type: claude-md-optimizer`). Pass it this task:

> Read the target CLAUDE.md and explore its surrounding codebase, then optimize
> the file for token economy without loss of quality per your instructions: cut
> anything Claude can infer from the code (or a senior dev could find in ~20
> minutes), keep the non-inferable decisions, conventions, and gotchas.
>
> Target path: <resolved path, default ./CLAUDE.md>
> Mode: <propose | apply>

Why a subagent: judging "can this be inferred from the code?" means reading much
of the codebase, and that exploration should not pollute this conversation's
context. It runs on Fable (big-picture analysis / review), consistent with the
harness model policy.

When the subagent returns, relay its redline to me — the before/after size and
% reduction, the grouped CUTs with reasons, and anything it deliberately kept —
and tell me the next step: in propose mode, diff `CLAUDE.optimized.md` against
`CLAUDE.md` and replace it if I'm happy (or re-run with `apply`); in apply mode,
review the git diff. Do not re-do the analysis in this thread.
