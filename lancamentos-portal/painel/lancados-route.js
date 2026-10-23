/* RASCUNHO para o repositório painel-fornecedores.
   Copiar para: app/api/lancamentos/lancados/route.js

   Devolve ao Apps Script do portal o que mudou nos documentos enviados por ele (origem 'portal'),
   para gravar Status, Responsável, Data Lançto e Nível na planilha-base.
   Só leitura, só colunas mínimas, segredo PRÓPRIO (LANC_LEITURA_SECRET) — diferente do LANC_INGEST_SECRET,
   porque esta rota devolve dados e a do ingest só grava.

   GET ?desde=<timestamp ISO de atualizado_em>&limite=500
   -> { itens: [{ id, recebido_em, filial, tipo, status, lancado_em, lancado_por, nivel, documento_pai_id, atualizado_em }],
        proximo: <atualizado_em do último item> } */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getServiceClient } from '../../../../lib/authServer';
import { conexoesPausadas, respostaPausada } from '../../../../features/lancamentos/server';

export const dynamic = 'force-dynamic';

function segredoOk(req) {
  const esperado = process.env.LANC_LEITURA_SECRET || '';
  const recebido = req.headers.get('x-lanc-secret') || '';
  if (!esperado || esperado.length !== recebido.length) return false;
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}

export async function GET(req) {
  if (!segredoOk(req)) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  if (await conexoesPausadas()) return respostaPausada();

  const p = req.nextUrl.searchParams;
  const limite = Math.min(Math.max(Number(p.get('limite')) || 500, 1), 500);
  const desde = p.get('desde');
  if (desde && isNaN(new Date(desde))) return NextResponse.json({ error: 'Parâmetro "desde" inválido.' }, { status: 400 });

  let q = getServiceClient().from('lanc_fila')
    .select('id, recebido_em, filial, tipo, status, lancado_em, lancado_por, nivel, documento_pai_id, atualizado_em')
    .eq('origem', 'portal')
    .not('atualizado_em', 'is', null);
  if (desde) q = q.gt('atualizado_em', desde);
  const { data, error } = await q.order('atualizado_em', { ascending: true }).limit(limite);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const itens = data || [];
  return NextResponse.json({ itens, proximo: itens.length ? itens[itens.length - 1].atualizado_em : (desde || null) });
}
