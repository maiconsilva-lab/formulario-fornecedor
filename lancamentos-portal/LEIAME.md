# Portal de Lançamentos Fiscais — instalação passo a passo

Fluxo: **Google Sites → app da Web (Apps Script) → PDFs no Drive + linha na planilha → painel**.
Quando alguém lança no painel, o **próprio painel** grava na mesma linha da planilha, na hora: Status, Responsável
(quem lançou), Data Lançto, Nível e Observações internas.
Nada de arquivo vai para o Supabase: no banco entra só uma linha por documento (e uma a mais se vier CT-e).

Faça tudo logado com a conta @premix que será **dona do script** (de preferência uma conta do setor, não pessoal:
se a conta for desativada, o portal para).

## Quem usa qual credencial
| Quem | Credencial | O que faz |
|---|---|---|
| Script do portal | a **sua** ("Executar como: eu") | Salva os PDFs no Drive compartilhado e grava a linha na planilha |
| Painel (Vercel) | **conta de serviço** | Grava Lançado, responsável e data na planilha, na hora do clique |

A planilha fica no **Meu Drive** (não no Drive compartilhado) e é compartilhada como **Editor** com a conta de serviço
`sheets-reader@painel-fornecedores.iam.gserviceaccount.com`. Os PDFs ficam no Drive compartilhado.

## Parte A — Google (você)

1. **Planilha-base** no Meu Drive, compartilhada como Editor com a conta de serviço. Copie o ID (entre `/d/` e `/edit`).
2. **Pasta do Drive compartilhado** "Lançamentos Fiscais", **dentro** da pasta que a ponte do painel já enxerga
   ("RECEPÇÃO DE DOCUMENTOS PARA LANÇAMENTOS"). Assim o painel lê os PDFs sem mudar a ponte. Copie o ID da pasta.
3. **Script:** script.google.com → **Novo projeto** ("Portal de Lançamentos").
   - Em `Código.gs`, cole o `Codigo.gs` desta pasta.
   - **+ → HTML**, nome exatamente `Portal`, e cole o `Portal.html`.
   - Configurações do projeto → marque **Mostrar arquivo de manifesto "appsscript.json"** e cole o `appsscript.json`.
4. **Propriedades do script** (Configurações do projeto → Propriedades do script):

   | Propriedade | Valor |
   |---|---|
   | `PLANILHA_ID` | ID da planilha-base |
   | `PASTA_RAIZ` | ID da pasta do Drive |
   | `PAINEL_URL` | `https://painel-fornecedores-six.vercel.app` (sem barra no final) |
   | `PAINEL_SEGREDO_ENVIO` | o mesmo valor de `LANC_INGEST_SECRET` na Vercel |

5. No editor, rode **uma vez cada**, nesta ordem (aceite as permissões na primeira): `autorizar` → `configurar`
   (cria a aba `Lancamentos` com as 17 colunas e a aba `Autorizados`).
6. **Implantar → Nova implantação → App da Web** — Executar como: **Eu**; Quem tem acesso: **Qualquer pessoa da Premix**.
   Copie a URL `/exec`. Para atualizar depois: **Gerenciar implantações → lápis → Nova versão** (a URL não muda).
7. **Google Sites:** Inserir → **Incorporar → Por URL** → cole a URL `/exec` → ajuste a altura → **Publicar**.
8. Rode **`testarPainel`**: deve registrar "Painel OK". (401 = segredo diferente ou falta redeploy; 503 = conexões pausadas.)
9. Rode **`instalarGatilho`**: a cada 5 minutos o script reenvia ao painel qualquer linha que ficou `Pendente`.

## Parte B — Painel (repositório painel-fornecedores, branch `claude/lancamentos-tempo-real`)

10. Na Vercel, crie a variável **`LANC_BASE_SHEET_ID`** com o ID da planilha-base.
11. Faça o merge da branch e o deploy (variáveis só valem depois de um novo deploy).
12. No SQL Editor do Supabase, rode `docs/lancamentos/sql/2026-10-23_sync_planilha_antiga_desligada.sql`
    (desliga só a sincronização da `Demandas_Sync`; o portal novo e a leitura de PDFs continuam).
13. Se ainda não rodou, `docs/lancamentos/sql/2026-10-23_zerar_dados.sql` (a cópia de segurança fica em `arquivo_lancamentos`).
14. Teste de ponta a ponta: envie um documento pelo formulário → ele aparece na fila do painel em até ~8 segundos →
    lance no painel → a linha da planilha ganha Status, Responsável e Data Lançto na hora.

## Como funciona

- A planilha guarda em colunas **ocultas** (R, S, T) o ID da linha, se o painel já recebeu (`OK`/`Pendente`) e o
  vencimento do CT-e. O painel acha a linha pelo ID, não pela posição: ordenar, filtrar ou apagar linhas não quebra nada.
- **Envio:** o formulário só confirma "recebido" quando o painel respondeu. Painel fora do ar: o usuário não vê erro;
  a linha fica `Pendente` e o gatilho de 5 min reenvia.
- **Tela de quem lança:** confere "mudou algo?" a cada 8 segundos (só com a aba aberta) e recarrega a fila se mudou.
- **Lançado → planilha:** o painel grava depois de responder ao usuário; se o Google falhar, tenta 3 vezes e registra no log.
  Documento que volta para "Lançar" tem Responsável e Data Lançto limpos.
- Não edite à mão as colunas de status, responsável e data: a próxima ação no painel sobrescreve.
  Para observações do time, use "Observações Internas" pelo painel.

## Ajustes comuns (topo do `Codigo.gs`)

- `RESTRINGIR_A_AUTORIZADOS = true` → só envia quem estiver **ativo** na aba `Autorizados` (E-mail | Nome | Ativo = Sim).
  Com `false`, qualquer conta @premix.com.br logada envia.
- `MAX_MB` / `MAX_TOTAL_MB` → limites de tamanho (10 MB por PDF, 20 MB no total).
- Filiais: lista `FILIAIS_NUM` (número, nome), do maior número para o menor.

## Segurança

- Nenhuma chave no navegador: o formulário só chama funções do script; o segredo fica nas propriedades do script.
- Só contas `@premix.com.br` passam (o Google identifica quem acessa; o script confere de novo no servidor).
- O painel só grava na planilha documentos de origem `portal` e só nas colunas que ele é dono.
- Só quem for **editor do projeto** do script consegue ver o segredo: mantenha só você (ou o setor).
