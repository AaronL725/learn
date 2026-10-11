import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import * as zlib from 'node:zlib';
import { resolveNative, feedbackBlock } from './quiz.mjs';

export const ROOT = path.resolve(process.cwd());
const STATE = path.join(ROOT, '.learn', 'sessions');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function statePath(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id || '')) throw new Error('A valid sessionId is required (provided by SessionStart).');
  return path.join(STATE, `${id}.json`);
}
export async function withLock(file, action) {
  const lock = path.join(ROOT, '.learn/locks', crypto.createHash('sha256').update(file).digest('hex'));
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (;;) {
    try { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'pid'), String(process.pid)); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const pid = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8'));
        try { process.kill(pid, 0); } catch (error) {
          if (error.code === 'ESRCH') { fs.rmSync(lock, { recursive: true, force: true }); continue; }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.rmSync(lock, { recursive: true, force: true });
      }
      await delay(30);
    }
  }
  try { return await action(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
function watcherAlive(id, pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).includes(`${fileURLToPath(import.meta.url)} --watch ${id}`); } catch { return false; }
}
function readState(id) { return JSON.parse(fs.readFileSync(statePath(id), 'utf8')); }
function saveState(id, state) {
  const file = statePath(id), temp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(STATE, { recursive: true, mode: 0o700 });
  fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 }); fs.renameSync(temp, file);
}
export function notePath(file) {
  const resolved = fs.realpathSync(path.resolve(ROOT, file));
  if (!fs.statSync(resolved).isFile()) throw new Error('Link an existing regular file.');
  return resolved;
}
export function messageBlock(record) {
  if (record.type !== 'response_item') return '';
  const p = record.payload;
  if (p?.type !== 'message' || !['user', 'assistant'].includes(p.role)) return '';
  if (p.role === 'assistant' && p.channel === 'analysis') return '';
  let text = (p.content || []).filter(c => ['input_text', 'output_text', 'text'].includes(c.type)).map(c => c.text).join('\n').trim();
  // System-injected environment and skills are context, not learner prose.
  if (/^<(environment_context|permissions instructions|system_reminder|subagent_notification|skills_instructions)>/.test(text) || text.startsWith('# AGENTS.md instructions for ')) return '';
  text = text.replace(/<skill\b([^>]*)>[\s\S]*?<\/skill>/g, (_, attrs) => `> [!note] SKILL loaded: ${/name="([^"]+)"/.exec(attrs)?.[1] || '(unknown)'}`);
  if (!text) return '';
  return `> [!${p.role === 'user' ? 'quote' : 'abstract'}] ${p.role === 'user' ? 'YOU' : 'CODEX'}\n\n${text}`;
}
export async function nativeInputBlock(record, state, sessionId) {
  if (record.type === 'session_meta' && record.payload?.id === sessionId && record.payload?.forked_from_id) {
    const parent = record.payload.forked_from_id;
    let ancestors = [];
    try { ancestors = readState(parent).ancestors || []; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    state.ancestors = [...new Set([parent, ...ancestors])];
  }
  const p = record.type === 'response_item' ? record.payload : null;
  if (p?.type === 'function_call' && /^(?:functions\.)?request_user_input$/.test(p.name)) {
    const request = JSON.parse(p.arguments);
    state.nativeRequests ||= {};
    state.nativeRequests[p.call_id] = request;
    return request.questions.map(q => callout('question', q.header || 'Question', [q.question, ...(q.options || []).map(o => `${o.label}${o.description ? ` — ${o.description}` : ''}`)].join('\n\n'))).join('\n\n');
  }
  if (p?.type !== 'function_call_output') return '';
  const request = state.nativeRequests?.[p.call_id];
  if (!request) return '';
  let response;
  try { response = JSON.parse(p.output); } catch { return callout('warning', 'Question unavailable', 'Cancelled/unavailable is not an answer; re-ask or stop.'); }
  const blocks = [];
  for (const q of request.questions) {
    if (/^(quiz|ask)_[a-f0-9]{32}$/.test(q.id)) {
      try {
        const result = resolveNative(q.id, response, { questions: [q] }, sessionId);
        blocks.push(result.status === 'unanswered' ? callout('warning', 'No answer — retry', result.message) : feedbackBlock(result, q.id.startsWith('quiz_') ? 'quiz' : 'ask_user_question'));
      } catch (e) { blocks.push(callout('warning', 'Invalid answer — retry', e.message)); }
    } else {
      const answers = response?.answers?.[q.id]?.answers;
      blocks.push(callout('example', q.header || 'Answer', answers?.length ? answers.map(a => a.startsWith('user_note: ') ? `Note: ${a.slice(11)}` : a).join('\n\n') : 'No answer — do not continue without a response.'));
    }
  }
  return blocks.join('\n\n');
}
async function appendBlocks(file, blocks) {
  if (!blocks.length) return;
  await withLock(file, () => {
    const current = fs.readFileSync(file, 'utf8');
    const additions = blocks.filter(b => !current.includes(b.marker));
    if (additions.length) fs.appendFileSync(file, `${current.trim() ? '\n\n' : ''}${additions.map(b => `${b.marker}\n${b.text}`).join('\n\n')}\n`);
  });
}
export function activeBranch(entries) {
  const active = [], turns = [];
  for (const entry of entries) {
    const record = entry.record, payload = record.payload;
    if (record.type === 'event_msg' && payload?.type === 'thread_rolled_back') {
      const count = payload.num_turns;
      if (!Number.isInteger(count) || count < 0) throw new Error('Invalid rollback event');
      if (count) {
        const kept = Math.max(0, turns.length - count);
        active.length = turns[kept] ?? 0;
        turns.length = kept;
      }
      active.push(entry);
      continue;
    }
    // Context-only user messages are not learner turns and must not count toward rollback.
    if (record.type === 'response_item' && payload?.role === 'user' && messageBlock(record) && !payload.content?.every(c => /^<skill\b/.test(c.text || ''))) turns.push(active.length);
    active.push(entry);
  }
  return active;
}
function parseEntries(buffer, origin, offset = 0) {
  const entries = []; let position = offset;
  const end = buffer.lastIndexOf(10);
  for (const line of buffer.subarray(0, end + 1).toString('utf8').split('\n').slice(0, -1)) {
    entries.push({ record: JSON.parse(line), position, origin });
    position += Buffer.byteLength(line) + 1;
  }
  return entries;
}
function inheritedEntries(meta, seen = new Set()) {
  const base = meta?.history_base;
  if (!base) return [];
  statePath(base.thread_id);
  if (seen.has(base.thread_id)) throw new Error('Cyclic transcript history_base');
  seen.add(base.thread_id);
  if (!Number.isSafeInteger(base.end_byte_offset) || base.end_byte_offset < 0) throw new Error('Invalid history prefix byte offset');
  const matches = file => path.basename(file).endsWith(`${base.thread_id}.jsonl`) || path.basename(file).endsWith(`${base.thread_id}.jsonl.zst`);
  let source;
  try { const candidate = readState(base.thread_id).transcript; if (candidate && matches(candidate) && fs.existsSync(candidate)) source = candidate; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  // Resolve an exact rollout ID, including reverted/archived prefixes; never guess the newest file.
  if (!source) {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const files = ['sessions', 'archived_sessions'].flatMap(dir => {
      const root = path.join(codexHome, dir);
      return fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).filter(matches).map(file => path.join(root, file)) : [];
    });
    if (files.length !== 1) throw new Error(`Cannot uniquely resolve history prefix ${base.thread_id}`);
    source = files[0];
  }
  let bytes = fs.readFileSync(source);
  if (source.endsWith('.zst')) {
    if (!zlib.zstdDecompressSync) throw new Error('Compressed Codex prefixes require Node with zstdDecompressSync (22.15+).');
    bytes = zlib.zstdDecompressSync(bytes);
  }
  if (base.end_byte_offset > bytes.length || base.end_byte_offset && bytes[base.end_byte_offset - 1] !== 10) throw new Error('Incomplete transcript history prefix');
  const entries = parseEntries(bytes.subarray(0, base.end_byte_offset), base.thread_id);
  const header = entries.find(e => e.record.type === 'session_meta')?.record.payload;
  return [...inheritedEntries(header, seen), ...entries];
}
export async function flush(id) {
  await withLock(statePath(id), async () => {
    const state = readState(id);
    if (!state.transcript || !fs.existsSync(state.transcript)) return;
    state.cursors ||= {};
    // Grading must keep working while /md-unlog pauses mirroring; retain each note's backfill cursor.
    const cursor = state.file || '(unlinked)';
    let offset = state.cursors[cursor] || 0;
    const size = fs.statSync(state.transcript).size;
    if (offset > size) offset = 0;
    const buffer = Buffer.alloc(size - offset);
    const fd = fs.openSync(state.transcript, 'r');
    let bytes;
    try { bytes = fs.readSync(fd, buffer, 0, buffer.length, offset); } finally { fs.closeSync(fd); }
    const end = buffer.subarray(0, bytes).lastIndexOf(10);
    if (end < 0) return; // A partial JSONL record is retried on the next tick.
    const blocks = [];
    // shortcut: Codex transcript JSONL is not a stable API; update this parser when Codex changes its wire format.
    const origin = /([a-f0-9-]{36})\.jsonl$/.exec(state.transcript)?.[1] || id;
    let entries = parseEntries(buffer.subarray(0, end + 1), origin, offset);
    if (!offset) entries = [...inheritedEntries(entries.find(e => e.record.type === 'session_meta')?.record.payload), ...entries];
    for (const entry of activeBranch(entries)) {
      const { record, position, origin } = entry;
      const rolledBack = offset && record.type === 'event_msg' && record.payload?.type === 'thread_rolled_back';
      const text = rolledBack ? callout('note', 'Conversation rolled back', `${record.payload.num_turns} user turn(s) removed from context. Existing note history is preserved; linking a fresh note backfills only the active branch.`) : messageBlock(record) || await nativeInputBlock(record, state, id);
      if (text) blocks.push({ marker: `<!-- learn:${origin}:${position} -->`, text });
    }
    if (state.file) await appendBlocks(state.file, blocks);
    state.cursors[cursor] = offset + end + 1;
    saveState(id, state);
  });
}
export async function setLog(id, file) {
  const resolved = file ? notePath(file) : null;
  await withLock(statePath(id), () => {
    const state = readState(id); state.file = resolved; saveState(id, state);
  });
  await flush(id);
  return { sessionId: id, file: resolved, status: resolved ? 'linked' : 'unlinked' };
}
export function callout(type, title, text) {
  return `> [!${type}] ${title}\n${text.split('\n').map(line => line ? `> ${line}` : '>').join('\n')}`;
}
export async function appendQA(id, marker, text) {
  if (!id) return;
  await flush(id);
  await withLock(statePath(id), async () => {
    const state = readState(id);
    if (state.file) await appendBlocks(state.file, [{ marker: `<!-- learn:qa:${marker} -->`, text }]);
  });
}
export async function sessionHook(input) {
  const id = input.session_id;
  if (path.resolve(input.cwd) !== ROOT) return;
  const file = statePath(id);
  if (input.hook_event_name === 'SessionEnd') {
    if (!fs.existsSync(file)) return;
    try { await flush(id); }
    finally {
      const state = readState(id);
      if (watcherAlive(id, state.pid)) { try { process.kill(state.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
    }
    return;
  }
  if (input.hook_event_name !== 'SessionStart') return;
  await withLock(file, () => {
    const header = fs.existsSync(input.transcript_path) ? fs.readFileSync(input.transcript_path, 'utf8').split('\n', 1)[0] : '';
    const parentId = header ? JSON.parse(header).payload?.forked_from_id : null;
    const parent = parentId && fs.existsSync(statePath(parentId)) ? readState(parentId) : null;
    let state = fs.existsSync(file) ? readState(id) : { file: parent ? parent.file : notePath('learning-log.md'), cursors: {}, ancestors: parentId ? [parentId, ...(parent?.ancestors || [])] : [] };
    if (state.transcript && state.transcript !== input.transcript_path) { state.cursors = {}; state.nativeRequests = {}; }
    state.transcript = input.transcript_path;
    if (watcherAlive(id, state.pid)) { saveState(id, state); return; }
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--watch', id], { detached: true, stdio: 'ignore' });
    child.unref(); state.pid = child.pid; saveState(id, state);
  });
  await flush(id);
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `Learning log sessionId: ${id}. Use this sessionId for native quiz preparation and learn MCP md_log/md_unlog. Log: ${readState(id).file || '(disabled)'}. Chat and native request_user_input questions/answers/notes mirror automatically; prepared quizzes are deterministically graded on submission. Preserve the teach skill's full process.` } };
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--watch') {
    const id = process.argv[3];
    let stopped = false;
    process.on('SIGTERM', () => { stopped = true; });
    while (!stopped) {
      try { await flush(id); } catch (e) {
        fs.appendFileSync(path.join(ROOT, '.learn', 'logger-errors.log'), `${new Date().toISOString()} ${id}: ${e.stack}\n`);
      }
      await delay(300);
    }
    await flush(id);
  } else {
    let data = ''; for await (const part of process.stdin) data += part;
    try { const output = await sessionHook(JSON.parse(data)); if (output) console.log(JSON.stringify(output)); }
    catch (e) { console.error(`Learning log: ${e.message}`); process.exitCode = 1; }
  }
}
