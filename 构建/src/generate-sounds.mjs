/**
 * Generates the built-in chimes (16-bit mono WAV, 44.1 kHz) into the package.
 * No dependencies: every sound is synthesised here, so the package ships no
 * third-party audio.
 *
 *   node src/generate-sounds.mjs [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] ?? path.join(HERE, '..', '..', '扩展包', 'notify-chime', 'assets'));

/** One bell-ish note: sine plus two soft harmonics, fast attack, exponential tail. */
const note = (buf, { at, dur, freq, amp = 1, bells = 0.35, decay = 5.2 }) => {
  const start = Math.floor(at * SR);
  const count = Math.floor(dur * SR);
  for (let i = 0; i < count; i += 1) {
    const index = start + i;
    if (index >= buf.length) break;
    const t = i / SR;
    const attack = Math.min(1, t / 0.006);
    const env = attack * Math.exp(-t * decay);
    const phase = 2 * Math.PI * freq * t;
    const sample = Math.sin(phase) + bells * Math.sin(2 * phase) + 0.12 * bells * Math.sin(3 * phase);
    buf[index] += sample * env * amp;
  }
};

const render = (seconds, build) => {
  const buf = new Float32Array(Math.ceil(seconds * SR));
  build(buf);
  // Peak-normalise, then leave headroom so the player's volume setting decides loudness.
  let peak = 0;
  for (const value of buf) peak = Math.max(peak, Math.abs(value));
  const scale = peak > 0 ? 0.5 / peak : 1;
  const pcm = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i += 1) {
    // Short fade at both ends kills the click a hard cut would make.
    const fadeIn = Math.min(1, i / (0.004 * SR));
    const fadeOut = Math.min(1, (buf.length - i) / (0.01 * SR));
    const value = Math.max(-1, Math.min(1, buf[i] * scale * fadeIn * fadeOut));
    pcm.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  return pcm;
};

const wav = (pcm) => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

const sounds = {
  // Rising fifth: the "this one is done" chime.
  'chime-done': () => render(0.95, (buf) => {
    note(buf, { at: 0, dur: 0.42, freq: 659.25, amp: 0.9 });
    note(buf, { at: 0.16, dur: 0.75, freq: 987.77, amp: 1 });
  }),
  // One soft note, for people who find two-note chimes busy.
  'chime-soft': () => render(0.85, (buf) => {
    note(buf, { at: 0, dur: 0.8, freq: 523.25, amp: 1, decay: 3.4 });
  }),
  // Three bright notes climbing.
  'chime-bright': () => render(0.8, (buf) => {
    note(buf, { at: 0, dur: 0.2, freq: 783.99, amp: 0.8 });
    note(buf, { at: 0.1, dur: 0.2, freq: 987.77, amp: 0.85 });
    note(buf, { at: 0.2, dur: 0.5, freq: 1174.66, amp: 1 });
  }),
  // Two even pulses: "a question is waiting".
  'chime-ask': () => render(0.62, (buf) => {
    note(buf, { at: 0, dur: 0.18, freq: 1318.51, amp: 1, decay: 9 });
    note(buf, { at: 0.24, dur: 0.24, freq: 1318.51, amp: 1, decay: 9 });
  }),
  // Three tighter pulses: "an approval is waiting".
  'chime-alert': () => render(0.6, (buf) => {
    for (const at of [0, 0.15, 0.3]) {
      note(buf, { at, dur: 0.12, freq: 880, amp: 1, decay: 12 });
    }
  }),
  // Two low notes: something failed.
  'chime-error': () => render(0.9, (buf) => {
    note(buf, { at: 0, dur: 0.34, freq: 220, amp: 1, bells: 0.55, decay: 4.2 });
    note(buf, { at: 0.3, dur: 0.55, freq: 174.61, amp: 1, bells: 0.55, decay: 3.8 });
  }),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, build] of Object.entries(sounds)) {
  const file = path.join(OUT, `${name}.wav`);
  fs.writeFileSync(file, wav(build()));
  process.stdout.write(`${path.basename(file)}  ${fs.statSync(file).size} bytes\n`);
}
process.stdout.write(`written to ${OUT}\n`);
