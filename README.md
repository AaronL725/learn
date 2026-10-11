# Learn

A portable learning skill for Codex CLI and Obsidian. It probes your understanding, presents a learning plan for approval, and teaches through connected concepts rather than memorized facts.

## Features

- Native CLI quizzes with optional reasoning notes, deterministic grading, feedback, and explicit confirmation before continuing.
- Single-choice and multi-select questions; multi-select answers use a complete set of indices in Tab notes.
- Research and visual subagents, with diagrams rendered and inspected before publication.
- Live Obsidian learning logs supporting Markdown, LaTeX, Mermaid, and embedded images.
- Project-local notes and state, independent of the skill's installation location.

## Installation and use

Place this complete folder at `~/.codex/skills/learn`. Keep its scripts, references, and agent templates together.

Requirements: Node.js 22.15 or newer, an authenticated Codex CLI, Chrome or Chromium, and Obsidian. Native questions require `default_mode_request_user_input` in Default mode.

From the project where you want to learn, run:

```bash
node "$HOME/.codex/skills/learn/scripts/setup.mjs"
codex
```

Trust the project and review its learning log hooks through `/hooks`, then restart or resume Codex. Invoke `$learn` with a learning request in your preferred language. Open the project in Obsidian to read `learning-log.md`.

The skill keeps learning logs, generated images, and session state in the invoking project. See [installation and relocation](references/installation-and-relocation.md) and [native question workflow](references/native-question-workflow.md) for details.
