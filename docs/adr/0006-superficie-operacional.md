# ADR 0006 — Superfície operacional de quatro abas

Status: aceito · Implantado em produção · Commit `0ea55c8` · Data: 2026-09

Estende o ADR 0001 #15 (abas visíveis como projeção regenerável). Decisão de
produto e interface. A decisão de domínio que a viabilizou — abstrair a fila de
revisão — está no ADR 0005, e as duas podem evoluir e ser superseded
independentemente.

---

## Contexto

O workbook tem 17 abas: quatro de leitura e treze internas. Até esta mudança,
quatro internas ficavam visíveis (`00`, `11`, `12`, `21`) porque eram operadas no
dia a dia — o que significava oito abas na barra, metade delas com nomes de
motor.

Critério que resolveu a classificação: **quem escreve**. `11` e `12` são as duas
únicas abas do workbook que o sistema nunca escreve — entrada humana pura. `00`
é setup raro. `21` é projeção de trabalho pendente. As outras nove são motor.

---

## 1. A superfície permanente são quatro abas

**Decisão.** Ficam visíveis apenas HOME, MOVIMENTAÇÕES, PLANEJAMENTO e
PATRIMÔNIO. As treze abas internas ficam ocultas.

**Porquê.** As quatro são projeções de leitura e cobrem todo o consumo de
informação. Toda escrita passa por comando de menu, que audita; nenhuma das
quatro aceita entrada. Manter abas de motor visíveis convida à edição manual —
o caminho que o sistema inteiro foi desenhado para evitar.

## 2. Ocultar é comportamento de interface, não de acesso

**Decisão.** Ocultar não restringe nada tecnicamente: o Apps Script lê e escreve
aba oculta normalmente, e nenhum módulo depende de visibilidade.

**Porquê.** Precisa ficar registrado porque a leitura intuitiva é a oposta
("oculto = inacessível"), e alguém poderia reexibir abas achando que corrige um
problema de acesso. Há teste fechando uma competência inteira com as treze abas
ocultas.

**Consequência.** Manutenção continua possível: o dono reexibe qualquer aba pelo
menu do Sheets quando quiser inspecionar o motor.

## 3. As três abas de entrada têm porta no menu

**Decisão.** O submenu **Abrir entrada** dá acesso a `11_EVENTOS_MANUAIS`,
`12_SALDOS_TRADING_SEMANAL` e `00_CONFIG_PARAMETROS`. Cada comando reexibe e
ativa a aba, e **não lê nem escreve dado nenhum** — o adaptador ganhou
`ativarAba` só para isso.

**Porquê.** Sem essa porta, "quatro abas visíveis" empurraria o usuário para
*Exibir → Abas ocultas* toda vez que precisasse declarar um evento ou lançar
saldos semanais. A superfície ficaria limpa e a operação, pior.

**Por que só estas três.** São as de digitação (ADR 0004 #4). `21_FILA_REVISAO`
fica deliberadamente de fora — `abrirEntrada` recusa qualquer aba fora da lista,
e o porquê está no ADR 0005 #1.

## 4. "Preparar planilha" e "Atualizar abas" restauram a superfície canônica

**Decisão.** `Bootstrap.restaurarSuperficie` devolve o estado limpo — as quatro
visíveis, o resto oculto — e é chamado pelos dois comandos. É idempotente e mexe
só em visibilidade.

**Porquê.** Abrir uma aba de entrada é temporário por natureza. Sem restauração,
a superfície degradaria a cada uso até voltar ao estado anterior, e o usuário
teria de ocultar abas à mão.

**Custo aceito.** Rodar "Atualizar abas" enquanto uma aba de entrada está aberta
a oculta. O dado permanece intacto — há teste —, mas é preciso reabrir pelo
menu. O parâmetro `restaurar: false` existe caso esse comportamento precise ser
desligado.

## 5. O sistema não apaga aba que não criou

**Decisão.** Nenhum comando remove abas fora das 17 canônicas. Em particular, a
`Página1` que o Google Sheets cria por padrão é ignorada: não é lida, não é
oculta, não é apagada.

**Porquê.** Apagar aba é irreversível pelo caminho normal e pode destruir dado
que o sistema desconhece. Ignorar é a única postura segura para conteúdo de
terceiro dentro do workbook.

**Consequência.** Se `Página1` existir, ela aparece como quinta aba visível. É
esperado, e a remoção é decisão manual do dono.

---

## Nota sobre a organização do menu

O menu foi reordenado por ritmo de uso — fluxo mensal em cima, leitura no meio,
correção e manutenção embaixo. A **ordem** não é registrada aqui de propósito:
é produto e deve continuar livre para mudar no acabamento visual. O que está
registrado é o que a ordem não pode violar: as decisões 3 e 4 acima.
