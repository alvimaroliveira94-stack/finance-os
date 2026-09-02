# Cenários canônicos

A matriz abaixo é gerada e verificada pelo harness: `npm test` **falha** se um cenário
obrigatório ficar sem teste. Os cenários visuais estão declarados como PENDENTE e são
implementados na onda do dashboard.

| ID | Cenário | Onda |
|---|---|---|
| C01 | Duplicatas legítimas permanecem distintas | núcleo (esta) |
| C02 | Reimportação do mesmo arquivo gera zero linhas novas | núcleo (esta) |
| C03 | Importação atômica: arquivo com erro não entra pela metade | núcleo (esta) |
| C04 | Fingerprint determinístico e estável | núcleo (esta) |
| C05 | Categorias canônicas e classificação determinística | núcleo (esta) |
| C06 | Os sete tipos de evento manual | núcleo (esta) |
| C07 | Validação de universo nos eventos | núcleo (esta) |
| C08 | Conciliação por valor exato, conta e janela de dias | núcleo (esta) |
| C09 | Ambiguidade de conciliação vai para a fila | núcleo (esta) |
| C10 | Firewall: conta de trading não entra em importação transacional | núcleo (esta) |
| C11 | Firewall: aba de saldo semanal só aceita trading | núcleo (esta) |
| C12 | Fronteira reconhecida Wise para Inter | núcleo (esta) |
| C13 | P&L operacional em GBP | núcleo (esta) |
| C14 | Resultado da reserva em BRL | núcleo (esta) |
| C15 | Taxa de câmbio ausente bloqueia o fechamento | núcleo (esta) |
| C16 | Custo operacional de trading não vira aporte | núcleo (esta) |
| C17 | Caixa retirado em BRL | núcleo (esta) |
| C18 | Sinal: redução de proteção | núcleo (esta) |
| C19 | Sinal: gasto extraordinário anormal | núcleo (esta) |
| C20 | Sinal: Vida para Trading | núcleo (esta) |
| C21 | Sinal: reserva fora da finalidade | núcleo (esta) |
| C22 | Sinal: queda de runway | núcleo (esta) |
| C23 | Sinal: compromisso sem provisão | núcleo (esta) |
| C24 | Sinal: retirada após mês forte (exige histórico) | núcleo (esta) |
| C25 | Estado: avanço só após 2 fechamentos consecutivos | núcleo (esta) |
| C26 | Estado: regressão no primeiro fechamento que confirma | núcleo (esta) |
| C27 | Provisões: status coberta, em risco, ritmo e dado insuficiente | núcleo (esta) |
| C28 | Provisões: desempate por vencimento, prioridade e proporcional | núcleo (esta) |
| C29 | Posições: os quatro eventos de event sourcing | núcleo (esta) |
| C30 | Posições: correção por evento compensatório | núcleo (esta) |
| C31 | Snapshot de posição ausente bloqueia o fechamento | núcleo (esta) |
| C32 | Fechamento imutável e checksum reprodutível | núcleo (esta) |
| C33 | Restatement gera nova versão sem sobrescrever | núcleo (esta) |
| C34 | View-model respeita a allowlist | núcleo (esta) |
| C35 | View-model expõe error, stale e null com motivo | núcleo (esta) |
| C36 | Log de auditoria registra antes e depois | núcleo (esta) |
| C37 | Acessibilidade do dashboard | visual (próxima) |
| C38 | Layout mobile do dashboard | visual (próxima) |
| C39 | Navegação por teclado do dashboard | visual (próxima) |

Para ver a matriz com o resultado atual de cada cenário:

```bash
npm run scenarios
```
