# Portal de Lançamentos Fiscais — instalação passo a passo

Fluxo: **Google Sites → app da Web (Apps Script) → PDFs no Drive + linha na planilha → painel**.
Quando o painel marca **Lançado**, a rotina de 5 minutos grava Status, Responsável, Data Lançto e Nível na mesma linha.
Nada de arquivo vai para o Supabase: no banco entra só uma linha por documento (e uma a mais se vier CT-e).

Faça tudo logado com a conta @premix que será **dona do script** (de preferência uma conta do setor, não pessoal:
se a conta for desativada, o portal para).

## Parte A — Google (você)

1. **Planilha-base:** crie uma planilha nova, "Lançamentos Fiscais — Base". Copie o ID (o trecho grande da URL entre `/d/` e `/edit`).
2. **Pasta do Drive:** crie uma pasta "Lançamentos Fiscais" **dentro da pasta que a ponte do painel já enxerga**
   (`PASTAS_PERMITIDAS` da ponte). Assim o painel consegue ler os PDFs sem mudar nada. Copie o ID da pasta.
3. **Script:** em script.google.com → **Novo projeto**, nome "Portal de Lançamentos".
   - Apague o conteúdo de `Código.gs` e cole o `Codigo.gs` desta pasta.
   - **+ → HTML**, nome exatamente `Portal`, e cole o `Portal.html`.
   - Configurações do projeto → marque **Mostrar arquivo de manifesto "appsscript.json"** e cole o `appsscript.json`.
4. **Propriedades do script** (Configurações do projeto → Propriedades do script):

   | Propriedade | Valor |
   |---|---|
   | `PLANILHA_ID` | ID da planilha-base |
   | `PASTA_RAIZ` | ID da pasta do Drive |
   | `PAINEL_URL` | `https://painel-fornecedores-six.vercel.app` |
   | `PAINEL_SEGREDO_ENVIO` | o mesmo valor de `LANC_INGEST_SECRET` na Vercel |
   | `PAINEL_SEGREDO_LEITURA` | um segredo **novo** (gere um aleatório longo); será o `LANC_LEITURA_SECRET` na Vercel |

5. No editor, rode **uma vez cada**, nesta ordem (aceite as permissões na primeira):
   `autorizar` → `configurar` (cria a aba `Lancamentos` com as 17 colunas e a aba `Autorizados`).
6. **Implantar → Nova implantação → App da Web**
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa da Premix** (domínio)
   - Copie a URL que termina em `/exec`.
7. **Google Sites:** edite a página → **Inserir → Incorporar → Por URL** → cole a URL `/exec` → ajuste a altura (sugestão: tela cheia da seção).
8. Teste com a sua conta: envie um documento de teste e confira o PDF na pasta e a linha na planilha.

## Parte B — Painel (repositório painel-fornecedores)

9. Copiar `painel/lancados-route.js` para `app/api/lancamentos/lancados/route.js`.
10. Na Vercel, criar a variável **`LANC_LEITURA_SECRET`** (igual ao `PAINEL_SEGREDO_LEITURA` do script) e fazer o deploy.
11. No editor do script, rode **`testarPainel`** → deve aparecer "Painel respondeu OK (leitura)".
12. Rode **`instalarGatilho`** (a rotina passa a rodar a cada 5 minutos).

## Como funciona o retorno

- A planilha guarda em colunas **ocultas** (R, S, T) o ID da linha, se o painel já recebeu (`OK`/`Pendente`) e o vencimento do CT-e.
- Painel fora do ar: o usuário **não** vê erro; a linha fica `Pendente` e a rotina reenvia sozinha.
- Marcou **Lançado** no painel: em até 5 minutos a linha ganha Status, Responsável (quem lançou) e Data Lançto.
  O Nível de prioridade vem calculado do painel. Se o documento voltar para "Lançar", Responsável e Data são limpos.
- Linhas ordenadas, filtradas ou apagadas na planilha não quebram nada: o script acha a linha pelo ID, não pela posição.

## Ajustes comuns (topo do `Codigo.gs`)

- `RESTRINGIR_A_AUTORIZADOS = true` → só envia quem estiver **ativo** na aba `Autorizados` (colunas E-mail | Nome | Ativo = Sim).
  Com `false`, qualquer conta @premix.com.br logada envia.
- `MAX_MB` / `MAX_TOTAL_MB` → limites de tamanho (10 MB por PDF, 20 MB no total).
- Atualizou o código? **Implantar → Gerenciar implantações → editar → Nova versão** (a URL continua a mesma).

## Segurança

- Nenhuma chave no navegador: o formulário só chama funções do script; os segredos ficam nas propriedades do script.
- Só contas `@premix.com.br` passam (o Google identifica quem acessa; o script confere de novo no servidor).
- Dois segredos separados: o de **envio** só grava no painel; o de **leitura** só consulta status e é diferente.
- Só quem for **editor do projeto** do script consegue ver os segredos: mantenha só você (ou o setor).
