# ADR 0005 — Fila de revisão como protocolo de decisão

Status: aceito · Implantado em produção · Commits `0ea55c8`, `29f7ef5` · Data: 2026-09

Estende o ADR 0001 #16 (falta de candidato não vira item de fila) e #17 (linha
sem regra entra no ledger na resolução). Aqueles definiram **o que entra** na
fila; este define **como se sai** dela.

Decisão de domínio e de workflow. A decisão de interface que a acompanha — quais
abas ficam visíveis — está no ADR 0006, e as duas podem evoluir
independentemente.

---

## Contexto

`21_FILA_REVISAO` é onde toda ambiguidade para. Um item aberto viola a
invariante `FILA_REVISAO_VAZIA`: **enquanto houver item aberto, o mês não
fecha.**

O comando "Revisar pendências" tratava todo item como se fosse de classificação:
mandava sempre `decisao: 'CLASSIFICAR'` e usava `item.referencia` como
fingerprint de linha. Num item de origem `CONCILIACAO` a referência é um
`evento_id`, não um fingerprint — a resolução falhava com `LINHA_INEXISTENTE`, o
item continuava aberto, e o mês não fechava. Reproduzido em teste antes da
correção.

---

## 1. A fila não é superfície de operação

**Decisão.** A aba 21 não é ponto de entrada. Não está no submenu "Abrir
entrada", e `Bootstrap.abrirEntrada` recusa explicitamente qualquer aba fora das
três de digitação. O usuário resolve pendências **apenas** pelo comando.

**Porquê.** A fila é um protocolo de trabalho pendente, não uma tabela para
editar. Resolver na mão significaria escrever `status = RESOLVIDO` numa célula
sem passar por `resolverItemFila` — sem versão no ledger, sem log de auditoria,
sem proteção de período fechado. O item pareceria resolvido e não teria efeito
nenhum.

**Custo aceito.** Não há visão panorâmica da fila: os itens são vistos um por
vez, no diálogo. Em compensação, todo caminho de resolução é auditado.

## 2. A decisão exigida depende da origem do item

**Decisão.** `Queue.decisaoPendente(item, contexto)` traduz o item na pergunta
que a origem exige, e devolve **estrutura, não texto** — quem monta o diálogo é
o ponto de entrada:

| Origem | Pergunta | Decisão |
|---|---|---|
| `CLASSIFICACAO` | qual categoria canônica? | `CLASSIFICAR` |
| `CONCILIACAO` | qual das movimentações candidatas casa com o evento? | `CONCILIAR` |

**Porquê.** São perguntas diferentes sobre objetos diferentes. Perguntar
categoria diante de uma ambiguidade de conciliação é a pergunta errada — e foi
exatamente o defeito.

**Consequência.** A regra fica testável sem simular planilha, e o comando de
menu não pode fixar a decisão: ela vem da resposta.

## 3. `evento_id` jamais substitui `fingerprint`

**Decisão.** Em item de conciliação, o fingerprint sai **sempre** da candidata
escolhida pelo usuário. `Queue.interpretarResposta` nunca devolve
`pendente.referencia` como fingerprint.

**Porquê.** É o defeito original, escrito como regra para não voltar. As
candidatas são apresentadas numeradas, com data, valor e descrição — esta última
buscada no ledger na hora de perguntar, já que a candidata gravada guarda apenas
fingerprint, data e valor. Sem descrição, escolher entre duas linhas de mesmo
valor seria adivinhação.

## 4. `DESCARTAR` é decisão explícita

**Decisão.** Arquivar um item sem aplicar nada é uma das três decisões de
primeira classe (`CLASSIFICAR`, `CONCILIAR`, `DESCARTAR`), oferecida em todo
item e registrada na auditoria com o ator.

**Porquê.** Sem ela, um item que não deve gerar efeito nenhum não teria saída — e
travaria o fechamento indefinidamente. Descartar não escreve no ledger.

## 5. Cancelar não resolve

**Decisão.** Cancelar o diálogo encerra a revisão de forma limpa, mantendo o item
`ABERTO`. Resposta inválida ou vazia também não resolve: aparece no resumo final
como não aplicada, com o motivo, e o item segue aberto.

**Porquê.** Sair de uma decisão não pode equivaler a tomá-la. E o resumo final —
resolvidos, descartados, ainda abertos — é o que impede que uma resposta
recusada passe despercebida.

## 6. Correção posterior é caminho separado da fila

**Decisão.** "Reclassificar movimentação" acrescenta uma nova versão gerencial ao
ledger e **nunca** reabre, edita ou apaga item já resolvido da fila.

**Porquê.** A fila registra a decisão tomada com a informação disponível
**naquele momento**. Um esclarecimento posterior — "aquele crédito era resgate
de poupança, não custo de vida" — é fato novo, não erro da decisão original.
Reabrir o item reescreveria a história; a versão nova do ledger a preserva
(ADR 0001 #4).

**Consequência.** Dois caminhos que nunca se cruzam: a fila decide o que ainda
não foi decidido; a reclassificação corrige o que já foi. Ambos recusam
competência fechada, que só muda por reapresentação.
