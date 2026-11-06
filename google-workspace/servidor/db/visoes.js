/* Visões (views) do Postgres recalculadas em JavaScript a cada leitura.
   Fonte: lanc_fila, lanc_fretes_v e lanc_ajustes_v do Supabase. */
import { carregar } from './armazem.js';
import { tabelaDef, hojeSP, dataSP, difDias } from './esquema.js';

function config(chave, padrao) {
  const r = carregar('lanc_config').linhas.find((x) => x.chave === chave);
  const n = r ? parseInt(r.valor, 10) : NaN;
  return isNaN(n) ? padrao : n;
}

function lancFila() {
  const urg = config('urgente_dias', 7);
  const crit = config('critico_dias', 15);
  const hoje = hojeSP();
  return carregar('lanc_documentos').linhas.map((d) => {
    const diasVenc = d.vencimento ? difDias(d.vencimento, hoje) : null;
    let nivel; let ordem;
    if (d.filial === 'Paraguay') { nivel = 'Paraguai'; ordem = 5; }
    else if (d.tipo === 'Nota Fiscal - Matéria prima') { nivel = 'MP'; ordem = 1; }
    else if (!d.vencimento) { nivel = 'Normal'; ordem = 4; }
    else if (diasVenc < urg) { nivel = 'Urgente'; ordem = 2; }
    else if (diasVenc < crit) { nivel = 'Crítico'; ordem = 3; }
    else { nivel = 'Normal'; ordem = 4; }
    const liq = d.valor_liquido; const bruto = d.valor_bruto; const bol = d.valor_boleto;
    const base = liq ?? bruto;
    const alerta = base !== null && base !== undefined && (
      (liq !== null && liq !== undefined && bruto !== null && bruto !== undefined && bruto - liq > 0.01) ||
      (bol !== null && bol !== undefined && Math.abs(base - bol) > 0.01));
    const { leitura_tentativas, ...resto } = d;
    return {
      ...resto,
      __base: d,
      dias_vencimento: diasVenc,
      dias_na_fila: d.recebido_em ? difDias(hoje, dataSP(d.recebido_em)) : null,
      nivel,
      nivel_ordem: ordem,
      alerta_valor: !!alerta,
    };
  });
}
lancFila.tipos = {
  ...tabelaDef('lanc_documentos').tipos,
  dias_vencimento: 'i', dias_na_fila: 'i', nivel: 't', nivel_ordem: 'i', alerta_valor: 'b',
};

function slaNivel(prazo, sla, risco) {
  if (prazo <= sla) return 'Dentro do SLA';
  if (prazo <= risco) return 'Risco';
  return 'Atenção';
}
function prazoDias(abertoEm, concluidoEm) {
  const hoje = hojeSP();
  return difDias(concluidoEm ? dataSP(concluidoEm) : hoje, dataSP(abertoEm));
}

function lancFretesV() {
  const sla = config('frete_sla_dias', 1);
  const risco = config('frete_risco_dias', 2);
  return carregar('lanc_fretes').linhas.map((f) => {
    const prazo = prazoDias(f.aberto_em, f.concluido_em);
    const temAmbos = f.vlr_tabela !== null && f.vlr_tabela !== undefined && f.vlr_cte !== null && f.vlr_cte !== undefined;
    return {
      ...f,
      diferenca: temAmbos ? f.vlr_cte - f.vlr_tabela : null,
      diferenca_pct: (!f.vlr_tabela || f.vlr_cte === null || f.vlr_cte === undefined)
        ? null : Math.round(((f.vlr_cte - f.vlr_tabela) / f.vlr_tabela) * 10000) / 100,
      prazo_dias: prazo,
      sla_nivel: slaNivel(prazo, sla, risco),
    };
  });
}
lancFretesV.tipos = { ...tabelaDef('lanc_fretes').tipos, diferenca: 'n', diferenca_pct: 'n', prazo_dias: 'i', sla_nivel: 't' };

function lancAjustesV() {
  const sla = config('ajuste_sla_dias', 3);
  const risco = config('ajuste_risco_dias', 5);
  return carregar('lanc_ajustes').linhas.map((a) => {
    const prazo = prazoDias(a.aberto_em, a.concluido_em);
    const condPed = difDias(a.dt_venc_pedido, a.dt_emissao);
    const condNf = difDias(a.dt_venc_nf, a.dt_emissao);
    return {
      ...a,
      cond_pedido_dias: condPed,
      cond_nf_dias: condNf,
      variacao_dias: condPed === null || condNf === null ? null : condPed - condNf,
      prazo_dias: prazo,
      sla_nivel: slaNivel(prazo, sla, risco),
    };
  });
}
lancAjustesV.tipos = {
  ...tabelaDef('lanc_ajustes').tipos,
  cond_pedido_dias: 'i', cond_nf_dias: 'i', variacao_dias: 'i', prazo_dias: 'i', sla_nivel: 't',
};

export const VISOES = { lanc_fila: lancFila, lanc_fretes_v: lancFretesV, lanc_ajustes_v: lancAjustesV };
