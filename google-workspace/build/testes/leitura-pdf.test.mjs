/* Leitura do PDF do Drive: chave de acesso, valores e CNPJ da NF; confere com o boleto. */
import { createRequire } from 'node:module';
import { montar } from './servidor.test.mjs';
const bcrypt = createRequire('/home/user/painel-fornecedores/package.json')('bcryptjs');
process.env.GAS_DIR = process.env.GAS_DIR || 'gas';
const { ctx, gas, chamar } = montar();
gas.propriedades.DOMINIO_PERMITIDO = '';
const db = ctx.PMX.createClient(); const q = (p) => ctx.PMX.agora(p);
let falhou = false; const ok = (c, m) => { if (!c) { falhou = true; console.error('FALHOU:', m); } else console.log('ok -', m); };

function pdf(linhas) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'];
  const fluxo = 'BT /F1 11 Tf ' + linhas.map(([x, y, t]) => `1 0 0 1 ${x} ${y} Tm (${t}) Tj`).join(' ') + ' ET';
  objs.push(`<< /Length ${fluxo.length} >>\nstream\n${fluxo}\nendstream`); objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  return out + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
}
const CHAVE = '35261025062769000165550020070283831462527210';
const pastaDrive = gas.globais.DriveApp.getFolderById('pasta-nfs');
const nf = pastaDrive.createFile(gas.globais.Utilities.newBlob(Buffer.from(pdf([
  [40, 800, 'DANFE'], [40, 780, 'CHAVE DE ACESSO'], [40, 765, CHAVE], [40, 740, 'VALOR TOTAL DA NOTA'], [200, 740, 'R$ 1.620,65'],
  [40, 715, 'CNPJ 04.765.927/0001-73'],
])), 'application/pdf', 'nf.pdf'));
const bol = pastaDrive.createFile(gas.globais.Utilities.newBlob(Buffer.from(pdf([[40, 800, 'BOLETO'], [40, 780, '00190.00009 03753.425002 00101.448173 3 16270000162065']])), 'application/pdf', 'boleto.pdf'));

q(db.from('usuarios_painel').insert({ nome: 'Ana Fiscal', email: 'ana@premix.com.br', senha_hash: bcrypt.hashSync('Senha#123', 4), role: 'admin', primeiro_login: false }));
chamar('POST', '/api/auth/login', { email: 'ana@premix.com.br', senha: 'Senha#123' });
q(db.from('lanc_documentos').insert({ filial: 'Ribeirão Preto', tipo: 'Nota Fiscal - Produto Acabado', num_doc: '000070283', link_nf: nf.getUrl(), link_boleto: bol.getUrl(), vencimento: '2026-11-20' }));

const r = chamar('GET', '/api/lancamentos/1/leitura');
ok(r.status === 200, 'leitura responde 200: ' + (r.corpo || '').slice(0, 200));
const d = q(db.from('lanc_documentos').select('*').eq('id', 1).single()).data;
ok(d.chave_acesso === CHAVE, 'chave de acesso (44 dígitos) lida do PDF da NF');
ok(d.lido_em && d.leitura_status, 'documento marcado como lido: ' + d.leitura_status);
ok(d.valor_bruto === 1620.65 || d.valor_liquido === 1620.65, 'valor da nota lido do PDF');
ok(d.valor_boleto === 1620.65 && d.linha_digitavel === '00190000090375342500200101448173316270000162065' && /^\d{4}-\d{2}-\d{2}$/.test(d.venc_boleto), 'boleto: linha digitável, valor e vencimento lidos do PDF');
ok(d.cnpj_emitente === '25062769000165', 'CNPJ do emitente extraído da chave de acesso');
ok(chamar('GET', '/api/lancamentos/fila').json.itens[0].alerta_valor === false, 'boleto igual à nota: sem alerta');
q(db.from('lanc_documentos').update({ valor_bruto: 1700, valor_liquido: 1700 }).eq('id', 1));
const fila = chamar('GET', '/api/lancamentos/fila').json.itens[0];
ok(fila.alerta_valor === true, 'boleto diferente da nota gera o alerta de valor na fila');
const aviso = chamar('PATCH', '/api/lancamentos/1', { acao: 'lancar' });
ok(aviso.status === 409 && /boleto/i.test(aviso.corpo), 'ao lançar, pede confirmação porque o boleto não bate com a nota');
process.exitCode = falhou ? 1 : 0;
