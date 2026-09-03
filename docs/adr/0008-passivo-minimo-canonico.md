# ADR 0008 — Passivo mínimo canônico: quanto devo é verdade de primeira classe

Status: aceito · Não implantado em produção · Data: 2026-09

Estende o ADR 0001 (categorias e universos são decisão do usuário, não deste
documento) e reusa a máquina de versionamento que o ADR 0001 já estabeleceu
para 30_PROVISOES/31_OBJETIVOS (`FOS.Subledger`), sem criar uma segunda.

---

## Contexto

Um empréstimo real ficou aberto na data de um fechamento: R$ 4.430 entraram
no banco, mas a obrigação assumida era de R$ 5.000 — R$ 570 de juro
descontado na origem. Até este ADR, o Finance OS não tinha nenhuma entidade
capaz de representar "quanto ainda devo": `disponivel_brl` somaria o caixa
recebido como se fosse livre, e `runway_meses` ficaria inflado por dinheiro
que já tem dono.

Duas propostas anteriores, descartadas na investigação que precedeu este
ADR: (1) só uma categoria neutra de movimentação, sem entidade de passivo —
resolve o rótulo do caixa, mas deixa `disponivel_brl` contando dívida como
livre enquanto ela permanecer aberta num fechamento; (2) reusar
`30_PROVISOES` como se fosse passivo — descartado porque `valor_acumulado`
tem semântica de poupança (quanto já *guardei*), o oposto de dívida (quanto
ainda *devo*), e quitar a dívida dispararia falsamente o sinal
`REDUCAO_PROTECAO`.

---

## 1. Passivo é subledger próprio, não provisão disfarçada

**Decisão.** `33_PASSIVOS` — aba interna, oculta, versionada, append-only,
mesma máquina de `FOS.Subledger` que já serve provisões e objetivos
(`correntes`, `correntesEm`, `novaVersao`). Nunca editada como workflow
normal: nasce de `NOVO_PASSIVO`, baixa por `AMORTIZACAO_PASSIVO`.

**Porquê.** PASSIVO = quanto devo; PROVISÃO = dinheiro reservado para uma
obrigação futura que não é esse passivo. São direções opostas do mesmo tipo
de relação (compromisso financeiro), e fundi-las inverteria o sinal de uma
das duas. `Liabilities.avaliar` é deliberadamente mais simples que
`Provisions.avaliar`: sem ritmo, sem histórico de fechamentos, sem meses
restantes — o MVP só precisa saber, por competência, quanto está em aberto e
se já venceu.

## 2. Duas verdades, dois donos — nunca fundidos

**Decisão.**

| Fato | Dono | Nasce de |
|---|---|---|
| Caixa que entrou/saiu do banco | `22_LEDGER` (`valor_origem`) | extrato importado, conciliado |
| Obrigação assumida e seu saldo | `33_PASSIVOS` (`valor_devido_original`/`valor_aberto`) | evento manual materializado |

`valor_devido_original` e o caixa recebido coincidem apenas quando o
empréstimo não tem desconto na origem. Divergem a partir do primeiro
empréstimo com juro retido — e é exatamente aí que ter dois donos, e não um,
evita que o sistema minta sobre um dos dois fatos para acomodar o outro.

## 3. `valor` × `valor_devido`: dois números no mesmo evento, dois papéis

**Decisão.** `NOVO_PASSIVO` carrega `valor` (o que o banco moveu — usado na
conciliação, exatamente como em todo evento conciliável já existente) e
`valor_devido` (a obrigação; quando vazio, assume `valor` — empréstimo sem
desconto). `expectativaConciliacao` usa exclusivamente `valor`: a
conciliação nunca soube, e continua não sabendo, quanto se deve — só quanto
se moveu.

**Custo aceito.** Duas colunas na aba 11 para um único tipo de evento, das
nove. `AMORTIZACAO_PASSIVO` não usa `valor_devido` — a baixa é 1:1 com o
caixa pago.

## 4. O custo retido na origem é sempre derivado, nunca lançado

**Decisão.** `custo = valor_devido_original − valor_recebido`. Calculado sob
demanda (`Liabilities.custoRetidoNaOrigem`), nunca armazenado como campo, e
**nunca uma linha do ledger**. Não há terceira movimentação porque nenhum
banco moveu esse dinheiro — inventar uma linha para os R$ 570 seria mentir
sobre o extrato.

**Como isso se garante estruturalmente, não só por convenção.** Toda linha
do ledger nasce de `Ledger.novaLinha`, que exige uma linha de staging — e
staging só existe por importação de extrato real. Não há caminho de código
que crie uma linha de ledger a partir de um número calculado; o custo retido
simplesmente não tem porta de entrada para virar movimentação.

## 5. `vencimento`: campo estruturado novo em `11_EVENTOS_MANUAIS`, condicional

**Decisão — o ponto em que a implementação parou e pediu decisão humana.**
`NOVO_PASSIVO` precisa de duas datas com papéis incompatíveis: `data` (a
movimentação bancária, usada na conciliação) e `vencimento` (quando a
obrigação vence). Nenhum campo existente serve: `data` já tem dono e
reusá-la quebraria a conciliação; `valor_origem_moeda`/`moeda_origem` já têm
dono (P&L de trading em GBP, `trading.js`); `observacao`/`descricao` são
texto livre, e `vencimento` alimenta invariante e status — extrair data de
texto livre é o tipo de fragilidade que todo o resto do domínio evita
(`FOS.Dates.isIso` valida toda data em todo lugar).

**Decisão aprovada.** Nona coluna, `vencimento`, formato ISO validado por
`FOS.Dates.isIso`, obrigatória só para `NOVO_PASSIVO` (`exigeVencimento` no
`SPEC`), inativa para os outros oito tipos, nunca usada na conciliação.

**Custo aceito.** O catálogo de campos da aba 11 cresce em duas colunas
(`vencimento` e `valor_devido`) para servir a um único tipo de evento entre
nove — mas evita todas as alternativas piores: sobrecarga de campo,
conciliação quebrada, ou parsing de texto livre.

## 6. `credor` reusa `observacao`, no mesmo precedente que já existe para `prioridade`

**Decisão.** `33_PASSIVOS.credor` vem de `evento.observacao`; `33_PASSIVOS.nome`
vem de `evento.descricao`. Nenhuma coluna nova para isso.

**Porquê é reuso, não invenção.** `NOVA_OBRIGACAO` já faz exatamente este
movimento — `prioridade: FOS.Config.parseNumber(evento.observacao) || 5` —
reaproveitando o campo livre do evento como um campo estruturado do
subledger de destino, para um tipo de evento específico. `credor` segue o
mesmo padrão, com uma diferença que baixa o risco: nunca é lido por cálculo
ou invariante, só exibido. Diferente de `vencimento`, isto não trava a
implementação — é o mesmo movimento que o código já fazia, uma vez a mais.

## 7. Dedução integral no disponível, nunca proporcional ao prazo

**Decisão.**

```
disponivel_brl = caixa_vida_brl − protecao − objetivos − passivos_abertos
```

`funcoesDoDinheiro` ganha um quarto termo, aditivo e independente dos outros
dois. `passivos_abertos` é a soma de `valor_aberto` de todo passivo vigente
na competência (`Subledger.correntesEm` + `Liabilities.totalAberto`) — zero
sem nenhum passivo, preservando o comportamento anterior byte a byte.

**Porquê integral.** O dinheiro emprestado não é seu em nenhuma fração,
mesmo que o vencimento seja daqui a três meses. `runway_meses` responde
"quanto tempo me sustento com o que é meu" — deduzir só a parcela "devida
este mês" superestimaria o runway, e entre subestimar e superestimar
dinheiro livre, o erro seguro é subestimar.

**Consequência aceita.** `funcoesDoDinheiro.livre` já tolerava ficar negativo
("pode ser negativo, e isso é informação, não erro") — passivo grande o
bastante empurra para lá, e nada quebra.

## 8. `patrimonio_brl_gerencial` não muda de significado

**Decisão.** Esse campo continua sendo, exatamente como sempre foi, o valor
de mercado das posições da aba 32. Passivo não entra nele.

**Porquê.** Mudar o que um campo *significa* numa série histórica já fechada
é pior do que criar um campo novo ao lado. Subtrair passivo dali redefiniria
silenciosamente "patrimônio gerencial" para "patrimônio líquido" — decisão
canônica maior, que este ADR delibera não tomar (item 9).

## 9. Patrimônio líquido não é criado

**Decisão.** Nenhuma soma nova combina caixa, posições e passivo num único
número. O sistema já reporta verdades separadas e deliberadamente não
somadas entre si (`trading.js` já registra essa decisão para as métricas de
trading); passivo entra no mesmo espírito: `vida.passivos_abertos_brl` e um
array `passivos` no snapshot, ao lado de `provisoes`/`objetivos` — nenhuma
soma cruzando universos.

**Por que isto evita infraestrutura especulativa.** Patrimônio líquido de
verdade exigiria decidir tratamento de capital de trading, câmbio e posição
sem snapshot — nenhuma dessas perguntas tem uma dívida real pressionando por
resposta agora. Construir a resposta antes da pergunta ser urgente é
exatamente o tipo de estrutura que este projeto evita.

## 10. Exclusão mútua passivo/provisão: garantida estruturalmente, não por checagem cruzada

**Decisão.** Passivo e provisão vivem em tabelas e ids independentes; nada
no código funde os dois, e cada um é deduzido do disponível uma única vez,
de forma aditiva. **Não existe verificação automática** de que a mesma
obrigação real não foi declarada como as duas coisas ao mesmo tempo.

**Porquê o limite é deliberado.** Detectar que "Empréstimo Sicoob" (passivo)
e "Reserva para o Sicoob" (provisão) são a mesma obrigação real exigiria
correlacionar texto livre ou pedir um vínculo explícito entre entidades —
nenhuma das duas coisas tem justificativa sem um caso real de duplicação
acontecendo. **Human Authority**: não duplicar a declaração da mesma dívida
é responsabilidade de quem declara, não do sistema, no MVP.

## 11. Amortização falha explícito, nunca silencioso

**Decisão.** Três guardas, em camadas diferentes: (a) `NOVO_PASSIVO` recusa
reusar o id de um passivo já existente (`PASSIVO_JA_EXISTE`) — nunca cria
uma segunda v1 nem uma versão silenciosa da primeira; (b)
`AMORTIZACAO_PASSIVO` recusa amortizar um passivo inexistente
(`PASSIVO_INEXISTENTE`) e recusa exceder o saldo aberto
(`AMORTIZACAO_EXCEDE_SALDO`) — em ambos os casos, nenhuma versão nova nasce;
(c) a invariante `PASSIVOS_SALDO_VALIDO` verifica `0 ≤ valor_aberto ≤
valor_devido_original` em toda linha na hora do fechamento, e bloqueia
(`EM_REVISAO`, nunca `FECHADO`) se algo escapou das guardas (a) e (b) — o
caminho que um juro capitalizado tomaria, se algum dia existir.

**Por que a invariante 2 existe mesmo com os portões do workflow.** Os
portões defendem a entrada; a invariante defende a saída. Sem ela, um dado
corrompido por qualquer via que não seja o workflow normal (nunca deveria
acontecer, mas a aba tecnicamente permite escrita direta) fecharia o mês em
silêncio com um número errado.

---

## Compatibilidade

Nenhum fechamento já fechado muda: o cálculo de `disponivel_brl` só ganha um
termo que é zero na ausência de qualquer linha em `33_PASSIVOS`, e nenhuma
competência anterior tem passivo algum. `patrimonio_brl_gerencial` e
`custo_vida_mes_brl`/`custo_vida_medio_brl` permanecem, byte a byte, com a
mesma fórmula de antes.
