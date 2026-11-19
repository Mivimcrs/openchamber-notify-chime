/**
 * 发布前自检，本地和 CI 都跑这一个：
 *
 *   node 工具/check.mjs
 *
 * 检查四件事：清单能被 OpenChamber 自己的解析器接受、清单里的入口文件都在、
 * 打包产物不是空壳、以及「detached 会让 PowerShell 空跑」那条回归守卫。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];
const fail = (message) => problems.push(message);

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

let manifest = null;
try {
  const parsePath = path.join(ROOT, '构建', 'node_modules', '@openchamber', 'sdk', 'dist', 'parse.js');
  const { parseManifestJson } = await import(pathToFileURL(parsePath).href);
  const parsed = parseManifestJson(read('package.json'));
  if (!parsed.ok) {
    fail(`清单解析失败: ${parsed.error ?? 'unknown'}`);
  } else {
    manifest = parsed.manifest;
    notes.push(`清单 OK，版本 ${parsed.version}`);
  }
} catch (error) {
  notes.push(`跳过 SDK 清单校验（没装 构建/node_modules）: ${error.message}`);
}

const pkg = JSON.parse(read('package.json'));
const contributes = pkg.openchamber?.contributes ?? {};

if (contributes.panel?.entry && !fs.existsSync(path.join(ROOT, contributes.panel.entry))) {
  fail(`面板入口不存在: ${contributes.panel.entry}`);
}
if (contributes.service?.entry && !fs.existsSync(path.join(ROOT, contributes.service.entry))) {
  fail(`服务入口不存在: ${contributes.service.entry}`);
}
if (pkg.openchamber?.icon && !fs.existsSync(path.join(ROOT, pkg.openchamber.icon))) {
  fail(`图标不存在: ${pkg.openchamber.icon}`);
}

for (const relative of ['panel/main.js', 'service/main.js']) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) {
    fail(`打包产物缺失: ${relative}（先跑 node 构建/build.mjs）`);
    continue;
  }
  const size = fs.statSync(file).size;
  if (size < 5000) fail(`打包产物太小，可能是空壳: ${relative} (${size} B)`);
}

const builtins = ['chime-done', 'chime-soft', 'chime-bright', 'chime-ask', 'chime-alert', 'chime-error'];
for (const id of builtins) {
  if (!fs.existsSync(path.join(ROOT, 'assets', `${id}.wav`))) fail(`内置音效缺失: assets/${id}.wav`);
}

// 回归守卫：2026-11-19 那次「试听没声音」就是 spawn 带了 detached，PowerShell 启动即退、
// 脚本一行没跑，而 spawn 不报错。这里直接卡住这个写法。
const serviceBundle = fs.existsSync(path.join(ROOT, 'service/main.js')) ? read('service/main.js') : '';
if (/detached\s*:\s*(true|!0)/.test(serviceBundle)) {
  fail('service/main.js 里出现了 detached: true —— 在 Windows 上会让 PowerShell 空跑，声音不响');
}
if (!serviceBundle.includes('spawn done')) {
  fail('service/main.js 缺少 spawn done 日志，播放失败时会变成无声无痕');
}

for (const note of notes) console.log(`· ${note}`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log('✓ 自检通过');
