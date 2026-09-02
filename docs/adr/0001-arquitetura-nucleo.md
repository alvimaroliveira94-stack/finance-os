# ADR 0001 — Arquitetura do núcleo do Finance OS

Status: aceito · Ondas 1 (núcleo) e 2 (experiência) · Data: 2026-05

Este ADR registra **decisões técnicas reversíveis**. Decisões financeiras canônicas
(categorias, sete eventos, quatro métricas de trading, regras de estado, provisões e sinais)
não são objeto deste documento: elas vieram definidas e o código as implementa como estão.

---

## 1. Namespace global `FOS` em vez de módulos

**Decisão.** Cada arquivo é uma IIFE que anexa seu módulo a `globalThis.FOS`.

**Porquê.** O Apps Script concatena arquivos no escopo global e não tem `require`/`import`.
O mesmo código precisa rodar sob Node para os testes. A IIFE resolve os dois casos sem
build step, sem bundler e sem dependência.

**Custo aceito.** Sem checagem estática de imports; a ordem de carga é declarada em `test/_load.js`.

**Reversível.** Se um dia houver build (clasp + bundler), basta trocar o rodapé dos arquivos.

## 2. Hash próprio (FNV-1a 64 bits) em vez de `Utilities.computeDigest`

**Decisão.** Fingerprint e checksum usam FNV-1a implementado em BigInt, no domínio puro.

**Porquê.** `Utilities.computeDigest` é API de plataforma; usá-la tornaria o fingerprint
impossível de testar fora do Google e amarraria uma regra de negócio (identidade da transação)
a um adaptador.

**Custo aceito.** FNV-1a não é criptográfico. Aqui ele não precisa ser: o checksum protege
contra alteração acidental e prova imutabilidade em um workbook privado, não contra um
adversário. Se o requisito virar antiadulteração forte, troca-se por SHA-256 no adaptador,
com versionamento do campo `checksum`.

## 3. Datas como texto ISO, sem `Date`

**Decisão.** O domínio trata datas como `YYYY-MM-DD` e competências como `YYYY-MM`, com
aritmética por dia juliano.

**Porquê.** `Date` no Apps Script depende do fuso do script e da planilha; um mesmo
fechamento poderia mudar de mês conforme o servidor. Texto ISO é determinístico.

**Custo aceito.** Não há suporte a hora/minuto no domínio. Nenhuma regra precisa disso.

## 4. Ledger append-only com visão corrente derivada

**Decisão.** Reclassificar não atualiza a linha: acrescenta uma linha com
`versao_gerencial + 1` e a mesma origem. A visão corrente é a maior versão por `fingerprint`.

**Porquê.** Zero `update` significa zero perda de histórico e auditoria trivial. Também evita
condição de corrida em planilha, onde escrita parcial é comum.

**Custo aceito.** A aba cresce mais rápido e toda leitura precisa projetar. Aceitável na
ordem de grandeza de um sistema pessoal.

**Alternativa descartada.** Marcar a linha antiga com `status = SUPERSEDIDO` — voltaria a ser
update destrutivo do ponto de vista de auditoria.

## 5. Conciliação registrada no ledger, não na aba de eventos

**Decisão.** O vínculo evento ↔ transação é gravado como `evento_conciliado_id` numa nova
versão da linha do ledger. A aba `11_EVENTOS_MANUAIS` nunca é reescrita pelo sistema.

**Porquê.** A aba 11 é território do usuário; o sistema escrevendo nela criaria conflito de
edição e ambiguidade sobre quem é a fonte da verdade. O ledger é append-only e auditável.

**Consequência.** A invariante "conciliações completas" lê o ledger, não um status editável.

## 6. Snapshot completo do fechamento em JSON dentro da linha

**Decisão.** `40_FECHAMENTOS` tem colunas espelho legíveis (caixa, disponível, runway,
patrimônio, estado, qualidade) e uma coluna `snapshot_json` com o snapshot inteiro.

**Porquê.** O fechamento precisa congelar dezenas de campos aninhados. Uma coluna por campo
tornaria a aba ilegível e frágil a mudanças de schema. O JSON canônico também é o que permite
recalcular o checksum e provar imutabilidade.

**Custo aceito.** O JSON não é editável à mão — o que é justamente a intenção.

## 7. Correção de posição por evento compensatório, com duas semânticas

**Decisão.** Eventos aditivos (`APORTE`, `RETIRADA`, `DISTRIBUICAO`) são corrigidos por um
evento do mesmo tipo com valor exatamente inverso, e ambos permanecem no ledger.
`SNAPSHOT_VALOR_MERCADO` é corrigido por um novo snapshot que referencia e substitui o anterior.

**Porquê.** Valor aditivo é fluxo (soma), snapshot é estado (substituição). Forçar uma única
semântica produziria projeção errada em um dos dois casos.

**Custo aceito.** A validação precisa conhecer a diferença; está explícita em `positions.js`.

## 8. Provedor de taxa abstrato, com implementação manual como padrão

**Decisão.** O domínio conhece apenas uma tabela `data → taxa`. O adaptador oferece provedor
manual (taxas na planilha) e provedor HTTP genérico (PTAX ou equivalente), configurável.

**Porquê.** Nesta onda não há deploy nem chamada externa. A abstração deixa o PTAX plugável
sem tocar em regra, e mantém o teste de "taxa ausente bloqueia fechamento" independente de rede.

**Custo aceito.** A URL do provedor é configuração, não constante — quem ligar o PTAX precisa
preencher e validar o extrator de resposta.

## 9. Escopo `drive.readonly` no manifesto

**Decisão.** O manifesto declara `spreadsheets.currentonly`, `script.container.ui` e
`drive.readonly`.

**Porquê.** Ler o extrato pelo nome do arquivo exige leitura do Drive. Os outros dois escopos
são o mínimo para um script vinculado com menu.

**Reversível.** Se o incômodo do escopo for maior que a conveniência, troca-se a leitura por
colagem manual do CSV e o escopo cai para dois. O adaptador de Drive fica isolado justamente
para permitir essa troca sem mexer no domínio.

## 10. Harness de testes próprio em vez de framework

**Decisão.** `test/_runner.js` (~130 linhas) implementa `describe`/`it`/`assert`, tags de
cenário e testes pendentes.

**Porquê.** Dependência zero: nada de `node_modules` num repositório que também é lido por
quem não é desenvolvedor. E a matriz de cenários canônicos — que é um requisito do projeto,
não um detalhe de teste — sai direto do runner, com falha se um cenário obrigatório ficar
descoberto.

**Custo aceito.** Sem cobertura de código automática, sem watch mode.

**Reversível.** Migrar para `node:test` é mecânico se a matriz for reimplementada como reporter.

## 11. Configuração como tabela única com seção

**Decisão.** `00_CONFIG_PARAMETROS` usa uma coluna `secao` (`PARAMETRO` | `CONTA` | `ENUM`) e
um conjunto de colunas onde cada seção preenche o que lhe cabe.

**Porquê.** A lista de abas é canônica e fechada; catálogo de contas e enums precisam morar
em `00`. Uma tabela por seção exigiria abas novas; JSON em célula seria ilegível para edição
humana.

**Custo aceito.** Algumas colunas ficam vazias conforme a seção.

## 12. Parâmetro bloqueado é `null` + `reason`, e propaga

**Decisão.** Parâmetro com `status = BLOQUEADO` devolve `null` com motivo, e todo cálculo que
depende dele devolve `null` com o mesmo motivo até chegar ao dashboard.

**Porquê.** É a tradução técnica de "não adivinhar". Um default silencioso produziria um
número plausível e errado — a pior saída possível num sistema de decisão.

**Custo aceito.** Mais caminhos `null` para tratar; em compensação todo `null` carrega a
explicação de por que é `null`.

---

# Onda 2 — decisões da experiência

## 13. Payload injetado no HTML, sem endpoint chamável

**Decisão.** O painel recebe todo o conteúdo embutido no HTML (marcador
`/*__PAINEL__*/null` substituído no servidor). Não existe `google.script.run`,
nem endpoint de leitura, nem chamada de rede na página.

**Porquê.** Elimina uma classe inteira de risco: sem endpoint, não há como
alguém chamar o servidor a partir do navegador, e o histórico completo cabe no
payload (são poucos fechamentos). A CSP com `connect-src 'none'` torna a
ausência de rede verificável, não apenas prometida.

**Custo aceito.** Trocar de competência recarrega a página em vez de buscar dado.

## 14. Painel como diálogo na planilha, não como web app

**Decisão.** `fosAbrirPainel` abre o HTML em modal dentro do Sheets.
`doGet` existe, verifica que usuário efetivo e ativo são o mesmo, mas nada é
implantado.

**Porquê.** Publicar web app criaria uma superfície pública para dado
financeiro pessoal. O modal já entrega a leitura para quem tem acesso à
planilha, que é exatamente o público desejado.

**Reversível.** Se um dia fizer sentido acessar pelo celular fora do Sheets,
basta implantar — o `doGet` já nasce restrito.

## 15. Abas visíveis como projeção regenerável

**Decisão.** As quatro abas visíveis são reescritas inteiras a cada
atualização, a partir do fechamento vigente.

**Porquê.** Elas não podem virar segunda fonte de verdade. Regenerar tudo é o
que garante que apagá-las não perde nada e que não existe estado escondido nelas.

**Custo aceito.** Filtros e ordenações manuais do usuário se perdem na
regeneração. Em troca, a aba nunca mente.

## 16. Falta de candidato na conciliação não vira item de fila

**Decisão.** Só ambiguidade (dois ou mais candidatos) gera item na fila.
Evento sem contrapartida fica como pendência reportada.

**Porquê.** Descoberto na integração: um evento de fevereiro sem extrato
importado criava item de fila e travava o fechamento de **janeiro**. Quem cobra
conciliação é a invariante do fechamento, que é escopada por competência.
A fila fica só com o que exige decisão humana de verdade.

## 17. Linha sem regra entra no ledger na resolução da fila

**Decisão.** Quando nenhuma regra classifica uma linha, ela fica só no staging
e na fila. Ao resolver o item, a linha entra no ledger como versão 1 com a
categoria escolhida pelo usuário.

**Porquê.** Descoberto ao ligar o fluxo: não havia caminho do staging para o
ledger sem regra. Colocar a linha no ledger "sem categoria" violaria a
invariante de soma por categoria; deixá-la fora até a decisão é coerente, e o
fechamento fica bloqueado enquanto houver item aberto.

## 18. Token de atenção só como acento

**Decisão.** `#B8791A` é usado em borda e faixa, nunca como cor de texto.

**Porquê.** Medido no teste: 3,63:1 sobre branco, abaixo de AA para texto
pequeno. O token é canônico e não foi alterado; mudou o **uso**. Há teste que
falha se alguém escrever `color:var(--atencao)`.

## 19. Cache de taxa dentro da aba 00

**Decisão.** As taxas materializadas vivem em `00_CONFIG_PARAMETROS` com
`secao = TAXA` e chave `PAR@DATA`, em vez de uma nova aba.

**Porquê.** A lista de abas internas é canônica e fechada. Guardar o cache na
configuração mantém as treze abas e deixa a taxa visível e auditável onde já
moram os outros parâmetros.

**Custo aceito.** A aba 00 mistura parâmetro e cache; a coluna `secao` separa.

## 20. Testes visuais estruturais, navegador só no QA opcional

**Decisão.** C37–C39 são verificados lendo o HTML/CSS (tokens, contraste
calculado, semântica, foco, breakpoints). A medição em navegador real fica em
`npm run qa:visual`, fora de `npm test`.

**Porquê.** Manter `npm test` sem dependência de binário externo, e ainda assim
falhar de verdade quando o contrato visual é quebrado. O QA em Chromium mede o
que só o navegador sabe: overflow real, ordem de foco e contraste computado.
