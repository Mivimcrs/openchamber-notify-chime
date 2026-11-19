/**
 * OpenChamber 提示音 — service.
 *
 * Session events arrive as HTTP requests on the loopback listener the host
 * gives us (`contributes.sessionEvents`), so a sound plays with no window
 * open. Everything else is the settings panel's small JSON API.
 *
 * Windows playback goes through PowerShell + WPF MediaPlayer (wav/mp3/m4a/wma
 * with a real volume), falling back to System.Media.SoundPlayer for a WAV.
 * The script is handed over as -EncodedCommand so a path with Chinese
 * characters survives the trip unchanged.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServiceHost, readSessionEventRequest } from '@openchamber/sdk';

// 构建时由 build.mjs 从仓库根的 package.json 注入，避免两处版本号漂移。
const VERSION = __EXT_VERSION__;
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.OPENCHAMBER_SERVICE_DATA_DIR || path.join(os.homedir(), '.openchamber-notify-chime');
const SOUNDS_DIR = path.join(DATA_DIR, 'sounds');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const LOG_PATH = path.join(DATA_DIR, 'service.log');
const PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0);
const TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN || '';
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.wav', '.mp3', '.m4a', '.wma']);
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,119}$/i;
const BODY_MAX = 1024 * 1024;
const RECENT_MAX = 12;

const SLOTS = ['done', 'failed', 'question', 'permission'];
const SLOT_LABELS = { done: '完成', failed: '失败', question: '需要回答', permission: '需要授权' };
const EVENT_SLOT = {
  'turn-finished': 'done',
  'turn-failed': 'failed',
  'question-asked': 'question',
  'permission-asked': 'permission',
};
const BUILTINS = [
  { id: 'chime-done', label: '叮咚（上扬双音）' },
  { id: 'chime-soft', label: '轻声（单音）' },
  { id: 'chime-bright', label: '清脆（三连音）' },
  { id: 'chime-ask', label: '询问（两声）' },
  { id: 'chime-alert', label: '提醒（三声急促）' },
  { id: 'chime-error', label: '低沉（两声）' },
];
const BUILTIN_IDS = new Set(BUILTINS.map((entry) => entry.id));

const DEFAULT_SETTINGS = {
  version: 1,
  enabled: true,
  volume: 0.8,
  cooldownMs: 1500,
  sessionCooldownMs: 3000,
  slots: {
    done: { on: true, sound: 'builtin:chime-done', label: '' },
    failed: { on: true, sound: 'builtin:chime-error', label: '' },
    question: { on: true, sound: 'builtin:chime-ask', label: '' },
    permission: { on: true, sound: 'builtin:chime-alert', label: '' },
  },
};

const PS = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : null;

class UserError extends Error {}

/* ------------------------------------------------------------------ files */

const ensureDirs = () => {
  fs.mkdirSync(SOUNDS_DIR, { recursive: true });
};

const log = (message) => {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    const size = fs.existsSync(LOG_PATH) ? fs.statSync(LOG_PATH).size : 0;
    if (size > 512 * 1024) fs.writeFileSync(LOG_PATH, '');
    fs.appendFileSync(LOG_PATH, line);
  } catch {
    /* a log that cannot be written must never break a notification */
  }
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isSafeRef = (value) => typeof value === 'string' && value.length <= 160;

/** `builtin:<id>` or `file:<name in sounds/>`; anything else falls back. */
const normalizeSound = (value, fallback) => {
  if (!isSafeRef(value)) return fallback;
  if (value.startsWith('builtin:')) {
    const id = value.slice(8);
    return BUILTIN_IDS.has(id) ? value : fallback;
  }
  if (value.startsWith('file:')) {
    const name = value.slice(5);
    return SAFE_FILE.test(name) ? value : fallback;
  }
  return fallback;
};

const loadSettings = () => {
  const next = clone(DEFAULT_SETTINGS);
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    if (typeof raw.enabled === 'boolean') next.enabled = raw.enabled;
    if (Number.isFinite(raw.volume)) next.volume = clamp(raw.volume, 0, 1);
    if (Number.isFinite(raw.cooldownMs)) next.cooldownMs = clamp(Math.round(raw.cooldownMs), 0, 15000);
    if (Number.isFinite(raw.sessionCooldownMs)) next.sessionCooldownMs = clamp(Math.round(raw.sessionCooldownMs), 0, 60000);
    for (const slot of SLOTS) {
      const saved = raw?.slots?.[slot];
      if (!saved) continue;
      if (typeof saved.on === 'boolean') next.slots[slot].on = saved.on;
      next.slots[slot].sound = normalizeSound(saved.sound, next.slots[slot].sound);
      if (typeof saved.label === 'string') next.slots[slot].label = saved.label.slice(0, 80);
    }
  } catch {
    /* first run, or a settings file that was hand-edited into nonsense */
  }
  return next;
};

const saveSettings = () => {
  const temp = `${SETTINGS_PATH}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`);
  fs.renameSync(temp, SETTINGS_PATH);
};

let settings = DEFAULT_SETTINGS;

/* ----------------------------------------------------------------- sounds */

const soundFile = (sound) => (sound.startsWith('builtin:')
  ? path.join(PKG_ROOT, 'assets', `${sound.slice(8)}.wav`)
  : path.join(SOUNDS_DIR, sound.slice(5)));

const soundExists = (sound) => {
  try {
    return fs.statSync(soundFile(sound)).isFile();
  } catch {
    return false;
  }
};

/** Milliseconds a file needs to play; null when we cannot tell (player then waits 6 s). */
const wavDurationMs = (file) => {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(64 * 1024);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    if (read < 44 || head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') return null;
    let offset = 12;
    let byteRate = 0;
    let dataSize = 0;
    while (offset + 8 <= read) {
      const id = head.toString('ascii', offset, offset + 4);
      const size = head.readUInt32LE(offset + 4);
      if (id === 'fmt ' && offset + 20 <= read) byteRate = head.readUInt32LE(offset + 16);
      if (id === 'data') {
        dataSize = size;
        break;
      }
      offset += 8 + size + (size % 2);
    }
    if (!byteRate || !dataSize) return null;
    return Math.round((dataSize / byteRate) * 1000);
  } catch {
    return null;
  }
};

const MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

const mp3DurationMs = (file) => {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(16 * 1024);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    let offset = 0;
    if (read > 10 && head.toString('ascii', 0, 3) === 'ID3') {
      const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
      offset = 10 + size;
    }
    while (offset + 4 <= read && !(head[offset] === 0xff && (head[offset + 1] & 0xe0) === 0xe0)) offset += 1;
    if (offset + 4 > read) return null;
    const version = (head[offset + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (head[offset + 1] >> 1) & 3; // 1 = Layer III
    if (layer !== 1) return null;
    const bitrateIndex = (head[offset + 2] >> 4) & 0x0f;
    const table = version === 3 ? MPEG1_L3 : MPEG2_L3;
    const kbps = table[bitrateIndex] ?? 0;
    if (!kbps) return null;
    const bytes = fs.statSync(file).size;
    return Math.round((bytes * 8) / kbps);
  } catch {
    return null;
  }
};

const durationMs = (file) => {
  const ext = path.extname(file).toLowerCase();
  const known = ext === '.wav' ? wavDurationMs(file) : ext === '.mp3' ? mp3DurationMs(file) : null;
  // m4a/wma are sampled containers we do not parse: give the player enough time, cap it.
  return known === null ? 6000 : clamp(known, 250, 15000);
};

const toEncodedCommand = (script) => Buffer.from(script, 'utf16le').toString('base64');
const psLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

// NOTE: never pass the detached option here. A detached, console-less PowerShell starts and
// exits immediately with code 0 without ever running -EncodedCommand, so the sound never
// plays while spawn() still reports success. Verified on Windows; keep it non-detached.
const spawnQuiet = (command, args, label = 'play') => {
  try {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const started = Date.now();
    let stderr = '';
    log(`spawn ${label} pid=${child.pid ?? 'none'}`);
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 2000) stderr += String(chunk);
    });
    child.on('error', (error) => log(`spawn failed ${label}: ${error.message}`));
    child.on('close', (code, signal) => {
      // PowerShell writes progress records to stderr as CLIXML; that is not an error.
      const detail = stderr.includes('CLIXML') ? '' : stderr.trim().replace(/\s+/g, ' ').slice(0, 300);
      log(`spawn done ${label} pid=${child.pid ?? 'none'} code=${code} signal=${signal ?? '-'} ms=${Date.now() - started}${detail ? ` stderr=${detail}` : ''}`);
    });
    child.unref();
    return true;
  } catch (error) {
    log(`spawn threw ${label}: ${error.message}`);
    return false;
  }
};

const playWindows = (file, volume, label = 'play') => {
  const waitMs = durationMs(file) + 300;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$file = ${psLiteral(file)}`,
    'try {',
    '  Add-Type -AssemblyName PresentationCore',
    '  $player = New-Object System.Windows.Media.MediaPlayer',
    `  $player.Volume = ${volume.toFixed(2)}`,
    '  $player.Open([Uri]$file)',
    '  $player.Play()',
    `  Start-Sleep -Milliseconds ${waitMs}`,
    '  $player.Close()',
    '} catch {',
    '  try { (New-Object System.Media.SoundPlayer $file).PlaySync() } catch { }',
    '}',
  ].join('\n');
  return spawnQuiet(PS, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', toEncodedCommand(script)], label);
};

const playOther = (file, volume, label = 'play') => {
  if (process.platform === 'darwin') return spawnQuiet('afplay', ['-v', volume.toFixed(2), file], label);
  const player = fs.existsSync('/usr/bin/paplay') ? 'paplay' : 'aplay';
  return spawnQuiet(player, [file], label);
};

/** Plays a sound reference; returns false when the file is gone. */
const play = (sound, volume = settings.volume) => {
  const file = soundFile(sound);
  if (!soundExists(sound)) {
    log(`missing sound ${sound} -> ${file}`);
    return false;
  }
  return process.platform === 'win32' ? playWindows(file, volume, sound) : playOther(file, volume, sound);
};

const pruneSounds = () => {
  const keep = new Set(SLOTS.map((slot) => settings.slots[slot].sound).filter((s) => s.startsWith('file:')).map((s) => s.slice(5)));
  let names = [];
  try {
    names = fs.readdirSync(SOUNDS_DIR);
  } catch {
    return;
  }
  for (const name of names) {
    if (keep.has(name)) continue;
    try {
      fs.unlinkSync(path.join(SOUNDS_DIR, name));
    } catch {
      /* in use or already gone */
    }
  }
};

const looksLikeAudio = (head, ext) => {
  if (head.length < 12) return false;
  if (ext === '.wav') return head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE';
  if (ext === '.mp3') return head.toString('ascii', 0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  if (ext === '.m4a') return head.toString('ascii', 4, 8) === 'ftyp';
  if (ext === '.wma') return head[0] === 0x30 && head[1] === 0x26 && head[2] === 0xb2 && head[3] === 0x75;
  return false;
};

/** Copies a picked file into the extension's own sounds folder and points the slot at it. */
const importFile = (slot, source) => {
  if (!SLOTS.includes(slot)) throw new UserError('未知的事件槽位');
  const resolved = path.resolve(String(source || '').trim());
  if (!resolved) throw new UserError('路径为空');
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new UserError('找不到这个文件');
  }
  if (!stat.isFile()) throw new UserError('这不是一个文件');
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new UserError(`不支持的格式「${ext || '无扩展名'}」，请用 wav / mp3 / m4a / wma`);
  if (stat.size > MAX_IMPORT_BYTES) throw new UserError('文件超过 20 MB，换一个短一点的提示音');
  if (stat.size < 128) throw new UserError('这个文件太小，不像音频');
  const fd = fs.openSync(resolved, 'r');
  const head = Buffer.alloc(16);
  try {
    fs.readSync(fd, head, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (!looksLikeAudio(head, ext)) throw new UserError(`这个 ${ext} 文件不像音频，换一个试试`);
  ensureDirs();
  const digest = crypto.createHash('sha1').update(fs.readFileSync(resolved)).digest('hex').slice(0, 10);
  const name = `${slot}-${digest}${ext}`;
  const target = path.join(SOUNDS_DIR, name);
  if (!fs.existsSync(target)) fs.copyFileSync(resolved, target);
  settings.slots[slot].sound = `file:${name}`;
  settings.slots[slot].label = path.basename(resolved).slice(0, 80);
  pruneSounds();
  saveSettings();
  log(`imported ${resolved} -> ${name} for ${slot}`);
  return name;
};

/* ------------------------------------------------------------ event wiring */

const host = createServiceHost({ env: process.env });
const emit = (topic, data) => {
  try {
    Promise.resolve(host.emit(topic, data)).catch(() => undefined);
  } catch {
    /* no frames open, or the host is gone */
  }
};

const recent = [];
let lastPlayAt = 0;
const lastPlayBySession = new Map();
let emitTimer = null;

const emitStateSoon = () => {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    emit('state', publicState());
  }, 400);
};

const pushRecent = (entry) => {
  recent.unshift({ at: Date.now(), ...entry });
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
  emitStateSoon();
};

const handleSessionEvent = (event) => {
  const slot = EVENT_SLOT[event?.type];
  if (!slot) return;
  // A subagent's turn end is not something the user has to react to.
  if (event.session?.parentId) return;
  const sessionId = event.session?.id ?? '';
  const conf = settings.slots[slot];
  if (!settings.enabled || !conf?.on) return;
  const now = Date.now();
  if (now - lastPlayAt < settings.cooldownMs) return;
  if (now - (lastPlayBySession.get(`${sessionId}|${slot}`) ?? 0) < settings.sessionCooldownMs) return;
  lastPlayAt = now;
  lastPlayBySession.set(`${sessionId}|${slot}`, now);
  if (lastPlayBySession.size > 500) lastPlayBySession.clear();
  const played = play(conf.sound);
  pushRecent({
    type: event.type,
    slot,
    sessionId,
    sound: conf.sound,
    played,
    detail: played ? '' : '音效文件不存在，已跳过',
  });
  log(`event ${event.type} session=${sessionId} slot=${slot} played=${played}`);
};

/* -------------------------------------------------------------- native pick */

const pickerScript = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Windows.Forms',
  '$owner = New-Object System.Windows.Forms.Form',
  "$owner.FormBorderStyle = 'None'",
  '$owner.ShowInTaskbar = $false',
  '$owner.TopMost = $true',
  '$owner.Opacity = 0',
  '$owner.Width = 1',
  '$owner.Height = 1',
  "$owner.StartPosition = 'CenterScreen'",
  '$owner.Show()',
  '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
  "$dialog.Title = '选择提示音（wav / mp3 / m4a / wma，建议 5 秒内）'",
  "$dialog.Filter = '音频文件|*.wav;*.mp3;*.m4a;*.wma|所有文件|*.*'",
  '$dialog.CheckFileExists = $true',
  '$dialog.Multiselect = $false',
  '$result = $dialog.ShowDialog($owner)',
  'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }',
  '$owner.Close()',
].join('\n');

const openPicker = (slot) => {
  if (!SLOTS.includes(slot)) return;
  if (process.platform !== 'win32') {
    emit('pick-failed', { slot, message: '这个系统没有内置文件选择框，请直接粘贴路径' });
    return;
  }
  let output = '';
  let child;
  try {
    child = spawn(PS, ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-EncodedCommand', toEncodedCommand(pickerScript)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    emit('pick-failed', { slot, message: error.message });
    return;
  }
  child.stdout?.on('data', (chunk) => { output += String(chunk); });
  child.on('error', (error) => emit('pick-failed', { slot, message: error.message }));
  child.on('close', () => {
    const picked = output.trim();
    if (!picked) {
      emit('pick-cancelled', { slot });
      return;
    }
    try {
      importFile(slot, picked);
      emit('state', publicState());
      emit('pick-imported', { slot, name: settings.slots[slot].label });
    } catch (error) {
      log(`picker import failed: ${error.message}`);
      emit('pick-failed', { slot, message: error.message });
    }
  });
};

/* ------------------------------------------------------------------- state */

const publicState = () => {
  let files = [];
  try {
    files = fs.readdirSync(SOUNDS_DIR)
      .filter((name) => SAFE_FILE.test(name))
      .map((name) => {
        let size = 0;
        try {
          size = fs.statSync(path.join(SOUNDS_DIR, name)).size;
        } catch {
          /* vanished between readdir and stat */
        }
        return { name, size };
      });
  } catch {
    files = [];
  }
  return {
    version: VERSION,
    platform: process.platform,
    dataDir: DATA_DIR,
    settings,
    builtins: BUILTINS,
    files,
    slots: SLOTS.map((slot) => ({
      id: slot,
      label: SLOT_LABELS[slot],
      sound: settings.slots[slot].sound,
      exists: soundExists(settings.slots[slot].sound),
      fileLabel: settings.slots[slot].label || '',
    })),
    recent,
  };
};

/* ------------------------------------------------------------------- routes */

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > BODY_MAX) {
      reject(new UserError('请求体过大'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const json = (res, status, data) => {
  const body = JSON.stringify(data ?? {});
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
};

const applyPatch = (patch) => {
  if (!patch || typeof patch !== 'object') throw new UserError('空的设置');
  if (typeof patch.enabled === 'boolean') settings.enabled = patch.enabled;
  if (Number.isFinite(patch.volume)) settings.volume = clamp(patch.volume, 0, 1);
  if (Number.isFinite(patch.cooldownMs)) settings.cooldownMs = clamp(Math.round(patch.cooldownMs), 0, 15000);
  if (patch.slot && typeof patch.slot === 'object') {
    const { id } = patch.slot;
    if (!SLOTS.includes(id)) throw new UserError('未知的事件槽位');
    const target = settings.slots[id];
    if (typeof patch.slot.on === 'boolean') target.on = patch.slot.on;
    if (patch.slot.sound !== undefined) {
      const next = patch.slot.sound;
      if (typeof next !== 'string' || !(next.startsWith('builtin:') || next.startsWith('file:'))) {
        throw new UserError('音效引用不合法');
      }
      if (next.startsWith('builtin:') && !BUILTIN_IDS.has(next.slice(8))) throw new UserError('没有这个内置音效');
      if (next.startsWith('file:') && !SAFE_FILE.test(next.slice(5))) throw new UserError('音效文件名不合法');
      if (!soundExists(next)) throw new UserError('这个音效文件已经不在了');
      target.sound = next;
      if (next.startsWith('builtin:')) {
        target.label = '';
      } else {
        const known = Object.values(settings.slots).find((entry) => entry.sound === next && entry.label);
        target.label = known?.label || next.slice(5);
      }
    }
  }
  saveSettings();
};

const route = async (req, res, url) => {
  const { pathname } = url;
  if (pathname === '/health') return json(res, 200, { ok: true });
  if (pathname === '/state') return json(res, 200, publicState());

  if (pathname === '/session-events') {
    const raw = await readBody(req);
    const parsed = readSessionEventRequest(raw);
    if (!parsed) return json(res, 400, { ok: false, error: 'not a session event' });
    json(res, 200, { ok: true });
    handleSessionEvent(parsed.event);
    return undefined;
  }

  if (pathname === '/settings') {
    const patch = JSON.parse(await readBody(req));
    applyPatch(patch);
    const state = publicState();
    emit('state', state);
    return json(res, 200, state);
  }

  if (pathname === '/preview') {
    const { slot } = JSON.parse(await readBody(req));
    if (!SLOTS.includes(slot)) throw new UserError('未知的事件槽位');
    const sound = settings.slots[slot].sound;
    if (!soundExists(sound)) throw new UserError('这个音效文件不在了，重新选一个');
    if (!play(sound)) throw new UserError('没能启动播放进程，详见 service.log');
    return json(res, 200, { ok: true });
  }

  if (pathname === '/pick-file') {
    const { slot } = JSON.parse(await readBody(req));
    openPicker(slot);
    return json(res, 202, { pending: true });
  }

  if (pathname === '/import') {
    const { slot, source } = JSON.parse(await readBody(req));
    importFile(slot, source);
    const state = publicState();
    emit('state', state);
    return json(res, 200, state);
  }

  if (pathname === '/reset') {
    const { slot } = JSON.parse(await readBody(req));
    if (!SLOTS.includes(slot)) throw new UserError('未知的事件槽位');
    settings.slots[slot].sound = DEFAULT_SETTINGS.slots[slot].sound;
    settings.slots[slot].label = '';
    pruneSounds();
    saveSettings();
    const state = publicState();
    emit('state', state);
    return json(res, 200, state);
  }

  return json(res, 404, { error: 'not found' });
};

const server = http.createServer((req, res) => {
  if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
    json(res, 401, { error: 'unauthorized' });
    return;
  }
  let url;
  try {
    url = new URL(req.url ?? '/', 'http://127.0.0.1');
  } catch {
    json(res, 400, { error: 'bad url' });
    return;
  }
  route(req, res, url).catch((error) => {
    const status = error instanceof UserError ? 400 : 500;
    if (status === 500) log(`route error ${url.pathname}: ${error.stack || error.message}`);
    if (!res.headersSent) json(res, status, { error: error.message || 'error' });
  });
});

process.on('uncaughtException', (error) => log(`uncaught: ${error.stack || error.message}`));
process.on('unhandledRejection', (error) => log(`unhandled: ${error?.stack || error}`));

ensureDirs();
settings = loadSettings();
pruneSounds();
saveSettings();

server.listen(PORT, '127.0.0.1', () => {
  log(`service up on ${PORT} (${process.platform}, data ${DATA_DIR})`);
});
