/* notify-chime — built by 构建/build.mjs, do not edit by hand. */

// src/service.js
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// node_modules/@openchamber/sdk/dist/scrollbar-style.js
var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
function installGuestScrollbarActivity(doc) {
  const root = doc.documentElement;
  if (root.hasAttribute("data-oc-scrollbar-activity"))
    return;
  root.setAttribute("data-oc-scrollbar-activity", "");
  const timers = /* @__PURE__ */ new WeakMap();
  doc.addEventListener("scroll", (event) => {
    const target = event.target === doc ? root : event.target;
    if (!(target instanceof Element))
      return;
    if (!target.hasAttribute("data-oc-scrolling"))
      target.setAttribute("data-oc-scrolling", "");
    const pending = timers.get(target);
    if (pending !== void 0)
      clearTimeout(pending);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      target.removeAttribute("data-oc-scrolling");
    }, 1e3));
  }, { capture: true, passive: true });
}
var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;

// node_modules/@openchamber/sdk/dist/manifest.js
var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);

// node_modules/@openchamber/sdk/dist/session-events.js
var GUEST_SESSION_EVENT_TYPES = [
  "turn-finished",
  "turn-failed",
  "permission-asked",
  "question-asked",
  "turn-started",
  "session-created",
  "session-archived",
  "session-deleted"
];
var SESSION_EVENTS_WIRE_VERSION = 1;
var SESSION_EVENTS_IDLE_MS = 10 * 6e4;
var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);
var isGuestSessionEventType = (value) => EVENT_TYPES.has(value);
var readSessionEventRequest = (body) => {
  let wire;
  try {
    const parsed = JSON.parse(body);
    if (Object(parsed) !== parsed || parsed === null)
      return null;
    wire = parsed;
  } catch {
    return null;
  }
  const { v, requestId, event, content } = wire;
  if (v !== SESSION_EVENTS_WIRE_VERSION)
    return null;
  if (String(requestId) !== requestId || requestId.length === 0)
    return null;
  if (Object(event) !== event || event === void 0)
    return null;
  const { id, type, at, session, project, linked, permission, question } = event;
  if (String(id) !== id || id.length === 0)
    return null;
  if (String(type) !== type || !isGuestSessionEventType(type))
    return null;
  if (!Number.isFinite(at))
    return null;
  if (Object(session) !== session || session === void 0)
    return null;
  const sessionId = session.id;
  if (String(sessionId) !== sessionId || sessionId.length === 0)
    return null;
  const parentId = session.parentId;
  if (parentId !== null && (String(parentId) !== parentId || parentId.length === 0))
    return null;
  if (Object(project) !== project || project === void 0)
    return null;
  const directory = project.directory;
  if (directory !== null && (String(directory) !== directory || directory.length === 0))
    return null;
  if (!Array.isArray(linked))
    return null;
  const request = {
    v: SESSION_EVENTS_WIRE_VERSION,
    requestId,
    event: { id, type, at: Number(at), session: { id: sessionId, parentId }, project: { directory }, linked }
  };
  if (permission !== void 0) {
    if (Object(permission) !== permission)
      return null;
    const permissionRequestId = permission.requestId;
    if (String(permissionRequestId) !== permissionRequestId || permissionRequestId.length === 0)
      return null;
    request.event.permission = { requestId: permissionRequestId };
  }
  if (question !== void 0) {
    if (Object(question) !== question)
      return null;
    const { kind, id: questionId } = question;
    if (kind !== "form" && kind !== "page")
      return null;
    if (String(questionId) !== questionId || questionId.length === 0)
      return null;
    request.event.question = { kind, id: questionId };
  }
  if (content !== void 0) {
    if (Object(content) !== content || content.type !== type)
      return null;
    request.content = content;
  }
  return request;
};

// node_modules/@openchamber/sdk/dist/service-host.js
var SERVICE_HOST_PATH = "/service/call";
var OPENCHAMBER_HOST_CALLBACK_URL_ENV = "OPENCHAMBER_HOST_CALLBACK_URL";
var SERVICE_HOST_TIMEOUT_MS = 3e4;
var SERVICE_SCHEDULE_IDLE_MS = 10 * 6e4;
var MENTIONS_IDLE_MS = 10 * 6e4;
var ServiceHostError = class extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "ServiceHostError";
    this.code = code;
    this.status = status;
  }
};
var createServiceHost = ({ env }) => {
  const call = async (method, input) => {
    const base = env[OPENCHAMBER_HOST_CALLBACK_URL_ENV];
    const token = env.OPENCHAMBER_SERVICE_TOKEN;
    if (!base || !token)
      throw new ServiceHostError("This service was not started by OpenChamber.", "HOST_UNAVAILABLE", 0);
    let response;
    try {
      response = await fetch(`${base.replace(/\/+$/, "")}${SERVICE_HOST_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method, input }),
        signal: AbortSignal.timeout(SERVICE_HOST_TIMEOUT_MS)
      });
    } catch {
      throw new ServiceHostError("OpenChamber did not answer.", "HOST_UNAVAILABLE", 0);
    }
    const body = await response.json().catch(() => null);
    if (response.ok && body?.result !== void 0)
      return body.result;
    throw new ServiceHostError(body?.error?.message ?? `OpenChamber answered HTTP ${response.status}.`, body?.error?.code ?? "HOST_UNAVAILABLE", response.status);
  };
  return {
    sessions: {
      start: (input) => call("sessions.start", input),
      send: (sessionId, prompt) => call("sessions.send", { sessionId, prompt }),
      retry: (sessionId) => call("sessions.retry", { sessionId }),
      status: (sessionId) => call("sessions.status", { sessionId }),
      lastReply: (sessionId) => call("sessions.lastReply", { sessionId }),
      stop: (sessionId) => call("sessions.stop", { sessionId }),
      answerPermission: (sessionId, requestId, answer) => call("sessions.answerPermission", { sessionId, requestId, ...answer }),
      answerForm: (sessionId, formId, values, message) => call("sessions.answerForm", { sessionId, formId, values, ...message === void 0 ? {} : { message } })
    },
    setInstructions: (directory, text) => call("instructions.set", { directory, text }),
    emit: (topic, data) => call("panels.emit", { topic, data }),
    readSettings: () => call("settings.read", {}).then(({ settings: settings2 }) => settings2),
    needsConfiguration: (message) => call("status.set", { needsConfiguration: message }),
    setMark: (target, mark) => call("marks.set", { target, mark })
  };
};

// node_modules/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 6e4;
var HOST_REQUEST_ERROR_CODES = [
  "HOST_UNAVAILABLE",
  "HOST_TIMEOUT",
  "HOST_REJECTED",
  "DISCONNECTED",
  "DISABLED",
  "BAD_PATH",
  "NO_INTEGRATION",
  "NO_SERVICE",
  "SERVICE_FAILED",
  "REQUEST_FAILED",
  "RESPONSE_TOO_LARGE",
  "NO_SESSION",
  "SESSION_BUSY",
  "NOT_GRANTED",
  "NO_DIRECTORY",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "DENIED",
  "NO_MODEL",
  "MODEL_FAILED",
  "UNSUPPORTED"
];
var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);

// node_modules/@openchamber/sdk/dist/service-providers.js
var BROWSER_CONTROL_ACTIONS = [
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.inspect",
  "browser.capture",
  "browser.resize",
  "browser.close"
];
var BROWSER_PROVIDER_IDLE_MS = 10 * 6e4;
var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 6e4;
var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 6e4;
var TRACKER_PROVIDER_IDLE_MS = 10 * 6e4;
var QUOTA_PROVIDER_IDLE_MS = 10 * 6e4;

// node_modules/@openchamber/sdk/dist/service-surface.js
var SURFACE_CONTROLLERS = ["none", "agent", "user"];
var CONTROLLERS = new Set(SURFACE_CONTROLLERS);

// src/service.js
var VERSION = "0.1.0";
var PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
var DATA_DIR = process.env.OPENCHAMBER_SERVICE_DATA_DIR || path.join(os.homedir(), ".openchamber-notify-chime");
var SOUNDS_DIR = path.join(DATA_DIR, "sounds");
var SETTINGS_PATH = path.join(DATA_DIR, "settings.json");
var LOG_PATH = path.join(DATA_DIR, "service.log");
var PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0);
var TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN || "";
var MAX_IMPORT_BYTES = 20 * 1024 * 1024;
var ALLOWED_EXT = /* @__PURE__ */ new Set([".wav", ".mp3", ".m4a", ".wma"]);
var SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,119}$/i;
var BODY_MAX = 1024 * 1024;
var RECENT_MAX = 12;
var SLOTS = ["done", "failed", "question", "permission"];
var SLOT_LABELS = { done: "完成", failed: "失败", question: "需要回答", permission: "需要授权" };
var EVENT_SLOT = {
  "turn-finished": "done",
  "turn-failed": "failed",
  "question-asked": "question",
  "permission-asked": "permission"
};
var BUILTINS = [
  { id: "chime-done", label: "叮咚（上扬双音）" },
  { id: "chime-soft", label: "轻声（单音）" },
  { id: "chime-bright", label: "清脆（三连音）" },
  { id: "chime-ask", label: "询问（两声）" },
  { id: "chime-alert", label: "提醒（三声急促）" },
  { id: "chime-error", label: "低沉（两声）" }
];
var BUILTIN_IDS = new Set(BUILTINS.map((entry) => entry.id));
var DEFAULT_SETTINGS = {
  version: 1,
  enabled: true,
  volume: 0.8,
  cooldownMs: 1500,
  sessionCooldownMs: 3e3,
  slots: {
    done: { on: true, sound: "builtin:chime-done", label: "" },
    failed: { on: true, sound: "builtin:chime-error", label: "" },
    question: { on: true, sound: "builtin:chime-ask", label: "" },
    permission: { on: true, sound: "builtin:chime-alert", label: "" }
  }
};
var PS = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : null;
var UserError = class extends Error {
};
var ensureDirs = () => {
  fs.mkdirSync(SOUNDS_DIR, { recursive: true });
};
var log = (message) => {
  const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${message}
`;
  try {
    const size = fs.existsSync(LOG_PATH) ? fs.statSync(LOG_PATH).size : 0;
    if (size > 512 * 1024) fs.writeFileSync(LOG_PATH, "");
    fs.appendFileSync(LOG_PATH, line);
  } catch {
  }
};
var clone = (value) => JSON.parse(JSON.stringify(value));
var clamp = (value, min, max) => Math.min(max, Math.max(min, value));
var isSafeRef = (value) => typeof value === "string" && value.length <= 160;
var normalizeSound = (value, fallback) => {
  if (!isSafeRef(value)) return fallback;
  if (value.startsWith("builtin:")) {
    const id = value.slice(8);
    return BUILTIN_IDS.has(id) ? value : fallback;
  }
  if (value.startsWith("file:")) {
    const name = value.slice(5);
    return SAFE_FILE.test(name) ? value : fallback;
  }
  return fallback;
};
var loadSettings = () => {
  const next = clone(DEFAULT_SETTINGS);
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    if (typeof raw.enabled === "boolean") next.enabled = raw.enabled;
    if (Number.isFinite(raw.volume)) next.volume = clamp(raw.volume, 0, 1);
    if (Number.isFinite(raw.cooldownMs)) next.cooldownMs = clamp(Math.round(raw.cooldownMs), 0, 15e3);
    if (Number.isFinite(raw.sessionCooldownMs)) next.sessionCooldownMs = clamp(Math.round(raw.sessionCooldownMs), 0, 6e4);
    for (const slot of SLOTS) {
      const saved = raw?.slots?.[slot];
      if (!saved) continue;
      if (typeof saved.on === "boolean") next.slots[slot].on = saved.on;
      next.slots[slot].sound = normalizeSound(saved.sound, next.slots[slot].sound);
      if (typeof saved.label === "string") next.slots[slot].label = saved.label.slice(0, 80);
    }
  } catch {
  }
  return next;
};
var saveSettings = () => {
  const temp = `${SETTINGS_PATH}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}
`);
  fs.renameSync(temp, SETTINGS_PATH);
};
var settings = DEFAULT_SETTINGS;
var soundFile = (sound) => sound.startsWith("builtin:") ? path.join(PKG_ROOT, "assets", `${sound.slice(8)}.wav`) : path.join(SOUNDS_DIR, sound.slice(5));
var soundExists = (sound) => {
  try {
    return fs.statSync(soundFile(sound)).isFile();
  } catch {
    return false;
  }
};
var wavDurationMs = (file) => {
  try {
    const fd = fs.openSync(file, "r");
    const head = Buffer.alloc(64 * 1024);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    if (read < 44 || head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") return null;
    let offset = 12;
    let byteRate = 0;
    let dataSize = 0;
    while (offset + 8 <= read) {
      const id = head.toString("ascii", offset, offset + 4);
      const size = head.readUInt32LE(offset + 4);
      if (id === "fmt " && offset + 20 <= read) byteRate = head.readUInt32LE(offset + 16);
      if (id === "data") {
        dataSize = size;
        break;
      }
      offset += 8 + size + size % 2;
    }
    if (!byteRate || !dataSize) return null;
    return Math.round(dataSize / byteRate * 1e3);
  } catch {
    return null;
  }
};
var MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
var MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
var mp3DurationMs = (file) => {
  try {
    const fd = fs.openSync(file, "r");
    const head = Buffer.alloc(16 * 1024);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    let offset = 0;
    if (read > 10 && head.toString("ascii", 0, 3) === "ID3") {
      const size = (head[6] & 127) << 21 | (head[7] & 127) << 14 | (head[8] & 127) << 7 | head[9] & 127;
      offset = 10 + size;
    }
    while (offset + 4 <= read && !(head[offset] === 255 && (head[offset + 1] & 224) === 224)) offset += 1;
    if (offset + 4 > read) return null;
    const version = head[offset + 1] >> 3 & 3;
    const layer = head[offset + 1] >> 1 & 3;
    if (layer !== 1) return null;
    const bitrateIndex = head[offset + 2] >> 4 & 15;
    const table = version === 3 ? MPEG1_L3 : MPEG2_L3;
    const kbps = table[bitrateIndex] ?? 0;
    if (!kbps) return null;
    const bytes = fs.statSync(file).size;
    return Math.round(bytes * 8 / kbps);
  } catch {
    return null;
  }
};
var durationMs = (file) => {
  const ext = path.extname(file).toLowerCase();
  const known = ext === ".wav" ? wavDurationMs(file) : ext === ".mp3" ? mp3DurationMs(file) : null;
  return known === null ? 6e3 : clamp(known, 250, 15e3);
};
var toEncodedCommand = (script) => Buffer.from(script, "utf16le").toString("base64");
var psLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;
var spawnQuiet = (command, args, label = "play") => {
  try {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    const started = Date.now();
    let stderr = "";
    log(`spawn ${label} pid=${child.pid ?? "none"}`);
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 2e3) stderr += String(chunk);
    });
    child.on("error", (error) => log(`spawn failed ${label}: ${error.message}`));
    child.on("close", (code, signal) => {
      const detail = stderr.includes("CLIXML") ? "" : stderr.trim().replace(/\s+/g, " ").slice(0, 300);
      log(`spawn done ${label} pid=${child.pid ?? "none"} code=${code} signal=${signal ?? "-"} ms=${Date.now() - started}${detail ? ` stderr=${detail}` : ""}`);
    });
    child.unref();
    return true;
  } catch (error) {
    log(`spawn threw ${label}: ${error.message}`);
    return false;
  }
};
var playWindows = (file, volume, label = "play") => {
  const waitMs = durationMs(file) + 300;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$file = ${psLiteral(file)}`,
    "try {",
    "  Add-Type -AssemblyName PresentationCore",
    "  $player = New-Object System.Windows.Media.MediaPlayer",
    `  $player.Volume = ${volume.toFixed(2)}`,
    "  $player.Open([Uri]$file)",
    "  $player.Play()",
    `  Start-Sleep -Milliseconds ${waitMs}`,
    "  $player.Close()",
    "} catch {",
    "  try { (New-Object System.Media.SoundPlayer $file).PlaySync() } catch { }",
    "}"
  ].join("\n");
  return spawnQuiet(PS, ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", toEncodedCommand(script)], label);
};
var playOther = (file, volume, label = "play") => {
  if (process.platform === "darwin") return spawnQuiet("afplay", ["-v", volume.toFixed(2), file], label);
  const player = fs.existsSync("/usr/bin/paplay") ? "paplay" : "aplay";
  return spawnQuiet(player, [file], label);
};
var play = (sound, volume = settings.volume) => {
  const file = soundFile(sound);
  if (!soundExists(sound)) {
    log(`missing sound ${sound} -> ${file}`);
    return false;
  }
  return process.platform === "win32" ? playWindows(file, volume, sound) : playOther(file, volume, sound);
};
var pruneSounds = () => {
  const keep = new Set(SLOTS.map((slot) => settings.slots[slot].sound).filter((s) => s.startsWith("file:")).map((s) => s.slice(5)));
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
    }
  }
};
var looksLikeAudio = (head, ext) => {
  if (head.length < 12) return false;
  if (ext === ".wav") return head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WAVE";
  if (ext === ".mp3") return head.toString("ascii", 0, 3) === "ID3" || head[0] === 255 && (head[1] & 224) === 224;
  if (ext === ".m4a") return head.toString("ascii", 4, 8) === "ftyp";
  if (ext === ".wma") return head[0] === 48 && head[1] === 38 && head[2] === 178 && head[3] === 117;
  return false;
};
var importFile = (slot, source) => {
  if (!SLOTS.includes(slot)) throw new UserError("未知的事件槽位");
  const resolved = path.resolve(String(source || "").trim());
  if (!resolved) throw new UserError("路径为空");
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new UserError("找不到这个文件");
  }
  if (!stat.isFile()) throw new UserError("这不是一个文件");
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new UserError(`不支持的格式「${ext || "无扩展名"}」，请用 wav / mp3 / m4a / wma`);
  if (stat.size > MAX_IMPORT_BYTES) throw new UserError("文件超过 20 MB，换一个短一点的提示音");
  if (stat.size < 128) throw new UserError("这个文件太小，不像音频");
  const fd = fs.openSync(resolved, "r");
  const head = Buffer.alloc(16);
  try {
    fs.readSync(fd, head, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (!looksLikeAudio(head, ext)) throw new UserError(`这个 ${ext} 文件不像音频，换一个试试`);
  ensureDirs();
  const digest = crypto.createHash("sha1").update(fs.readFileSync(resolved)).digest("hex").slice(0, 10);
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
var host = createServiceHost({ env: process.env });
var emit = (topic, data) => {
  try {
    Promise.resolve(host.emit(topic, data)).catch(() => void 0);
  } catch {
  }
};
var recent = [];
var lastPlayAt = 0;
var lastPlayBySession = /* @__PURE__ */ new Map();
var emitTimer = null;
var emitStateSoon = () => {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    emit("state", publicState());
  }, 400);
};
var pushRecent = (entry) => {
  recent.unshift({ at: Date.now(), ...entry });
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
  emitStateSoon();
};
var handleSessionEvent = (event) => {
  const slot = EVENT_SLOT[event?.type];
  if (!slot) return;
  if (event.session?.parentId) return;
  const sessionId = event.session?.id ?? "";
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
    detail: played ? "" : "音效文件不存在，已跳过"
  });
  log(`event ${event.type} session=${sessionId} slot=${slot} played=${played}`);
};
var pickerScript = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Windows.Forms",
  "$owner = New-Object System.Windows.Forms.Form",
  "$owner.FormBorderStyle = 'None'",
  "$owner.ShowInTaskbar = $false",
  "$owner.TopMost = $true",
  "$owner.Opacity = 0",
  "$owner.Width = 1",
  "$owner.Height = 1",
  "$owner.StartPosition = 'CenterScreen'",
  "$owner.Show()",
  "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
  "$dialog.Title = '选择提示音（wav / mp3 / m4a / wma，建议 5 秒内）'",
  "$dialog.Filter = '音频文件|*.wav;*.mp3;*.m4a;*.wma|所有文件|*.*'",
  "$dialog.CheckFileExists = $true",
  "$dialog.Multiselect = $false",
  "$result = $dialog.ShowDialog($owner)",
  "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }",
  "$owner.Close()"
].join("\n");
var openPicker = (slot) => {
  if (!SLOTS.includes(slot)) return;
  if (process.platform !== "win32") {
    emit("pick-failed", { slot, message: "这个系统没有内置文件选择框，请直接粘贴路径" });
    return;
  }
  let output = "";
  let child;
  try {
    child = spawn(PS, ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-EncodedCommand", toEncodedCommand(pickerScript)], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch (error) {
    emit("pick-failed", { slot, message: error.message });
    return;
  }
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  child.on("error", (error) => emit("pick-failed", { slot, message: error.message }));
  child.on("close", () => {
    const picked = output.trim();
    if (!picked) {
      emit("pick-cancelled", { slot });
      return;
    }
    try {
      importFile(slot, picked);
      emit("state", publicState());
      emit("pick-imported", { slot, name: settings.slots[slot].label });
    } catch (error) {
      log(`picker import failed: ${error.message}`);
      emit("pick-failed", { slot, message: error.message });
    }
  });
};
var publicState = () => {
  let files = [];
  try {
    files = fs.readdirSync(SOUNDS_DIR).filter((name) => SAFE_FILE.test(name)).map((name) => {
      let size = 0;
      try {
        size = fs.statSync(path.join(SOUNDS_DIR, name)).size;
      } catch {
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
      fileLabel: settings.slots[slot].label || ""
    })),
    recent
  };
};
var readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > BODY_MAX) {
      reject(new UserError("请求体过大"));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  req.on("error", reject);
});
var json = (res, status, data) => {
  const body = JSON.stringify(data ?? {});
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
};
var applyPatch = (patch) => {
  if (!patch || typeof patch !== "object") throw new UserError("空的设置");
  if (typeof patch.enabled === "boolean") settings.enabled = patch.enabled;
  if (Number.isFinite(patch.volume)) settings.volume = clamp(patch.volume, 0, 1);
  if (Number.isFinite(patch.cooldownMs)) settings.cooldownMs = clamp(Math.round(patch.cooldownMs), 0, 15e3);
  if (patch.slot && typeof patch.slot === "object") {
    const { id } = patch.slot;
    if (!SLOTS.includes(id)) throw new UserError("未知的事件槽位");
    const target = settings.slots[id];
    if (typeof patch.slot.on === "boolean") target.on = patch.slot.on;
    if (patch.slot.sound !== void 0) {
      const next = patch.slot.sound;
      if (typeof next !== "string" || !(next.startsWith("builtin:") || next.startsWith("file:"))) {
        throw new UserError("音效引用不合法");
      }
      if (next.startsWith("builtin:") && !BUILTIN_IDS.has(next.slice(8))) throw new UserError("没有这个内置音效");
      if (next.startsWith("file:") && !SAFE_FILE.test(next.slice(5))) throw new UserError("音效文件名不合法");
      if (!soundExists(next)) throw new UserError("这个音效文件已经不在了");
      target.sound = next;
      if (next.startsWith("builtin:")) {
        target.label = "";
      } else {
        const known = Object.values(settings.slots).find((entry) => entry.sound === next && entry.label);
        target.label = known?.label || next.slice(5);
      }
    }
  }
  saveSettings();
};
var route = async (req, res, url) => {
  const { pathname } = url;
  if (pathname === "/health") return json(res, 200, { ok: true });
  if (pathname === "/state") return json(res, 200, publicState());
  if (pathname === "/session-events") {
    const raw = await readBody(req);
    const parsed = readSessionEventRequest(raw);
    if (!parsed) return json(res, 400, { ok: false, error: "not a session event" });
    json(res, 200, { ok: true });
    handleSessionEvent(parsed.event);
    return void 0;
  }
  if (pathname === "/settings") {
    const patch = JSON.parse(await readBody(req));
    applyPatch(patch);
    const state = publicState();
    emit("state", state);
    return json(res, 200, state);
  }
  if (pathname === "/preview") {
    const { slot } = JSON.parse(await readBody(req));
    if (!SLOTS.includes(slot)) throw new UserError("未知的事件槽位");
    const sound = settings.slots[slot].sound;
    if (!soundExists(sound)) throw new UserError("这个音效文件不在了，重新选一个");
    if (!play(sound)) throw new UserError("没能启动播放进程，详见 service.log");
    return json(res, 200, { ok: true });
  }
  if (pathname === "/pick-file") {
    const { slot } = JSON.parse(await readBody(req));
    openPicker(slot);
    return json(res, 202, { pending: true });
  }
  if (pathname === "/import") {
    const { slot, source } = JSON.parse(await readBody(req));
    importFile(slot, source);
    const state = publicState();
    emit("state", state);
    return json(res, 200, state);
  }
  if (pathname === "/reset") {
    const { slot } = JSON.parse(await readBody(req));
    if (!SLOTS.includes(slot)) throw new UserError("未知的事件槽位");
    settings.slots[slot].sound = DEFAULT_SETTINGS.slots[slot].sound;
    settings.slots[slot].label = "";
    pruneSounds();
    saveSettings();
    const state = publicState();
    emit("state", state);
    return json(res, 200, state);
  }
  return json(res, 404, { error: "not found" });
};
var server = http.createServer((req, res) => {
  if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
    json(res, 401, { error: "unauthorized" });
    return;
  }
  let url;
  try {
    url = new URL(req.url ?? "/", "http://127.0.0.1");
  } catch {
    json(res, 400, { error: "bad url" });
    return;
  }
  route(req, res, url).catch((error) => {
    const status = error instanceof UserError ? 400 : 500;
    if (status === 500) log(`route error ${url.pathname}: ${error.stack || error.message}`);
    if (!res.headersSent) json(res, status, { error: error.message || "error" });
  });
});
process.on("uncaughtException", (error) => log(`uncaught: ${error.stack || error.message}`));
process.on("unhandledRejection", (error) => log(`unhandled: ${error?.stack || error}`));
ensureDirs();
settings = loadSettings();
pruneSounds();
saveSettings();
server.listen(PORT, "127.0.0.1", () => {
  log(`service up on ${PORT} (${process.platform}, data ${DATA_DIR})`);
});
