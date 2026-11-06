# Premix Fornecedores — versão Google (Apps Script + Planilha + Drive)

Piloto da migração saindo de Supabase + Vercel. Este primeiro módulo é o
**formulário público de cadastro de fornecedor**, com os mesmos 4 tipos
(PJ, PF, Motorista, Atualização Bancária) e as mesmas regras do `index.html` atual.

| Antes | Agora |
|---|---|
| Tabela `fornecedores` no Supabase | Aba `fornecedores` na planilha **Premix — Cadastros** (mesmas colunas) |
| Bucket `comprovantes` (links públicos) | Uma pasta por fornecedor no **Drive compartilhado**, sem link público |
| Chave do Supabase no código da página | Nenhuma chave no navegador: só o script (rodando na conta da organização) grava |
| Hospedagem Vercel / HTML solto | Web App do Apps Script, incorporado no **Google Sites** |

## Arquivos

- `Code.gs`: abre o Web App e permite incorporar no Sites.
- `Config.gs`: `setup()` cria a planilha e configura a pasta. As colunas ficam aqui.
- `Db.gs`: lê e grava nas planilhas (com trava contra envios simultâneos e proteção contra fórmulas).
- `Fornecedores.gs`: recebe o cadastro, valida tudo de novo no servidor e salva os documentos no Drive.
- `Migracao.gs`: copia os fornecedores e documentos que hoje estão no Supabase.
- `Index.html`: o formulário (visual idêntico ao atual).

## Instalação (uma vez)

1. No **Drive compartilhado** da organização, crie a pasta `Fornecedores` e copie o ID
   dela (o trecho da URL depois de `/folders/`).
2. Acesse <https://script.google.com> com a conta da organização → **Novo projeto**.
3. Crie os arquivos com os mesmos nomes e cole o conteúdo desta pasta
   (`Code.gs`, `Config.gs`, `Db.gs`, `Fornecedores.gs`, `Migracao.gs`, `Index.html`).
   Em **Configurações do projeto**, marque "Mostrar arquivo de manifesto" e cole o `appsscript.json`.
4. Em `Config.gs`, troque `COLE_AQUI_O_ID_DA_PASTA` pelo ID e rode a função **`setup`**.
   Autorize as permissões. O log mostra o link da planilha criada.
5. **Implantar → Nova implantação → App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa** (o fornecedor é externo)
   Copie a URL que termina em `/exec`.
6. No **Google Sites**: Inserir → **Incorporar** → cole a URL `/exec`.

> Se a opção "Qualquer pessoa" não aparecer, o administrador do Google Workspace
> precisa liberar o compartilhamento de Apps Script fora do domínio
> (Admin → Apps → Google Workspace → Drive e Documentos → Compartilhamento).

**Sempre que alterar o código:** Implantar → Gerenciar implantações → editar →
Versão: *Nova versão*. A URL continua a mesma, então o Sites não precisa mudar.

## Migração dos dados atuais

1. Em Configurações do projeto → Propriedades do script, crie:
   - `SUPABASE_URL` = `https://frudrwxdygfticgcwigv.supabase.co`
   - `SUPABASE_SERVICE_KEY` = a chave *service_role* (Supabase → Project Settings → API)
2. Rode `importarFornecedores()`. Ele copia os 290 registros e não duplica se for rodado de novo.
3. Rode `migrarArquivos()` até o log mostrar **Concluído**. Ele copia os comprovantes
   para o Drive e troca os links na planilha.
4. **Apague `SUPABASE_SERVICE_KEY`** das propriedades.

## Segurança

- O navegador do fornecedor não tem acesso à planilha nem ao Drive. Ele só chama
  `salvarFornecedor`, que aceita apenas os campos do formulário. Status, código do
  fornecedor e campos internos são definidos pelo servidor.
- Os anexos são conferidos pelo **conteúdo real** (PDF/JPG/PNG), com limite de 5MB.
  Arquivos fora do tipo de cadastro escolhido são recusados.
- Os documentos herdam as permissões do Drive compartilhado. Nenhum link é público.
- A aba fica protegida contra edição manual. Textos que começam com `=`, `+`, `-` ou `@`
  são gravados como texto, nunca como fórmula.
- Há um limite de envios por intervalo e um campo-isca contra robôs.

## Próximos módulos

O painel interno (Pendências, Produtos, Trilha, Contratos, Lançamento) vai num Web App
separado, com acesso **somente para contas da organização**. O login Google substitui
a tabela `usuarios_painel`. Estrutura prevista:

- **Premix — Cadastros**: fornecedores, produtos, filiais, usuários, configurações
- **Premix — Operação**: contratos, medições, vigências, lançamentos, pendências, trilha
- **Premix — Histórico**: auditoria, históricos e logs (as tabelas que só crescem)
