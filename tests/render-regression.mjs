import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(source, '.learn'), { recursive: true });
const fixture = fs.mkdtempSync(path.join(source, '.learn/test-render-'));
const project = path.join(fixture, 'project'), skill = path.join(fixture, 'skill'), temporary = path.join(fixture, 'tmp');
for (const dir of [project, skill, temporary]) fs.mkdirSync(dir);
const env = { ...process.env, TMPDIR: temporary, LEARN_MEMORY_DIR: path.join(fixture, 'atlas'), PUPPETEER_SKIP_DOWNLOAD: '1', npm_config_cache: path.join(fixture, 'npm-cache') };
let completed = false;
try {
  fs.cpSync(path.join(source, 'scripts'), path.join(skill, 'scripts'), { recursive: true, filter: file => path.basename(file) !== 'node_modules' });
  const deps = path.join(skill, 'scripts/visual-tools');
  await exec('npm', ['ci', '--prefix', deps, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { env, maxBuffer: 1024 * 1024 });
  const runner = path.join(skill, 'run.mjs');
  fs.writeFileSync(runner, `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { callTool } from './scripts/learn.mjs';
import { memory } from './scripts/memory.mjs';
const parse = r => JSON.parse(r.content[0].text);
const files = [];
for (const [kind, source, oldText, newText] of [
  ['mermaid', 'graph LR\\nA[Composition] --> B[Local rates]\\nB --> C[Chain rule]', 'Local rates', 'Product of rates'],
  ['svg', '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180" viewBox="0 0 400 180"><rect width="400" height="180" fill="white"/><path d="M40 130 L350 130 M40 130 L40 25" stroke="black" stroke-width="2"/><path d="M40 130 L260 50" stroke="#2563eb" stroke-width="4"/><text x="145" y="45" font-family="sans-serif" font-size="22">Local change</text></svg>', 'Local change', 'Local rate']
]) {
  const created = parse(await callTool('write_' + kind, { source }));
  const original = fs.readFileSync(created.path, 'utf8');
  await assert.rejects(callTool('edit_' + kind, { session: created.session, old_text: 'missing text', new_text: 'replacement' }), /EXACTLY ONCE/);
  assert.equal(fs.readFileSync(created.path, 'utf8'), original);
  await callTool('edit_' + kind, { session: created.session, old_text: oldText, new_text: newText });
  const preview = await callTool('render_' + kind, { session: created.session });
  assert.equal(preview.content[1].mimeType, 'image/png');
  const png = Buffer.from(preview.content[1].data, 'base64');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
  const published = parse(await callTool('render_' + kind, { session: created.session, save_as: 'same-topic' }));
  const second = parse(await callTool('render_' + kind, { session: created.session, save_as: 'same-topic' }));
  assert.notEqual(published.filename, second.filename);
  assert.equal(path.dirname(published.path), path.join(process.cwd(), 'viz'));
  files.push(published.path);
}
const root = await memory('update', { type: 'concept', slug: 'composition', fields: { title: 'Composition: <f> & \"g\"' } });
await memory('update', { type: 'concept', slug: 'chain-rule', fields: { title: 'Chain rule', relations: [{ type: 'requires', targetId: root.id }] } });
const atlas = fs.readFileSync(path.join(process.env.LEARN_MEMORY_DIR, 'Atlas.md'), 'utf8');
const graph = /\\x60\\x60\\x60mermaid\\n([\\s\\S]*?)\\n\\x60\\x60\\x60/.exec(atlas)[1];
const mapSource = parse(await callTool('write_mermaid', { source: graph }));
const renderedMap = parse(await callTool('render_mermaid', { session: mapSource.session, save_as: 'atlas' }));
assert.ok(fs.statSync(renderedMap.path).size > 0);
console.log(JSON.stringify({ files }));
`);
  const rendered = await exec(process.execPath, [runner], { cwd: project, env, maxBuffer: 1024 * 1024 });
  const { files } = JSON.parse(rendered.stdout);
  assert.equal(files.length, 2);
  const request = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ].map(r => JSON.stringify(r) + '\n').join('');
  const protocol = exec(process.execPath, [path.join(skill, 'scripts/learn.mjs')], { cwd: project, env });
  protocol.child.stdin.end(request);
  const output = await protocol;
  const responses = output.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(responses.find(r => r.id === 2).result.tools.length, 8);
  completed = true;
  console.log(JSON.stringify({ status: 'passed', fixture, files, checks: ['real Mermaid and SVG PNGs', 'exact editing', 'unique publication', 'MCP initialize and 8 tools', 'generated Atlas Mermaid with escaped labels'] }));
} finally {
  if (!completed || !process.argv.includes('--keep')) fs.rmSync(fixture, { recursive: true, force: true });
}
