# Personal knowledge and resumable activities

Read this reference when learn is activated, when changing a note, or when updating personal memory. The learner chooses the subject and target. Memory helps teach that target with less repeated diagnosis; it is not a curriculum scheduler.

## Activation and teaching

1. Run all runtime commands from the invoking subject project's directory. Use the real SessionStart sessionId. Read `.learn/project.json` and call `memory.mjs recall` with the requested topic, known concept IDs and this courseId. Read the returned profile, current concept Markdown, evidence and activity summaries. If memory is unavailable, use local activity checkpoints and ask only relevant missing questions.
2. Call `study.mjs open` with the sessionId to inspect its binding or return candidate activities. Resume an activity that matches the learner's request; do not select the latest unrelated activity. If several match, ask which one. For a new goal supply `topic`, an English `slug`, and a title in the learner's language. The response supplies stable activity/note/course IDs and the current revision. `open` with an explicit activityId resumes it in a new session.
3. Reuse evidence within its demonstrated scope. Distinguish demonstrated answers, self-reports, uncertain interpretations, misconceptions and corrections. Evidence from another subject may support a prerequisite without proving its unfamiliar application. A correct choice with flawed notes remains contradictory evidence. Repeated answers to one question are not independent demonstrations.
4. Follow the adaptive teaching reference. Persist checkpoints during learning, after meaningful nodes, at pauses and before switching notes or goals. Include goal, ordered plan, completed nodes, current gap and next step within the existing target. Opening a session is not permission to recommend another target.
5. Read quiz feedback and reasoning, then curate concept interpretations. Raw quiz evidence is recorded automatically; interpretation is the parent teacher's job, not the deterministic grader's. Show feedback and preserve the explicit Continue/Pause gate before teaching further. Memory administration should remain unobtrusive.

## Locations and identities

The personal Atlas defaults to `~/Documents/Knowledge Atlas`. Change the absolute `atlas` path in the project's `.learn/project.json` to use another shared vault. `LEARN_MEMORY_DIR` overrides it for isolated tests or an explicitly chosen runtime store. Do not derive personal memory from the skill installation location.

```text
Knowledge Atlas/
  Atlas.md                  Graph entry and generated Mermaid map
  Profile.md                Preferences and personal notes
  concepts/<english-slug>.md
  courses/course-<id>.md     Subject references and activity snapshots
  .learn/evidence.jsonl      Append-only raw events
  .learn/index.json          Reconstructible cache
```

Project topic notes remain visible Markdown files; `viz/` stays at its existing location. `.learn/project.json` holds the course ID and Atlas locator; `.learn/studies.json` holds activities, checkpoints and stable note IDs; sessions, quizzes and pending writes remain under `.learn/`. Keep this private runtime directory out of source control.

Course, activity, concept, note and session IDs carry identity; paths are locators. A concept title or alias is not its identity. Renaming a concept file preserves its record ID; mapping discovers its new path. Project-local note paths are relative, so moving the complete project retains note bindings after setup is rerun and the activity is opened. For an external note that moved, reopen with its existing noteId and new filepath. Do not copy an initialized project as a new subject without giving it a new course identity.

Open the project and the Atlas as separate Obsidian vaults. Within the Atlas, generated concept wikilinks provide native graph connections; Mermaid labels show their types and directions. Relations may be cyclic (e.g. analogy or contrast); the teaching path for one goal stays ordered. Cross-vault project references are explicit path/course/note/session locators, not misleading wiki links. Raw quiz snapshots and saved checkpoints retain important context if an original project disappears.

## Script interface

Each script returns JSON. Supply input via a private JSON file under the project's `.learn/`; do not put answer keys or personal evidence in public lesson prose. Replace IDs and versions in examples with actual returned values.

```bash
node "<SKILL_DIR>/scripts/memory.mjs" recall .learn/recall.json
node "<SKILL_DIR>/scripts/study.mjs" open .learn/open.json
node "<SKILL_DIR>/scripts/study.mjs" checkpoint .learn/checkpoint.json
node "<SKILL_DIR>/scripts/study.mjs" switch .learn/switch.json
node "<SKILL_DIR>/scripts/memory.mjs" update .learn/concept.json
node "<SKILL_DIR>/scripts/memory.mjs" record .learn/evidence.json
node "<SKILL_DIR>/scripts/memory.mjs" map
node "<SKILL_DIR>/scripts/memory.mjs" sync
```

Recall input:

```json
{"query":"chain rule", "courseId":"course_actual", "conceptIds":[], "evidenceIds":[]}
```

Recall returns matching concepts, their immediate typed neighbors and merge records, the profile, matching course activity snapshots, original evidence, content versions, changedSinceIndex and sync status. Searches match words in titles, aliases, scope and prose; they do not resolve semantic equivalence. Inspect candidates and issue another recall by IDs as needed. Same-name concepts can coexist; do not auto-merge homonyms or assume a search match demonstrates understanding. The Markdown is reread even when the index is corrupt. No percentages or universal mastery threshold are calculated.

New activity input:

```json
{"sessionId":"actual_session", "topic":"Understand the chain rule", "slug":"chain-rule", "title":"Chain rule", "conceptIds":["concept_actual"]}
```

Resume input:

```json
{"sessionId":"new_session", "activityId":"study_actual", "noteId":"note_actual"}
```

Checkpoint input:

```json
{
  "sessionId":"actual_session", "activityId":"study_actual", "revision":3,
  "status":"paused",
  "checkpoint":{
    "summary":"Established composition; learner can explain the two rates.",
    "plan":["Composition", "Local changes", "Product of rates"],
    "completedNodes":["Composition"],
    "currentGap":"Why the local scale factors multiply",
    "nextStep":"Derive the product from a small input change"
  }
}
```

Use the returned revision for subsequent checkpoints, switches, or edits to an existing activity (including conceptIds/status); stale activity writers fail. `goal` explicitly changes this activity's target and requires its current revision. `status` can be active, paused or complete; reopening preserves the status until the teacher changes it in accordance with the learner's intent.

After the learner chooses a continuation note:

```json
{
  "sessionId":"actual_session", "activityId":"study_actual", "revision":4,
  "slug":"chain-rule-applications", "title":"Applications",
  "checkpoint":{"summary":"The product rule for local rates is now established.", "nextStep":"Apply it to a nested function"}
}
```

`switch` creates a uniquely named English Markdown file with a short handoff and forwards only new transcript entries. Supply an existing noteId to return to that activity's note; supply filepath to link an existing Markdown file (slug is still required when adding a new note record). A switch belongs to the same activity; use `open` to start a separate target. Explicit `md_log` keeps its old backfill default; optional `mode: "forward"` starts at the current transcript position. Ad hoc log relinking clears an unrelated activity binding, avoiding incorrect quiz attribution; use study open to restore it.

Concept creation:

```json
{
  "type":"concept", "slug":"chain-rule",
  "fields":{
    "title":"Chain rule", "aliases":["Derivative of a composition"],
    "scope":"Scalar differentiable functions",
    "abilities":["Explains the product of two local rates"],
    "gaps":["Vector-valued application not demonstrated"],
    "misconceptions":[], "uncertainty":"Application evidence is limited",
    "evidenceIds":["evidence_actual"],
    "relations":[{"type":"requires", "targetId":"concept_composition"}]
  },
  "body":"# Chain rule\n\n## Understanding\nThe learner connects composition to local rate changes.\n\n## Personal notes\n"
}
```

A concept update includes `id` and its last returned `version`; fields are merged. Arrays supplied replace their previous arrays, so retain previous evidence/aliases/relationships intentionally. Omitted `body` preserves existing prose; when supplying body, read it first and retain the learner's notes and corrections. Stable identity data is in a delimited JSON record block; readable understanding and personal amendments belong in the Markdown body. Generated Connections and Atlas map sections are rebuilt; edit narrative outside those sections, or edit relation data in the record block.

Profile uses `type: "profile"`, ID `profile`, `fields.preferences` and Markdown body. Store only relevant learning preferences actually stated or supported by observations. A stale version fails instead of overwriting a human edit; recall again and reconcile it. `changedSinceIndex` is a signal to read amendments, not authority to discard them. Invalid/missing record blocks are reported; repair them with the user's text preserved.

To merge genuinely equivalent concepts, update the source with `fields.mergedInto` set to the existing target ID. Retain its original file, raw evidence and narrative; recall resolves the redirect and returns evidence from both IDs. Curate the target with the source's meaningful aliases/abilities/relationships and provenance using a separate version-checked update. Merging is explicit, cycles are rejected, and related-but-distinct concepts stay separate.

Manual evidence input (use a stable event ID for retries):

```json
{
  "id":"self_report_actual_event", "kind":"self-report", "occurredAt":"2026-10-11T08:00:00Z",
  "context":{"courseId":"course_actual", "activityId":"study_actual", "noteId":"note_actual", "sessionId":"actual_session", "conceptIds":["concept_actual"], "scope":"Scalar differentiation"},
  "statement":"I have used the chain rule before, but do not understand why it works."
}
```

Kinds are quiz, self-report, correction, interpretation and checkpoint. Preserve the actual statement; record interpretations separately with referenced evidence IDs. A correction may identify what it supersedes, but never rewrites a past response. Raw quiz events preserve the complete prepared question, stable values, actual display/request order, answer, optional note, grade, explanation, time and preparation-time activity context. Cancellation/timeouts/invalid submissions do not create them. Resume and inherited answered questions reuse the same event; answering a pending forked question records that branch's real submission.

## Durability and limits

Global writes use an Atlas-local lock, stale-process recovery and atomic Markdown replacement; project activity updates use a separate project lock. Evidence is fsynced under the global lock and deduplicated by stable event ID; a different payload with an existing ID is rejected. An incomplete append is retained for inspection and the durable project outbox can replay its complete event. Markdown and evidence are the sources; the index and graph can be rebuilt.

Evidence and course snapshots queue in the project before delivery. Quiz grading and local feedback work while the Atlas is unavailable; `memorySync.status: "pending"` and its errors expose the situation. Retry on activation, meaningful checkpoints or `memory.mjs sync`; do not silently claim synchronization succeeded. Direct memory updates fail visibly and should be retried from freshly recalled Markdown. Replayed older course snapshots cannot replace a newer activity revision.

External editors do not participate in the lock. Versions plus a final reread reject edits detected during an update; avoid simultaneous editing of the exact same record while AI is committing it. The tiny filesystem check/rename interval is not an editor-wide transaction. A crash between project activity save and binding/snapshot publication can leave a recoverable local activity; open it again to rebind and republish. Codex transcript formats remain version-sensitive, and local notes are durable history: rollback changes new backfill, not already written past evidence or notes.
