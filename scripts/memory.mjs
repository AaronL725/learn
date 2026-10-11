import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PROJECT = path.resolve(process.cwd());
export const hash = text => crypto.createHash('sha256').update(text).digest('hex');
export const identifier = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Invalid stable ID');
  return value;
};
export const slug = value => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) throw new Error('Use an English lowercase filename slug');
  return value;
};
export function atomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}
export async function locked(root, action) {
  const lock = path.join(root, '.learn', 'write.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  const start = Date.now();
  for (;;) {
    try { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'pid'), String(process.pid)); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const pid = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8'));
        if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid lock owner');
        try { process.kill(pid, 0); } catch (e) {
          if (e.code === 'ESRCH') { fs.rmSync(lock, { recursive: true, force: true }); continue; }
          if (e.code !== 'EPERM') throw e;
        }
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.rmSync(lock, { recursive: true, force: true });
      }
      if (Date.now() - start > 1500) throw new Error('Knowledge store busy; retry later');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try { return await action(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
export function ensureProject(root = PROJECT) {
  const file = path.join(root, '.learn/project.json');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const data = { courseId: `course_${crypto.randomUUID()}`, title: path.basename(root), atlas: path.join(os.homedir(), 'Documents/Knowledge Atlas') };
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  identifier(data.courseId);
  if (typeof data.atlas !== 'string' || !path.isAbsolute(data.atlas)) throw new Error('Project atlas must be an absolute path');
  return data;
}
export function atlasRoot() {
  const config = path.join(PROJECT, '.learn/project.json');
  return path.resolve(process.env.LEARN_MEMORY_DIR || (fs.existsSync(config) ? ensureProject().atlas : path.join(os.homedir(), 'Documents/Knowledge Atlas')));
}
const START = '<!-- learn:record -->', END = '<!-- /learn:record -->';
function documentText(data, body) {
  return `${START}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n${END}\n${body}`;
}
function documents(root) {
  const files = ['Profile.md', ...['concepts', 'courses'].flatMap(dir => {
    const full = path.join(root, dir);
    return fs.existsSync(full) ? fs.readdirSync(full).filter(f => f.endsWith('.md')).map(f => `${dir}/${f}`) : [];
  })];
  return files.filter(f => fs.existsSync(path.join(root, f))).map(file => {
    const markdown = fs.readFileSync(path.join(root, file), 'utf8');
    const match = /<!-- learn:record -->\n```json\n([\s\S]*?)\n```\n<!-- \/learn:record -->\n?/.exec(markdown);
    if (!match) throw new Error(`Missing learning record in ${file}; restore its record block before synchronizing`);
    const data = JSON.parse(match[1]); identifier(data.id);
    if (!['concept', 'course', 'profile'].includes(data.type)) throw new Error(`Invalid learning record in ${file}`);
    return { ...data, file, version: hash(markdown), markdown, body: markdown.slice(0, match.index) + markdown.slice(match.index + match[0].length) };
  });
}
function canonical(id, docs) {
  const seen = new Set();
  for (;;) {
    if (seen.has(id)) throw new Error('Cyclic concept merge');
    seen.add(id);
    const doc = docs.find(d => d.id === id);
    if (!doc) throw new Error(`Unknown concept ${id}`);
    if (!doc.mergedInto) return id;
    id = doc.mergedInto;
  }
}
function rebuild(root) {
  let docs = documents(root);
  if (!docs.some(d => d.type === 'profile')) {
    update(root, { type: 'profile', fields: { title: 'Learner profile', preferences: {} } });
    docs = documents(root);
  }
  const ids = new Set();
  for (const d of docs) {
    if (ids.has(d.id)) throw new Error(`Duplicate stable ID ${d.id}`);
    ids.add(d.id);
    if (d.type === 'concept') canonical(d.id, docs);
  }
  // Wikilinks live in visible concept notes so Obsidian's native graph has real edges.
  for (const d of docs.filter(d => d.type === 'concept')) {
    const edges = [...(d.relations || []), ...(d.mergedInto ? [{ type: 'merged into', targetId: d.mergedInto }] : [])];
    const links = edges.map(r => {
      const target = docs.find(t => t.id === r.targetId);
      if (!target) throw new Error(`Missing relation target ${r.targetId}`);
      return `- ${r.type}: [[${target.file.slice(0, -3)}|${String(target.title || target.id).replace(/[\[\]|\n]/g, ' ')}]]`;
    });
    const generated = `<!-- learn:links -->\n## Connections\n\n${links.join('\n')}\n<!-- /learn:links -->`;
    const updated = /<!-- learn:links -->[\s\S]*?<!-- \/learn:links -->/.test(d.markdown) ? d.markdown.replace(/<!-- learn:links -->[\s\S]*?<!-- \/learn:links -->/, () => generated) : `${d.markdown}\n${generated}\n`;
    if (updated !== d.markdown) {
      if (hash(fs.readFileSync(path.join(root, d.file), 'utf8')) !== d.version) throw new Error('Concept changed while mapping; retry');
      atomic(path.join(root, d.file), updated);
    }
  }
  docs = documents(root);
  const index = { generatedAt: new Date().toISOString(), documents: docs.map(({ markdown, body, ...d }) => d) };
  atomic(path.join(root, '.learn/index.json'), JSON.stringify(index, null, 2));
  const concepts = docs.filter(d => d.type === 'concept');
  const links = concepts.map(d => `- [[${d.file.slice(0, -3)}|${String(d.title || d.id).replace(/[\[\]|\n]/g, ' ')}]]${d.mergedInto ? ' (merged)' : ''}`);
  const graph = ['```mermaid', 'graph LR'];
  const node = id => `n${hash(id).slice(0, 16)}`;
  const label = text => JSON.stringify(String(text).replaceAll('&', '&amp;').replaceAll('\"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replace(/[\r\n]/g, ' '));
  for (const d of concepts) {
    graph.push(`  ${node(d.id)}[${label(d.title || d.id)}]`);
    for (const r of d.relations || []) {
      if (concepts.some(c => c.id === r.targetId)) graph.push(`  ${node(d.id)} -->|${label(r.type)}| ${node(r.targetId)}`);
    }
    if (d.mergedInto) graph.push(`  ${node(d.id)} -->|merged into| ${node(d.mergedInto)}`);
  }
  graph.push('```');
  const file = path.join(root, 'Atlas.md');
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Knowledge Atlas\n\nPersonal understanding, evidence and connections.\n';
  const generated = `<!-- learn:map -->\n\n[[Profile]]\n\n${links.join('\n')}\n\n${docs.filter(d => d.type === 'course').map(d => `- [[${d.file.slice(0, -3)}]]`).join('\n')}\n\n${graph.join('\n')}\n\n<!-- /learn:map -->`;
  const updated = /<!-- learn:map -->[\s\S]*?<!-- \/learn:map -->/.test(previous) ? previous.replace(/<!-- learn:map -->[\s\S]*?<!-- \/learn:map -->/, () => generated) : `${previous}\n${generated}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== previous) throw new Error('Atlas.md changed while rebuilding; retry');
  atomic(file, updated);
  return docs;
}
function evidence(root) {
  const file = path.join(root, '.learn/evidence.jsonl');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8'), end = text.lastIndexOf('\n') + 1;
  // An interrupted append is retained for inspection; the durable outbox replays its full event.
  if (end < text.length) {
    atomic(`${file}.incomplete-${crypto.randomUUID()}`, text.slice(end));
    fs.truncateSync(file, Buffer.byteLength(text.slice(0, end)));
  }
  return text.slice(0, end).split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function record(root, input) {
  if (!['quiz', 'self-report', 'correction', 'interpretation', 'checkpoint'].includes(input.kind)) throw new Error('Invalid evidence kind');
  identifier(input.id);
  if (!input.occurredAt || !Number.isFinite(Date.parse(input.occurredAt))) throw new Error('Evidence requires occurredAt');
  const old = evidence(root).find(e => e.id === input.id);
  if (old && JSON.stringify(old) !== JSON.stringify(input)) throw new Error('Evidence ID collision; original event is immutable');
  if (!old) {
    const file = path.join(root, '.learn/evidence.jsonl');
    const fd = fs.openSync(file, 'a', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(input) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  return { id: input.id, status: old ? 'duplicate' : 'recorded' };
}
function update(root, p) {
  if (!['concept', 'profile', 'course'].includes(p.type)) throw new Error('update requires concept, profile or course type');
  const docs = documents(root), id = identifier(p.id || (p.type === 'profile' ? 'profile' : `${p.type}_${crypto.randomUUID()}`));
  const old = docs.find(d => d.id === id);
  if (old && old.type !== p.type) throw new Error('ID belongs to a different record type');
  if (old && p.version !== old.version) throw new Error('Stale version: recall current Markdown and reconcile human edits before updating');
  if (!old && p.version) throw new Error('Record disappeared; refusing to recreate it');
  const fields = p.fields || {};
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('fields must be an object');
  const allowed = ['title', 'aliases', 'scope', 'abilities', 'gaps', 'misconceptions', 'uncertainty', 'evidenceIds', 'relations', 'preferences', 'activities', 'projectPath', 'mergedInto'];
  if (Object.keys(fields).some(k => !allowed.includes(k))) throw new Error('Unknown learning record field');
  for (const k of ['title', 'scope', 'uncertainty', 'projectPath', 'mergedInto']) if (fields[k] !== undefined && typeof fields[k] !== 'string') throw new Error(`${k} must be a string`);
  for (const k of ['aliases', 'abilities', 'gaps', 'misconceptions', 'evidenceIds']) if (fields[k] !== undefined && (!Array.isArray(fields[k]) || fields[k].some(v => typeof v !== 'string'))) throw new Error(`${k} must be an array of strings`);
  if (fields.relations !== undefined && (!Array.isArray(fields.relations) || fields.relations.some(r => !r || typeof r.type !== 'string' || !r.type.trim() || typeof r.targetId !== 'string'))) throw new Error('relations require type and targetId');
  const { file: oldFile, version: oldVersion, markdown: oldMarkdown, body: oldBody, ...oldData } = old || {};
  const data = { ...(old ? oldData : { id, type: p.type }), ...fields };
  for (const r of data.relations || []) {
    if (!docs.some(d => d.type === 'concept' && d.id === r.targetId) && r.targetId !== id) throw new Error(`Unknown relation target ${r.targetId}`);
  }
  if (data.mergedInto) {
    if (p.type !== 'concept' || !docs.some(d => d.type === 'concept' && d.id === data.mergedInto)) throw new Error('Merge target must be an existing concept');
    canonical(id, [...docs.filter(d => d.id !== id), data]);
  }
  const file = old?.file || (p.type === 'profile' ? 'Profile.md' : `${p.type === 'concept' ? 'concepts' : 'courses'}/${slug(p.slug)}.md`);
  if (!old && fs.existsSync(path.join(root, file))) throw new Error('Filename already belongs to another record');
  if (p.body !== undefined && typeof p.body !== 'string') throw new Error('body must be Markdown text');
  const body = p.body ?? old?.body ?? `# ${fields.title || p.slug || 'Learner profile'}\n\n## Personal notes\n`;
  const markdown = documentText(data, body);
  if (old && hash(fs.readFileSync(path.join(root, file), 'utf8')) !== old.version) throw new Error('Markdown changed during update; retry');
  atomic(path.join(root, file), markdown);
  return { ...data, file, version: hash(markdown), body, markdown };
}
function courseSnapshot(root, p) {
  const docs = documents(root), old = docs.find(d => d.id === p.courseId);
  const activities = { ...(old?.activities || {}) };
  const activity = p.activity;
  identifier(activity.id);
  if (!activities[activity.id] || activities[activity.id].revision < activity.revision) activities[activity.id] = activity;
  return update(root, { type: 'course', id: p.courseId, version: old?.version, slug: `course-${p.courseId.replace(/^course_/, '').toLowerCase()}`, fields: { title: p.title, projectPath: p.projectPath, activities } });
}
export function enqueue(operation, input, root = atlasRoot()) {
  const job = { operation, input, root }, id = hash(JSON.stringify(job));
  const dir = path.join(PROJECT, '.learn/outbox');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) atomic(file, JSON.stringify(job));
  return id;
}
export async function syncPending() {
  const dir = path.join(PROJECT, '.learn/outbox'), errors = [], unavailable = new Set();
  let delivered = 0;
  if (!fs.existsSync(dir)) return { status: 'synced', delivered, pending: 0 };
  for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const file = path.join(dir, name);
    let job, entered = false;
    try {
      try { job = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      if (unavailable.has(job.root)) continue;
      await locked(job.root, () => {
        entered = true;
        if (job.operation === 'record') record(job.root, job.input);
        else if (job.operation === 'course') { courseSnapshot(job.root, job.input); rebuild(job.root); }
        else throw new Error('Invalid outbox operation');
      });
      fs.rmSync(file, { force: true }); delivered++;
    } catch (e) {
      if (!entered && job?.root) unavailable.add(job.root);
      errors.push({ file: name, message: e.message });
    }
  }
  const pending = fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
  return { status: pending ? 'pending' : 'synced', delivered, pending, ...(errors.length ? { errors } : {}) };
}
export async function memory(action, p = {}) {
  if (action === 'record') {
    enqueue('record', p);
    return syncPending();
  }
  if (action === 'sync') return syncPending();
  const root = atlasRoot();
  if (action === 'recall') {
    const sync = await syncPending();
    if (!fs.existsSync(root)) return { root, concepts: [], profile: null, courses: [], evidence: [], sync };
    try {
      return await locked(root, () => {
        let index = {};
        try { index = JSON.parse(fs.readFileSync(path.join(root, '.learn/index.json'), 'utf8')); } catch {}
        const docs = rebuild(root), concepts = docs.filter(d => d.type === 'concept');
        const wanted = p.conceptIds || [], terms = String(p.query || '').toLowerCase().split(/\s+/).filter(Boolean);
        const matched = concepts.filter(d => wanted.includes(d.id) || terms.length && terms.some(t => `${d.title} ${(d.aliases || []).join(' ')} ${d.scope || ''} ${d.body}`.toLowerCase().includes(t)));
        const selected = new Set(matched.map(d => canonical(d.id, docs)));
        for (const d of concepts.filter(d => selected.has(d.id))) for (const r of d.relations || []) selected.add(canonical(r.targetId, docs));
        const ids = new Set(concepts.filter(d => selected.has(canonical(d.id, docs))).map(d => d.id));
        const allEvidence = evidence(root).filter(e => (e.context?.conceptIds || []).some(id => ids.has(id)) || (p.evidenceIds || []).includes(e.id));
        const changed = docs.filter(d => index.documents?.some(old => old.id === d.id && old.version !== d.version)).map(d => d.id);
        return { root, concepts: concepts.filter(d => ids.has(d.id)), profile: docs.find(d => d.type === 'profile') || null, courses: docs.filter(d => d.type === 'course' && (!p.courseId || d.id === p.courseId)), evidence: allEvidence, changedSinceIndex: changed, sync };
      });
    } catch (e) { return { root, status: 'unavailable', message: e.message, sync }; }
  }
  return locked(root, () => {
    if (action === 'update') { const result = update(root, p); return rebuild(root).find(d => d.id === result.id); }
    if (action === 'map') return { root, documents: rebuild(root).map(({ markdown, body, ...d }) => d) };
    throw new Error('Usage: memory.mjs recall|record|update|map|sync [JSON-file]');
  });
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await memory(process.argv[2], process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : {}))); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
