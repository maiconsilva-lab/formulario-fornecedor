/* O Portal de Lançamentos (código real, com as alterações de pasta/nome e de chamada ao painel) falando com o painel novo. */
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { montar } from './servidor.test.mjs';
import { criarGasFalso } from './gas-falso.mjs';
process.env.GAS_DIR = process.env.GAS_DIR || 'gas';
let falhou = false; const ok = (c, m) => { if (!c) { falhou = true; console.error('FALHOU:', m); } else console.log('ok -', m); };

// ── painel novo (Apps Script do painel) e o Portal, cada um no seu "projeto"
const painel = montar();
painel.gas.propriedades.DOMINIO_PERMITIDO = '';
painel.gas.propriedades.LANC_INGEST_SECRET = 'segredo-do-painel';
const db = painel.ctx.PMX.createClient(); const q = (p) => painel.ctx.PMX.agora(p);

const portal = criarGasFalso({ props: { PASTA_RAIZ: 'raiz-docs', PAINEL_URL: 'https://script.google.com/a/macros/premix.com.br/s/AKfy123/exec', PAINEL_SEGREDO_ENVIO: 'segredo-do-painel' } });
const planilha = portal.globais.SpreadsheetApp.create('Base');
portal.propriedades.PLANILHA_ID = planilha.getId();
const ctx = vm.createContext({ ...portal.globais, console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('AVISO ' + a.join(' ')), error: console.error } });
const logs = [];
const chamadasRede = [];
// a "internet" entre os dois projetos
portal.globais.UrlFetchApp.fetch = (url, op = {}) => {
  chamadasRede.push({ url, op });
  const u = new URL(url);
  if (u.hostname === 'script.google.com') {
    const r = painel.ctx.doPost({ parameter: Object.fromEntries(u.searchParams), postData: { contents: op.payload || '' } });
    const texto = r.texto;
    return { getResponseCode: () => 200, getContentText: () => texto };
  }
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, id: 1 }) };
};
vm.runInContext(fs.readFileSync(new URL('../../portal/Codigo.gs', import.meta.url), 'utf8'), ctx);
ctx.configurar();

const hojeSP = new Date(Date.now() - 3 * 3600e3).toISOString();
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const mesEsperado = MESES[Number(hojeSP.slice(5, 7)) - 1];
const diaEsperado = hojeSP.slice(8, 10);
const pdf = Buffer.from('%PDF-1.4 conteudo de teste').toString('base64');
const arquivos = () => Object.values(portal.arquivos);
const caminho = (a) => { const partes = []; let id = a.pai; while (id && id !== 'raiz-docs') { const p = (portal.pastas || {})[id]; if (!p) break; partes.unshift(p.nome); id = p.pai; } return partes.join(' / '); };

// pastas: o simulador expõe só os arquivos; reconstrói o caminho pelas pastas criadas
const pastasCriadas = [];
const dApp = portal.globais.DriveApp; const antigoGet = dApp.getFolderById;

// ── 1) nomes e pastas
const sobe = (meta) => ctx.enviarArquivo({ nome: 'x.pdf', base64: pdf, ...meta });
const r1 = sobe({ papel: 'nf', filial: 'Patrocínio Paulista', numero: '12345', tipo: 'Nota Fiscal - Produto Acabado' });
ok(r1.nome === 'Patrocínio Paulista NF 000012345.pdf', 'nota fiscal: "' + r1.nome + '"');
ok(sobe({ papel: 'nf', filial: 'Ribeirão Preto', numero: '77', tipo: 'Serviços (Compras Indiretos)' }).nome === 'Ribeirão Preto NFS 000000077.pdf', 'serviços vira NFS');
ok(sobe({ papel: 'nf', filial: 'Cuiabá', numero: '5012', tipo: 'Frete - Matéria Prima' }).nome === 'Cuiabá CTE 000005012.pdf', 'documento do tipo Frete vira CTE');
ok(sobe({ papel: 'nf', filial: 'Goiânia', numero: '9', tipo: 'Produtos (Compras Indiretos)' }).nome === 'Goiânia NF 000000009.pdf', 'produtos (compras indiretas) vira NF');
ok(sobe({ papel: 'nf', filial: 'Goiânia', numero: '9', tipo: 'Nota Fiscal - Matéria prima' }).nome === 'Goiânia NF 000000009 (2).pdf', 'mesmo nome no mesmo dia ganha (2)');
ok(sobe({ papel: 'nf', filial: 'Goiânia', numero: '9', tipo: 'Nota Fiscal - Matéria prima' }).nome === 'Goiânia NF 000000009 (3).pdf', 'e depois (3)');
ok(sobe({ papel: 'frete', filial: 'Patrocínio Paulista', numero: '5012', tipo: 'Nota Fiscal - Produto Acabado' }).nome === 'Patrocínio Paulista CTE 000005012.pdf', 'CT-e anexado a uma NF: CTE + número do CT-e');
ok(sobe({ papel: 'boleto', filial: 'Patrocínio Paulista', numero: '12345', tipo: 'Nota Fiscal - Produto Acabado' }).nome === 'Patrocínio Paulista BOLETO 000012345.pdf', 'boleto: BOLETO + número');
ok(sobe({ papel: 'nf', filial: 'Gurupi', numero: '123456789012', tipo: 'Nota Fiscal - Produto Acabado' }).nome === 'Gurupi NF 123456789012.pdf', 'número longo (mais de 9 dígitos) não é cortado');
const semTipo = sobe({ papel: 'nf', filial: 'Gurupi', numero: '3' });
ok(semTipo.nome === 'Gurupi DOC 000000003.pdf', 'sem tipo (formulário antigo) não quebra: usa DOC');
let erroPdf = ''; try { ctx.enviarArquivo({ nome: 'x.pdf', base64: Buffer.from('MZ nao é pdf').toString('base64'), filial: 'Gurupi', numero: '1', tipo: 'Nota Fiscal - Matéria prima', papel: 'nf' }); } catch (e) { erroPdf = e.message; }
ok(/não é um PDF/.test(erroPdf), 'arquivo que não é PDF continua sendo recusado');

// estrutura de pastas Filial / mês / dia: o PDF mais novo de Patrocínio
const pastaDe = (nome) => { const f = arquivos().find((a) => a.blob.getName() === nome); return f; };
const pf = pastaDe('Patrocínio Paulista NF 000012345.pdf');
const raizDocs = portal.globais.DriveApp.getFolderById('raiz-docs');
const filiais = []; const it = raizDocs.getFolders(); while (it.hasNext()) filiais.push(it.next().getName());
ok(filiais.includes('Patrocínio Paulista') && filiais.includes('Ribeirão Preto') && !filiais.some((n) => /^\d{4}-\d{2}/.test(n)), 'a pasta de mais alto nível é a Filial: ' + filiais.slice(0, 4).join(', ') + '...');
const fp = raizDocs.getFoldersByName('Patrocínio Paulista').next();
const meses = []; const im = fp.getFolders(); while (im.hasNext()) meses.push(im.next().getName());
ok(meses.length === 1 && meses[0] === mesEsperado, 'dentro da filial vem o mês: "' + meses[0] + '"');
const dias = []; const idd = fp.getFoldersByName(mesEsperado).next().getFolders(); while (idd.hasNext()) dias.push(idd.next().getName());
ok(dias.length === 1 && dias[0] === diaEsperado, 'e dentro do mês, o dia: "' + dias[0] + '"');

// ── 2) envio completo: PDFs + linha na planilha + painel novo
const pdfs = {};
const sobeEnvio = (papel, num, tipo) => sobe({ papel, filial: 'Patrocínio Paulista', numero: num, tipo }).link;
const venc = new Date(Date.now() + 9 * 86400e3).toISOString().slice(0, 10);
const resp = ctx.registrarEnvio({
  filial: 'Patrocínio Paulista', tipo: 'Nota Fiscal - Produto Acabado', numero: '4455', vencimento: venc, observacoes: 'Pedido 123',
  possuiFrete: true, numCte: '8899', vencimentoCte: venc, possuiBoleto: true,
  linkNf: sobeEnvio('nf', '4455', 'Nota Fiscal - Produto Acabado'), linkFrete: sobeEnvio('frete', '8899', 'Nota Fiscal - Produto Acabado'), linkBoleto: sobeEnvio('boleto', '4455', 'Nota Fiscal - Produto Acabado'),
  md5Nf: 'a'.repeat(32), md5Cte: 'b'.repeat(32),
});
ok(resp.ok && resp.painel === true, 'registrarEnvio: o painel novo aceitou o documento (painel: ' + resp.painel + ')');
const docs = q(db.from('lanc_documentos').select('*').order('id')).data;
ok(docs.length === 2, 'o painel criou o documento e o CT-e vinculado (' + docs.length + ' linhas)');
const nf = docs.find((d) => !d.documento_pai_id);
ok(nf.filial === 'Patrocínio Paulista' && nf.num_doc === '000004455' && nf.vencimento === venc && nf.enviado_por === 'teste@premix.com.br' && nf.origem === 'portal', 'campos do documento chegaram certos ao painel');
ok(/drive\.google\.com\/file/.test(nf.link_nf) && /drive\.google\.com\/file/.test(nf.link_boleto) && nf.arquivo_md5 === 'a'.repeat(32), 'links do Drive e MD5 chegaram ao painel');
const cte = docs.find((d) => d.documento_pai_id);
ok(cte && cte.num_doc === '000008899' && /Frete/.test(cte.tipo), 'o CT-e virou documento próprio, vinculado à nota');
const linhaPlan = planilha.getSheetByName('Lancamentos').getDataRange().getValues()[1];
ok(linhaPlan[18] === 'OK' && linhaPlan[2] === 'Patrocínio Paulista' && linhaPlan[4] === '000004455', 'a planilha-base do Portal recebeu a linha e a coluna "Painel" ficou OK');
const chamada = chamadasRede.find((c) => /script\.google\.com/.test(c.url));
ok(/\?rota=lancamentos%2Fingest&segredo=segredo-do-painel$/.test(chamada.url), 'a chamada ao painel novo leva a rota e o segredo na URL');

// ── 3) repetido, segredo errado, teste de diagnóstico
const dup = ctx.registrarEnvio({ filial: 'Patrocínio Paulista', tipo: 'Nota Fiscal - Produto Acabado', numero: '4455', vencimento: venc, linkNf: 'https://drive.google.com/file/d/x/view' });
ok(dup.duplicado === true, 'o mesmo envio de novo pede confirmação (regra do Portal mantida)');
logs.length = 0; ctx.testarPainel();
ok(logs.some((l) => /Painel OK/.test(l)), 'testarPainel reconhece o painel novo: ' + logs.join(' | ').slice(0, 100));
portal.propriedades.PAINEL_SEGREDO_ENVIO = 'errado';
logs.length = 0; ctx.testarPainel();
ok(logs.some((l) => /Segredo recusado/.test(l)), 'testarPainel com segredo errado avisa claramente');
portal.propriedades.PAINEL_SEGREDO_ENVIO = 'segredo-do-painel';

// ── 4) painel antigo (Vercel) continua funcionando como sempre
portal.propriedades.PAINEL_URL = 'https://painel-fornecedores-six.vercel.app';
chamadasRede.length = 0; logs.length = 0; ctx.testarPainel();
const v = chamadasRede[0];
ok(v.url === 'https://painel-fornecedores-six.vercel.app/api/lancamentos/ingest' && v.op.headers['x-lanc-secret'] === 'segredo-do-painel', 'com a URL da Vercel, nada muda: caminho + cabeçalho');

process.exitCode = falhou ? 1 : 0;
