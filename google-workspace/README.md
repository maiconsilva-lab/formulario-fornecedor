# Lançamentos Fiscais no Google Workspace (Apps Script + Planilhas + Drive)

O módulo **Lançamentos** do painel (fila, pendências, consulta, report, NF Transferência, Tabela de Fretes, Cond. Pagto e a "Visão das filiais") rodando num único projeto do Google Apps Script, com os dados em 3 planilhas. Os PDFs continuam onde já estão, no Drive da Premix. **Supabase e Vercel não são alterados**: o que existe aqui é uma cópia que pode rodar em paralelo até você decidir a troca.

Os demais módulos (Cadastros, Pendências Fiscais, Contratos, Trilha e os formulários públicos) ficam para depois. O pacote completo continua disponível: `node build.mjs --perfil completo`.

## Como funciona

O código das telas e das rotas de API é o do repositório `painel-fornecedores`, sem alterações. O `build/` o empacota para o Apps Script, cortando o que Lançamentos não usa (28 das 81 rotas, 635 KB de tela em vez de 3,6 MB).

| Hoje | No Google |
|---|---|
| 18 tabelas do módulo no Supabase | 3 planilhas: **Cadastros**, **Operação**, **Histórico** (uma aba por tabela, mesmas colunas) |
| `supabase.from(...)` e funções SQL | O mesmo código, rodando sobre as planilhas (filtros, views, relatórios e travas reescritos em JS) |
| Rotas `/api/*` na Vercel | `google.script.run`, mesma resposta e mesma sessão |
| Portal de Lançamentos → Vercel | Portal → URL pública do app (mesmo corpo, segredo na URL) |
| `pg_cron` a cada 10 min | Gatilho de tempo do Apps Script, a cada 10 min |
| Conta de serviço lendo Planilhas/Drive | A conta dona do script (a mesma que hoje roda a "ponte do Drive") |

Quem usa: contas `@premix.com.br` (checado no servidor). Quem não é da Premix só vê uma mensagem de acesso restrito. A tela "Visão das filiais" mantém o código de 6 dígitos de cada filial.

```
google-workspace/
  servidor/   camada de dados em planilhas + substitutos de Next/Node/googleapis
  cliente/    roteador interno, ponte com o servidor, imagens
  estatico/   appsscript.json (permissões) e Setup.js (instalação/migração)
  build/      empacotador, perfis e testes
  gas/        SAÍDA do perfil "lancamentos": é isto que vai para o Apps Script (já gerada; Servidor-NN e Painel-NN são texto em linhas curtas, próprio para colar)
```

## Instalação

### 1. Enviar os arquivos

**Opção A, colando no editor (não precisa instalar nada).** Em <https://script.google.com> (conta `@premix.com.br`) → **Novo projeto**. Para cada arquivo `.js` de `gas/`: clique em **+ → Script**, dê o mesmo nome (sem a extensão) e cole o conteúdo, apagando o que já existir. São 9 arquivos:
`Funcoes`, `Setup`, `Servidor-01` a `Servidor-05` e `Painel-01`, `Painel-02`.
Depois, em **Configurações do projeto**, marque *Mostrar o arquivo de manifesto "appsscript.json"*, volte ao editor e substitua o conteúdo de `appsscript.json` pelo do arquivo de `gas/`.

**Opção B, com `clasp` (precisa de Node.js):**
```bash
npm i -g @google/clasp
clasp login                       # com a conta @premix que será a "dona" do sistema
cd google-workspace/gas
clasp create --type standalone --title "Premix — Lançamentos"
clasp push --force
```
Para regenerar `gas/` depois de mudanças no painel: `cd build && npm i && node build.mjs <caminho do painel-fornecedores>`.

### 2. Propriedades do script
Editor do Apps Script → **Configurações do projeto → Propriedades do script**:

| Propriedade | Valor |
|---|---|
| `PASTA_RAIZ` | id da pasta do Drive compartilhado onde ficarão as planilhas |
| `DOMINIO_PERMITIDO` | `premix.com.br` |
| `SUPABASE_URL` | `https://frudrwxdygfticgcwigv.supabase.co` (só para copiar os dados) |
| `SUPABASE_SERVICE_KEY` | chave `service_role` (só para copiar os dados) |

Integrações com planilhas e Drive (use a conta dona do script, que precisa ter acesso a elas):

| Propriedade | Para quê |
|---|---|
| `LANC_SYNC_SHEET_ID` | planilha com a aba `Demandas_Sync` (a variável `GOOGLE_SHEET_ID`/`LANC_SYNC_SHEET_ID` de hoje) |
| `LANC_BASE_SHEET_ID` | planilha-base do Portal: o painel grava nela Status, Responsável e Data Lançto na hora |
| `PONTE_PLANILHA_ID` | planilha de recepção (aba `Demandas`), se usar a leitura "ponte" |
| `PONTE_PASTAS_PERMITIDAS` | opcional: restringe de quais pastas do Drive o sistema lê PDFs |

A configuração `fonte_planilha` e `sync_planilha` vem junto com a cópia da tabela `lanc_config`, então o comportamento atual (hoje: `sync`, sincronização automática desligada) é mantido.

### 3. Rodar pelo editor, nesta ordem
1. `configurar()`: cria as 3 planilhas, a pasta de imagens e os segredos. Pode repetir.
2. `migrarTudo()`: copia as 18 tabelas. Repita até aparecer *Concluído*.
3. `instalarGatilhos()`: agenda a rotina (sincronização + leitura dos PDFs) a cada 10 minutos.
4. `diagnostico()`: lista o que ainda falta.

### 4. Publicar
**Implantar → Nova implantação → App da Web**, **Executar como: Eu**. O acesso é por implantação, então crie duas do mesmo projeto:

- **"Painel"**: acesso *Qualquer pessoa da Premix*. É a URL que as analistas usam (e que pode ir no Google Sites).
- **"Público"**: acesso *Qualquer pessoa*. É a URL que o Portal de Lançamentos chama. Visitantes anônimos só recebem a mensagem de acesso restrito; a API exige conta da organização.

**Portal de Lançamentos:** troque a `LANC_URL` do script dele por
`<URL pública>?rota=lancamentos/ingest&segredo=<valor de LANC_INGEST_SECRET>`
(o valor está nas Propriedades do script; o Apps Script não repassa cabeçalhos, por isso o segredo vai na URL).

**Imagens da tela de login** (opcional): envie `painel-fornecedores/public/login/*` para a pasta *Imagens do painel*, mantendo a subpasta `login`. O logo vem do site da Premix.

## Portal de Lançamentos (script de envio das filiais)

A pasta `portal/` tem o `Codigo.gs` do Portal com duas alterações, testadas junto com o painel novo:

1. **Pastas e nomes no Drive:** `Filial / 2026-10 Outubro / 06` e o arquivo `Patrocínio Paulista NF 000012345.pdf`
   (NF, NFS, CTE ou BOLETO; número com 9 dígitos; repetido no mesmo dia ganha ` (2)`). A tabela de siglas fica no começo do script.
2. **Chamada ao painel:** se `PAINEL_URL` for um endereço do Apps Script (`script.google.com`), a rota e o segredo vão na URL
   (o Apps Script não recebe cabeçalhos); se for a Vercel, nada muda. Na troca basta mudar `PAINEL_URL` e `PAINEL_SEGREDO_ENVIO`.

Na página do Portal (`Portal.html`) duas linhas passam a enviar também o tipo e o número do CT-e junto de cada PDF (ver o passo a passo).
`Codigo.original.gs` é o código de antes, para voltar atrás se precisar.

## Dia da troca (roteiro)

Teste primeiro com a cópia de hoje, sem mexer em nada do sistema atual. Quando for trocar:

1. Pause o painel antigo (no Supabase, `lanc_config.conexoes_pausadas = 1`) para ninguém lançar nada durante a cópia.
2. Propriedade `CONFIRMA_REIMPORTAR = SIM` → rode `reimportarTudo()` (apaga as planilhas) → rode `migrarTudo()` até *Concluído*.
3. Troque a `LANC_URL` do Portal.
4. Avise as analistas da nova URL. A tela pede o login de novo (mesmo e-mail e senha de hoje).
5. Depois de confirmado, **apague `SUPABASE_SERVICE_KEY`** das propriedades.

Para voltar atrás, basta repor a `LANC_URL` antiga e despausar o painel antigo (os lançamentos feitos na versão Google ficariam só nas planilhas).

## Testes

```bash
cd build && npm i && npm test           # perfil Lançamentos (precisa do Playwright)
npm run test:completo                   # painel inteiro
```
O perfil Lançamentos cobre: Portal enviando documentos (inclusive NF com CT-e, duplicidade e segredo errado), fila e ordem de prioridade, detalhe, lançar/pendenciar/cancelar com as travas, busca, relatório, NF Transferência, Tabela de Fretes (com diferença calculada), visão das filiais com código, leitura de PDF (chave de acesso, valores, CNPJ e boleto), sincronização com a planilha, espelhamento de volta, instalação, cópia e reimportação, e as telas num Chromium real.

## O que só dá para saber no Google de verdade

- **Velocidade:** cada ação lê/grava planilhas, então espere de 1 a 3 s (contra décimos de segundo hoje). Ao lançar, o espelhamento na planilha-base acontece na mesma execução e soma 1 a 2 s.
- **Tamanho:** a tela tem 0,6 MB e o servidor 1,9 MB (7 arquivos de até 460 KB). Bem menor que o pacote completo, mas ainda convém confirmar que o `clasp push` e a abertura aceitam.
- **PDF na tela:** usa a pré-visualização do Drive; precisa de a pessoa estar logada na conta da Premix no navegador, como hoje.
- **OCR de PDF escaneado:** usa o serviço avançado *Drive* (já no manifesto); pode ser preciso ativar a *Drive API* no projeto do Google Cloud ligado ao script.
- **Cotas:** execução de até 6 min, gatilhos de tempo e `UrlFetch`. Com a equipe atual deve sobrar; vale acompanhar na primeira semana.
- **Cookies/armazenamento no iframe:** se o navegador bloquear, a tela guarda o login só em memória (pede de novo ao recarregar).

## Lacunas

- Dados efêmeros (`rate_limits`, `sync_lock`, chat) não são copiados.
- A tabela `lanc_fila` e as visões `lanc_*_v` não viram abas: são calculadas na hora.
- O Portal de Lançamentos, por ser outro script, só precisa da troca de URL; ele não foi alterado.
