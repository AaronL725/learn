# Learn

A portable learning skill for Codex CLI and Obsidian. Learn adapts teaching to your requested goal and existing knowledge, building connected understanding through foundational truths and motivated discovery.

## What it does

- Recalls relevant knowledge before diagnosing gaps, reducing repeated questions across projects and sessions.
- Teaches through a motivated path: establish foundations, derive new ideas, connect them, and check understanding.
- Provides native CLI quizzes with optional reasoning notes, deterministic grading, answer explanations, and an explicit Continue/Pause step.
- Supports single-choice and multi-select questions. Multi-select answers use the complete set of indices in Tab notes.
- Keeps multiple topic notes and persistent activity checkpoints, so one learning goal can span several notes and sessions.
- Maintains an editable Knowledge Atlas with learning preferences, concept relationships, gaps, misconceptions, and evidence distinct from interpretations.
- Mirrors completed conversation messages and quiz feedback into Obsidian Markdown, including LaTeX, Mermaid, and image embeds.
- Retains research and visual agents, with diagrams rendered and inspected before publication.

You choose what to learn and when to change notes. Learn does not choose future topics, schedule reviews, or send unsolicited check-ins. Lesson replies and note content follow your language; generated filenames use English.

## Installation

Install the complete skill folder at `~/.codex/skills/learn`, keeping its scripts, references, and agent templates together. The skill can run from that location in any learning project; learning data is stored outside the installation folder.

Requirements:

- Node.js 22.15 or newer.
- An authenticated Codex CLI with native `request_user_input` available. Default mode requires `default_mode_request_user_input` enabled.
- Chrome or Chromium for image rendering.
- Obsidian for reading notes and the knowledge graph.

Initialize each subject project once:

```bash
cd /path/to/your-learning-project
node "$HOME/.codex/skills/learn/scripts/setup.mjs"
codex
```

Setup installs the bundled renderer dependencies and creates learning-specific project configuration, agents, and logging hooks. It preserves unrelated MCP configuration and hooks. Trust the project, review its logging hooks through `/hooks`, then restart or resume Codex. Rerun setup after moving the skill or project.

## Use

Invoke `$learn` with a learning request, for example:

```text
$learn Help me understand the chain rule, starting from what I already know.
```

You can also say:

```text
Continue the chain-rule activity from where we stopped.
Create a new note for applications and continue the same activity.
I have used this formula before, but I do not understand why it works.
```

Open the subject project as an Obsidian vault. Once created during use, open `~/Documents/Knowledge Atlas` as a separate vault for your profile and shared concept network. A new session recalls the relevant activity and evidence instead of assuming the most recent conversation is the one to continue.

For single-choice quizzes, select an answer and press Tab to add optional reasoning. For multi-select, put the full index set, such as `1,3`, on the first notes line and reasoning on subsequent lines. Read the feedback, then explicitly choose Continue or Pause. Empty or timed-out responses are never scored or treated as permission to continue.

## Generated files

| Location | Contents |
| --- | --- |
| Learning project: `<topic>.md` | Topic notes, such as `chain-rule.md`; continuation notes contain a brief handoff and new conversation content. |
| Learning project: `viz/` | Published diagram images; its location is unchanged. |
| Learning project: `.learn/` | Subject identity, activities, checkpoints, session bindings, question caches, and pending memory writes. Keep this private directory out of Git. |
| Learning project: `.codex/` | Learning-specific configuration, logging hooks, and agent copies. |
| `~/Documents/Knowledge Atlas/` | `Atlas.md`, `Profile.md`, concept notes, course/activity snapshots, raw evidence, and a rebuildable index. |

New projects **do not automatically create `learning-log.md`**. A meaningful topic note is created when the learning goal is known. Existing `learning-log.md` files remain supported and are not moved or overwritten. You can explicitly link another existing note.

The Atlas location can be changed through the project's `.learn/project.json`. You can edit its Markdown in Obsidian; version checks reject stale AI updates. Raw evidence preserves what was actually answered, including reasoning, while interpretations remain separately editable. A correct choice with incorrect reasoning is not automatically counted as understanding. If Atlas synchronization fails, local grading and feedback still work, and pending writes can be retried.

## Details and checks

- [Knowledge and activities](references/knowledge-and-activities.md): memory, checkpoints, note switching, direct editing, and script interfaces.
- [Native question workflow](references/native-question-workflow.md): quizzes, notes, grading, continuation, and CLI limitations.
- [Installation and relocation](references/installation-and-relocation.md): portable paths and project setup.

Run the isolated regression suite:

```bash
node tests/regression.mjs
```

To also check actual Mermaid/SVG PNG rendering, the generated Atlas diagram, and the MCP interface:

```bash
node tests/render-regression.mjs
```

Tests remove their fixtures afterwards. Renderer test dependencies are installed inside a removable fixture. Codex transcript formats are version-sensitive; CLI changes may require a logger update. Native CLI feedback requires a model processing round, while local Obsidian feedback is generated by the log watcher.
