# Finance OS

Sistema financeiro pessoal com **fonte única no Google Sheets** e motor em **Google Apps Script**,
com harness local em Node para testar todo o domínio fora do Google.

Onda atual: **experiência completa do V1** — núcleo funcional, fluxos operacionais fechados,
quatro abas visíveis populadas e dashboard HTML somente leitura.

---

## Princípios que o código respeita

1. **Fonte única.** A verdade mora na planilha. O Apps Script lê, classifica, concilia e congela.
2. **Pipeline unidirecional.** Extrato e eventos entram, ledger canônico se forma, fechamento congela, dashboard só lê.
3. **Nunca adivinhar.** Ambiguidade, baixa confiança ou dado faltando vão para a fila de revisão ou viram `null` com motivo. Nunca zero, nunca chute.
4. **Append-only onde importa.** Ledger, posições e fechamentos não sofrem update destrutivo: correção é nova versão ou evento compensatório.
5. **Nenhuma ação financeira autônoma.** O sistema não conecta conta, não move dinheiro, não emite ordem. "Ações" no fechamento são sugestões de leitura, marcadas como não executáveis.
6. **Firewall entre universos.** Vida, Trading e Patrimônio são separados; só a fronteira Wise → Inter é reconhecida.

---

## Arquitetura

```
Google Sheets (fonte única)
        |
        v
Adaptadores  (SpreadsheetApp / DriveApp / UrlFetchApp / relógio)  -- src/adapters
        |
        v
Workflows    (orquestração e escrita, com log de auditoria)       -- src/app
        |
        v
Domínio puro (regras, sem nenhuma API do Google)                  -- src/domain
        |
        v
View-model allowlisted  ->  abas visíveis (Sheets) e painel HTML  -- src/ui
```

O painel e as abas visíveis são **projeção**: podem ser apagados e regerados
sem perda, porque a verdade está nas abas internas.

O domínio é **puro por contrato** e há teste automatizado que falha se algum arquivo de
`src/domain` referenciar `SpreadsheetApp`, `DriveApp`, `UrlFetchApp`, `new Date()` ou `Math.random()`.
É isso que permite rodar 100% das regras no Node.

### Abas

**Visíveis (leitura e entrada humana):** `HOME`, `MOVIMENTAÇÕES`, `PLANEJAMENTO`, `PATRIMÔNIO`.

**Estruturas internas (motor):**

| Aba | Responsabilidade |
|---|---|
| `00_CONFIG_PARAMETROS` | Parâmetros, catálogo de contas e enums. Parâmetro bloqueado devolve `null` + `reason`. |
| `10_IMPORT_EXTRATO` | Staging atômico de CSV/OFX, só para contas pessoais elegíveis. |
| `11_EVENTOS_MANUAIS` | Os sete tipos de evento declarados pelo usuário. `tipo_evento`, `moeda` e `status` têm lista fechada; um valor fora do catálogo é recusado com motivo, nunca ignorado. |
| `12_SALDOS_TRADING_SEMANAL` | Somente saldos semanais do ecossistema de trading. |
| `20_REGRAS_CLASSIFICACAO` | Regras determinísticas versionadas. |
| `21_FILA_REVISAO` | Toda ambiguidade e baixa confiança. |
| `22_LEDGER_CANONICO_MOVIMENTACOES` | Ledger append-only: origem imutável, campos gerenciais versionados. |
| `30_PROVISOES` | Subledger versionado de obrigações futuras. |
| `31_OBJETIVOS` | Subledger versionado de metas de patrimônio. |
| `32_LEDGER_POSICOES` | Event sourcing de posições (APORTE, RETIRADA, DISTRIBUICAO, SNAPSHOT_VALOR_MERCADO). |
| `40_FECHAMENTOS` | Fechamento mensal materializado e imutável, com snapshot completo e checksum. |
| `41_RESTATEMENTS` | Reapresentações: nova versão, nunca sobrescrita. |
| `90_LOG_AUDITORIA` | Antes e depois de toda ação relevante. |

### Universos e firewall

| Conta (sintética) | Universo | Ingestão | Moeda | Estado |
|---|---|---|---|---|
| `INTER_CC` | Vida | Importação mensal | BRL | ativa, elegível |
| `NUBANK` | Vida | Importação mensal | BRL | inativa |
| `BETFAIR` | Trading | Saldo semanal | GBP | ativa |
| `NETELLER` | Trading | Saldo semanal | GBP | ativa |
| `WISE` | Trading | Saldo semanal | GBP | ativa |
| `RESERVA_BANCA_BRL` | Trading | Saldo semanal | BRL | ativa |

- Conta de trading **nunca** entra em importação transacional: dela só entram saldos semanais.
- Única travessia controlada: **Wise → Inter**. Movimentos internos entre Betfair/Neteller/Wise não são controlados.
- Custo operacional de trading pago pela conta de vida é `CUSTO_TRADING` — custo, nunca aporte de capital.

### Classificação e conciliação

- Categorias canônicas: `CUSTO_VIDA`, `CUSTO_TRADING`, `SAQUE_TRADING`, `GASTO_EXTRAORDINARIO`, `APORTE_EXTRAORDINARIO`, `TRANSFERENCIA_INTERNA`, `PATRIMONIO_OBJETIVOS`.
- Fingerprint: `hash(data + valor + descricao_normalizada + conta + ordinal_ocorrencia_no_arquivo)`.
  Reimportar o mesmo arquivo gera **zero** linhas novas; duas transações legítimas idênticas
  recebem ordinais diferentes e continuam distintas.
- Conciliação: valor exato + conta compatível + janela de ±3 dias (parâmetro). Ambiguidade vai para a fila.

### Trading: quatro métricas independentes

Não existe número líquido misturando moedas.

1. **Caixa retirado (BRL)** — créditos `SAQUE_TRADING` no ledger.
2. **P&L operacional (GBP)** — `capital_final − capital_inicial + saques − aportes extraordinários`.
3. **Resultado da reserva (BRL)** — `saldo_final − saldo_inicial + retiradas − aportes`.
4. **Custo operacional (BRL)** — soma de `CUSTO_TRADING`.

Conversão gerencial usa provedor de taxa abstrato (PTAX é a implementação prevista).
**Sem taxa para a data exata, não há conversão e o fechamento é bloqueado.** O efeito
cambial é reportado separadamente do resultado operacional.

### Estado do ciclo

Estado sugerido é contínuo; o avanço formal só ocorre após **2 fechamentos consecutivos**
sustentando o estado superior; a regressão ocorre no **primeiro** fechamento que confirma a deterioração.

### Fechamento

`ABERTO → EM_REVISAO → FECHADO`. Antes de fechar, valida fila de revisão, conciliações,
taxa de câmbio, snapshots de posição, provisões/objetivos versionados, invariantes e checksum.
O snapshot congela saldos e posições de Trading, as quatro métricas, taxa e efeito cambial,
custos, disponível e runway, funções do dinheiro, provisões e objetivos, patrimônio por moeda
e em BRL gerencial, qualidade, estado, os sete sinais, ações sugeridas e metadados.
Correção posterior é **restatement** (nova versão), nunca update.

### Provisões

`valor_faltante <= 0` → **COBERTA**. Vencida e descoberta → **EM_RISCO**. Menos de 2 fechamentos →
**DADO_INSUFICIENTE**. Caso contrário, compara o ritmo observado nos 2 últimos fechamentos com o
ritmo necessário → **EM_RITMO** ou **FORA_DE_RITMO**.
Desempate de alocação: vencimento mais próximo → prioridade explícita → rateio proporcional.

### Ciclo de 90 dias: sete sinais binários

Sem score, sem índice composto. Cada sinal é `true`, `false` ou `DADO_INSUFICIENTE`:
redução de proteção, gasto extraordinário anormal, Vida→Trading, reserva fora da finalidade,
queda de runway, compromisso sem provisão, retirada/redução alocativa após mês forte
(este exige 3 fechamentos anteriores).
Limite reversível de gasto extraordinário: **30% do caixa de vida vigente** (parâmetro em `00`).

### Superfícies de leitura

As quatro abas visíveis são geradas idempotentemente pelo Apps Script a partir do
fechamento vigente — nunca são uma segunda fonte de verdade.

| Aba | O que mostra |
|---|---|
| `HOME` | Estado formal e sugerido, qualidade e frescor, dinheiro e runway, funções do dinheiro, as quatro métricas de trading separadas por moeda, os sete sinais, as três ações que exigem decisão e os bloqueios. |
| `MOVIMENTAÇÕES` | Visão mediada do ledger. Colunas de origem protegidas; categoria muda só pela fila de revisão e só em competência aberta. |
| `PLANEJAMENTO` | Custo de vida, provisões e objetivos versionados com ritmo observado e necessário. |
| `PATRIMÔNIO` | Posições, totais por moeda, patrimônio gerencial e o capital de Trading em bloco separado. |

**Essas quatro são as únicas abas permanentemente visíveis.** As treze internas ficam
ocultas: são motor, não interface. Ocultar é cosmético — o Apps Script lê e escreve aba
oculta normalmente.

As três de digitação têm porta própria no menu, em **Abrir entrada ▸** (Eventos manuais,
Saldos de trading, Configuração): o comando reexibe e ativa a aba, sem tocar em dado
nenhum. **Atualizar abas** e **Preparar planilha** devolvem a superfície canônica.

`21_FILA_REVISAO` deliberadamente **não** está nesse submenu: a fila é abstraída por
inteiro por "Revisar pendências", que faz a pergunta certa para cada item — qual categoria,
quando a movimentação não tem classificação; qual das movimentações candidatas, quando um
evento casa com mais de uma.

### Painel HTML

Página única, no máximo 960px, servida pelo HTML Service **dentro da planilha**
(nenhum web app publicado). Navegação por âncoras: Visão geral → Planejamento →
Patrimônio → Histórico.

- Consome exclusivamente o payload allowlisted, injetado no HTML pelo servidor.
- Não faz conta financeira, não escreve, não chama o servidor, não carrega nada externo (CSP com `default-src 'none'` e `connect-src 'none'`).
- Estados tratados: carregando, vazio, erro, desatualizado e valor nulo com motivo — nunca um zero falso.
- Light-only, tokens fixos, contraste AA, teclado completo, `prefers-reduced-motion` respeitado.

### Fluxos operacionais

| Fluxo | O que faz |
|---|---|
| Resolver item da fila | Exige decisão explícita (categoria ou linha escolhida). Classifica a linha pendente ou cria nova versão gerencial, registra antes/depois e fecha o item. Idempotente. |
| Materializar eventos | `NOVA_OBRIGACAO` e `NOVO_OBJETIVO` viram nova versão em `30`/`31`; `APORTE_POSICAO` e `RETIRADA_POSICAO` viram evento em `32`. Roda quantas vezes quiser sem duplicar. |
| Registrar evento de posição | `DISTRIBUICAO` e `SNAPSHOT_VALOR_MERCADO` entram à mão. Correção só por evento compensatório. |
| Diagnóstico de setup | Lista os parâmetros nulos/bloqueados, o impacto de cada um e as invariantes que ainda travam o fechamento. |
| Cache de taxa | Política configurável (`MANUAL` por padrão). Em `MANUAL`, a taxa entra pelo menu **Publicar taxa do mês**: append-only, versionada e auditada, com a data de referência e a data efetiva da cotação separadas. Em `HTTP`, consulta o provedor parametrizado e materializa na aba `00`. Falha vira `null` + motivo — o fechamento continua bloqueado. |

---

## Comandos

```bash
npm run check            # verificação estática: sintaxe, JSON, API de Node em src/, bundle
npm run build            # gera dist/financeos.gs (arquivo único para o Apps Script)
npm test                 # roda tudo e imprime a matriz dos cenários canônicos
npm run test:domain      # só testes de domínio
npm run test:integration # só testes de integração (com fakes de plataforma)
npm run scenarios        # só a matriz de cenários
npm run preview          # gera out/preview-*.html com dataset sintético
npm run qa:visual        # mede overflow, foco e contraste em Chromium headless
node tools/seed.js config   # TSV da configuração sintética, para colar na aba 00
node tools/seed.js regras   # TSV das regras sintéticas, para colar na aba 20
```

O harness não tem dependência externa: só Node 18+.
`npm test` falha se algum cenário canônico obrigatório ficar sem teste e se
`dist/financeos.gs` estiver dessincronizado de `src/`.

`npm run qa:visual` é opcional e usa o Chromium local (defina `CHROME_PATH` se
necessário). Ele só abre os previews sintéticos — nunca dado real.

## Setup local

```bash
git clone <repo> && cd finance-os
npm test
```

Não há `npm install`: o projeto é dependência-zero de propósito.

## Setup no Google (manual, sem deploy automatizado)

O projeto do Apps Script precisa de **três coisas**, nada mais:

1. Crie uma planilha e abra **Extensões → Apps Script**.
2. Rode `npm run build` e cole **`dist/financeos.gs`** como um único arquivo de script.
   > Não cole os arquivos de `src/` um a um. No Apps Script o código global roda na
   > ordem em que os arquivos aparecem no editor, e vários módulos leem
   > `FOS.Constants` durante a carga: fora da ordem canônica o projeto quebra com
   > `TypeError` antes do primeiro clique. O arquivo único elimina esse risco.
   > A ordem canônica está em `tools/ordem.js`, e há teste que prova que fora dela
   > o carregamento falha.
3. Crie um arquivo **HTML** chamado `dashboard` e cole `src/ui/dashboard.html`.
4. Cole `src/appsscript.json` no manifesto e recarregue a planilha.
5. Use o menu **Finance OS → Preparar planilha**.
6. Ajuste `00_CONFIG_PARAMETROS`: contas reais, saldo inicial do caixa de vida e parâmetros.
   Parâmetros que você ainda não decidiu devem ficar com `status = BLOQUEADO` e um `reason` —
   o sistema respeita isso e devolve `null` em vez de inventar número.
   Linhas com `status = DEPRECIADO` são parâmetros que deixaram de ser canônicos: o sistema
   não os lê mais e não os cobra. Ficam na aba como histórico; a lista está em
   `FOS.Config.PARAMETROS_DEPRECIADOS`, e é ela que manda, não a célula.
   `URL_PROVEDOR_TAXA_CAMBIO` é caso à parte: fica bloqueada **por decisão**, porque
   `POLITICA_TAXA_CAMBIO = MANUAL` e o V1 não consulta ninguém. O diagnóstico só volta a
   cobrá-la se a política mudar para `HTTP`.
7. Importe extratos pelo menu, registre eventos manuais na aba `11` e saldos semanais na aba `12`.
8. Use **Revisar pendências** e **Registrar evento**; publique a cotação do mês em
   **Publicar taxa do mês**; então **Fechar mês** e **Abrir painel**.

**Declarando eventos na aba `11`**: escolha `tipo_evento`, `moeda` e `status` pelas listas
da própria célula — os valores saem das constantes que o domínio usa para validar, então a
planilha nunca oferece algo que o sistema recusaria. O dropdown é conveniência, não fonte de
verdade: colar valores por cima substitui a regra da célula no Sheets, e por isso a validação
que vale continua sendo a do código. **Registrar evento** lista cada linha recusada com
`evento_id` e motivo, e o diagnóstico avisa antes do fechamento — nenhuma linha é descartada
em silêncio.

**Antes do primeiro fechamento com posição ou saldo em moeda estrangeira**, publique
a taxa pelo menu **Finance OS → Publicar taxa do mês**. Nunca edite as linhas de taxa
da aba `00` à mão: a chave, a versão e a data de referência são responsabilidade do
sistema.

A política do câmbio GBP→BRL é esta:

- a taxa **pertence à competência**, não ao dia em que você fecha o mês;
- a **data de referência** é o último dia calendário da competência (`BRL/GBP@2026-01-31`);
- havendo PTAX nessa data, é ela; **não havendo** (fim de semana ou feriado), use a PTAX
  do último dia útil anterior;
- você informa a taxa **e o dia efetivo da cotação**. O sistema grava as duas datas e
  **não adivinha dia útil** — não existe fallback silencioso;
- o fechamento precisa de **duas** taxas: a da competência (para converter o patrimônio)
  e a da competência anterior (para separar o efeito cambial do resultado operacional).
  Sem a segunda o mês fecha, mas o efeito cambial fica `null` com motivo, e o diagnóstico avisa.

Corrigir uma taxa publica uma **versão maior**, sem apagar a anterior; a versão vigente é
sempre a de maior número, nunca a última linha da planilha. Competência já fechada é
recusada: a taxa da época fica preservada, e a correção só passa a valer por reapresentação
(restatement) explícita e com motivo registrado.

O fechamento é **offline por decisão**: ele lê a taxa materializada e nunca busca cotação
sozinho. Sem taxa para a data de referência, o mês não fecha e o motivo aparece no diagnóstico.

**Metas não são parâmetros.** Meta de patrimônio é um objetivo versionado na aba `31`,
declarado pelo evento `NOVO_OBJETIVO` — com prazo, prioridade, histórico e acompanhamento de
ritmo. O custo de vida operacional é derivado do ledger observado (`MESES_MEDIA_CUSTO_VIDA`),
não de um alvo digitado. Os antigos `PATRIMONIO_ALVO_BRL` e `CUSTO_VIDA_ALVO_MENSAL_BRL` foram
descontinuados por auditoria: nenhum cálculo os consumia.

Os meses fecham **em ordem cronológica**: o sistema recusa fechar um mês deixando
um mês anterior com movimento ainda em aberto, porque o estado do ciclo depende de
fechamentos consecutivos.

O menu é agrupado por ritmo de uso — o mês inteiro em cima, na ordem em que acontece;
a leitura no meio; correção, navegação e manutenção embaixo:

```
Finance OS
├── Importar extrato
├── Revisar pendências
├── Registrar evento
├── Publicar taxa do mês
├── Fechar mês
├──────────────────
├── Abrir painel
├── Atualizar abas
├──────────────────
├── Reclassificar movimentação
├── Abrir entrada ▸ (Eventos manuais · Saldos de trading · Configuração)
└── Preparar planilha
```

Escopos declarados no manifesto: `spreadsheets.currentonly`, `script.container.ui` e
`drive.readonly` (necessário para ler o arquivo de extrato pelo nome). Se preferir escopo
ainda menor, é possível trocar a leitura por colagem manual do CSV e remover `drive.readonly`.

## Limites explícitos desta onda

- **Não** conecta contas, **não** faz deploy, **não** publica web app, **não** move dinheiro.
- Nenhum dado pessoal, saldo real, transação real ou PII existe neste repositório. Todo o dataset é sintético e marcado como tal.
- O painel abre como diálogo dentro da planilha. `doGet` existe e só responde ao dono, mas **nada foi implantado**.
- O provedor de taxa padrão é manual (taxas registradas na planilha). O provedor HTTP é parametrizado e testado com fake, sem nenhuma URL de produção configurada e sem nenhuma chamada real nesta entrega.
- O painel é light-only no V1: não há tema escuro.
- O fechamento nunca acessa a rede: cotação entra pelo cache da aba `00`.
- `dist/financeos.gs` é gerado, não editado à mão: alterações vão em `src/` + `npm run build`.
- Não existe simulador de cenários, projeção ou score em nenhuma superfície.

## Documentos

- `docs/adr/0001-arquitetura-nucleo.md` — decisões técnicas reversíveis e seus porquês.
- `docs/CENARIOS.md` — os cenários canônicos e onde cada um é testado.
