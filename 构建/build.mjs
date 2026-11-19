/**
 * Builds the extension package at the repository root:
 *
 *   node build.mjs
 *
 * Two bundles and nothing else: the panel (browser IIFE, SDK bundled) and the
 * service (node ESM, SDK bundled) so the package ships without node_modules.
 * `panel/index.html`, `icon.svg`, `package.json` and `assets/*.wav` are static
 * and live at the repository root; this folder (`构建/`) only holds the sources.
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const SRC = path.join(HERE, 'src');

// 产物里的 `// src/panel.js` 这类相对路径取自 esbuild 的 working dir；
// 固定成 构建/，本地和 CI 在不同目录下跑都能得到同样的字节。
const absWorkingDir = HERE;
const extensionVersion = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
const define = { __EXT_VERSION__: JSON.stringify(extensionVersion) };

const banner = { js: '/* notify-chime — built by 构建/build.mjs, do not edit by hand. */' };

const run = async () => {
  if (!fs.existsSync(path.join(PKG, 'package.json'))) {
    throw new Error(`package folder missing: ${PKG}`);
  }

  const results = await Promise.all([
    build({
      entryPoints: [path.join(SRC, 'panel.js')],
      outfile: path.join(PKG, 'panel', 'main.js'),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: ['chrome120'],
      charset: 'utf8',
      legalComments: 'none',
      absWorkingDir,
      define,
      banner,
    }),
    build({
      entryPoints: [path.join(SRC, 'service.js')],
      outfile: path.join(PKG, 'service', 'main.js'),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: ['node20'],
      charset: 'utf8',
      legalComments: 'none',
      absWorkingDir,
      define,
      banner,
    }),
  ]);

  for (const result of results) {
    for (const [file, output] of Object.entries(result.metafile?.outputs ?? {})) {
      process.stdout.write(`${file}  ${(output.bytes / 1024).toFixed(1)} kB\n`);
    }
  }

  const panel = path.join(PKG, 'panel', 'main.js');
  const service = path.join(PKG, 'service', 'main.js');
  process.stdout.write(`panel   ${(fs.statSync(panel).size / 1024).toFixed(1)} kB -> ${panel}\n`);
  process.stdout.write(`service ${(fs.statSync(service).size / 1024).toFixed(1)} kB -> ${service}\n`);
};

await run();
