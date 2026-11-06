/* Divide um texto grande em arquivos .js do Apps Script que podem ser COLADOS à mão no editor:
   cada arquivo tem ~450 KB e o conteúdo vai em linhas curtas (o editor do navegador trava com linhas de centenas de KB).
   Cada parte é uma função (não executa nada até ser chamada), então não pesa a cada abertura do projeto. */
import fs from 'node:fs';
import path from 'node:path';

export function emitirPartes(texto, prefixoVar, nomeArquivo, dir, { tamParte = 450000, tamLinha = 3000 } = {}) {
  const partes = [];
  for (let i = 0; i < texto.length; i += tamParte) partes.push(texto.slice(i, i + tamParte));
  partes.forEach((p, i) => {
    const linhas = [];
    for (let j = 0; j < p.length; j += tamLinha) linhas.push('  ' + JSON.stringify(p.slice(j, j + tamLinha)));
    fs.writeFileSync(path.join(dir, `${nomeArquivo}-${String(i + 1).padStart(2, '0')}.js`),
      `/* GERADO AUTOMATICAMENTE — ${nomeArquivo}, parte ${i + 1} de ${partes.length}. Não edite. */\nfunction ${prefixoVar}_P${i + 1}() {\n  return [\n${linhas.join(',\n')}\n  ].join('');\n}\n`);
  });
  return partes.length;
}
export const juntar = (prefixoVar, n) => Array.from({ length: n }, (_, i) => `${prefixoVar}_P${i + 1}()`).join(' + ');
