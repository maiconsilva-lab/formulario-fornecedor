/* Funções do Postgres (supabase.rpc) reescritas em JavaScript.
   Cada uma reproduz a definição SQL original do projeto. */
import { carregar, anexar, regravar, remover, comTrava } from './armazem.js';
import { VISOES } from './visoes.js';
import { agoraIso, hojeSP, dataSP, difDias, isoTs, isoData } from './esquema.js';
import { montarNova } from './consulta.js';

const r1 = (x) => (x === null || x === undefined || isNaN(x) ? null : Math.round(x * 10) / 10);
const media = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const soma = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const maximo = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined); return v.length ? Math.max(...v) : null; };
const pct = (parte, total) => (total ? r1((100 * parte) / total) : null);
const entre = (d, a, b) => d !== null && d !== undefined && d >= a && d <= b;
const ABERTOS = ['Lançar', 'Pendente'];

function somaDias(ymd, n) { return new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
function serieDias(ini, fim) { const out = []; for (let d = ini; d <= fim; d = somaDias(d, 1)) out.push(d); return out; }

function inserir(tabela, dados) { const n = montarNova(tabela, dados); anexar(tabela, [n]); return n; }

/* lanc_pessoa(p): apelido → nome; vazio → '—' */
function lancPessoa(p) {
  const chave = String(p ?? '').trim().toLowerCase();
  const a = carregar('lanc_pessoas_alias').linhas.find((x) => x.apelido === chave);
  if (a) return a.nome;
  const t = String(p ?? '').trim();
  return t || '—';
}

function filaComDatas() {
  return VISOES.lanc_fila().map((v) => ({ ...v, rec_d: dataSP(v.recebido_em), lan_d: dataSP(v.lancado_em) }));
}

function relatorioPeriodo({ p_ini, p_fim }) {
  const ini = isoData(p_ini); const fim = isoData(p_fim);
  const dias = difDias(fim, ini) + 1;
  const iniAnt = somaDias(ini, -dias); const fimAnt = somaDias(ini, -1);
  const hoje = hojeSP();
  const f = filaComDatas();
  const ab = f.filter((x) => ABERTOS.includes(x.status));
  const rec = f.filter((x) => entre(x.rec_d, ini, fim));
  const lan = f.filter((x) => x.status === 'Lançado' && entre(x.lan_d, ini, fim));
  const prazo = (xs) => r1(media(xs.map((x) => difDias(x.lan_d, x.rec_d))));
  const MP = 'Nota Fiscal - Matéria prima';
  const niveis = [['MP', 1], ['Urgente', 2], ['Crítico', 3], ['Normal', 4], ['Paraguai', 5]];

  const porPessoa = {};
  for (const x of lan) { const p = lancPessoa(x.lancado_por); (porPessoa[p] = porPessoa[p] || []).push(x); }
  const tipos = [...new Set(f.map((x) => x.tipo))];
  const filiais = {};
  for (const x of f) (filiais[x.filial] = filiais[x.filial] || []).push(x);
  const motivos = {};
  for (const x of ab.filter((y) => y.status === 'Pendente')) { const m = x.motivo_pendencia ?? 'Sem motivo informado'; (motivos[m] = motivos[m] || []).push(x); }

  const fretes = VISOES.lanc_fretes_v();
  const ajustes = VISOES.lanc_ajustes_v();
  const blocoSla = (xs) => {
    const fin = xs.filter((x) => x.status === 'Finalizado');
    return {
      abertos_agora: xs.filter((x) => x.status !== 'Finalizado').length,
      abertos_periodo: xs.filter((x) => entre(dataSP(x.aberto_em), ini, fim)).length,
      finalizados_periodo: fin.filter((x) => entre(dataSP(x.concluido_em), ini, fim)).length,
      pct_sla: pct(fin.filter((x) => x.sla_nivel === 'Dentro do SLA').length, fin.length),
      fora_sla_abertos: xs.filter((x) => x.status !== 'Finalizado' && x.sla_nivel !== 'Dentro do SLA').length,
      tempo_medio_dias: r1(media(fin.map((x) => x.prazo_dias))),
    };
  };
  const transf = carregar('lanc_transferencias').linhas;
  const transfPer = transf.filter((x) => entre(x.data, ini, fim));
  const porResp = {};
  for (const x of transfPer) { const p = lancPessoa(x.responsavel); porResp[p] = (porResp[p] || 0) + 1; }

  return {
    ini, fim, dias,
    periodo: {
      recebidos: rec.length,
      lancados: lan.length,
      recebidos_e_lancados: rec.filter((x) => x.status === 'Lançado' && entre(x.lan_d, ini, fim)).length,
      recebidos_em_aberto: rec.filter((x) => ABERTOS.includes(x.status)).length,
      cancelados: rec.filter((x) => x.status === 'Cancelado').length,
      prazo_medio_dias: prazo(lan),
      mesmo_dia_pct: pct(lan.filter((x) => x.lan_d === x.rec_d).length, lan.length),
      ate_1_dia_pct: pct(lan.filter((x) => difDias(x.lan_d, x.rec_d) <= 1).length, lan.length),
      ctes_recebidos: rec.filter((x) => String(x.tipo || '').startsWith('Frete')).length,
    },
    anterior: {
      recebidos: f.filter((x) => entre(x.rec_d, iniAnt, fimAnt)).length,
      lancados: f.filter((x) => x.status === 'Lançado' && entre(x.lan_d, iniAnt, fimAnt)).length,
      prazo_medio_dias: prazo(f.filter((x) => x.status === 'Lançado' && entre(x.lan_d, iniAnt, fimAnt))),
    },
    hoje: {
      recebidos: f.filter((x) => x.rec_d === hoje).length,
      processados: f.filter((x) => x.rec_d === hoje && ['Lançado', 'Cancelado'].includes(x.status)).length,
      em_aberto: f.filter((x) => x.rec_d === hoje && ABERTOS.includes(x.status)).length,
      pendentes: f.filter((x) => x.rec_d === hoje && x.status === 'Pendente').length,
      lancados_hoje: f.filter((x) => x.status === 'Lançado' && x.lan_d === hoje).length,
      mp_recebidas: f.filter((x) => x.rec_d === hoje && x.nivel === 'MP').length,
      mp_lancadas: f.filter((x) => x.rec_d === hoje && x.nivel === 'MP' && x.status === 'Lançado').length,
    },
    mp: {
      recebidas: rec.filter((x) => x.tipo === MP).length,
      lancadas: lan.filter((x) => x.tipo === MP).length,
      a_lancar: ab.filter((x) => x.tipo === MP && x.status === 'Lançar').length,
      pendentes: ab.filter((x) => x.tipo === MP && x.status === 'Pendente').length,
      prazo_medio_dias: prazo(lan.filter((x) => x.tipo === MP)),
    },
    agora: {
      a_lancar: ab.filter((x) => x.status === 'Lançar').length,
      pendentes: ab.filter((x) => x.status === 'Pendente').length,
      mp: ab.filter((x) => x.nivel === 'MP' && x.status === 'Lançar').length,
      vencidas: ab.filter((x) => x.dias_vencimento !== null && x.dias_vencimento < 0).length,
      vencem_7d: ab.filter((x) => x.dias_vencimento !== null && x.dias_vencimento >= 0 && x.dias_vencimento <= 6).length,
      sla_3_ou_mais: ab.filter((x) => x.dias_na_fila !== null && x.dias_na_fila >= 3).length,
      sla_menos_3: ab.filter((x) => x.dias_na_fila !== null && x.dias_na_fila < 3).length,
      parados_7d: ab.filter((x) => x.dias_na_fila !== null && x.dias_na_fila > 7).length,
      mais_antigo_dias: maximo(ab.map((x) => x.dias_na_fila)),
      alerta_valor: ab.filter((x) => x.alerta_valor).length,
      sem_numero: ab.filter((x) => !x.num_doc).length,
    },
    fila_nivel: niveis.map(([nivel, ordem]) => ({
      nivel, ordem,
      lancar: ab.filter((x) => x.nivel === nivel && x.status === 'Lançar').length,
      pendente: ab.filter((x) => x.nivel === nivel && x.status === 'Pendente').length,
      sla_3_ou_mais: ab.filter((x) => x.nivel === nivel && x.dias_na_fila >= 3).length,
    })),
    por_pessoa: Object.entries(porPessoa)
      .map(([pessoa, xs]) => ({ pessoa, qtd: xs.length, prazo_medio: prazo(xs) }))
      .sort((a, b) => b.qtd - a.qtd),
    por_tipo: tipos.map((tipo) => ({
      tipo,
      recebidos: rec.filter((x) => x.tipo === tipo).length,
      lancados: lan.filter((x) => x.tipo === tipo).length,
      abertos: ab.filter((x) => x.tipo === tipo).length,
      sla_3_ou_mais: ab.filter((x) => x.tipo === tipo && x.dias_na_fila >= 3).length,
    })).filter((x) => x.recebidos > 0 || x.lancados > 0 || x.abertos > 0)
      .sort((a, b) => b.recebidos - a.recebidos || b.abertos - a.abertos),
    por_filial: Object.entries(filiais).map(([filial, xs]) => ({
      filial: filial === 'null' ? null : filial,
      recebidos: xs.filter((x) => entre(x.rec_d, ini, fim)).length,
      lancados: xs.filter((x) => x.status === 'Lançado' && entre(x.lan_d, ini, fim)).length,
      abertos: xs.filter((x) => ABERTOS.includes(x.status)).length,
      urgentes: xs.filter((x) => ABERTOS.includes(x.status) && x.dias_vencimento !== null && x.dias_vencimento < 7).length,
    })).filter((x) => x.recebidos > 0 || x.abertos > 0).sort((a, b) => b.abertos - a.abertos || b.recebidos - a.recebidos),
    por_dia: serieDias(ini, fim).map((dia) => ({
      dia,
      recebidos: f.filter((x) => x.rec_d === dia).length,
      lancados: f.filter((x) => x.status === 'Lançado' && x.lan_d === dia).length,
    })),
    pendencias: Object.entries(motivos).map(([motivo, xs]) => ({
      motivo, qtd: xs.length, mais_antigo: maximo(xs.map((x) => x.dias_na_fila)), idade_media: r1(media(xs.map((x) => x.dias_na_fila))),
    })).sort((a, b) => b.qtd - a.qtd),
    fretes: { ...blocoSla(fretes), diferenca_periodo: soma(fretes.filter((x) => entre(dataSP(x.aberto_em), ini, fim)).map((x) => x.diferenca)) },
    ajustes: blocoSla(ajustes),
    transferencias: {
      periodo: transfPer.length,
      abertas: transf.filter((x) => x.status !== 'Finalizado').length,
      por_responsavel: porResp,
    },
  };
}

function relatorioExtra({ p_ini, p_fim }) {
  const ini = isoData(p_ini); const fim = isoData(p_fim);
  const ab = VISOES.lanc_fila().filter((x) => ABERTOS.includes(x.status));
  const rec = carregar('lanc_documentos').linhas.filter((d) => entre(dataSP(d.recebido_em), ini, fim));
  const hist = carregar('lanc_historico').linhas;
  const pendenciados = new Set(hist.filter((h) => h.acao === 'pendenciar').map((h) => h.documento_id));
  const idade = [[1, '0–1 dia', 0, 1], [2, '2–3 dias', 2, 3], [3, '4–7 dias', 4, 7], [4, '8–15 dias', 8, 15], [5, 'Mais de 15', 16, 100000]];
  const venc = [[1, 'Vencidas', -100000, -1], [2, 'Vencem em até 7 dias', 0, 7], [3, '8 a 15 dias', 8, 15], [4, 'Mais de 15 dias', 16, 100000]];
  return {
    idade_fila: idade.map(([ordem, faixa, de, ate]) => ({
      ordem, faixa,
      lancar: ab.filter((x) => entre(x.dias_na_fila, de, ate) && x.status === 'Lançar').length,
      pendente: ab.filter((x) => entre(x.dias_na_fila, de, ate) && x.status === 'Pendente').length,
    })),
    vencimento_fila: [
      ...venc.map(([ordem, faixa, de, ate]) => ({ ordem, faixa, qtd: ab.filter((x) => entre(x.dias_vencimento, de, ate)).length })),
      { ordem: 5, faixa: 'Sem vencimento', qtd: ab.filter((x) => x.dias_vencimento === null).length },
    ],
    excecao: {
      recebidos: rec.length,
      viraram_pendencia: rec.filter((d) => d.status === 'Pendente' || pendenciados.has(d.id)).length,
    },
    leitura: {
      abertos: ab.length,
      abertos_lidos: ab.filter((x) => x.lido_em).length,
      recebidos: rec.length,
      recebidos_lidos: rec.filter((d) => d.lido_em).length,
    },
  };
}

function motivoSugerido(texto) {
  const t = String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/auditori/.test(t)) return 'Auditoria de Fretes';
  if (/tabela/.test(t) && /frete/.test(t)) return 'Tabela de Fretes';
  if (/toleranc/.test(t)) return 'Tolerância';
  if (/contrato/.test(t)) return 'Contrato em Aprovação';
  if (/(^|[^a-z])(po|pedido)([^a-z]|$)/.test(t)) return 'PO em Aprovação';
  if (/(^|[^a-z])(sc|solicitacao)([^a-z]|$)/.test(t)) return 'SC em Aprovação';
  return null;
}

function classificarPendencias() {
  const docs = carregar('lanc_documentos').linhas;
  const alterados = []; const historico = [];
  for (const d of docs) {
    if (d.status !== 'Pendente' || d.motivo_pendencia) continue;
    const m = motivoSugerido(d.registros) ?? motivoSugerido(d.observacoes);
    if (!m) continue;
    d.motivo_pendencia = m; d.atualizado_em = agoraIso(); alterados.push(d);
    historico.push({ documento_id: d.id, acao: 'motivo', detalhe: 'Motivo identificado automaticamente pelo texto: ' + m, usuario: 'sistema' });
  }
  // Segunda instrução do SQL: enxerga o resultado da primeira; dentro dela, lê os pais como estavam antes.
  const porId = new Map(docs.map((d) => [d.id, d]));
  const herdados = [];
  for (const f of docs) {
    if (f.status !== 'Pendente' || f.motivo_pendencia) continue;
    const p = porId.get(f.documento_pai_id);
    if (p && p.status === 'Pendente' && p.motivo_pendencia) herdados.push([f, p.motivo_pendencia]);
  }
  for (const [f, m] of herdados) {
    f.motivo_pendencia = m; f.atualizado_em = agoraIso();
    if (!alterados.includes(f)) alterados.push(f);
    historico.push({ documento_id: f.id, acao: 'motivo', detalhe: 'Motivo herdado da NF vinculada: ' + m, usuario: 'sistema' });
  }
  regravar('lanc_documentos', alterados);
  anexar('lanc_historico', historico.map((h) => montarNova('lanc_historico', h)));
  return historico.length;
}

function syncAplicar({ p_updates }) {
  const lista = typeof p_updates === 'string' ? JSON.parse(p_updates) : (p_updates || []);
  const porId = new Map(carregar('lanc_documentos').linhas.map((d) => [d.id, d]));
  const alterados = [];
  for (const u of lista) {
    const d = porId.get(Number(u.id));
    if (!d) continue;
    d.status = u.status ?? null;
    d.lancado_em = isoTs(u.lancado_em ?? null);
    d.lancado_por = u.lancado_por ?? null;
    d.registros = u.registros ?? d.registros;
    d.vencimento = isoData(u.vencimento ?? null);
    d.observacoes = u.observacoes ?? d.observacoes;
    d.motivo_pendencia = u.status === 'Pendente' ? d.motivo_pendencia : null;
    d.atualizado_em = agoraIso();
    d.atualizado_por = 'sincronização planilha';
    alterados.push(d);
  }
  regravar('lanc_documentos', alterados);
  return alterados.length;
}

function syncTravar({ p_dono, p_segundos = 120 }) {
  const cfg = carregar('lanc_config').linhas;
  let r = cfg.find((x) => x.chave === 'sync_trava');
  if (!r) r = inserir('lanc_config', { chave: 'sync_trava', valor: '', descricao: 'Trava da sincronização com a planilha (uso interno)' });
  let livre = !r.valor;
  if (!livre) { try { livre = Date.parse(JSON.parse(r.valor).ate) < Date.now(); } catch { livre = true; } }
  if (!livre) return false;
  r.valor = JSON.stringify({ dono: p_dono, ate: isoTs(new Date(Date.now() + p_segundos * 1000)) });
  regravar('lanc_config', [r]);
  return true;
}

function syncLiberar() {
  const r = carregar('lanc_config').linhas.find((x) => x.chave === 'sync_trava');
  if (r) { r.valor = ''; regravar('lanc_config', [r]); }
  return null;
}

function rateLimitCheck({ p_chave, p_max, p_janela_segundos }) {
  const linhas = carregar('rate_limits').linhas;
  let r = linhas.find((x) => x.chave === p_chave);
  const limite = Date.now() - p_janela_segundos * 1000;
  if (!r) { r = inserir('rate_limits', { chave: p_chave, contador: 1, inicio: agoraIso() }); return r.contador <= p_max; }
  if (Date.parse(r.inicio) < limite) { r.contador = 1; r.inicio = agoraIso(); } else r.contador += 1;
  regravar('rate_limits', [r]);
  return r.contador <= p_max;
}

function registrarAcessoFilial({ p_filial }) {
  const hojeUtc = new Date().toISOString().slice(0, 10); // current_date do Supabase (UTC)
  const linhas = carregar('filial_atividade').linhas;
  const r = linhas.find((x) => x.filial === p_filial);
  if (!r) { inserir('filial_atividade', { filial: p_filial, ultimo_acesso: agoraIso(), acessos_hoje: 1, dia_contagem: hojeUtc, total_acessos: 1 }); return null; }
  r.ultimo_acesso = agoraIso();
  r.acessos_hoje = r.dia_contagem === hojeUtc ? (r.acessos_hoje || 0) + 1 : 1;
  r.dia_contagem = hojeUtc;
  r.total_acessos = (r.total_acessos || 0) + 1;
  regravar('filial_atividade', [r]);
  return null;
}

function syncLockClaim({ p_job, p_ttl_seconds }) {
  const linhas = carregar('sync_lock').linhas;
  const r = linhas.find((x) => x.job === p_job);
  const expira = isoTs(new Date(Date.now() + p_ttl_seconds * 1000));
  if (!r) { inserir('sync_lock', { job: p_job, locked_at: agoraIso(), expires_at: expira }); return true; }
  if (Date.parse(r.expires_at) < Date.now()) { r.locked_at = agoraIso(); r.expires_at = expira; regravar('sync_lock', [r]); return true; }
  return false;
}

function syncLockRelease({ p_job }) {
  remover('sync_lock', carregar('sync_lock').linhas.filter((x) => x.job === p_job));
  return null;
}

const SO_LEITURA = { lanc_relatorio_periodo: relatorioPeriodo, lanc_relatorio_extra: relatorioExtra };
const COM_ESCRITA = {
  lanc_classificar_pendencias: classificarPendencias,
  lanc_sync_aplicar: syncAplicar,
  lanc_sync_travar: syncTravar,
  lanc_sync_liberar: syncLiberar,
  rate_limit_check: rateLimitCheck,
  registrar_acesso_filial: registrarAcessoFilial,
  sync_lock_claim: syncLockClaim,
  sync_lock_release: syncLockRelease,
};

export function executarRpc(nome, args) {
  if (SO_LEITURA[nome]) return SO_LEITURA[nome](args || {});
  if (COM_ESCRITA[nome]) return comTrava(() => COM_ESCRITA[nome](args || {}));
  throw Object.assign(new Error(`Could not find the function public.${nome}`), { code: 'PGRST202' });
}

export const _interno = { motivoSugerido, lancPessoa };
