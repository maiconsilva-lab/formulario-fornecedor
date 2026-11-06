/* Esquema das tabelas (gerado a partir do Supabase) e regras de tipo.
   O texto vem de esquema.txt, embutido no bundle pelo build. */
import TEXTO from '../esquema.txt';

export const PLANILHA_DA_TABELA = (tabela) => {
  if (['auditoria', 'logs_atividade', 'ctr_historico', 'lanc_historico'].includes(tabela)) return 'historico';
  if ([
    'fornecedores', 'produtos', 'desbloqueios', 'filiais', 'usuarios_painel', 'preferencias_usuario',
    'acessos_universais', 'tokens_correcao', 'filial_atividade', 'dashboard_meta', 'dashboard_commodities',
  ].includes(tabela)) return 'cadastros';
  return 'operacao';
};

function lerEsquema(texto) {
  const tabelas = {};
  for (const bruta of texto.split('\n')) {
    const linha = bruta.trim();
    if (!linha || linha.startsWith('#')) continue;
    const [nome, pk, unicos, colsTxt] = linha.split('|');
    const colunas = [];
    // "status:t=Não Iniciado aberto_em:ts=@now" — o padrão pode ter espaço; vai até a próxima "nome:tipo".
    const re = /([a-z0-9_]+):([a-z]+)(?:=(.*?))?(?=\s+[a-z0-9_]+:[a-z]+(?:=|\s|$)|$)/g;
    let m;
    while ((m = re.exec(colsTxt))) colunas.push({ nome: m[1], tipo: m[2], padrao: m[3] === undefined ? undefined : m[3] });
    tabelas[nome] = {
      nome,
      pk: pk ? pk.split(',') : [],
      unicos: unicos ? unicos.split(';').map((u) => u.split(',')) : [],
      colunas,
      tipos: Object.fromEntries(colunas.map((c) => [c.nome, c.tipo])),
    };
  }
  return tabelas;
}

export const ESQUEMA = lerEsquema(TEXTO);

export function tabelaDef(nome) {
  const t = ESQUEMA[nome];
  if (!t) throw Object.assign(new Error(`relation "public.${nome}" does not exist`), { code: '42P01' });
  return t;
}

/* ── Datas: o Brasil não tem horário de verão desde 2019, então São Paulo = UTC-3 fixo. ── */
const SP_MS = 3 * 3600 * 1000;
export const agoraIso = () => isoTs(new Date());
export function isoTs(v) {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toISOString().replace('Z', '+00:00');
}
export function dataSP(v) {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() - SP_MS).toISOString().slice(0, 10);
}
export const hojeSP = () => dataSP(new Date());
export function isoData(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return dataSP(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : dataSP(d);
}
/** Diferença em dias entre duas datas YYYY-MM-DD (a - b), como no Postgres. */
export function difDias(a, b) {
  if (!a || !b) return null;
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}

/** Converte um valor vindo do código (ou da planilha) para o tipo da coluna, como o Postgres faria. */
export function normalizar(tipo, v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  switch (tipo) {
    case 'i': case 'n': {
      if (v === '') return null;
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (isNaN(n)) throw Object.assign(new Error(`invalid input syntax for type numeric: "${v}"`), { code: '22P02' });
      return tipo === 'i' ? Math.trunc(n) : n;
    }
    case 'b':
      if (v === '') return null;
      if (typeof v === 'boolean') return v;
      return ['true', 't', '1', 'yes', 'sim'].includes(String(v).toLowerCase());
    case 'j':
      if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
      return v;
    case 'ta':
      if (Array.isArray(v)) return v.map((x) => (x === null ? null : String(x)));
      if (typeof v === 'string') {
        if (v.startsWith('[')) { try { return JSON.parse(v); } catch { /* segue */ } }
        if (v.startsWith('{')) return v.slice(1, -1).split(',').filter(Boolean).map((x) => x.replace(/^"|"$/g, ''));
      }
      return [String(v)];
    case 'ts': return isoTs(v);
    case 'd': return isoData(v);
    default: return v === '' ? '' : String(v);
  }
}

function hex(nBytes) {
  let s = '';
  for (let i = 0; i < nBytes; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return s;
}
export function uuid() {
  if (typeof Utilities !== 'undefined') return Utilities.getUuid();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Valor padrão de uma coluna (DEFAULT do Postgres). `proximoId` resolve as sequências. */
export function valorPadrao(col, proximoId) {
  const p = col.padrao;
  if (p === undefined) return null;
  switch (p) {
    case '@uuid': return uuid();
    case '@now': return agoraIso();
    case '@seq': return proximoId();
    case '@now+10m': return isoTs(new Date(Date.now() + 10 * 60000));
    case '@now+30d': return isoTs(new Date(Date.now() + 30 * 86400000));
    case '@hex16': return hex(16);
    case '@hex24': return hex(24);
    case '@mes': return hojeSP().slice(0, 7);
    case '@hoje': return hojeSP();
    default: return normalizar(col.tipo, p);
  }
}
