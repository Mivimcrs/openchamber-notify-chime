/**
 * OpenChamber 提示音 — settings panel.
 *
 * A rail panel, not the feature itself: the sounds play from the service with
 * no window open. Everything here talks to the service over its loopback API.
 */
import { connectHost } from '@openchamber/sdk';
import { applyHostReady, mountButton, mountSelect, mountSwitch, mountTextField } from '@openchamber/sdk/ui';

const host = connectHost();
const root = document.getElementById('root');
const VOLUMES = [
  { id: '0.25', label: '25%' },
  { id: '0.4', label: '40%' },
  { id: '0.55', label: '55%' },
  { id: '0.7', label: '70%' },
  { id: '0.8', label: '80%' },
  { id: '1', label: '100%' },
];

/** The list plus whatever value is stored, so an odd saved volume still shows. */
const volumeOptions = (value) => {
  const options = [...VOLUMES];
  const id = String(Math.round(Number(value) * 100) / 100);
  if (!options.some((entry) => entry.id === id)) {
    options.push({ id, label: `${Math.round(Number(value) * 100)}%` });
    options.sort((a, b) => Number(a.id) - Number(b.id));
  }
  return options;
};

const el = (tag, className) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};

const pad = (value) => String(value).padStart(2, '0');
const clock = (at) => {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

let state = null;
let built = false;
let ready = false;
let attempts = 0;
let retryTimer = null;
let pathValue = '';
let importSlot = 'done';
const refs = { slots: new Map(), banner: null, recent: null, master: null, volume: null, importSlot: null, path: null };

const api = async (method, path, body) => {
  const result = await host.serviceRequest({
    method,
    path,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = result.body ? JSON.parse(result.body) : null;
  } catch {
    data = null;
  }
  if (result.status >= 400) throw new Error(data?.error || `请求失败（HTTP ${result.status}）`);
  return data;
};

const showError = (message) => {
  if (!built) {
    paintNotice(String(message || ''));
    return;
  }
  refs.banner?.update({ tone: 'error', title: '出了点问题', body: String(message || ''), action: { label: '重新读取', onClick: () => { void load(); } } });
};

/** Shown instead of the form while the service cannot be reached (not approved yet). */
const paintNotice = (message) => {
  const existing = root.querySelector('.nc-notice .nc-notice-body');
  if (existing) {
    existing.textContent = message;
    return;
  }
  root.innerHTML = '';
  const box = el('div', 'nc-notice');
  const title = el('div', 'nc-notice-title');
  title.textContent = '还连不上本地服务';
  const body = el('div', 'nc-notice-body');
  body.textContent = message;
  const hint = el('div', 'nc-notice-body');
  hint.textContent = '首次安装需要在设置 → 扩展里批准它的「本地服务」权限，批准后这里会自动出现设置。';
  const action = el('div', 'nc-notice-action');
  mountButton(action, { label: '重试', size: 'sm', onClick: () => { attempts = 0; void load(); } });
  box.append(title, body, hint, action);
  root.append(box);
};

const showInfo = (message) => {
  if (!message) {
    refs.banner?.update({ title: '', body: '', action: null });
    return;
  }
  refs.banner?.update({ tone: 'info', title: message, body: '', action: null });
};

const soundOptions = (current) => {
  const options = [
    ...state.builtins.map((entry) => ({ id: `builtin:${entry.id}`, label: entry.label })),
    ...state.files.map((file) => ({ id: `file:${file.name}`, label: labelOfFile(file.name) })),
  ];
  if (current && !options.some((option) => option.id === current)) {
    const slot = state.slots.find((entry) => entry.sound === current);
    options.push({ id: current, label: slot && !slot.exists ? '（文件已失效）' : '（自定义）' });
  }
  return options;
};

const labelOfFile = (name) => {
  const slot = state.slots.find((entry) => entry.sound === `file:${name}`);
  if (slot?.fileLabel) return slot.fileLabel;
  return name;
};

const apply = (next) => {
  state = next;
  refs.master?.update({ checked: next.settings.enabled });
  refs.volume?.update({ value: String(next.settings.volume), options: volumeOptions(next.settings.volume) });
  for (const slot of next.slots) {
    const row = refs.slots.get(slot.id);
    if (!row) continue;
    row.switch.update({ checked: next.settings.slots[slot.id].on });
    row.select.update({ options: soundOptions(slot.sound), value: slot.sound });
    row.node.dataset.broken = slot.exists ? 'false' : 'true';
    const source = slot.sound.startsWith('builtin:')
      ? `内置 · ${next.builtins.find((entry) => `builtin:${entry.id}` === slot.sound)?.label ?? ''}`
      : `自定义 · ${slot.fileLabel || slot.sound.slice(5)}`;
    row.meta.textContent = slot.exists ? source : `${source}（文件不见了，响的是静音）`;
  }
  paintRecent(next.recent);
  if (importSlot && !next.slots.some((entry) => entry.id === importSlot)) importSlot = 'done';
  refs.importSlot?.update({ value: importSlot, options: next.slots.map((slot) => ({ id: slot.id, label: `${slot.label}` })) });
  showInfo('');
};

const paintRecent = (entries) => {
  if (!refs.recent) return;
  refs.recent.innerHTML = '';
  if (!entries?.length) {
    const empty = el('div', 'nc-empty');
    empty.textContent = '还没有响过。让一个会话结束，或按上面的「试听」。';
    refs.recent.append(empty);
    return;
  }
  for (const entry of entries.slice(0, 8)) {
    const row = el('div', 'nc-log');
    const time = el('span', 'nc-log-time');
    time.textContent = clock(entry.at);
    const what = el('span', 'nc-log-what');
    const slot = state?.slots?.find((item) => item.id === entry.slot);
    what.textContent = `${slot?.label ?? entry.slot}${entry.played ? '' : ' · 未播放'}${entry.detail ? ` · ${entry.detail}` : ''}`;
    row.append(time, what);
    refs.recent.append(row);
  }
};

const patch = async (body) => {
  try {
    apply(await api('POST', '/settings', body));
  } catch (error) {
    showError(error.message);
  }
};

const setSound = async (slot, sound) => {
  if (sound === state.settings.slots[slot].sound) return;
  try {
    apply(await api('POST', '/settings', { slot: { id: slot, sound } }));
  } catch (error) {
    showError(error.message);
    apply(await api('GET', '/state').catch(() => state));
  }
};

const preview = async (slot) => {
  try {
    await api('POST', '/preview', { slot });
  } catch (error) {
    showError(error.message);
  }
};

const pickFor = async (slot) => {
  try {
    await api('POST', '/pick-file', { slot });
    showInfo('已打开文件选择框：挑一个 wav / mp3 / m4a / wma（建议 5 秒内）');
  } catch (error) {
    showError(error.message);
  }
};

const resetSlot = async (slot) => {
  try {
    apply(await api('POST', '/reset', { slot }));
  } catch (error) {
    showError(error.message);
  }
};

const importPath = async () => {
  const source = pathValue.trim();
  if (!source) {
    showError('先把文件路径粘贴进来');
    return;
  }
  try {
    apply(await api('POST', '/import', { slot: importSlot, source }));
    showInfo('导入成功，已经换成这个音效');
  } catch (error) {
    showError(error.message);
  }
};

const build = () => {
  root.innerHTML = '';

  const head = el('div', 'nc-head');
  const titles = el('div', 'nc-titles');
  const title = el('div', 'nc-title');
  title.textContent = '提示音';
  const sub = el('div', 'nc-sub');
  sub.textContent = '会话结束、要你回答或授权时出声，窗口开着也响。';
  titles.append(title, sub);
  const masterWrap = el('div', 'nc-master');
  refs.master = mountSwitch(masterWrap, {
    label: '总开关',
    checked: state.settings.enabled,
    onChange: (checked) => { void patch({ enabled: checked }); },
  });
  head.append(titles, masterWrap);
  root.append(head);

  const banner = el('div', 'nc-banner');
  root.append(banner);
  refs.banner = {
    update: ({ tone = 'info', title: text = '', body = '', action = null }) => {
      banner.innerHTML = '';
      if (!text && !body) {
        banner.dataset.show = 'false';
        return;
      }
      banner.dataset.show = 'true';
      banner.dataset.tone = tone;
      if (text) {
        const line = el('div', 'nc-banner-text');
        line.textContent = text;
        banner.append(line);
      }
      if (body) {
        const detail = el('div', 'nc-banner-body');
        detail.textContent = body;
        banner.append(detail);
      }
      if (action) {
        const holder = el('div', 'nc-banner-action');
        banner.append(holder);
        mountButton(holder, { label: action.label, size: 'xs', variant: 'outline', onClick: action.onClick });
      }
    },
  };
  refs.banner.update({ title: '' });

  const section = el('div', 'nc-section');
  const sectionTitle = el('div', 'nc-section-title');
  sectionTitle.textContent = '什么时候响';
  section.append(sectionTitle);

  for (const slot of state.slots) {
    const row = el('div', 'nc-row');
    row.dataset.broken = slot.exists ? 'false' : 'true';

    const info = el('div', 'nc-row-info');
    const name = el('div', 'nc-row-name');
    name.textContent = slot.label;
    const meta = el('div', 'nc-row-meta');
    info.append(name, meta);

    const controls = el('div', 'nc-row-controls');
    const sw = mountSwitch(controls, {
      label: '',
      checked: state.settings.slots[slot.id].on,
      onChange: (checked) => { void patch({ slot: { id: slot.id, on: checked } }); },
    });
    const select = mountSelect(controls, {
      label: '',
      options: soundOptions(slot.sound),
      value: slot.sound,
      searchable: false,
      onChange: (sound) => { void setSound(slot.id, sound); },
    });
    mountButton(controls, {
      label: '试听',
      size: 'xs',
      variant: 'outline',
      onClick: () => { void preview(slot.id); },
    });
    mountButton(controls, {
      label: '选择…',
      size: 'xs',
      variant: 'outline',
      onClick: () => { void pickFor(slot.id); },
    });
    mountButton(controls, {
      label: '重置',
      size: 'xs',
      variant: 'ghost',
      onClick: () => { void resetSlot(slot.id); },
    });

    row.append(info, controls);
    section.append(row);
    refs.slots.set(slot.id, { node: row, meta, switch: sw, select });
  }
  root.append(section);

  const volumeSection = el('div', 'nc-section nc-volume');
  const volumeTitle = el('div', 'nc-section-title');
  volumeTitle.textContent = '音量';
  const volumeWrap = el('div', 'nc-volume-control');
  refs.volume = mountSelect(volumeWrap, {
    label: '',
    options: volumeOptions(state.settings.volume),
    value: String(state.settings.volume),
    onChange: (value) => { void patch({ volume: Number(value) }); },
  });
  volumeSection.append(volumeTitle, volumeWrap);
  root.append(volumeSection);

  const importSection = el('div', 'nc-section');
  const importTitle = el('div', 'nc-section-title');
  importTitle.textContent = '粘贴路径导入';
  const importGrid = el('div', 'nc-import');
  const slotWrap = el('div', 'nc-import-slot');
  refs.importSlot = mountSelect(slotWrap, {
    label: '',
    options: state.slots.map((slot) => ({ id: slot.id, label: slot.label })),
    value: importSlot,
    onChange: (id) => { importSlot = id; },
  });
  const pathWrap = el('div', 'nc-import-path');
  refs.path = mountTextField(pathWrap, {
    label: '',
    value: pathValue,
    mono: true,
    placeholder: 'D:\\声音\\done.mp3',
    onChange: (value) => { pathValue = value; },
  });
  const importButton = el('div', 'nc-import-go');
  mountButton(importButton, { label: '导入', size: 'sm', onClick: () => { void importPath(); } });
  importGrid.append(slotWrap, pathWrap, importButton);
  const hint = el('div', 'nc-hint');
  hint.textContent = '文件会被复制到这个扩展自己的目录，原文件之后移动或删除都不影响。';
  importSection.append(importTitle, importGrid, hint);
  root.append(importSection);

  const recentSection = el('div', 'nc-section');
  const recentTitle = el('div', 'nc-section-title');
  recentTitle.textContent = '最近响过';
  refs.recent = el('div', 'nc-recent');
  recentSection.append(recentTitle, refs.recent);
  root.append(recentSection);

  const foot = el('div', 'nc-foot');
  foot.textContent = `服务：${state.platform} · 数据目录 ${state.dataDir}`;
  root.append(foot);

  apply(state);
};

const load = async () => {
  try {
    const next = await api('GET', '/state');
    if (!next) throw new Error('服务没有返回状态');
    attempts = 0;
    if (!built) {
      state = next;
      build();
      built = true;
      return;
    }
    apply(next);
  } catch (error) {
    if (!built) paintNotice(error.message);
    else showError(error.message);
    scheduleRetry();
  }
};

/** A freshly installed package asks for approval; keep looking until it lands. */
const scheduleRetry = () => {
  if (built || retryTimer || attempts >= 40) return;
  attempts += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void load();
  }, 3000);
};

host.onServiceEvent((payload) => {
  const topic = payload?.topic ?? payload?.payload?.topic;
  const data = payload?.data ?? payload?.payload?.data;
  if (topic === 'state' && data) apply(data);
  if (topic === 'pick-imported') {
    showInfo(`已导入 ${data?.name || '音效'}`);
    if (data?.slot) preview(data.slot);
  }
  if (topic === 'pick-cancelled') showInfo('取消选择，音效没变');
  if (topic === 'pick-failed') showError(data?.message || '导入失败');
});

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  if (ready) return;
  ready = true;
  void load();
});
