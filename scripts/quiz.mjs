import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROOT, callout, statePath, flush } from './md-log.mjs';

export function normalizeOptions(input = [], unique = false) {
  if (!Array.isArray(input)) throw new Error('options must be an array');
  const seen = new Set();
  return input.map(o => {
    if (typeof o?.label !== 'string' || (o.value !== undefined && typeof o.value !== 'string') || (o.description !== undefined && typeof o.description !== 'string')) throw new Error('Invalid option');
    return { label: o.label.trim(), value: o.value?.trim() || o.label.trim(), ...(o.description?.trim() ? { description: o.description.trim() } : {}) };
  }).filter(o => {
    if (!o.label) return false;
    if (unique && seen.has(o.value)) throw new Error(`Duplicate option value: ${o.value}`);
    seen.add(o.value); return true;
  });
}
export function prepare(name, params) {
  if (!['quiz', 'ask_user_question'].includes(name)) throw new Error('Unknown question type');
  if (params.details !== undefined && typeof params.details !== 'string') throw new Error('details must be a string');
  for (const key of ['multiSelect', 'shuffle']) if (params[key] !== undefined && typeof params[key] !== 'boolean') throw new Error(`${key} must be a boolean`);
  if (typeof params.question !== 'string' || !params.question.trim()) throw new Error('question is required');
  const options = normalizeOptions(params.options, name === 'quiz');
  if (name === 'quiz' && options.length < 2) throw new Error('quiz requires at least two options');
  if (name === 'quiz' && params.shuffle !== false) {
    for (let i = options.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [options[i], options[j]] = [options[j], options[i]]; }
  }
  const mode = options.length === 0 ? 'text' : params.multiSelect ? 'multi-select' : 'single-select';
  let correctIndices = [];
  if (name === 'quiz') {
    if (typeof params.explanation !== 'string' || !params.explanation.trim()) throw new Error('explanation is required');
    let correct = params.correctAnswer;
    if (typeof correct === 'string' && correct.trim().startsWith('[')) { try { const p = JSON.parse(correct); if (Array.isArray(p)) correct = p.map(String); } catch {} }
    correct = Array.isArray(correct) ? correct : [correct];
    if (!correct.length || correct.some(v => typeof v !== 'string')) throw new Error('correctAnswer is required');
    correctIndices = [...new Set(correct.map(v => {
      const i = options.findIndex(o => o.value === v.trim());
      if (i < 0) throw new Error(`correctAnswer ${v} does not match an option value`);
      return i + 1;
    }))].sort((a, b) => a - b);
    if (mode === 'single-select' && correctIndices.length !== 1) throw new Error('Single-select requires exactly one correct answer');
  }
  return { name, question: params.question, context: params.details?.trim(), mode, options, correctIndices, explanation: params.explanation?.trim() };
}
export function publicQuestion(q) {
  const { name, question, context, mode, options } = q;
  return { name, question, context, mode, options: options.map((o, i) => ({ index: i + 1, label: o.label, description: o.description })) };
}
export function grade(q, input) {
  const indices = input.indices || [];
  if (!Array.isArray(indices) || indices.some(i => !Number.isInteger(i) || i < 1 || i > q.options.length) || new Set(indices).size !== indices.length) throw new Error('Invalid selection');
  const dontKnow = input.dontKnow === true;
  if (dontKnow && (q.name !== 'quiz' || indices.length)) throw new Error('I don’t know is exclusive');
  if (q.mode === 'single-select' && indices.length > 1) throw new Error('Choose one answer');
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  const other = typeof input.other === 'string' ? input.other.trim() : '';
  if (!dontKnow && !indices.length && !(q.name !== 'quiz' && (other || q.mode === 'text'))) throw new Error('Select at least one answer');
  if (q.name !== 'quiz' && q.mode === 'single-select' && other && indices.length) throw new Error('Choose Other or one real answer');
  const answers = [...indices].sort((a, b) => a - b).map(index => ({ ...(q.name !== 'quiz' ? { type: 'option' } : {}), index, ...q.options[index - 1] }));
  if (q.name !== 'quiz' && (other || q.mode === 'text')) answers.push({ type: q.mode === 'text' ? 'text' : 'other', label: other, value: other });
  const result = { status: 'answered', question: q.question, context: q.context, mode: q.mode, answers, ...(note ? { note } : {}) };
  if (q.name === 'quiz') Object.assign(result, { options: publicQuestion(q).options, correctIndices: q.correctIndices, correct: !dontKnow && indices.length === q.correctIndices.length && [...indices].sort((a, b) => a - b).every((v, i) => v === q.correctIndices[i]), dontKnow, explanation: q.explanation });
  return result;
}
export function feedbackBlock(result, name) {
  if (result.status === 'cancelled') return callout('warning', `${name === 'quiz' ? 'Quiz' : 'Question'} — cancelled`, '(user skipped)');
  if (name !== 'quiz') return callout('example', 'Answer', (result.answers.map(a => a.type === 'option' ? `${a.index}. ${a.label}` : a.type === 'other' ? `Other: ${a.label}` : a.label).join('\n') || '(empty response)') + (result.note ? `\n\nNote: ${result.note}` : ''));
  const title = result.dontKnow ? 'Quiz — I don’t know' : result.correct ? 'Quiz — correct ✓' : 'Quiz — incorrect ✗';
  const type = result.dontKnow ? 'question' : result.correct ? 'success' : 'failure';
  const selected = result.dontKnow ? 'I don’t know (genuine knowledge gap, no guess)' : result.answers.map(a => `${a.index}. ${a.label}`).join(', ');
  const correct = result.correctIndices.map(i => `${i}. ${result.options[i - 1].label}`).join(', ');
  const marked = result.options.map(o => {
    const mark = result.correctIndices.includes(o.index) ? '✓' : result.answers.some(a => a.index === o.index) ? '✗' : ' ';
    return `${mark} ${o.index}. ${o.label}${o.description ? ` — ${o.description}` : ''}`;
  }).join('\n');
  return callout(type, title, `${marked}\n\nYour answer: ${selected}\nCorrect answer: ${correct}${result.note ? `\n\nNote: ${result.note}` : ''}\n\n${result.explanation}`);
}

function quizPath(id, sessionId) {
  if (!/^(quiz|ask)_[a-f0-9]{32}$/.test(id || '')) throw new Error('Invalid question id');
  if (sessionId) statePath(sessionId);
  return path.join(ROOT, '.learn', 'quizzes', ...(sessionId ? [sessionId] : []), `${id}.json`);
}
export function nativeRequest(q, id, compact = false) {
  const numbered = q.mode === 'multi-select' || (compact && q.options.length > 2);
  const options = numbered ? [{ label: "Submit selected indices", description: "Enter indices such as 1,3 on the first line of Tab notes; use subsequent lines for reasoning." }] : q.options.map((o, i) => ({ label: `${i + 1}. ${o.label}`, description: o.description || "Tab adds optional reasoning; Enter submits." }));
  if (q.name === 'quiz') options.push({ label: "I don't know", description: "A genuine knowledge gap; Tab also allows questions." });
  else if (q.mode === 'text') options.push({ label: "Submit text", description: "Enter text with Tab; Enter submits. An empty response is allowed." });
  else if (numbered) options.push({ label: "Other response", description: "Enter a custom answer with Tab, or combine it with indices by adding Other: content on a separate line." });
  // Native schema requires nonempty options; keep cancellation explicit for ungraded text/one-option prompts.
  if (options.length < 2) options.push({ label: "Cancel question", description: "Cancellation is not an answer." });
  const body = [q.question, q.context, ...(numbered ? q.options.map((o, i) => `${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}`) : []), numbered ? "Enter the complete set of indices on the first line of Tab notes and optional reasoning on subsequent lines; options are not graded individually and answers are not revealed in advance." : "After selecting, press Tab to add optional reasoning.", "Press an arrow key once before thinking: Default mode times out after approximately two minutes with no input; a keypress cancels the timer."].filter(Boolean).join('\n\n');
  return { questions: [{ id, header: q.name === 'quiz' ? "Understanding quiz" : "Learning direction", question: body, options }] };
}
export function nativeAnswer(q, request, response) {
  const question = request.questions[0], answer = response?.answers?.[question.id]?.answers;
  if (!Array.isArray(answer) || !answer.length) return { status: 'unanswered', message: 'No answer: re-ask the SAME question; do not grade or continue.' };
  if (answer.some(a => typeof a !== 'string') || answer.filter(a => !a.startsWith('user_note: ')).length !== 1) throw new Error('Invalid native answer');
  const selectedLabel = answer.find(a => !a.startsWith('user_note: '));
  // Retain localized selections from saved requests when resuming a session.
  const label = {"\u63d0\u4ea4\u6240\u9009\u7f16\u53f7": "Submit selected indices", "\u4e0d\u77e5\u9053": "I don't know", "\u63d0\u4ea4\u6587\u5b57": "Submit text", "\u5176\u4ed6\u56de\u7b54": "Other response", "\u53d6\u6d88\u95ee\u9898": "Cancel question"}[selectedLabel] || selectedLabel;
  const note = answer.filter(a => a.startsWith('user_note: ')).map(a => a.slice(11)).join('\n').trim();
  if (label === "Cancel question") return { status: 'cancelled', question: q.question, mode: q.mode, answers: [] };
  if (label === "I don't know" && q.name === 'quiz') return grade(q, { dontKnow: true, note });
  if (q.mode === 'text') {
    if (label !== "Submit text" && label !== 'None of the above') throw new Error('Invalid text answer');
    return grade(q, { other: note });
  }
  const index = q.options.findIndex((o, i) => label === `${i + 1}. ${o.label}`);
  if (index >= 0 && q.mode === 'single-select') return grade(q, { indices: [index + 1], note });
  if (label === "Other response" && q.name !== 'quiz') return grade(q, { other: note });
  if (label === 'None of the above' && q.name !== 'quiz' && q.mode === 'single-select') return grade(q, { other: note });
  if (label !== "Submit selected indices" && label !== 'None of the above') throw new Error('Unknown selection');
  const [first, ...rest] = note.split('\n');
  if (!/^\s*(?:(?:Answer|\u7b54\u6848)\s*[:\uFF1A]\s*)?\d+(?:\s*[,\uFF0C\u3001 ]\s*\d+)*\s*$/i.test(first)) throw new Error("The first line must contain indices such as 1,3; put reasoning on a separate line.");
  const indices = first.replace(/^\s*(?:Answer|\u7b54\u6848)\s*[:\uFF1A]\s*/i, '').trim().split(/\s*[,\uFF0C\u3001 ]\s*/).map(Number);
  let other = '';
  const reasoning = rest.filter(line => {
    if (q.name !== 'quiz' && /^(?:Other|\u5176\u4ed6)\s*[:\uFF1A]/i.test(line)) { other += (other ? '\n' : '') + line.replace(/^(?:Other|\u5176\u4ed6)\s*[:\uFF1A]\s*/i, ''); return false; }
    return true;
  }).join('\n');
  return grade(q, { indices, other, note: reasoning });
}
export function prepareNative(name, params, compact = false) {
  const state = JSON.parse(fs.readFileSync(statePath(params.sessionId), 'utf8'));
  if (!state.transcript) throw new Error('SessionStart hook has not bound a transcript');
  const q = prepare(name, params), id = `${name === 'quiz' ? 'quiz' : 'ask'}_${crypto.randomBytes(16).toString('hex')}`;
  const request = nativeRequest(q, id, compact);
  fs.mkdirSync(path.dirname(quizPath(id)), { recursive: true });
  fs.writeFileSync(quizPath(id), JSON.stringify({ sessionId: params.sessionId, q, request }), { mode: 0o600 });
  return { id, request };
}
export function resolveNative(id, response, request, sessionId) {
  let file = quizPath(id), saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (sessionId && saved.sessionId !== sessionId) {
    let ancestors = [];
    try { ancestors = JSON.parse(fs.readFileSync(statePath(sessionId), 'utf8')).ancestors || []; } catch {}
    if (!ancestors.includes(saved.sessionId)) throw new Error('Question belongs to another session');
    file = quizPath(id, sessionId);
    saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { ...saved, sessionId };
  }
  if (saved.result?.status === 'answered') {
    const retried = nativeAnswer(saved.q, request || saved.request, response);
    if (JSON.stringify(retried) !== JSON.stringify(saved.result)) throw new Error('Question already graded; prepare a new question instead of overwriting its answer');
    return { ...saved.result, feedback: feedbackBlock(saved.result, saved.q.name) };
  }
  // The transcript's actual request wins if a runtime needed the compact 2–3 option representation.
  const result = nativeAnswer(saved.q, request || saved.request, response);
  if (result.status !== 'unanswered') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...saved, result }), { mode: 0o600 });
  }
  return { ...result, ...(result.status === 'answered' ? { feedback: feedbackBlock(result, saved.q.name) } : {}) };
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, file, sessionId] = process.argv.slice(2);
    if (action === 'result') {
      let saved = JSON.parse(fs.readFileSync(quizPath(file), 'utf8'));
      await flush(sessionId || saved.sessionId);
      const branch = sessionId && quizPath(file, sessionId);
      saved = JSON.parse(fs.readFileSync(branch && fs.existsSync(branch) ? branch : quizPath(file), 'utf8'));
      console.log(JSON.stringify(saved.result ? { ...saved.result, feedback: feedbackBlock(saved.result, saved.q.name) } : { status: 'unanswered', request: saved.request, message: 'Re-ask the same question; no valid submitted answer.' }));
    } else {
      const input = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (action === 'prepare') console.log(JSON.stringify(prepareNative(input.name || 'quiz', input, process.argv.includes('--compact'))));
      else if (action === 'grade') console.log(JSON.stringify(resolveNative(input.id, input.response, input.request, input.sessionId)));
      else throw new Error('Usage: node <skill>/scripts/quiz.mjs prepare|grade <JSON-file> [--compact], or result <id> [sessionId]');
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
