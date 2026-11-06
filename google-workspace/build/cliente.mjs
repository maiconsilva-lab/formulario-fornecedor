/* Empacota as telas React do painel (Next.js) num único HTML para o Apps Script: gas/Painel.html */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const CLI = path.resolve(AQUI, '../cliente');

export async function construirCliente({ painel, saida, minificar = true }) {
  const plugin = {
    name: 'premix-cliente',
    setup(b) {
      b.onResolve({ filter: /^@painel\// }, (a) => {
        const alvo = path.join(painel, a.path.slice('@painel/'.length));
        for (const c of [alvo, alvo + '.js', path.join(alvo, 'index.js')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return { path: c };
        return { path: alvo };
      });
      b.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: path.join(CLI, 'shims/next-dynamic.js') }));
      // window.location.{pathname,search,href} → roteador interno (a URL real do iframe não serve).
      b.onLoad({ filter: /\.js$/ }, (a) => {
        if (!a.path.startsWith(painel) || a.path.includes('node_modules')) return undefined;
        let src = fs.readFileSync(a.path, 'utf8');
        if (!/window\.location\.(pathname|search|href)/.test(src)) return undefined;
        src = src.replace(/window\.location\.(pathname|search|href)/g, 'window.__pmxLoc.$1');
        return { contents: src, loader: 'jsx', resolveDir: path.dirname(a.path) };
      });
    },
  };
  const r = await esbuild.build({
    entryPoints: [path.join(CLI, 'entrada-painel.js')],
    outdir: 'saida', // só para a divisão js/css; nada é gravado
    bundle: true, format: 'iife', platform: 'browser', target: 'es2019',
    loader: { '.js': 'jsx', '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' },
    jsx: 'automatic',
    nodePaths: [path.join(painel, 'node_modules'), path.join(AQUI, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_CORRECTION_FORM_URL': 'undefined' },
    plugins: [plugin],
    minify: minificar, legalComments: 'none', write: false, logLevel: 'silent', metafile: true,
  });
  const js = r.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const css = (r.outputFiles.find((f) => f.path.endsWith('.css')) || { text: '' }).text;
  const scriptSeguro = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="robots" content="noindex, nofollow">
<base target="_top">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div id="raiz"></div>
<script>${scriptSeguro}</script>
</body>
</html>`;
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, html);
  return { bytes: html.length, metafile: r.metafile, avisos: r.warnings };
}
