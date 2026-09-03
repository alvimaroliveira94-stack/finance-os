# ADR 0008 — Passivo mínimo canônico: quanto devo é verdade de primeira classe

Status: aceito · Parcialmente implantado em produção (`NOVO_PASSIVO` ativo,
`33_PASSIVOS` já contém `PAS-0001`) · Itens 13 (`SALDO_INICIAL_PASSIVO` /
`CORRECAO_PASSIVO`) construídos e testados, ainda não usados em produção ·
Data: 2026-09

Estende o ADR 0001 (categorias e universos são decisão do usuário, não deste
documento) e reusa a máquina de versionamento que o ADR 0001 já estabeleceu
para 30_PROVISOES/31_OBJETIVOS (`FOS.Subledger`), sem criar uma segunda.

---

## Contexto

Um empréstimo real ficou aberto na data de um fechamento: o caixa recebido
foi menor que a obrigação assumida — a diferença é juro descontado na
origem. Até este ADR, o Finance OS não tinha nenhuma entidade
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
banco moveu esse dinheiro — inventar uma linha para o custo retido seria
mentir sobre o extrato.

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

## 6. `credor`: campo estruturado próprio, não reuso de `observacao`

**Decisão revisada.** `33_PASSIVOS.credor` vem de uma décima coluna
estruturada em `11_EVENTOS_MANUAIS`, `credor`, obrigatória só para
`NOVO_PASSIVO` (`exigeCredor` no `SPEC`). `33_PASSIVOS.nome` continua vindo
de `evento.descricao`, e `33_PASSIVOS.observacao` passa a vir de
`evento.observacao` — as duas colunas de `33_PASSIVOS` deixam de competir
por um único campo de origem.

**A decisão original desta seção foi implementada e revertida no mesmo
commit em que este ADR nasceu.** A primeira versão reaproveitava
`evento.observacao` para `credor`, no mesmo padrão que `NOVA_OBRIGACAO` já
usa para `prioridade` (`workflows.js`:
`FOS.Config.parseNumber(evento.observacao) || 5`). Uma auditoria read-only
pediu antes do deploy mostrou por que o paralelo não se sustenta: em
`NOVA_OBRIGACAO`, `observacao` não tem concorrente — é o único dado extra
que uma provisão leva. Em `NOVO_PASSIVO`, a arquitetura aprovada já
reservava **duas** colunas de destino (`credor` e `observacao`) para o
mesmo `33_PASSIVOS`, mas só havia **um** campo livre de origem
(`evento.observacao`). A cópia era integral, sem parsing — `credor`
chegava correto — mas `evento.observacao` só podia servir a um dos dois
destinos por vez, e `33_PASSIVOS.observacao` ficava permanentemente vazio:
nenhuma linha de código, em nenhum dos dois branches de materialização,
jamais escrevia nele. Duas verdades que a arquitetura queria lado a lado
(quem é o credor; que anotações existem sobre o empréstimo) competiam pelo
mesmo campo, e uma delas perdia sempre — violação de Single Truth
Ownership, mesmo sem duplicação nem corrupção de dado.

**Por que uma coluna nova, e não outro reuso.** Nenhum campo remanescente
de `11_EVENTOS_MANUAIS` estava livre e sem concorrência: `descricao` já vira
`nome`; `valor_origem_moeda`/`moeda_origem` já têm dono no P&L de trading em
GBP (item 5); `observacao` acabara de se mostrar concorrido. `credor` é a
única informação nova, estruturada e de leitura simples (nunca parseada,
nunca usada em cálculo ou invariante) — exatamente o perfil de campo que
merece coluna própria, no mesmo padrão condicional que `vencimento` e
`valor_devido` já seguem: existe para todos os nove tipos de evento, é
exigido e lido só por um.

**Custo aceito.** Mais uma coluna na aba 11 — a terceira que este ADR
acrescenta (depois de `vencimento` e `valor_devido`), para um único tipo de
evento entre nove. Aceito pela mesma razão do item 5: a alternativa (reuso
com concorrência) já se provou, na prática, gerar uma coluna morta em
`33_PASSIVOS` e um limite real de expressividade, não uma economia de fato.

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

## 12. Ownership: o passivo só materializa depois da prova bancária

**Decisão revisada.** Uma auditoria de rollout contra a planilha de
produção (antes do primeiro `NOVO_PASSIVO` real) encontrou que
`materializarEventos()` criava/versionava `33_PASSIVOS` a partir só da
validação de forma do evento (`FOS.Events.validar`), sem checar se o
crédito ou débito correspondente já existia, conciliado, em `22_LEDGER`.
Um evento com dado errado, ou uma conciliação ainda ambígua/sem candidato,
produzia um passivo canônico — já deduzido do disponível — sem nenhuma
prova de que o dinheiro se moveu. Corrigido: os três papéis são agora
explícitos e nunca se confundem —

| Papel | Dono | O que prova |
|---|---|---|
| Movimento bancário | `22_LEDGER` | O caixa que entrou/saiu, pelo extrato importado |
| Vínculo | Evento manual (`11_EVENTOS_MANUAIS`) | A intenção humana de ligar um movimento a uma obrigação — declaração, não prova |
| Obrigação | `33_PASSIVOS` | Só nasce/muda depois que o vínculo tem prova: uma linha corrente do ledger com `evento_conciliado_id` igual ao `evento_id` |

Quarta guarda, no mesmo espírito das três do item 11 — mas na *entrada*,
não na saída: `NOVO_PASSIVO` e `AMORTIZACAO_PASSIVO` recusam materializar
(`PASSIVO_SEM_CONCILIACAO` / `AMORTIZACAO_SEM_CONCILIACAO`) enquanto não
existir, na visão corrente de `22_LEDGER`, uma linha conciliada com o
`evento_id`. Sem candidato, com candidato ambíguo, ou com dado do evento
que nunca vai casar com o extrato: zero linhas em `33_PASSIVOS`, sempre —
nunca parcial, nunca silencioso. Como nada é criado nesses casos, rodar o
comando de novo depois que a conciliação for resolvida materializa
normalmente, sem jamais esbarrar em `PASSIVO_JA_EXISTE`.

**Onde isso muda o workflow, e por que só ali.** `fosRegistrarEvento`
("Registrar evento") passa a chamar `conciliarEventos()` antes de
`materializarEventos()` — a ordem inversa da usada até aqui — para que um
crédito/débito que já está no ledger no momento do comando materialize no
mesmo clique, sem exigir uma segunda execução. Essa inversão é local a
este ponto de entrada, não uma regra geral: `conciliarEventos()` nunca
escreve em `30_PROVISOES`/`31_OBJETIVOS`/`32_LEDGER_POSICOES`/`33_PASSIVOS`,
e `materializarEventos()` nunca escreve em `22_LEDGER`/`21_FILA_REVISAO` —
os dois não competem por nenhuma aba em comum, e nenhum dos outros sete
tipos de evento manual depende de qual das duas funções roda primeiro.
`fosImportarExtrato` já chamava as duas nesta mesma ordem.

**Custo aceito.** O caso comum (extrato já importado e conciliável sem
ambiguidade) continua em um clique. O caso em que a conciliação ainda não
tem candidato — extrato do mês ainda não chegou, ou ambiguidade pendente
na fila — passa a exigir rodar "Registrar evento" de novo depois de
resolvida; antes desta correção, esse mesmo caso silenciosamente já criava
o passivo, o que era exatamente o problema, não uma conveniência a
preservar.

## 13. Passivo brownfield: dívida pré-existente entra sem inventar movimento bancário

**Contexto.** O portão do item 12 criou um problema novo, real, para as
dívidas que já existiam quando o Finance OS começou a operar: elas nunca
vão ter um crédito bancário no sistema para conciliar — o empréstimo
nasceu antes dos livros abrirem. Usar `NOVO_PASSIVO` para declará-las
inventaria um nascimento (e um caixa) que nunca aconteceu no período
observado; classificar as parcelas pagas depois da abertura como
`CUSTO_VIDA` misturaria amortização de principal com consumo.

**Decisão — dois tipos novos, o catálogo passa de nove para onze.**

### `SALDO_INICIAL_PASSIVO`

Cria a v1 de um passivo em `33_PASSIVOS` **sem nenhuma conciliação e sem
tocar `22_LEDGER`** — `concilia: false` no SPEC, o mesmo mecanismo que já
isola `NOVA_OBRIGACAO`/`NOVO_OBJETIVO` do portão de prova bancária.
`referencia_id` é o `passivo_id`; `credor`, `vencimento`, `moeda`,
`descricao` seguem a semântica de `NOVO_PASSIVO`; `valor_devido` fica
vazio. A guarda `PASSIVO_JA_EXISTE`, já usada por `NOVO_PASSIVO`, é
reaplicada aqui tal como está — um `passivo_id` nasce uma vez, não importa
por qual dos dois caminhos.

**Fronteira temporal, obrigatória e sem bypass.** `evento.data` não pode
ser posterior ao fim de `COMPETENCIA_INICIAL_CAIXA_VIDA`
(`SALDO_INICIAL_FORA_DA_ABERTURA`); se o parâmetro estiver indisponível
(bloqueado ou nunca semeado), a validação falha fechada
(`COMPETENCIA_INICIAL_INDISPONIVEL`) — nunca aberta. Sem essa fronteira,
`SALDO_INICIAL_PASSIVO` seria um segundo caminho, sempre disponível, para
declarar qualquer dívida sem prova bancária — desfazendo exatamente o
portão que o item 12 construiu. `vigente_desde` é `evento.data`, a data de
abertura declarada — não a data de materialização.

**O significado de `valor` é diferente do de `NOVO_PASSIVO`, e é
deliberado.** É o **saldo total ainda a desembolsar** na data de abertura
— nunca o valor originalmente contratado. `valor_devido_original` e
`valor_aberto` nascem os dois iguais a `evento.valor`. Consequência aceita:
`valor_amortizado` (derivado, `original − aberto`) começa em zero e só
cresce com o que o sistema observa depois da abertura — nunca finge saber
quanto já foi pago antes de existir. **Não há reconstrução histórica de
nenhum tipo**: nenhuma parcela paga antes da abertura é lançada, estimada
ou inferida; o saldo declarado já é o resultado líquido delas, do mesmo
jeito que `SALDO_INICIAL_CAIXA_VIDA_BRL` já é o resultado de toda a vida
financeira anterior sem uma única linha de ledger reconstruída.

### `CORRECAO_PASSIVO`

Nunca um evento financeiro: `concilia: false`, não escreve em `22_LEDGER`,
não move caixa. Gera nova versão do passivo referenciado pelo mecanismo
já existente (`FOS.Subledger.novaVersao`) alterando **somente**
`valor_aberto` — `valor_devido_original`, `nome`, `credor`, `vencimento`,
`moeda` seguem intocados porque `novaVersao` só sobrescreve as chaves
explicitamente passadas. `valor` é o **novo saldo absoluto**, não um
delta — por isso `0` é aceito (quitação por correção) e é o único tipo do
catálogo com essa permissão. Guardas: `PASSIVO_INEXISTENTE` se a
referência não existir; `CORRECAO_ACIMA_DO_ORIGINAL` se o valor exceder
`valor_devido_original` (a mesma disciplina de `PASSIVOS_SALDO_VALIDO` —
saldo nunca cresce sozinho — aplicada na entrada, não só na saída);
`OBSERVACAO_OBRIGATORIA` se a observação vier vazia, porque uma correção
administrativa sem motivo registrado é tão silenciosa quanto o defeito que
motivou este tipo a existir. Diferente de `AMORTIZACAO_PASSIVO`, a
`observacao` do evento **é** copiada para a versão nova do passivo — é o
motivo da correção, e existe para ficar visível na linha corrente, não
só no log de auditoria.

**O que este tipo não é.** Não é um editor genérico de passivo: não altera
`credor`, `vencimento`, `moeda` nem `valor_devido_original` — quem precisar
mudar esses dados de um passivo já criado enfrenta uma decisão estrutural
nova, fora do escopo deste ADR, do mesmo jeito que o item 12 já deixou
"reordenar/remover coluna existente" fora do escopo do ADR 0009.

### A regra de amortização do item 11/12 não muda para dívida brownfield

Uma parcela paga depois da abertura (`AMORTIZACAO_PASSIVO`) continua
exigindo débito conciliado, do mesmo jeito, não importa se o passivo
nasceu de `NOVO_PASSIVO` ou de `SALDO_INICIAL_PASSIVO` — o portão do item
12 é sobre a origem do saldo, não sobre a origem do passivo. Classificar
uma movimentação como `MOVIMENTACAO_COM_TERCEIRO` na fila **não** amortiza
passivo algum sozinha: só o evento `AMORTIZACAO_PASSIVO`, materializado e
conciliado, reduz `valor_aberto`. Nenhuma inferência automática de parcela
foi criada.

**Custo aceito.** Sem separação entre principal e juros: uma parcela abate
1:1 o saldo aberto, que já significa "total ainda a desembolsar", não
principal contábil. O sistema nunca reporta quanto de uma parcela é juro —
não tinha esse dado antes desta extensão, e continua sem tê-lo.

**Limite documentado, não resolvido.** `00_CONFIG_PARAMETROS` guarda uma
cópia documental do catálogo de `TIPO_EVENTO` (seção `ENUM`), semeada só
quando a aba está vazia. Numa planilha de produção já semeada com nove
tipos, essa cópia fica desatualizada depois deste ADR. Isso é cosmético,
não funcional: nenhum código de runtime lê `config.enums` — o dropdown da
aba 11 e toda validação vêm de `FOS.Events.SPEC`, a única fonte de
verdade. Reescrever esse enum documental exigiria um mecanismo de
re-seed que hoje não existe e que nenhum caso real pede — infraestrutura
que este ADR delibera não construir agora.

---

## Compatibilidade

Nenhum fechamento já fechado muda: o cálculo de `disponivel_brl` só ganha um
termo que é zero na ausência de qualquer linha em `33_PASSIVOS`, e nenhuma
competência anterior tem passivo algum. `patrimonio_brl_gerencial` e
`custo_vida_mes_brl`/`custo_vida_medio_brl` permanecem, byte a byte, com a
mesma fórmula de antes.
