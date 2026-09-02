# ADR 0004 — Entrada humana: a planilha oferece conveniência, o código guarda a verdade

Status: aceito · Implantado em produção · Commit `1a6f5d3` · Data: 2026-09

Trata da fronteira entre a ergonomia do Google Sheets e a validação do domínio.
Governa toda superfície de entrada, atual e futura.

---

## Contexto

`11_EVENTOS_MANUAIS` e `12_SALDOS_TRADING_SEMANAL` são as duas únicas abas do
workbook que o sistema **nunca escreve**: entrada humana pura.

Na validação de produção, a coluna `tipo_evento` não tinha lista fechada, e um
valor digitado errado (`NOVA_OBRIGAÇÃO` com cedilha, espaço sobrando, plural)
era descartado sem que ninguém soubesse. A validação existia e era rígida —
`Events.validar` recusa tipo fora do catálogo — mas o resultado dela não chegava
ao usuário: `materializarEventos` filtrava o tipo **antes** de validá-lo, e o
menu exibia o contador que justamente não continha o erro. O diálogo mostrava
"Provisões criadas: 0", idêntico à mensagem de "não havia nada a fazer".

Nenhum efeito financeiro incorreto era produzido. O problema era o silêncio.

---

## 1. O dropdown sai da constante que o domínio valida

**Decisão.** As listas fechadas da aba 11 (`tipo_evento`, `moeda`, `status`)
são construídas a partir das **mesmas constantes** que o domínio usa para
validar — `Events.tiposValidos()` (chaves do `SPEC`), `C.MOEDA`,
`Events.STATUS_EVENTO` — nunca de uma cópia mantida à parte.

**Porquê.** Se a planilha oferecesse um valor que `Events.validar` recusa, ela
estaria mentindo para o usuário. Amarrando as duas na mesma fonte, um tipo que
entre ou saia do catálogo aparece ou some do dropdown sozinho.

## 2. O dropdown é conveniência, não fonte de verdade

**Decisão.** A validação que vale continua sendo a do código. A lista fechada
reduz a chance do erro; não a elimina.

**Porquê.** No Google Sheets, **colar valores substitui a regra de validação da
célula**. Um dropdown dá a impressão de que a entrada está garantida, e a
conclusão natural — "com dropdown, a checagem no código virou redundante" — é
falsa e quebra no primeiro *colar*. Há teste cobrindo esse caminho: escrita
direta no repositório, ignorando a regra da célula, continua sendo recusada.

**Consequência.** Toda superfície de entrada futura segue a mesma regra: a
conveniência vive na planilha, a verdade vive no domínio.

## 3. Nenhum erro de declaração pode ser silencioso

**Decisão.** `materializarEventos` distingue dois casos que antes eram um só:

- **tipo desconhecido** → erro reportado (`TIPO_EVENTO_INVALIDO`), aparece no
  contador do menu, no log de auditoria e como aviso
  `EVENTOS_MANUAIS_INVALIDOS` no diagnóstico antes do fechamento;
- **tipo válido que não pertence ao fluxo de materialização** (`SAQUE_TRADING`,
  `GASTO_EXTRAORDINARIO`, `APORTE_EXTRAORDINARIO`) → silêncio correto, porque
  esses são conciliados, não materializados.

O comando "Registrar evento" junta as recusas dos dois caminhos — materialização
e conciliação — sem repetir `evento_id`, e mostra cada uma com o motivo.

**Porquê.** A distinção é o que separa "o sistema ignorou minha linha" de "o
sistema tinha nada a fazer com ela". Sem ela, o usuário não consegue interpretar
um contador zerado.

**Custo aceito.** `Events.validar` não faz `trim()`: um espaço sobrando é
recusado com motivo visível, em vez de normalizado em silêncio. É deliberado —
o sistema não adivinha o que o usuário quis escrever.

## 4. Entrada em lote continua sendo tabela, não formulário

**Decisão.** Nem a aba 11 nem a aba 12 ganham diálogo de entrada.

**Porquê.** `12_SALDOS_TRADING_SEMANAL` recebe três contas por semana — é a
entrada mais frequente do sistema. Um formulário transformaria digitação
tabular em vários passos por linha. A aba 11 tem a mesma natureza: declaração em
lote, revisável antes de rodar o comando.

**Alternativa descartada.** Formulário de menu para os dois. Resolveria a
validação na origem, mas ao custo de mais fricção justamente no ponto de maior
frequência — o inverso do princípio do sistema.

**Consequência.** As duas abas ficam ocultas por padrão e são abertas pelo menu
(ver ADR 0006), sem deixar de ser tabelas.
