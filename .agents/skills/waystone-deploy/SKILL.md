---
name: waystone-deploy
description: Deploy Waystone releases and updates to Mars using the shared Cursor and Codex deployment runbook.
---

Read `repositories/agent-context/skills/waystone-deploy/SKILL.md` from the app root and follow it for release/deployment tasks. That private repository is the canonical cross-agent context.

If missing, clone `https://github.com/waystone-workshop/agent-context.git` into `repositories/agent-context`. If present and clean, run `git -C repositories/agent-context pull --ff-only`. Preserve local edits. Read its `context.md` and `handoff.md`; verify dated state against GitHub/Mars. If access fails, report the blocker and use `deploy/mars/README.md` plus the actual workflow for independent preparation; do not invent missing context or claim a deployment succeeded.
