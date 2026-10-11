import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, setLog } from './md-log.mjs';
const exec = promisify(execFile);
const DEPS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'visual-tools/node_modules');
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(p => fs.existsSync(p));
let STAGING;
function staging() { return STAGING ||= fs.mkdtempSync(path.join(os.tmpdir(), 'codex-learn-')); }
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = description => ({ type: 'string', description });
const tools = [
  { name: 'md_log', description: 'Link an EXISTING regular file and backfill this session without overwriting its content. Resume keeps the link. Also handles the user’s /md-log request.', inputSchema: object({ sessionId: string('From SessionStart.'), filepath: string('Existing file path, absolute or project-relative.'), mode: { type: 'string', enum: ['backfill', 'forward'], description: 'Default backfill; forward starts at the current transcript position.' } }, ['sessionId', 'filepath']) },
  { name: 'md_unlog', description: 'Stop mirroring this session. Also handles /md-unlog.', inputSchema: object({ sessionId: string('From SessionStart.') }, ['sessionId']) },
  ...['mermaid', 'svg'].flatMap(kind => [
    { name: `write_${kind}`, description: `Write FULL ${kind} source to an isolated managed file. Returns session; pass that exact session to edit/render. No render yet.`, inputSchema: object({ source: string('Complete source.') }, ['source']) },
    { name: `edit_${kind}`, description: 'Single exact-match replacement; old_text must occur exactly once. Failure changes nothing.', inputSchema: object({ session: string('From write tool.'), old_text: string('Nonempty unique exact substring.'), new_text: string('Replacement.') }, ['session', 'old_text', 'new_text']) },
    { name: `render_${kind}`, description: 'Render current managed source to PNG and return it inline. LOOK at it, fix errors and iterate. Omit save_as for preview; pass a short topic slug to publish a unique PNG in project/viz. Never return uninspected visuals.', inputSchema: object({ session: string('From write tool.'), save_as: string('Short topic slug; omit for preview.') }, ['session']) },
  ]),
];
const textResult = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
const managed = new Map();
function sourceFile(kind, session) {
  const item = managed.get(session);
  if (!item || item.kind !== kind) throw new Error(`No ${kind} source for this session; call write_${kind} first`);
  return item.file;
}
async function visual(name, p) {
  const [action, kind] = name.split('_');
  if (action === 'write') {
    if (typeof p.source !== 'string' || !p.source.trim()) throw new Error('source must be nonempty');
    if (kind === 'svg' && !/<svg[\s>]/.test(p.source)) throw new Error('A complete SVG document is required');
    const session = crypto.randomUUID(), file = path.join(staging(), `${session}.${kind === 'svg' ? 'svg' : 'mmd'}`);
    fs.writeFileSync(file, p.source.trim()); managed.set(session, { kind, file });
    return textResult({ session, path: file, lines: p.source.trim().split('\n').length });
  }
  const file = sourceFile(kind, p.session);
  if (action === 'edit') {
    const source = fs.readFileSync(file, 'utf8');
    if (typeof p.old_text !== 'string' || !p.old_text || typeof p.new_text !== 'string') throw new Error('old_text must be nonempty; new_text must be a string');
    const first = source.indexOf(p.old_text);
    if (p.old_text === p.new_text || first < 0 || source.indexOf(p.old_text, first + 1) !== -1) throw new Error('old_text must occur EXACTLY ONCE and new_text must differ');
    const updated = source.slice(0, first) + p.new_text + source.slice(first + p.old_text.length);
    fs.writeFileSync(file, updated);
    const hit = updated.slice(0, first).split('\n').length - 1;
    const snippet = updated.split('\n').map((line, i) => `${i + 1}  ${line}`).slice(Math.max(0, hit - 3), hit + 4).join('\n');
    return textResult({ session: p.session, path: file, snippet, message: 'Applied edit. Render and inspect.' });
  }
  if (!CHROME) throw new Error('Install Chrome or Chromium to render visuals');
  const png = path.join(staging(), `${crypto.randomUUID()}.png`);
  if (kind === 'mermaid') {
    const config = path.join(staging(), 'puppeteer.json');
    fs.writeFileSync(config, JSON.stringify({ executablePath: CHROME }));
    await exec(path.join(DEPS, '.bin/mmdc'), ['-i', file, '-o', png, '-p', config, '-s', '2', '-b', 'white'], { timeout: 120000, maxBuffer: 1024 * 1024 });
  } else {
    // Chrome is already required by Mermaid; an SVG <img> disables scripts and external resource loads.
    const { default: puppeteer } = await import(pathToFileURL(path.join(DEPS, 'puppeteer/lib/puppeteer/puppeteer.js')).href);
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, timeout: 60000 });
    const timeout = setTimeout(() => { browser.close().catch(() => {}); }, 60000);
    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', request => request.url().startsWith('data:') || request.url() === 'about:blank' ? request.continue() : request.abort());
      await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });
      const data = fs.readFileSync(file).toString('base64');
      await page.setContent(`<html><body style="margin:0"><img id="svg" src="data:image/svg+xml;base64,${data}"></body></html>`);
      const size = await page.$eval('#svg', async (img, source) => {
        await img.decode();
        const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
        const box = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
        const viewBoxOnly = !svg.hasAttribute('width') && !svg.hasAttribute('height') && box?.length === 4 && box.every(Number.isFinite);
        const width = Math.ceil(viewBoxOnly ? box[2] : img.naturalWidth);
        const height = Math.ceil(viewBoxOnly ? box[3] : img.naturalHeight);
        img.width = width; img.height = height;
        return { width, height };
      }, fs.readFileSync(file, 'utf8'));
      if (!size.width || !size.height) throw new Error('SVG dimensions must be positive');
      await page.setViewport({ ...size, deviceScaleFactor: 2 });
      await (await page.$('#svg')).screenshot({ path: png, omitBackground: true });
    } finally { clearTimeout(timeout); await browser.close(); }
  }
  let dest = png, filename;
  if (p.save_as) {
    const slug = p.save_as.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'viz';
    filename = `viz-${slug}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`;
    fs.mkdirSync(path.join(ROOT, 'viz'), { recursive: true }); dest = path.join(ROOT, 'viz', filename); fs.copyFileSync(png, dest);
  }
  return { content: [{ type: 'text', text: JSON.stringify({ session: p.session, path: dest, ...(filename ? { filename } : {}), message: 'LOOK at this PNG; verify meaning, labels and layout. Iterate before returning RESULT.' }) }, { type: 'image', mimeType: 'image/png', data: fs.readFileSync(dest).toString('base64') }] };
}
export async function callTool(name, params, signal = new AbortController().signal) {
  const spec = tools.find(t => t.name === name);
  if (!spec) throw new Error(`Unknown tool: ${name}`);
  if (!params || typeof params !== 'object') throw new Error('arguments must be an object');
  for (const key of spec.inputSchema.required) if (params[key] === undefined) throw new Error(`${key} is required`);
  if (name === 'md_log' || name === 'md_unlog') return textResult(await setLog(params.sessionId, name === 'md_log' ? params.filepath : null, params.mode));
  return visual(name, params);
}
export async function serve() {
  const running = new Map();
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  const input = readline.createInterface({ input: process.stdin });
  for await (const line of input) {
    let request; try { request = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    if (request.method === 'notifications/cancelled') { running.get(request.params?.requestId)?.abort(); continue; }
    if (request.id === undefined) continue;
    const controller = new AbortController(); running.set(request.id, controller);
    (async () => {
      try {
        let result;
        switch (request.method) {
          case 'initialize': result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'codex-learn', version: '1.0.0' } }; break;
          case 'ping': result = {}; break;
          case 'tools/list': result = { tools }; break;
          case 'tools/call':
            try { result = await callTool(request.params.name, request.params.arguments || {}, controller.signal); }
            catch (e) { result = { ...textResult(e.message), isError: true }; }
            break;
          default: send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }); return;
        }
        send({ jsonrpc: '2.0', id: request.id, result });
      } catch (e) { send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: e.message } }); }
      finally { running.delete(request.id); }
    })();
  }
  for (const controller of running.values()) controller.abort();
  if (STAGING) fs.rmSync(STAGING, { recursive: true, force: true });
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await serve();
