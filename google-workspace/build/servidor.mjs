/* Empacota as rotas de API do painel (Next.js) + a camada Google num único
   arquivo para o Apps Script: gas/Servidor.js */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const SERV = path.resolve(AQUI, '../servidor');
const SHIMS = path.join(SERV, 'shims');

function listarRotas(painel) {
  const base = path.join(painel, 'app/api');
  const out = [];
  (function andar(dir) {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (fs.statSync(p).isDirectory()) andar(p);
      else if (nome === 'route.js') out.push(p);
    }
  })(base);
  return out.sort().map((arquivo) => ({
    arquivo,
    padrao: '/api/' + path.relative(base, path.dirname(arquivo)).split(path.sep).join('/'),
  }));
}

export async function construirServidor({ painel, saida, perfil, minificar = true }) {
  const rotas = listarRotas(painel).filter((r) => !perfil.rotasApi || perfil.rotasApi.some((pre) => r.padrao.slice('/api/'.length).startsWith(pre)));
  const virtual = rotas.map((r, i) => `import * as r${i} from ${JSON.stringify(r.arquivo)};`).join('\n') +
    `\nexport const ROTAS = [${rotas.map((r, i) => `{ padrao: ${JSON.stringify(r.padrao)}, mod: r${i} }`).join(',\n')}];\n`;

  const apelidos = {
    'next/server': path.join(SHIMS, 'next-server.js'),
    'next/cache': path.join(SHIMS, 'next-cache.js'),
    'node:crypto': path.join(SHIMS, 'node-crypto.js'),
    crypto: path.join(SHIMS, 'node-crypto.js'),
    googleapis: path.join(SHIMS, 'googleapis.js'),
    '@supabase/supabase-js': path.join(SERV, 'db/consulta.js'),
    'read-excel-file/node': path.join(SHIMS, 'read-excel-file.js'),
    'node:buffer': path.join(SHIMS, 'buffer.js'),
    buffer: path.join(SHIMS, 'buffer.js'),
    'buffer-original': path.join(AQUI, 'node_modules/buffer/index.js'),
  };

  const plugin = {
    name: 'premix-google',
    setup(b) {
      b.onResolve({ filter: /^virtual:rotas$/ }, () => ({ path: 'rotas', namespace: 'virtual' }));
      b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: virtual, resolveDir: painel, loader: 'js' }));
      b.onResolve({ filter: /.*/ }, (args) => {
        if (apelidos[args.path]) return { path: apelidos[args.path] };
        return undefined;
      });
    },
  };

  const r = await esbuild.build({
    entryPoints: [path.join(SERV, 'entrada.js')],
    bundle: true,
    format: 'iife',
    globalName: '__PMX_INTERNO',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['import', 'module', 'default'],
    target: 'es2016', // converte async/await para usar a Promessa síncrona
    supported: { 'async-await': false, 'async-generator': false, 'for-await': false, 'dynamic-import': false },
    inject: [path.join(SHIMS, 'injetar.js')],
    loader: { '.js': 'jsx', '.txt': 'text' },
    nodePaths: [path.join(painel, 'node_modules'), path.join(AQUI, 'node_modules')],
    plugins: [plugin],
    define: { __PERFIL__: JSON.stringify({ nome: perfil.nome, tabelas: perfil.tabelas, publicas: perfil.publicas }) },
    minify: minificar,
    legalComments: 'none',
    write: false,
    logLevel: 'silent',
    metafile: true,
  });
  const codigo = r.outputFiles[0].text;
  const cabecalho = `/* GERADO AUTOMATICAMENTE por google-workspace/build — não edite à mão.
   Contém as rotas de API do painel-fornecedores e a camada de dados em Planilhas. */\n`;
  const FUNCOES = {
    api: 'req', doGet: 'e', doPost: 'e', salvarFornecedor: 'payload', salvarProduto: 'payload', lerImagem: 'caminho',
    prepararAbas: '', importarTabela: 'nome, linhas', esquema: '', limparTabela: 'nome',
  };
  const GATILHOS = { gatilhoLancamentos: 'lancamentos', gatilhoPendencias: 'pendencias' };
  const envolto = `var PMX = (function () {
  var Promise;
  function __definirPromise(P) { Promise = P; }
${codigo}
  return __PMX_INTERNO;
})();
PMX;`;
  // O código vai em partes de até ~500 KB (cada arquivo do Apps Script tem limite de tamanho)
  // e é carregado uma vez por execução, na primeira chamada.
  const TAM = 500000;
  const partes = [];
  for (let i = 0; i < envolto.length; i += TAM) partes.push(envolto.slice(i, i + TAM));
  const dir = path.dirname(saida);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^Servidor(-parte-\d+)?\.js$/.test(f)) fs.unlinkSync(path.join(dir, f));
  partes.forEach((p, i) => {
    fs.writeFileSync(path.join(dir, `Servidor-parte-${String(i + 1).padStart(2, '0')}.js`),
      `/* GERADO AUTOMATICAMENTE — parte ${i + 1} de ${partes.length} do servidor. Não edite. */\nvar __PMX_PARTE_${i + 1} = ${JSON.stringify(p)};\n`);
  });
  const nomesPartes = partes.map((_, i) => `__PMX_PARTE_${i + 1}`).join(' + ');
  const principal = `/* GERADO AUTOMATICAMENTE por google-workspace/build — não edite à mão.
   O servidor (rotas de API do painel-fornecedores + camada de dados em Planilhas)
   está nos arquivos Servidor-parte-NN.js; aqui ficam as funções que o Apps Script chama. */
var __PMX_CARREGADO = null;
function __pmx() {
  if (!__PMX_CARREGADO) __PMX_CARREGADO = (0, eval)(${nomesPartes});
  return __PMX_CARREGADO;
}
${Object.entries(FUNCOES).map(([f, a]) => `function ${f}(${a}) { return __pmx().${f}(${a}); }`).join('\n')}
${Object.entries(GATILHOS).map(([f, q]) => `function ${f}() { return __pmx().gatilho('${q}'); }`).join('\n')}
`;
  fs.writeFileSync(saida, principal);
  return { bytes: envolto.length, partes: partes.length, rotas: rotas.length, metafile: r.metafile, avisos: r.warnings };
}
