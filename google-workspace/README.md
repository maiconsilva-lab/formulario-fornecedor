# Premix no Google Workspace (Apps Script + Planilhas + Drive)

O painel inteiro (Visão Geral, Fila Protheus, Cadastros, Gestão de Tarefas, Pendências Fiscais, Lançamentos, Contratos, Trilha) e os formulários públicos (fornecedor, produtos) rodando num único projeto do Google Apps Script, com os dados em 3 planilhas e os documentos no Drive compartilhado. **Supabase e Vercel continuam funcionando como estão**: nada aqui os altera. A migração é uma cópia.

## Como foi feito

O código das telas e das 81 rotas de API continua sendo o do repositório `painel-fornecedores`, sem alterações. O `build/` o empacota para o Apps Script:

| Antes | Agora |
|---|---|
| 50 tabelas no Supabase | 3 planilhas: **Cadastros**, **Operação**, **Histórico** (uma aba por tabela, mesmas colunas) |
| Consultas `supabase.from(...)` | Mesmo código, executado por `servidor/db/*` sobre as planilhas (filtros, `or`, `in`, `upsert`, views e as 10 funções SQL reescritas em JS) |
| Bucket `comprovantes` | Uma pasta por fornecedor no Drive compartilhado |
| Rotas `/api/*` na Vercel | `google.script.run.api(...)`, mesma resposta e mesmos cookies de sessão |
| Login próprio (e-mail/senha, bcrypt) | O mesmo, mais uma trava: só contas `@premix.com.br` alcançam o painel |
| Crons da Vercel / pg_cron | Gatilho de 10 em 10 min do Apps Script |

```
google-workspace/
  servidor/    camada de dados em planilhas, shims (Next, crypto, fetch, googleapis), formulários públicos
  cliente/     roteador interno, ponte com o servidor, imagens
  paginas/     Fornecedor.html, Produtos.html (formulários públicos)
  estatico/    appsscript.json (permissões) e Setup.js (instalação/migração)
  build/       empacotador e testes
  gas/         SAÍDA — é isto que vai para o Apps Script (já gerada e versionada)
```

## Instalação

### 1. Enviar os arquivos
Os arquivos têm vários MB (o painel tem 3,6 MB), então o envio é pela ferramenta `clasp`:

```bash
npm i -g @google/clasp
clasp login                       # com a conta @premix que será a "dona" do sistema
cd google-workspace/gas
clasp create --type standalone --title "Premix — Central"
clasp push --force
```

Para regenerar `gas/` depois de mudanças no painel: `cd build && npm i && node build.mjs <caminho do painel-fornecedores>`.

### 2. Propriedades do script
No editor: **Configurações do projeto → Propriedades do script**:

| Propriedade | Valor |
|---|---|
| `PASTA_RAIZ` | id da pasta do Drive compartilhado onde ficará tudo |
| `DOMINIO_PERMITIDO` | `premix.com.br` |
| `CTR_CHAVE` | o mesmo valor da variável `CTR_CHAVE` da Vercel, se ela existir |
| `SUPABASE_URL` | `https://frudrwxdygfticgcwigv.supabase.co` (só para migrar) |
| `SUPABASE_SERVICE_KEY` | chave `service_role` (só para migrar) |

### 3. Rodar, nesta ordem, pelo editor
1. `configurar()`: cria as 3 planilhas, as pastas e os segredos. Pode repetir.
2. `migrarTudo()`: copia as tabelas. Repita até aparecer *Concluído*. Não duplica.
3. `migrarArquivos()`: copia os comprovantes para o Drive e troca os links. Repita até *Concluído*.
4. `instalarGatilhos()`: agenda a rotina de Lançamentos.
5. `diagnostico()`: lista o que ainda falta.

Depois de migrar, **apague `SUPABASE_SERVICE_KEY`**.

### 4. Publicar (duas implantações do mesmo projeto)
**Implantar → Nova implantação → App da Web**, **Executar como: Eu**. O acesso é definido por implantação:

- **"Painel"**: acesso *Qualquer pessoa da Premix*. É a URL interna e vai no Google Sites.
- **"Público"**: acesso *Qualquer pessoa*. É a URL que os fornecedores usam e a que o Portal de Lançamentos chama.

Mesmo na implantação pública, visitantes anônimos só recebem os formulários: a API, as imagens e o painel exigem uma conta Google do domínio (checada no servidor).

Endereços (`<URL>` = a da implantação):
- Painel: `<URL>` (ou `<URL>?p=/pendencias`, `?p=/contratos`, `?p=/lancamentos`, `?p=/trilha`)
- Formulário de fornecedor: `<URL>?pagina=fornecedor`
- Formulário de produtos: `<URL>?pagina=produtos`

**Google Sites:** Inserir → Incorporar → colar a URL da implantação correspondente.

### 5. Integrações opcionais
Use os mesmos nomes das variáveis do painel, como propriedades do script: `LANC_SYNC_SHEET_ID`, `LANC_BASE_SHEET_ID`, `CTR_PLANILHA_ID`, `GOOGLE_SHEET_ID`, `TRILHA_*`, `GEMINI_API_KEY`, `EMAILJS_*`, etc. As planilhas lidas por elas precisam estar acessíveis à conta dona do script (que agora faz o papel da conta de serviço). A "ponte do Drive" passou a rodar dentro do próprio sistema: `PONTE_PLANILHA_ID` (planilha de recepção) e, se quiser restringir, `PONTE_PASTAS_PERMITIDAS`.

**Portal de Lançamentos:** troque a `LANC_URL` do script dele por
`<URL pública>?rota=lancamentos/ingest&segredo=<valor de LANC_INGEST_SECRET>`.
O Apps Script não repassa cabeçalhos, por isso o segredo vai na URL.

**Imagens do painel** (fotos da tela de login e telas dos POPs da Trilha): envie a pasta `public/` do `painel-fornecedores` para a pasta *Imagens do painel* que o `configurar()` criou. O logo vem do site da Premix.

## Testes

```bash
cd build && npm i && npm test   # precisa do Playwright instalado
```
Cobre: camada de dados (filtros, views, funções SQL, tipos), servidor empacotado (login, sessão, listas, edição), instalação e migração, formulários públicos, controle de acesso, e o painel real num Chromium (login e as 4 telas).

## O que ainda não foi validado (só dá para saber no Google de verdade)

- **Limites do Apps Script.** O painel gera 3,6 MB de HTML e o servidor 2,6 MB (em 6 arquivos). É grande para o Apps Script; se o envio ou a abertura falhar, o próximo passo é dividir por módulo.
- **Velocidade.** Cada chamada lê as planilhas: espere 1 a 3 s por ação, contra décimos de segundo no Supabase. O cliente já junta chamadas repetidas e guarda algumas por poucos segundos.
- **Cota diária de execução** (6 min por execução; limites de gravação). Com ~7 usuários deve sobrar; com muitos acessos simultâneos pode enfileirar.
- **Cookies/armazenamento no iframe.** Se o navegador bloquear `localStorage` no iframe, o painel usa memória e pede o login de novo ao recarregar.
- **Downloads de CSV/Excel** dentro do iframe do Apps Script/Sites.
- **Leitura de PDF/OCR** (Lançamentos): a leitura de texto de PDF foi testada; o OCR usa o Drive e precisa do serviço avançado *Drive* (já no manifesto).

## Fora do escopo / lacunas já existentes

- **Correção de cadastro devolvido.** O painel gera links `…/corrigir?token=…` para o fornecedor corrigir; essa página **não existe** neste repositório nem na Vercel hoje. Os tokens são gravados (aba `tokens_correcao`), mas falta a tela de correção.
- Dados de `rate_limits`, `sync_lock` e chat (efêmeros) não são migrados.
- A tabela `lanc_fila` e as visões `lanc_*_v` não viram abas: são calculadas na hora.
