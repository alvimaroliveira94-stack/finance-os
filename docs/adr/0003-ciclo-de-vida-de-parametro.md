# ADR 0003 — Ciclo de vida de um parâmetro de configuração

Status: aceito · Implantado em produção · Commits `e3fa607`, `c6712bb` · Data: 2026-09

Estende o ADR 0001 #12 (parâmetro bloqueado é `null` + `reason`), que definiu o
que o sistema faz com um parâmetro sem valor. Este ADR define a pergunta
seguinte: **quando o sistema tem o direito de cobrar esse valor do usuário.**

---

## Contexto

A auditoria encontrou dois parâmetros — `PATRIMONIO_ALVO_BRL` e
`CUSTO_VIDA_ALVO_MENSAL_BRL` — declarados na semente e lidos por **ninguém**.
Fechar a mesma competência com um deles vazio e com valor preenchido produzia
snapshots idênticos, exceto por `metadados.parametros_bloqueados`. Ainda assim
apareciam como pendência a cada diagnóstico, cobrando uma definição que nenhum
cálculo usaria.

Um terceiro, `URL_PROVEDOR_TAXA_CAMBIO`, tem consumidor real, mas está bloqueado
**por decisão** (`POLITICA_TAXA_CAMBIO = MANUAL`) — e também aparecia como
pendência, sem que houvesse ação pendente alguma.

Um parâmetro sem valor pode significar três coisas diferentes. O sistema tratava
as três como uma só.

---

## 1. Quatro estados, não dois

**Decisão.** `STATUS_PARAMETRO` ganha `DEPRECIADO`, ao lado de `ATIVO` e
`BLOQUEADO`. O ciclo de vida completo passa a ser:

| Estado | Significado |
|---|---|
| `ATIVO` | tem valor, é consumido |
| `BLOQUEADO` | decisão **pendente** do usuário → aparece no diagnóstico |
| `BLOQUEADO` por política | ausência **intencional** sob a configuração vigente → não aparece |
| `DEPRECIADO` | decisão **tomada**: deixou de ser canônico → não aparece, nunca mais |

**Porquê.** Bloqueado é uma pergunta em aberto; depreciado é uma pergunta
respondida. Colapsar as duas obriga o usuário a reler, a cada diagnóstico, uma
lista que mistura o que falta decidir com o que já foi decidido — e o efeito
prático é que ele para de ler a lista inteira.

## 2. A fonte de verdade da depreciação é o código, não a célula

**Decisão.** `Config.PARAMETROS_DEPRECIADOS` é a lista canônica.
`Config.build` marca essas chaves como `DEPRECIADO` **independentemente** do que
a linha da planilha diga, e `param()` devolve `null` mesmo que alguém digite um
valor na célula.

**Porquê.** Uma decisão arquitetural não pode ser revertida por edição de célula.
Se a planilha mandasse, bastaria alguém escrever `ATIVO` na aba 00 para
ressuscitar um parâmetro que o domínio não lê — criando a pior categoria de bug:
configuração que aparenta ter efeito e não tem.

**Custo aceito.** Contraintuitivo para quem abre a aba 00 e vê a linha. Mitigado
pela decisão 3: o texto da linha é sincronizado para dizer a mesma coisa.

## 3. Depreciar não apaga a linha

**Decisão.** A linha permanece na aba 00 com o valor que o usuário porventura
tenha digitado. "Preparar planilha" sincroniza apenas `status`, `reason` e
`descricao`, **célula a célula**, e é idempotente.

**Porquê.** Preservar histórico é regra geral do sistema. E o parâmetro pode ter
tido significado no passado: apagar a linha apagaria a evidência de que ele
existiu.

**Custo aceito — e por que célula a célula.** A aba 00 também guarda as taxas
publicadas (ADR 0002 #4). Usar `substituirTabela` para alterar duas células
significaria reescrever uma aba que contém dado financeiro append-only — risco
desproporcional ao ganho. Por isso o adaptador ganhou `atualizarCampos`, que
escreve só as células que casam com um filtro e não toca em nenhuma outra linha
ou coluna.

## 4. Ausência intencional não é pendência

**Decisão.** `URL_PROVEDOR_TAXA_CAMBIO` só é cobrada quando
`POLITICA_TAXA_CAMBIO = HTTP` (`Adapters.exigeUrlDoProvedor`). Sob `MANUAL` — o
padrão do V1 — a ausência dela não gera aviso. Sob `HTTP` sem URL, gera
`URL_PROVEDOR_TAXA_AUSENTE`, que explica que nenhuma cotação será consultada e
aponta as duas saídas.

**Porquê.** O parâmetro não foi depreciado nem ativado: ele existe para quando a
política mudar. O que estava errado era o diagnóstico tratar uma decisão tomada
como ação pendente.

**Consequência.** O aviso continua sendo aviso, não bloqueio: sem URL o mês ainda
fecha, porque a taxa pode ser publicada à mão.

## 5. O diagnóstico não promete dependentes que não existem

**Decisão.** A mensagem genérica de parâmetro bloqueado deixou de afirmar que
"os cálculos que dependem dele ficam null com motivo" e passou a dizer que
qualquer cálculo que *venha a* usá-lo devolverá `null` com motivo.

**Porquê.** A frase antiga era literalmente falsa para todos os parâmetros
bloqueados que existiam. Mensagem de diagnóstico que descreve errado o próprio
sistema é pior que mensagem ausente.

---

## Compatibilidade

Snapshots já gravados são texto imutável e não mudam. Uma **reapresentação** de
competência anterior produzirá `metadados.parametros_bloqueados` sem as chaves
depreciadas — diferença esperada e correta, já que o restatement reflete a
configuração vigente. Nenhum número financeiro muda.
