// Builds dist/index.html: one self-contained file (CSS + JS inlined, no CDN dependencies).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';

const js = await build({
  entryPoints: ['src/app.js'], bundle: true, format: 'esm', minify: true, write: false,
  target: ['safari15', 'chrome100', 'firefox100'], legalComments: 'none',
});
const css = readFileSync('src/styles.css', 'utf8');
const html = readFileSync('src/index.template.html', 'utf8')
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
cpSync('src/static', 'dist', { recursive: true }); // og.png, favicon-free extras, .well-known/nostr.json, _headers
console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} KB`);
