# ADR 0001 — Arquitetura do núcleo do Finance OS

Status: aceito · Onda: núcleo funcional (fases 0–5) · Data: 2026-05

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
