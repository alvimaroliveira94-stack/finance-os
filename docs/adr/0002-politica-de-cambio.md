# ADR 0002 — Política de câmbio: a taxa pertence à competência

Status: aceito · Implantado em produção · Commit `6f85074` · Data: 2026-09

Estende o ADR 0001 #8 (provedor de taxa abstrato), #19 (cache na aba 00) e #23
(fechamento offline). Aqui está registrada a **política** que aqueles três
mecanismos passaram a servir.

Diferente do ADR 0001, este documento registra uma decisão **financeira**,
aprovada explicitamente pelo usuário em nove itens. O código a implementa como
está; alterá-la exige nova aprovação, não refatoração.

---

## 1. A taxa pertence à competência, não ao dia do fechamento

**Decisão.** A taxa GBP→BRL de um mês é resolvida na **data de referência** da
competência — o último dia calendário do mês —, não na data em que o usuário
executa o fechamento. `montarContexto` resolve em `competenciaRange(comp).fim`,
e a chave de cache é sempre `BRL/GBP@AAAA-MM-DD` com essa data.

**Porquê.** Fechar 2026-01 no dia 5 ou no dia 20 de fevereiro tem de produzir o
mesmo número. Amarrar a taxa ao dia da execução tornaria o fechamento não
determinístico e a reapresentação irreprodutível.

**Consequência.** Cada fechamento precisa de **duas** taxas: a da competência,
para converter o patrimônio, e a da competência anterior, para separar o efeito
cambial do resultado operacional. Sem a segunda o mês fecha, mas o efeito
cambial fica `null` com motivo — e o diagnóstico avisa.

## 2. Duas datas gravadas: referência e cotação efetiva

**Decisão.** Quem publica informa a taxa **e o dia da cotação que usou**. O
sistema materializa o valor sob a data de referência e guarda a data efetiva
separadamente, em `data_cotacao`. As duas aparecem na aba 00, no log de
auditoria e no snapshot de fechamento (`cambio.data_taxa` e
`cambio.data_cotacao`).

**Porquê.** A política aprovada manda usar a PTAX do último dia útil anterior
quando não há cotação na data de referência. Guardar só o valor perderia a
justificativa; guardar só a data da cotação quebraria a chave da competência.
Com as duas, a reapresentação reproduz a decisão original e a auditoria mostra
qual cotação foi aplicada e por quê.

**Custo aceito.** Uma coluna a mais no schema da aba 00 (`data_cotacao`),
acrescentada de forma idempotente por "Preparar planilha". O workflow recusa
gravar antes da migração (`ESTRUTURA_DESATUALIZADA`) em vez de perder a data em
silêncio.

## 3. `Fx.resolver` continua estrito: sem fallback por calendário

**Decisão.** O resolver exige a taxa na data exata. Não existe — e não deve
existir — busca pela "cotação mais recente até a data".

**Porquê.** Esta é a decisão mais fácil de reverter por engano, e a mais cara.
O domínio não conhece feriado bancário nem calendário brasileiro; qualquer
fallback seria adivinhação, exatamente o chute silencioso que a arquitetura
inteira proíbe (ADR 0001 #12). A regra do "último dia útil anterior" é cumprida
por **decisão humana registrada** no ato da publicação, não por heurística de
código.

**Alternativa descartada.** Fallback no resolver com janela máxima. Cumpriria a
política automaticamente, mas exigiria calendário de feriados no domínio e
tornaria indistinguíveis "dia sem PTAX" e "taxa que ninguém publicou".

**Reversível?** Em tese sim, mas só com nova aprovação: mudaria o resultado de
reapresentações de meses já fechados.

## 4. Cache versionado, append-only, maior versão vence

**Decisão.** Corrigir uma taxa publica uma linha de **versão maior**, sem apagar
a anterior. A versão vigente de cada chave é a de maior número — nunca a última
linha lida. Uma linha `BLOQUEADO` de versão maior despublica a anterior.

**Porquê.** A ordem física das linhas de uma aba não pode alterar o resultado de
um fechamento. O primeiro desenho resolvia duplicata por "última linha vence", o
que tornava o cálculo dependente de como a planilha estava ordenada.

**Custo aceito.** A aba 00 acumula uma linha por correção. É o mesmo trade-off
do ledger append-only (ADR 0001 #4).

## 5. Competência fechada é protegida

**Decisão.** Publicar taxa para uma competência já fechada é recusado
(`PERIODO_FECHADO`). Corrigir exige sinalização explícita mais um motivo
registrado, e só passa a valer quando a competência for reapresentada.

**Porquê.** O snapshot gravado é imutável e guarda a taxa da época; reprocessar
tem de reproduzi-la. Sem a guarda, uma correção de taxa mudaria silenciosamente
o resultado de um restatement futuro.

## 6. Publicar taxa nunca toca a rede

**Decisão.** O workflow de publicação manual não conhece `UrlFetchApp`, mesmo
com `POLITICA_TAXA_CAMBIO = HTTP` configurada.

**Porquê.** Reforça o ADR 0001 #23 no caminho de escrita: o fechamento já era
offline na leitura, e agora a entrada da taxa também é. Há teste que injeta um
`urlFetchApp` que lança se chamado.
