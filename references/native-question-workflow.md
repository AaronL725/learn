# Native question workflow

The teaching skill's body remains unchanged. Its `quiz` tool maps to the complete sequence below; do not ask a question while omitting grading or confirmation to continue.

1. Write `.learn/quiz-input.json` (an internal file; do not show it to the learner): `name` (quiz or ask_user_question), `sessionId` (provided by SessionStart), `question`, `details` (optional), `options` (label/value/optional description), `multiSelect` (optional), `correctAnswer` (required for quiz; a stable value or an array), `explanation` (required for quiz), and `shuffle` (true by default).
2. Execute `node "<SKILL_DIR>/scripts/quiz.mjs" prepare .learn/quiz-input.json` through the native shell to obtain an `id` and a safe `request`. The correct answer and explanation are stored only in `.learn/quizzes/`; do not display them before submission. The native tool's detailed view may show the file-writing command; as in Pi, the model holds the answer. During normal answering, the learner reads only the question and Obsidian.
3. Call `request_user_input(request)` exactly as returned, from the root agent, one question at a time. Ordinary single-choice questions retain all options, randomized ordering, and “I don't know”; Tab allows optional reasoning with any answer. Do not add recommended labels or hint at the answer. Use prepare's `--compact` only if the interface enforces a maximum of three options: retain all numbered options in the question text, enter the selected number on the first line of Tab notes, and reasoning on subsequent lines.
4. Native multi-select has no checkboxes, so submit the complete set of indices at once: choose “Submit selected indices”, enter `1,3` on the first line of Tab notes, and optionally add reasoning on subsequent lines. Do not ask or grade each option separately; grading requires an exact match of the complete set. Notes are still allowed with “I don't know”, which cannot be combined with indices. Ungraded multi-select allows `Other: custom answer` on a separate subsequent line, combined with the indices; for free-text questions, choose “Submit text” and enter the original response in Tab notes.
5. After submission, the log watcher automatically grades locally on its next refresh (approximately 300 ms plus CLI disk-write time), appending the answer, reasoning, correct answer, and explanation to Obsidian without waiting for the model to grade again. Grading continues while logging is paused; relinking the log backfills questions and answers from the paused interval. Execute `node "<SKILL_DIR>/scripts/quiz.mjs" result <id> <sessionId>` to obtain the same deterministic result. If logging is temporarily unavailable, write the **original response returned by the native tool**, along with id/sessionId, to JSON and use `grade <JSON-file>`; never fabricate a response.
6. When the result is answered, display the returned feedback and immediately call a second native question with id `continue_<original-question-id>`, the complete feedback in question, and options “Continue” (continue after reading the feedback) and “Pause” (pause, clarify, or ask a question). Tab notes remain available. Advance only after an explicit “Continue”. Handle Pause/Other or questions in the notes first. Cancellation does not permit advancement.
7. Empty responses, timeouts, tool cancellations, and invalid/duplicate/out-of-range indices are not wrong answers, are not “I don't know”, do not establish mastery, and do not imply permission to continue. Explain the state and re-ask the same id/request, preserving the order; stop when explicitly asked to stop. Do not prepare again. A retry may replace an earlier invalid response, but cannot overwrite an already graded valid answer.

Codex 0.162.1 in Default mode returns an empty response after a 60-second invisible grace period plus a 60-second countdown if no key is pressed. Any keypress or paste cancels that question's automatic timer. Pressing an arrow key once before thinking allows an unlimited wait; Plan mode has no such timer. The tool has no parameter to disable this timer; MCP's tool_timeout_sec is not a native question timeout setting.

The CLI cannot run custom grading or inject feedback within its native selection pane. Obsidian feedback is therefore written immediately by the local watcher; CLI feedback and the next “Continue” pane require one model processing round and incur network latency. This remaining interface timing difference is not fully equivalent to Pi's immediate feedback in the same pane. Markdown/LaTeX/Mermaid render natively in Obsidian; the CLI displays their source text.

## Upstream tool guidelines (original text preserved in full)

The `quiz` / `ask_user_question` tools below are the compatibility sequences defined above. A change in names does not change these guidelines; Pi's original note field is handled by native Tab notes.


### quiz

- quiz is GRADED; ask_user_question is not. If the question has a correct answer, use quiz. If you just need a preference, decision, or open-ended input, use ask_user_question.
- correctAnswer is REQUIRED and is the option value, not a position number. Single-select: one string (e.g. "mercury"). Multi-select: an array of strings (e.g. ["belize", "niue"]).
- Always pass the option's `value` string as correctAnswer — it is self-checking and prevents miscounting positions. A value that matches no option is a hard error.
- explanation is REQUIRED — always say why the correct answer is correct.
- Multi-select is graded as an exact-set match: the user is correct only if they select every correct option and no incorrect ones.
- There is no free-text mode. An 'I don't know' choice is ALWAYS added automatically — provide ONLY the real, gradable options (at least two). Never add your own uncertainty/opt-out option like 'I don't know', 'I'm not sure', or 'Not sure'; that is handled for you and a manual one would be redundant or gradable-as-wrong.
- If a result comes back as dontKnow, the user honestly did not know and did NOT guess — treat it as a genuine knowledge gap to teach into, not as a wrong answer.
- Any answer (right, wrong, or 'I don't know') may carry an optional free-text `note` the user typed in the always-present note field. When present it reflects what they were thinking or unsure about — read it and let it steer your follow-up. It is omitted entirely when empty.
- Treat each wrong answer (distractor) as a diagnostic probe, not just filler: make it a specific, believable mistake the user might actually hold — a common misconception, or an adjacent/easily-confused concept — so that WHICH wrong answer they pick reveals WHICH nuance of their understanding is off. You learn far more from a targeted wrong choice than from a binary right/wrong, and the choice tells you exactly which gap to teach into next (and what the explanation should address).
- Guardrail: every distractor must be unambiguously wrong on the intended reading — tempting, but a real error, not a defensible alternative. Don't drift into trick questions.
- Anti-guessing hygiene: don't let the correct answer stand out by form (longest, most precise, most hedged, or the only one in the right format). Keep options similar in length, specificity, and phrasing so it can't be picked from shape alone.
- Set multiSelect: true only when more than one option is correct.
- Options are shuffled before display by default, so don't worry about which position you list the correct answer in. Set shuffle: false only when option order is meaningful (ordered values, or an 'All/None of the above' option that must stay last).
- To probe nuance, ask several quick quiz questions and adapt each one based on the previous answers, rather than writing one giant question.
- Don't leak the answer through formatting: keep option phrasing/length even and don't hint which is correct.

### ask_user_question

- Ask exactly one question per tool call.
- If you need answers to multiple questions, make multiple separate ask_user_question tool calls instead of combining them into one prompt.
- Users will always be able to select "Other" to provide custom text input when options are provided.
- Use multiSelect: true only when you need multiple answers to the same question.
- If you recommend a specific option, make it the first option in the list and add "(Recommended)" at the end of the label.
- Prefer this tool over guessing when requirements, preferences, or implementation choices are unclear.
- Use this tool when multiple valid implementation paths exist and the preferred path depends on user choice.
