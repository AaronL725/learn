import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROOT, statePath, setLog } from './md-log.mjs';
import { atomic, ensureProject, locked, identifier, slug, enqueue, syncPending } from './memory.mjs';

const file = path.join(ROOT, '.learn/studies.json');
function read() { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { activities: [] }; }
export function studyContext(sessionId) {
  const state = JSON.parse(fs.readFileSync(statePath(sessionId), 'utf8'));
  return state.learning || null;
}
function snapshot(project, activity) {
  enqueue('course', { courseId: project.courseId, title: project.title, projectPath: ROOT, activity });
}
function createNote(p, activity) {
  const name = slug(p.slug), title = p.title || p.topic || activity.goal;
  if (typeof title !== 'string' || !title.trim()) throw new Error('A meaningful note title is required');
  const id = `note_${crypto.randomUUID()}`;
  let noteFile;
  if (p.filepath) {
    noteFile = fs.realpathSync(path.resolve(ROOT, p.filepath));
    if (!fs.statSync(noteFile).isFile() || !noteFile.endsWith('.md')) throw new Error('Use an existing Markdown file');
  } else {
    const handoff = activity.checkpoint ? `\n## Handoff\n\n${activity.checkpoint.summary || ''}\n\nCurrent goal: ${activity.goal}\nNext step: ${activity.checkpoint.nextStep || 'Continue the current goal'}\n` : '';
    for (let n = 1; ; n++) {
      noteFile = path.join(ROOT, `${name}${n === 1 ? '' : `-${n}`}.md`);
      try { fs.writeFileSync(noteFile, `<!-- learn:note:${id} activity:${activity.id} -->\n# ${title}\n${handoff}`, { flag: 'wx' }); break; }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
  }
  const note = { id, file: noteFile.startsWith(ROOT + path.sep) ? path.relative(ROOT, noteFile) : noteFile, title, createdAt: new Date().toISOString() };
  activity.notes.push(note);
  return note;
}
function validateCheckpoint(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('checkpoint must be an object');
  for (const key of ['summary', 'currentGap', 'nextStep']) if (c[key] !== undefined && typeof c[key] !== 'string') throw new Error(`${key} must be text`);
  for (const key of ['plan', 'completedNodes']) if (c[key] !== undefined && (!Array.isArray(c[key]) || c[key].some(v => typeof v !== 'string'))) throw new Error(`${key} must be an array of strings`);
}
export async function study(action, p) {
  identifier(p.sessionId);
  const state = JSON.parse(fs.readFileSync(statePath(p.sessionId), 'utf8'));
  if (!state.transcript) throw new Error('SessionStart hook has not bound a transcript');
  if (!['open', 'switch', 'checkpoint'].includes(action)) throw new Error('Usage: study.mjs open|switch|checkpoint <JSON-file>');
  if (p.checkpoint) validateCheckpoint(p.checkpoint);
  const project = ensureProject();
  const result = await locked(ROOT, async () => {
    const data = read(), binding = studyContext(p.sessionId);
    let activity = data.activities.find(a => a.id === (p.activityId || binding?.activityId));
    if (p.activityId && !activity) throw new Error('Unknown activityId in this subject project');
    if (action === 'open' && !p.activityId && p.topic && activity?.goal !== p.topic) activity = null;
    if (!activity && action !== 'open') throw new Error('Open a learning activity first');
    if (!activity && !p.topic) return { status: 'choose', courseId: project.courseId, activities: data.activities };
    const existing = Boolean(activity);
    if (!activity) {
      if (typeof p.topic !== 'string' || !p.topic.trim()) throw new Error('topic is required');
      // Existing matching goals are offered, never silently chosen by recency.
      const matches = data.activities.filter(a => a.goal === p.topic);
      if (matches.length) return { status: 'choose', courseId: project.courseId, activities: matches };
      activity = { id: `study_${crypto.randomUUID()}`, courseId: project.courseId, goal: p.topic, conceptIds: [], notes: [], sessions: [], revision: 0, status: 'active' };
      data.activities.push(activity);
    }
    if (action === 'checkpoint' || action === 'switch' || existing && [p.checkpoint, p.conceptIds, p.status].some(v => v !== undefined)) {
      if (p.revision !== activity.revision) throw new Error('Stale activity revision: open the activity and reconcile its current checkpoint');
    }
    if (p.goal !== undefined) {
      if (typeof p.goal !== 'string' || !p.goal.trim()) throw new Error('goal must be nonempty text');
      if (p.revision !== activity.revision) throw new Error('Changing the goal requires the current activity revision');
      activity.goal = p.goal;
    }
    if (p.conceptIds !== undefined) {
      if (!Array.isArray(p.conceptIds)) throw new Error('conceptIds must be an array');
      p.conceptIds.forEach(identifier); activity.conceptIds = p.conceptIds;
    }
    if (p.status !== undefined) {
      if (!['active', 'paused', 'complete'].includes(p.status)) throw new Error('Invalid activity status');
      activity.status = p.status;
    }
    if (p.checkpoint) activity.checkpoint = { ...activity.checkpoint, ...p.checkpoint };
    let note = activity.notes.find(n => n.id === (p.noteId || binding?.noteId)) || activity.notes.at(-1);
    if (note && p.noteId && p.filepath) {
      const relocated = fs.realpathSync(path.resolve(ROOT, p.filepath));
      if (!fs.statSync(relocated).isFile() || !relocated.endsWith('.md')) throw new Error('Use an existing Markdown file');
      note.file = relocated.startsWith(ROOT + path.sep) ? path.relative(ROOT, relocated) : relocated;
    }
    if (p.noteId && !activity.notes.some(n => n.id === p.noteId)) throw new Error('noteId belongs to another activity');
    if (!note || action === 'switch') {
      if (action === 'switch' && p.noteId) note = activity.notes.find(n => n.id === p.noteId);
      else note = createNote(p, activity);
    }
    if (p.checkpoint) activity.checkpoint = { ...activity.checkpoint, ...p.checkpoint, noteId: note.id, sessionId: p.sessionId, updatedAt: new Date().toISOString() };
    if (!activity.sessions.includes(p.sessionId)) activity.sessions.push(p.sessionId);
    activity.revision++;
    activity.updatedAt = new Date().toISOString();
    const context = { courseId: project.courseId, activityId: activity.id, noteId: note.id, sessionId: p.sessionId, conceptIds: activity.conceptIds, notePath: path.resolve(ROOT, note.file) };
    atomic(file, JSON.stringify(data, null, 2) + '\n');
    await setLog(p.sessionId, note.file, 'forward', context);
    snapshot(project, activity);
    if (p.checkpoint) enqueue('record', { id: `checkpoint_${activity.id}_${activity.revision}`, kind: 'checkpoint', occurredAt: activity.updatedAt, context, goal: activity.goal, checkpoint: activity.checkpoint, projectPath: ROOT, notePath: note.file });
    return { status: 'open', activity, context, note };
  });
  return { ...result, memorySync: await syncPending() };
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await study(process.argv[2], JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))))); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
