# Finance OS

Sistema financeiro pessoal com **fonte única no Google Sheets** e motor em **Google Apps Script**,
com harness local em Node para testar todo o domínio fora do Google.

Onda atual: **núcleo funcional e testável (fases 0–5)**. As superfícies visuais
(dashboard de leitura e abas visíveis populadas) estão preparadas, mas ficam para a próxima onda.

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
```

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
| `11_EVENTOS_MANUAIS` | Os sete tipos de evento declarados pelo usuário. |
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

---

## Comandos

```bash
npm test                 # roda tudo e imprime a matriz dos cenários canônicos
npm run test:domain      # só testes de domínio
npm run test:integration # só testes de integração (com fakes de plataforma)
npm run scenarios        # só a matriz de cenários
node tools/seed.js config   # TSV da configuração sintética, para colar na aba 00
node tools/seed.js regras   # TSV das regras sintéticas, para colar na aba 20
```

O harness não tem dependência externa: só Node 18+.
`npm test` falha se algum cenário canônico obrigatório ficar sem teste.

## Setup local

```bash
git clone <repo> && cd finance-os
npm test
```

Não há `npm install`: o projeto é dependência-zero de propósito.

## Setup no Google (manual, sem deploy automatizado)

1. Crie uma planilha e abra **Extensões → Apps Script**.
2. Cole os arquivos de `src/` no projeto de script (domínio, adaptadores, app e `main.js`)
   e o conteúdo de `src/appsscript.json` no manifesto.
3. Recarregue a planilha e use o menu **Finance OS → 1. Criar/verificar estrutura**.
4. Ajuste `00_CONFIG_PARAMETROS`: contas reais, saldo inicial do caixa de vida e parâmetros.
   Parâmetros que você ainda não decidiu devem ficar com `status = BLOQUEADO` e um `reason` —
   o sistema respeita isso e devolve `null` em vez de inventar número.
5. Importe extratos pelo menu, registre eventos manuais na aba `11` e saldos semanais na aba `12`.

Escopos declarados no manifesto: `spreadsheets.currentonly`, `script.container.ui` e
`drive.readonly` (necessário para ler o arquivo de extrato pelo nome). Se preferir escopo
ainda menor, é possível trocar a leitura por colagem manual do CSV e remover `drive.readonly`.

## Limites explícitos desta onda

- **Não** conecta contas, **não** faz deploy, **não** publica web app, **não** move dinheiro.
- Nenhum dado pessoal, saldo real, transação real ou PII existe neste repositório. Todo o dataset é sintético e marcado como tal.
- Dashboard de leitura, população das abas visíveis e testes visuais (acessibilidade, mobile, teclado) ficam para a próxima onda; o contrato de dados (`view-model` com allowlist) já está pronto e testado.
- O provedor de taxa padrão é manual (taxas registradas na planilha). O provedor HTTP existe e é testado com fake, mas não está apontado para nenhuma URL de produção.

## Documentos

- `docs/adr/0001-arquitetura-nucleo.md` — decisões técnicas reversíveis e seus porquês.
- `docs/CENARIOS.md` — os cenários canônicos e onde cada um é testado.
