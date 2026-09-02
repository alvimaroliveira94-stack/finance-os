# Cenários canônicos

A matriz abaixo é gerada e verificada pelo harness: `npm test` **falha** se um cenário
ficar sem teste. Os cenários visuais (C37–C39) são verificados estruturalmente sobre o
HTML do painel; `npm run qa:visual` complementa medindo em Chromium headless.

| ID | Cenário | Onda |
|---|---|---|
| C01 | Duplicatas legítimas permanecem distintas | 1 (núcleo) |
| C02 | Reimportação do mesmo arquivo gera zero linhas novas | 1 (núcleo) |
| C03 | Importação atômica: arquivo com erro não entra pela metade | 1 (núcleo) |
| C04 | Fingerprint determinístico e estável | 1 (núcleo) |
| C05 | Categorias canônicas e classificação determinística | 1 (núcleo) |
| C06 | Os sete tipos de evento manual | 1 (núcleo) |
| C07 | Validação de universo nos eventos | 1 (núcleo) |
| C08 | Conciliação por valor exato, conta e janela de dias | 1 (núcleo) |
| C09 | Ambiguidade de conciliação vai para a fila | 1 (núcleo) |
| C10 | Firewall: conta de trading não entra em importação transacional | 1 (núcleo) |
| C11 | Firewall: aba de saldo semanal só aceita trading | 1 (núcleo) |
| C12 | Fronteira reconhecida Wise para Inter | 1 (núcleo) |
| C13 | P&L operacional em GBP | 1 (núcleo) |
| C14 | Resultado da reserva em BRL | 1 (núcleo) |
| C15 | Taxa de câmbio ausente bloqueia o fechamento | 1 (núcleo) |
| C16 | Custo operacional de trading não vira aporte | 1 (núcleo) |
| C17 | Caixa retirado em BRL | 1 (núcleo) |
| C18 | Sinal: redução de proteção | 1 (núcleo) |
| C19 | Sinal: gasto extraordinário anormal | 1 (núcleo) |
| C20 | Sinal: Vida para Trading | 1 (núcleo) |
| C21 | Sinal: reserva fora da finalidade | 1 (núcleo) |
| C22 | Sinal: queda de runway | 1 (núcleo) |
| C23 | Sinal: compromisso sem provisão | 1 (núcleo) |
| C24 | Sinal: retirada após mês forte (exige histórico) | 1 (núcleo) |
| C25 | Estado: avanço só após 2 fechamentos consecutivos | 1 (núcleo) |
| C26 | Estado: regressão no primeiro fechamento que confirma | 1 (núcleo) |
| C27 | Provisões: status coberta, em risco, ritmo e dado insuficiente | 1 (núcleo) |
| C28 | Provisões: desempate por vencimento, prioridade e proporcional | 1 (núcleo) |
| C29 | Posições: os quatro eventos de event sourcing | 1 (núcleo) |
| C30 | Posições: correção por evento compensatório | 1 (núcleo) |
| C31 | Snapshot de posição ausente bloqueia o fechamento | 1 (núcleo) |
| C32 | Fechamento imutável e checksum reprodutível | 1 (núcleo) |
| C33 | Restatement gera nova versão sem sobrescrever | 1 (núcleo) |
| C34 | View-model respeita a allowlist | 1 (núcleo) |
| C35 | View-model expõe error, stale e null com motivo | 1 (núcleo) |
| C36 | Log de auditoria registra antes e depois | 1 (núcleo) |
| C37 | Acessibilidade do dashboard | 2 (experiência) |
| C38 | Layout mobile do dashboard | 2 (experiência) |
| C39 | Navegação por teclado do dashboard | 2 (experiência) |
| C40 | Fila: resolução exige escolha explícita e é auditada | 2 (experiência) |
| C41 | Período fechado protegido contra reclassificação | 2 (experiência) |
| C42 | Obrigação e objetivo materializam subledger versionado | 2 (experiência) |
| C43 | Aporte e retirada de posição viram evento append-only | 2 (experiência) |
| C44 | Diagnóstico de setup explica o que bloqueia o fechamento | 2 (experiência) |
| C45 | Taxa de câmbio: política, cache materializado e erro seguro | 2 (experiência) |
| C46 | Abas visíveis geradas idempotentemente do modelo canônico | 2 (experiência) |
| C47 | Dashboard consome apenas o payload allowlisted | 2 (experiência) |
| C48 | Painel restrito e sem endpoint mutável | 2 (experiência) |
| C49 | Publicação manual da taxa da competência | 3 (operação) |
| C50 | Evento manual inválido é recusado, nunca ignorado | 3 (operação) |
| C51 | Parâmetro depreciado sai da configuração sem perder histórico | 3 (operação) |
| C52 | Superfície de quatro abas e fila totalmente abstraída | 3 (operação) |

Para ver a matriz com o resultado atual de cada cenário:

```bash
npm run scenarios
```
