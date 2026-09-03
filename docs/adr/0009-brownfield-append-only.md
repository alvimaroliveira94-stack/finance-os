# ADR 0009 — Evolução de schema em aba já populada: append-only, nunca inserção

Status: aceito · Data: 2026-09

Estende o ADR 0008 (as três colunas `valor_devido`, `vencimento`, `credor`
que motivaram esta decisão) e não cria nenhuma máquina de migração nova —
é uma restrição sobre como `FOS.Schema` pode crescer, imposta pelo
comportamento já existente de `criarAba`/`lerTabela`.

---

## Contexto

Uma auditoria read-only de rollout, feita contra uma planilha de produção
real já em uso (ciclo de agosto de 2026, 101 movimentações importadas,
regras `CAL-*` ativas), encontrou um defeito bloqueante no schema do ADR
0008: `SCHEMA[EVENTOS_MANUAIS].colunas` inseria `vencimento` na posição 4,
`valor_devido` na posição 8 e `credor` na posição 15 — no meio do schema de
16 colunas já em produção (commit `57c0eb3`), não ao final dele.

O mecanismo que torna isso destrutivo já existia antes deste ADR e não
muda aqui: `criarAba` (`adapters/spreadsheet.js`), ao encontrar uma aba já
existente, reescreve só a linha 1 (o cabeçalho) e nunca move nem
reprocessa as linhas de dado abaixo dela — não há, e nunca houve, um passo
de migração. `lerTabela` lê o cabeçalho vigente (linha 1) e o zipa
**por posição** com cada linha de dado. Rodar "Preparar planilha"
(`fosSetup` → `Bootstrap.inicializar`) contra a aba de produção populada
teria reescrito o cabeçalho para a nova ordem enquanto os 101 eventos já
gravados continuavam nas posições antigas — toda leitura seguinte
reinterpretaria, por exemplo, `conta_origem` como `vencimento`. Nenhum dado
seria apagado; todo dado seria mal rotulado, silenciosamente.

Duas correções foram consideradas. Migração de schema (reescrever também
as linhas de dado, remapeando célula por célula na hora do bootstrap) foi
descartada: nenhum caso real, hoje, precisa que uma coluna nova entre no
meio de uma aba já populada, e construir esse mecanismo agora seria
infraestrutura especulativa — o próprio princípio que orienta o resto do
projeto (ADR 0008 §9, sobre não construir patrimônio líquido antes de a
pergunta ser urgente). A correção adotada, abaixo, resolve o caso real sem
criar máquina nova nenhuma.

---

## Decisão

**Toda coluna nova que uma aba já populada em produção pode receber entra
sempre ao final da lista de colunas do schema, nunca no meio.** O prefixo
de colunas que já existe em produção permanece byte a byte, na mesma
ordem lógica, para sempre — mesmo quando a ordem "ideal" (agrupando campos
relacionados) seria outra.

Para `11_EVENTOS_MANUAIS`: os 16 nomes de coluna e a ordem exata do commit
`57c0eb3` (produção) são o prefixo fixo; `valor_devido`, `vencimento` e
`credor` (ADR 0008) passam a ser as posições 17–19, nessa ordem — a ordem
relativa entre os três é livre, porque nenhum dos três tem posição própria
em produção; o que é fixo é que os três vêm **depois** dos 16.

`SCHEMA[EVENTOS_MANUAIS].colunas` carrega um comentário citando este ADR,
para que qualquer edição futura que insira uma coluna no meio do prefixo
seja uma decisão deliberada e revisada, não um deslize.

## Por que append-only basta, sem migração

Confirmado por leitura de código, não por suposição, antes desta decisão
ser implementada:

1. **Nenhum workflow depende da posição física** de `valor_devido`,
   `vencimento` ou `credor`. `events.js`, `workflows.js` e todo o resto do
   domínio acessam esses campos por nome (`evento.vencimento`,
   `evento[s.contaConciliacao]`), nunca por índice.
2. **Leitura e escrita são compatíveis por nome.** `Schema.toObject`
   (leitura) zipa cabeçalho vigente × linha por posição — é exatamente por
   isso que o prefixo precisa ficar intacto — mas o consumidor sempre lê o
   objeto resultante por chave. `Schema.toRow` (escrita) mapeia por nome de
   coluna, não por posição alguma.
3. **Dropdowns e validações localizam coluna por nome em tempo de
   execução** (`indexOf` sobre o cabeçalho vigente), não por posição
   hardcoded — sobrevivem a qualquer ordem de coluna, desde que o nome
   exista.
4. **Append-only resolve o caso real sem tocar em célula existente.** Numa
   aba já populada, `criarAba` grava o cabeçalho de 19 colunas; as células
   de dado das 16 antigas continuam fisicamente onde estavam, agora sob os
   mesmos 16 nomes nas mesmas posições; as 3 novas ficam vazias para toda
   linha antiga, porque nunca foram escritas nela — comportamento nativo
   do Sheets ao ler um range mais largo do que uma linha antiga escreveu,
   sem nenhum código de migração.

Os quatro pontos acima eram a condição para não bloquear a implementação;
se qualquer um fosse falso, a correção teria sido reportada como bloqueio,
não implementada.

## O que isto não resolve, de propósito

Isto não é migração de schema genérica. Se um caso real algum dia exigir
remover uma coluna, trocar seu tipo, ou reordenar um prefixo já em
produção, este ADR não cobre esse caso — ele exige decisão humana nova,
porque exigiria reescrever linhas de dado existentes, o que `criarAba`
deliberadamente não faz.

## Custo aceito

A ordem das colunas em `11_EVENTOS_MANUAIS` deixa de refletir agrupamento
lógico (as três colunas de `NOVO_PASSIVO` ficam longe de `valor`/`moeda`,
com quem se relacionam) — sacrifício de legibilidade da planilha em troca
de nunca corromper dado real de produção. Aceito porque o schema já é
lido majoritariamente por nome, em todo o código e em toda tela; a ordem
física importa hoje apenas para quem abre a aba manualmente.

## Prova

Teste brownfield novo em
`test/integration/23-passivos-minimos.test.js` (`describe('Rollout
brownfield: 11_EVENTOS_MANUAIS já populada', ...)`, cenário `C54`):
cria a aba com o schema antigo de 16 colunas, grava duas linhas sintéticas
com valores distintos em todo campo, roda `Bootstrap.inicializar` e prova
que as 16 células permanecem sob os mesmos 16 cabeçalhos com os mesmos
valores, que as 3 colunas novas nascem vazias para as linhas antigas, que
o domínio (`repositorio.eventos()`, `Events.validar`) continua lendo os
dados antigos corretamente, e que rodar `inicializar` uma segunda vez é
idempotente. Sabotagem confirmada: reinserir uma coluna no meio do
prefixo de 16 derruba exatamente os testes que dependem da posição
preservada.
