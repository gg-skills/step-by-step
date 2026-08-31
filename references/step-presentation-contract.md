# Step Presentation Contract

Use this contract every time the skill presents the current step.

## Required packet structure

| # | Section | Content |
|---|---------|---------|
| 1 | `# Active Step <current>/<total>: <title>` | Step header |
| 2 | `## Step Status` | `STEP_ID`, session path, queue source, owner, status, prerequisites |
| 3 | `## Preflight Checks` | Checks already run; pass/fail/blocker state |
| 4 | `## What You Need To Do` | Smallest complete set of user actions |
| 5 | `## What I Can Do For You` | Safe agent-side actions available now |
| 6 | `## CHOOSEABLE_OPTIONS` | `AUTOMATION_OPTIONS`, `HELP_OPTIONS`, `CONTROL_OPTIONS` |
| 7 | `## Resolution Check` | Exact evidence required to resolve the step |
| 8 | `## Next Step Preview` | Short preview of the next queued step (only after resolution) |

## Section details

### Step Status

Always include `STEP_ID`, session directory path, queue source (`user list`, repo artifact, task tracker, or `session`), owner (`user`, `agent`, or `shared`), current status, and prerequisite summary.

### Preflight Checks

Report checks already performed. If a check passed, state what was verified. If it failed, keep the step active and explain the blocker. If the agent cannot run a check, state that explicitly and move the missing evidence into `Resolution Check`.

### What You Need To Do

Give the smallest complete set of user actions. Use exact commands, paths, URLs, or UI clicks. If the step is already satisfied, say so and move to resolution confirmation. If only part is manual, describe only that remainder.

### What I Can Do For You

List safe agent-side actions scoped to the current environment. Prefer concrete offers: verifying output, patching files, running a command, or breaking a step into substeps.

### CHOOSEABLE_OPTIONS

Use these groups in this order:

1. `AUTOMATION_OPTIONS`
2. `HELP_OPTIONS`
3. `CONTROL_OPTIONS`

Rules:

- Put the recommended option first within each group and mark it with `(recommended)`.
- Each option uses a selector token in backticks: `ACTION_NAME_IN_SCREAMING_SNAKE_CASE`.
- Each option describes what will happen if selected.
- Accept either the token or a natural-language equivalent.
- Also invoke the harness Ask User picker in the same turn when that tool is available, mapped per `chooseable-options/references/ask-user-harness.md`.

### Resolution Check

Define what counts as complete. Name the exact evidence, state whether the agent can verify it directly, and specify the minimum acceptable user proof if direct verification is impossible. Do not advance until satisfied.

### Next Step Preview

Keep this short. Preview the next queued step only after the current one is resolved. If the current step is still open, state that the workflow remains on this step. Never auto-advance based on a preview alone. After showing the packet, persist it into the session folder before moving on.

For session folder layout and persistence rules, see `session-artifact-contract.md`.
