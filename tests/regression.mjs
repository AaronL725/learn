import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, execFileSync, spawn } from 'node:child_process';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(source, '.learn'), { recursive: true });
const fixture = fs.mkdtempSync(path.join(source, '.learn/test-'));
const project = path.join(fixture, 'calculus'), atlas = path.join(fixture, 'atlas');
fs.mkdirSync(project);
process.chdir(project);
process.env.LEARN_MEMORY_DIR = atlas;
process.env.CODEX_HOME = path.join(fixture, 'codex-home');
const load = name => import(pathToFileURL(path.join(source, 'scripts', `${name}.mjs`)).href);
const { memory, syncPending, ensureProject } = await load('memory');
const { study, studyContext } = await load('study');
const { statePath, setLog, flush, messageBlock, sessionHook } = await load('md-log');
const { prepare, grade, nativeRequest, nativeAnswer, prepareNative, resolveNative } = await load('quiz');
const { configureProject, projectConfig } = await load('setup');
const { callTool } = await load('learn');
let checks = 0;
function check(label) { console.log(`ok ${++checks} - ${label}`); }
const save = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const append = (file, records) => fs.appendFileSync(file, records.map(r => JSON.stringify(r) + '\n').join(''));
const message = (role, text) => ({ type: 'response_item', payload: { type: 'message', role, ...(role === 'assistant' ? { channel: 'final' } : {}), content: [{ type: 'text', text }] } });
function session(id, records = []) {
  const transcript = path.join(project, '.learn', `${id}.jsonl`);
  save(transcript, ''); append(transcript, records);
  save(statePath(id), { file: null, cursors: {}, transcript });
  return transcript;
}
function response(prepared, label, note) {
  return { answers: { [prepared.id]: { answers: [label, ...(note ? [`user_note: ${note}`] : [])] } } };
}
const event = (id, kind, concept, extra = {}) => ({ id, kind, occurredAt: '2026-10-11T08:00:00Z', context: { conceptIds: [concept] }, ...extra });
try {
  const config = '[mcp_servers.unrelated]\ncommand = "keep"\n\n[features]\nsomething = true\n';
  const configured = projectConfig(config, process.execPath, '/portable/learn.mjs', project);
  assert.ok(configured.includes(config.split('\n\n')[0]));
  assert.ok(configured.includes('something = true'));
  configureProject(project); configureProject(project);
  assert.equal(fs.existsSync(path.join(project, 'learning-log.md')), false);
  assert.equal(fs.existsSync(path.join(project, 'AGENTS.md')), false);
  const course = ensureProject();
  assert.equal(course.courseId, ensureProject().courseId);
  assert.equal(fs.existsSync(atlas), false);
  check('setup preserves unrelated configuration and creates stable subject metadata without an empty note');

  const composition = await memory('update', { type: 'concept', slug: 'function-composition', fields: { title: 'Function composition', aliases: ['Composition'], scope: 'Scalar functions' } });
  let chain = await memory('update', { type: 'concept', slug: 'chain-rule', fields: { title: 'Chain rule', aliases: ['Nested derivatives'], scope: 'Scalar differentiable functions', relations: [{ type: 'requires', targetId: composition.id }] }, body: '# Chain rule\n\nHuman notes belong here.\n' });
  const unrelated = await memory('update', { type: 'concept', slug: 'composition-music', fields: { title: 'Composition', scope: 'Music' } });
  let recalled = await memory('recall', { conceptIds: [chain.id] });
  assert.ok(recalled.concepts.some(c => c.id === composition.id));
  assert.ok(!recalled.concepts.some(c => c.id === unrelated.id));
  assert.ok(fs.readFileSync(path.join(atlas, chain.file), 'utf8').includes('[[concepts/function-composition|'));
  assert.equal((await memory('recall', { query: 'Composition' })).concepts.length, 3);
  check('cross-context knowledge is scoped by identity, with real Obsidian links and separate homonyms');

  await memory('record', event('self_report_one', 'self-report', chain.id, { statement: 'I have used this before.' }));
  await memory('record', event('correction_one', 'correction', chain.id, { statement: 'That example was guessed.', supersedes: 'self_report_one' }));
  recalled = await memory('recall', { conceptIds: [chain.id] });
  assert.equal(recalled.evidence[0].kind, 'self-report');
  assert.equal(recalled.evidence[1].supersedes, 'self_report_one');
  assert.equal(recalled.concepts.find(c => c.id === chain.id).abilities, undefined);
  check('self-report and corrections retain provenance without fabricated demonstrated mastery');

  chain = recalled.concepts.find(c => c.id === chain.id);
  fs.appendFileSync(path.join(atlas, chain.file), '\nI corrected this directly in Obsidian.\n');
  await assert.rejects(memory('update', { type: 'concept', id: chain.id, version: chain.version, fields: { gaps: [] } }), /Stale version/);
  recalled = await memory('recall', { conceptIds: [chain.id] });
  assert.ok(recalled.changedSinceIndex.includes(chain.id));
  chain = recalled.concepts.find(c => c.id === chain.id);
  chain = await memory('update', { type: 'concept', id: chain.id, version: chain.version, fields: { uncertainty: 'Reasoning not verified' } });
  assert.ok(chain.body.includes('corrected this directly'));
  save(path.join(atlas, '.learn/index.json'), '{corrupt');
  assert.ok((await memory('recall', { conceptIds: [chain.id] })).concepts.length >= 2);
  const renamed = path.join(atlas, 'concepts/chain-rule-renamed.md');
  fs.renameSync(path.join(atlas, chain.file), renamed);
  chain = (await memory('recall', { conceptIds: [chain.id] })).concepts.find(c => c.id === chain.id);
  assert.equal(chain.file, 'concepts/chain-rule-renamed.md');
  check('human edits survive, stale writers fail, corrupted indexes rebuild and file renames retain identity');

  const alias = await memory('update', { type: 'concept', slug: 'derivative-of-composition', fields: { title: 'Derivative of a composition', aliases: ['Nested rate law'] } });
  await memory('record', event('alias_report', 'self-report', alias.id, { statement: 'I know this name.' }));
  await memory('update', { type: 'concept', id: alias.id, version: alias.version, fields: { mergedInto: chain.id } });
  recalled = await memory('recall', { query: 'Nested rate law' });
  assert.ok(recalled.concepts.some(c => c.id === chain.id));
  assert.ok(recalled.evidence.some(e => e.id === 'alias_report'));
  const currentChain = recalled.concepts.find(c => c.id === chain.id);
  await assert.rejects(memory('update', { type: 'concept', id: chain.id, version: currentChain.version, fields: { mergedInto: alias.id } }), /Cyclic/);
  check('explicit alias merges preserve evidence and reject redirect cycles');

  const transcript = session('session_a', [message('user', 'OLD TOPIC HISTORY'), message('assistant', 'OLD ANSWER')]);
  let opened = await study('open', { sessionId: 'session_a', topic: 'Understand the chain rule', slug: 'chain-rule', title: '\u7406\u89e3\u94fe\u5f0f\u6cd5\u5219', conceptIds: [chain.id] });
  assert.equal(opened.memorySync.status, 'synced');
  const noteOne = path.resolve(project, opened.note.file);
  assert.ok(!fs.readFileSync(noteOne, 'utf8').includes('OLD TOPIC HISTORY'));
  const math = 'New learning $f(x)$\n\n$$\nf(x)=x^2\n$$\n\n```mermaid\ngraph LR\nA --> B\n```\n\n![[diagram.png|500]]';
  append(transcript, [message('assistant', math)]); await flush('session_a');
  assert.ok(fs.readFileSync(noteOne, 'utf8').includes(math));
  const request = prepareNative('quiz', { sessionId: 'session_a', question: 'Which rule applies?', options: [{ label: 'Multiply local rates', value: 'product' }, { label: 'Add local rates', value: 'sum' }], correctAnswer: 'product', explanation: 'The inner change scales the outer change.', shuffle: false, learning: { scope: 'Scalar composition' } });
  let switched = await study('switch', { sessionId: 'session_a', revision: opened.activity.revision, slug: 'chain-rule-applications', title: 'Applications', checkpoint: { summary: 'Composition established.', plan: ['Composition', 'Rates'], completedNodes: ['Composition'], currentGap: 'Product of rates', nextStep: 'Derive the product' } });
  const noteTwo = path.resolve(project, switched.note.file);
  assert.ok(fs.readFileSync(noteTwo, 'utf8').includes('Composition established.'));
  assert.ok(!fs.readFileSync(noteTwo, 'utf8').includes(math));
  const answered = response(request, '1. Multiply local rates', 'I think the two derivatives are added, so I picked this.');
  const result = resolveNative(request.id, answered, request.request, 'session_a');
  assert.equal(result.correct, true);
  assert.ok(result.note.includes('added'));
  assert.equal((await syncPending()).status, 'synced');
  recalled = await memory('recall', { conceptIds: [chain.id], courseId: course.courseId });
  const quizEvidence = recalled.evidence.find(e => e.questionId === request.id);
  assert.equal(quizEvidence.context.noteId, opened.note.id);
  assert.equal(quizEvidence.context.scope, 'Scalar composition');
  assert.ok(quizEvidence.result.note.includes('added'));
  assert.equal(recalled.concepts.find(c => c.id === chain.id).abilities, undefined);
  assert.ok(recalled.courses[0].activities[opened.activity.id].checkpoint.nextStep.includes('product'));
  append(transcript, [message('user', 'ONLY NEW NOTE CONTENT')]); await flush('session_a');
  assert.ok(fs.readFileSync(noteTwo, 'utf8').includes('ONLY NEW NOTE CONTENT'));
  assert.ok(!fs.readFileSync(noteOne, 'utf8').includes('ONLY NEW NOTE CONTENT'));
  check('topic notes forward only, preserve Markdown/math/graph/images, and quiz metadata stays bound to preparation');

  session('session_b');
  const resumed = await study('open', { sessionId: 'session_b', activityId: opened.activity.id, noteId: opened.note.id });
  assert.equal(resumed.note.id, opened.note.id);
  assert.equal(resumed.activity.checkpoint.nextStep, 'Derive the product');
  await assert.rejects(study('checkpoint', { sessionId: 'session_a', revision: switched.activity.revision, checkpoint: { nextStep: 'stale overwrite' } }), /Stale activity/);
  const other = await study('open', { sessionId: 'session_a', topic: 'Study vectors', slug: 'vectors' });
  assert.equal(studyContext('session_b').activityId, opened.activity.id);
  assert.equal(studyContext('session_a').activityId, other.activity.id);
  assert.ok((await memory('recall', { conceptIds: [chain.id], courseId: course.courseId })).courses[0].activities[opened.activity.id]);
  check('activity checkpoints resume by identity, concurrent session bindings stay separate and stale progress is rejected');

  const multi = prepare('quiz', { question: 'Select two', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }, { label: 'C', value: 'c' }], multiSelect: true, correctAnswer: ['a', 'c'], explanation: 'Both are required', shuffle: false });
  const multiReq = { id: 'test_multi', request: nativeRequest(multi, 'test_multi') };
  assert.equal(nativeAnswer(multi, multiReq.request, response(multiReq, 'Submit selected indices', '1,3\nBecause both apply.')).correct, true);
  assert.equal(nativeAnswer(multi, multiReq.request, response(multiReq, 'Submit selected indices', '1')).correct, false);
  assert.equal(nativeAnswer(multi, multiReq.request, response(multiReq, "I don't know", 'Need help')).dontKnow, true);
  assert.throws(() => grade(multi, { indices: [1, 1] }), /Invalid selection/);
  assert.throws(() => grade(multi, { indices: [1], dontKnow: true }), /exclusive/);
  assert.throws(() => nativeAnswer(multi, multiReq.request, response(multiReq, 'Submit selected indices', 'because')), /first line/);
  const compact = { id: 'compact', request: nativeRequest(multi, 'compact', true) };
  assert.ok(compact.request.questions[0].question.includes('3. C'));
  const ask = prepare('ask_user_question', { question: 'Choose or add', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }], multiSelect: true });
  const askReq = { id: 'asktest', request: nativeRequest(ask, 'asktest') };
  assert.equal(nativeAnswer(ask, askReq.request, response(askReq, 'Submit selected indices', '1\nOther: custom\nMy reasoning')).answers[1].type, 'other');
  const free = prepare('ask_user_question', { question: 'Text?', options: [] });
  const freeReq = { id: 'free', request: nativeRequest(free, 'free') };
  assert.equal(nativeAnswer(free, freeReq.request, response(freeReq, 'Submit text', 'Actual text')).answers[0].label, 'Actual text');
  assert.equal(nativeAnswer(free, freeReq.request, response(freeReq, 'Cancel question')).status, 'cancelled');
  assert.equal(nativeAnswer(multi, multiReq.request, {}).status, 'unanswered');
  assert.throws(() => resolveNative(request.id, response(request, '2. Add local rates'), request.request, 'session_a'), /already graded/);
  resolveNative(request.id, answered, request.request, 'session_a'); await syncPending();
  assert.equal((await memory('recall', { conceptIds: [chain.id] })).evidence.filter(e => e.questionId === request.id).length, 1);
  check('single/multiple/ungraded/text answers, optional notes, exact-set grading, cancellation, timeout and replay behavior');

  const raced = prepareNative('quiz', { sessionId: 'session_b', question: 'Concurrent submission', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }], correctAnswer: 'a', explanation: 'A is correct', shuffle: false });
  const raceCalls = ['1. A', '2. B'].map((label, n) => {
    const input = path.join(project, `.learn/race-${n}.json`);
    save(input, { id: raced.id, sessionId: 'session_b', response: response(raced, label, `Reasoning ${n}`), request: raced.request });
    return exec(process.execPath, [path.join(source, 'scripts/quiz.mjs'), 'grade', input], { cwd: project, env: process.env });
  });
  const racing = await Promise.allSettled(raceCalls);
  assert.equal(racing.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(racing.find(r => r.status === 'rejected').reason.stderr.includes('already graded'));
  await syncPending();
  assert.equal((await memory('recall', { conceptIds: [chain.id] })).evidence.filter(e => e.questionId === raced.id).length, 1);
  check('concurrent native graders commit one immutable response and one evidence event');


  const pending = prepareNative('quiz', { sessionId: 'session_b', question: 'Pending fork question', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }], correctAnswer: 'yes', explanation: 'Yes is correct', shuffle: false });
  const childTranscript = session('session_fork');
  const forkState = JSON.parse(fs.readFileSync(statePath('session_fork'), 'utf8')); forkState.ancestors = ['session_b']; save(statePath('session_fork'), forkState);
  const before = fs.readFileSync(path.join(atlas, '.learn/evidence.jsonl'), 'utf8');
  assert.equal(resolveNative(pending.id, {}, pending.request, 'session_fork').status, 'unanswered');
  await syncPending();
  assert.equal(fs.readFileSync(path.join(atlas, '.learn/evidence.jsonl'), 'utf8'), before);
  const forkAnswer = response(pending, '1. Yes', 'Fork reasoning');
  resolveNative(pending.id, forkAnswer, pending.request, 'session_fork');
  resolveNative(pending.id, forkAnswer, pending.request, 'session_b');
  await syncPending();
  const events = (await memory('recall', { conceptIds: [chain.id] })).evidence.filter(e => e.questionId === pending.id);
  assert.deepEqual(events.map(e => e.context.sessionId).sort(), ['session_b', 'session_fork']);
  const inheritedState = JSON.parse(fs.readFileSync(statePath('session_fork'), 'utf8')); inheritedState.ancestors.push('session_a'); save(statePath('session_fork'), inheritedState);
  resolveNative(request.id, answered, request.request, 'session_fork'); await syncPending();
  assert.equal((await memory('recall', { conceptIds: [chain.id] })).evidence.filter(e => e.questionId === request.id).length, 1);
  check('pending fork answers stay separate while inherited answered evidence is not counted twice');

  save(path.join(project, 'legacy.md'), '# Existing content\n');
  await setLog('session_a', 'legacy.md');
  const legacy = fs.readFileSync(path.join(project, 'legacy.md'), 'utf8');
  assert.ok(legacy.startsWith('# Existing content'));
  assert.ok(legacy.includes('OLD TOPIC HISTORY') && legacy.includes(math));
  await flush('session_a'); assert.equal(fs.readFileSync(path.join(project, 'legacy.md'), 'utf8'), legacy);
  const rollbackTranscript = session('session_rollback', [message('user', 'KEPT TURN'), message('assistant', 'Kept answer'), message('user', 'REMOVED TURN'), message('assistant', 'Removed answer'), { type: 'event_msg', payload: { type: 'thread_rolled_back', num_turns: 1 } }]);
  save(path.join(project, 'rollback.md'), '# Rollback\n'); await setLog('session_rollback', 'rollback.md');
  assert.ok(fs.readFileSync(path.join(project, 'rollback.md'), 'utf8').includes('KEPT TURN'));
  assert.ok(!fs.readFileSync(path.join(project, 'rollback.md'), 'utf8').includes('REMOVED TURN'));
  assert.equal(messageBlock({ type: 'response_item', payload: { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'text', text: 'secret' }] } }), '');
  check('legacy backfill remains append-only and deduplicated, rollback excludes removed turns and analysis is private');

  const prefixFile = session('prefix_parent', [message('user', 'INHERITED PREFIX'), message('assistant', 'Prefix answer')]);
  const prefixSize = fs.statSync(prefixFile).size;
  append(prefixFile, [message('user', 'BEYOND PREFIX')]);
  const meta = { type: 'session_meta', payload: { id: 'prefix_child', forked_from_id: 'prefix_parent', history_base: { thread_id: 'prefix_parent', end_byte_offset: prefixSize } } };
  session('prefix_child', [meta, message('assistant', 'Current child answer')]);
  save(path.join(project, 'prefix.md'), '# Prefix\n'); await setLog('prefix_child', 'prefix.md');
  assert.ok(fs.readFileSync(path.join(project, 'prefix.md'), 'utf8').includes('INHERITED PREFIX'));
  assert.ok(!fs.readFileSync(path.join(project, 'prefix.md'), 'utf8').includes('BEYOND PREFIX'));
  const archive = path.join(process.env.CODEX_HOME, 'archived_sessions', 'prefix_parent.jsonl.zst');
  fs.mkdirSync(path.dirname(archive), { recursive: true }); fs.writeFileSync(archive, zlib.zstdCompressSync(fs.readFileSync(prefixFile)));
  fs.unlinkSync(prefixFile);
  session('prefix_zstd', [meta]); save(path.join(project, 'prefix-zstd.md'), '# Archived prefix\n'); await setLog('prefix_zstd', 'prefix-zstd.md');
  assert.ok(fs.readFileSync(path.join(project, 'prefix-zstd.md'), 'utf8').includes('INHERITED PREFIX'));
  const empty = session('forward_empty'); save(path.join(project, 'forward-empty.md'), '# Forward\n'); await setLog('forward_empty', 'forward-empty.md', 'forward');
  append(empty, [meta, message('assistant', 'FUTURE ONLY')]); await flush('forward_empty');
  assert.ok(fs.readFileSync(path.join(project, 'forward-empty.md'), 'utf8').includes('FUTURE ONLY'));
  assert.ok(!fs.readFileSync(path.join(project, 'forward-empty.md'), 'utf8').includes('INHERITED PREFIX'));
  check('exact paginated and zstd history prefixes still backfill while forward notes exclude inherited history');


  await setLog('session_b', null);
  assert.equal(studyContext('session_b').activityId, opened.activity.id);
  const liveQuestion = prepareNative('quiz', { sessionId: 'session_b', question: 'Logging paused?', options: [{ label: 'Working', value: 'yes' }, { label: 'Broken', value: 'no' }], correctAnswer: 'yes', explanation: 'Grading works when unlinked', shuffle: false });
  const liveState = JSON.parse(fs.readFileSync(statePath('session_b'), 'utf8'));
  append(liveState.transcript, [
    { type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', call_id: 'call_one', arguments: JSON.stringify(liveQuestion.request) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_one', output: JSON.stringify(response(liveQuestion, '1. Working', 'Real native-style notes')) } },
  ]);
  await flush('session_b');
  save(path.join(project, 'q-and-a.md'), '# Q&A\n'); await setLog('session_b', 'q-and-a.md');
  const qlog = fs.readFileSync(path.join(project, 'q-and-a.md'), 'utf8');
  assert.ok(qlog.includes('Quiz — correct') && qlog.includes('Real native-style notes') && qlog.includes('Correct answer:'));
  check('actual transcript request/output parsing grades while unlinked and mirrors original notes plus feedback');

  const blockedAtlas = path.join(fixture, 'blocked-atlas'); save(blockedAtlas, 'not a directory');
  process.env.LEARN_MEMORY_DIR = blockedAtlas;
  const outageQuiz = prepareNative('quiz', { sessionId: 'session_a', question: 'Can grading survive an Atlas outage?', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }], correctAnswer: 'yes', explanation: 'Local grading is independent.', shuffle: false, learning: { activityId: opened.activity.id, conceptIds: [chain.id] } });
  const outageGrade = resolveNative(outageQuiz.id, response(outageQuiz, '1. Yes', 'Keep my reasoning.'), outageQuiz.request, 'session_a');
  assert.equal(outageGrade.correct, true);
  assert.ok(outageGrade.feedback.includes('Keep my reasoning.'));
  const pendingSync = await memory('record', event('outage_event', 'self-report', chain.id, { statement: 'Keep me locally.' }));
  assert.equal(pendingSync.status, 'pending');
  fs.unlinkSync(blockedAtlas); fs.mkdirSync(blockedAtlas);
  assert.equal((await syncPending()).status, 'synced');
  assert.ok(fs.readFileSync(path.join(blockedAtlas, '.learn/evidence.jsonl'), 'utf8').includes('outage_event'));
  process.env.LEARN_MEMORY_DIR = atlas;
  const partial = path.join(atlas, '.learn/evidence.jsonl'); fs.appendFileSync(partial, '{incomplete');
  await memory('record', event('after_interruption', 'self-report', chain.id));
  assert.ok(fs.readdirSync(path.dirname(partial)).some(f => f.startsWith('evidence.jsonl.incomplete-')));
  assert.ok((await memory('recall', { conceptIds: [chain.id] })).evidence.some(e => e.id === 'after_interruption'));
  await memory('record', event('after_interruption', 'self-report', chain.id));
  const conflict = await memory('record', event('after_interruption', 'self-report', chain.id, { statement: 'changed' }));
  assert.equal(conflict.status, 'pending');
  assert.ok(conflict.errors[0].message.includes('immutable'));
  // This deliberately invalid job is a test-only fixture, not a real retry candidate.
  fs.rmSync(path.join(project, '.learn/outbox'), { recursive: true });
  check('Atlas outage queues durably, retries original destination, interrupted append recovers and evidence cannot change');

  const jobs = [];
  for (let n = 0; n < 8; n++) {
    const input = path.join(project, `.learn/parallel-${n}.json`);
    save(input, event(`parallel_${n}`, 'self-report', chain.id));
    jobs.push(exec(process.execPath, [path.join(source, 'scripts/memory.mjs'), 'record', input], { cwd: project, env: process.env }));
  }
  await Promise.all(jobs); await syncPending();
  assert.equal((await memory('recall', { conceptIds: [chain.id] })).evidence.filter(e => e.id.startsWith('parallel_')).length, 8);
  const lock = path.join(atlas, '.learn/write.lock'); fs.mkdirSync(lock); save(path.join(lock, 'pid'), '2147483647');
  assert.ok((await memory('map')).documents.length);
  check('parallel processes lose no evidence and dead-owner locks recover');

  const killed = spawn(process.execPath, ['--input-type=module', '-e', `import { locked } from ${JSON.stringify(pathToFileURL(path.join(source, 'scripts/memory.mjs')).href)}; await locked(process.env.LEARN_MEMORY_DIR, async () => { process.stdout.write('locked\\n'); await new Promise(resolve => setTimeout(resolve, 20000)); });`], { cwd: project, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { killed.stdout.once('data', resolve); killed.once('error', reject); });
  const death = new Promise(resolve => killed.once('exit', resolve)); killed.kill('SIGKILL'); await death;
  assert.ok((await memory('map')).documents.length);
  check('an actual writer terminated mid-lock does not block later recovery');


  const secondProject = path.join(fixture, 'physics'); fs.mkdirSync(secondProject);
  const recallFile = path.join(secondProject, 'recall.json'); save(recallFile, { conceptIds: [chain.id] });
  const fromPhysics = JSON.parse(execFileSync(process.execPath, [path.join(source, 'scripts/memory.mjs'), 'recall', recallFile], { cwd: secondProject, env: process.env, encoding: 'utf8' }));
  assert.ok(fromPhysics.evidence.some(e => e.questionId === request.id));
  assert.equal(fs.existsSync(path.join(secondProject, 'learning-log.md')), false);
  const toolList = await callTool('md_log', { sessionId: 'session_b', filepath: 'q-and-a.md', mode: 'forward' });
  assert.equal(toolList.content[0].type, 'text');
  await assert.rejects(callTool('render_svg', { session: 'unknown' }), /No svg/);
  await assert.rejects(callTool('write_svg', { source: 'invalid' }), /complete SVG/);
  check('another subject recalls shared evidence and retained MCP log/image interfaces remain valid');

  const hookTranscript = path.join(project, '.learn/hook-session.jsonl'); save(hookTranscript, '');
  const hook = await sessionHook({ session_id: 'hook_session', cwd: project, transcript_path: hookTranscript, hook_event_name: 'SessionStart' });
  assert.ok(hook.hookSpecificOutput.additionalContext.includes(course.courseId));
  assert.equal(JSON.parse(fs.readFileSync(statePath('hook_session'), 'utf8')).file, null);
  await sessionHook({ session_id: 'hook_session', cwd: project, hook_event_name: 'SessionEnd' });
  check('fresh-session hooks tolerate no default note and expose only IDs and memory location');

  const movedState = JSON.parse(fs.readFileSync(statePath('session_b'), 'utf8')); movedState.file = path.join(project, 'gone.md'); save(statePath('session_b'), movedState);
  await flush('session_b');
  assert.equal(JSON.parse(fs.readFileSync(statePath('session_b'), 'utf8')).file, null);
  const rebound = await study('open', { sessionId: 'session_b', activityId: opened.activity.id, noteId: opened.note.id });
  assert.equal(rebound.note.id, opened.note.id);
  check('missing log locators remain recoverable through stable activity and note identities');

  console.log(`Passed ${checks} regression groups; fixtures are removed on exit.`);
} finally {
  for (const file of fs.existsSync(path.join(project, '.learn/sessions')) ? fs.readdirSync(path.join(project, '.learn/sessions')) : []) {
    const state = JSON.parse(fs.readFileSync(path.join(project, '.learn/sessions', file), 'utf8'));
    if (state.pid) { try { process.kill(state.pid, 'SIGTERM'); } catch {} }
  }
  await new Promise(resolve => setTimeout(resolve, 400));
  process.chdir(source);
  fs.rmSync(fixture, { recursive: true, force: true });
}
