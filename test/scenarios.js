'use strict';
/**
 * Catálogo dos cenários canônicos.
 * Cada teste declara o cenário que cobre; o runner mostra a matriz de
 * cobertura e falha se algum cenário obrigatório ficar sem teste.
 * C37 a C39 cobrem as superfícies visuais e passaram a ser verificados
 * estruturalmente sobre o HTML do dashboard; o harness opcional
 * `npm run qa:visual` complementa com medição em navegador real.
 */
const CENARIOS = [
  { id: 'C01', nome: 'Duplicatas legítimas permanecem distintas' },
  { id: 'C02', nome: 'Reimportação do mesmo arquivo gera zero linhas novas' },
  { id: 'C03', nome: 'Importação atômica: arquivo com erro não entra pela metade' },
  { id: 'C04', nome: 'Fingerprint determinístico e estável' },
  { id: 'C05', nome: 'Categorias canônicas e classificação determinística' },
  { id: 'C06', nome: 'Os sete tipos de evento manual' },
  { id: 'C07', nome: 'Validação de universo nos eventos' },
  { id: 'C08', nome: 'Conciliação por valor exato, conta e janela de dias' },
  { id: 'C09', nome: 'Ambiguidade de conciliação vai para a fila' },
  { id: 'C10', nome: 'Firewall: conta de trading não entra em importação transacional' },
  { id: 'C11', nome: 'Firewall: aba de saldo semanal só aceita trading' },
  { id: 'C12', nome: 'Fronteira reconhecida Wise para Inter' },
  { id: 'C13', nome: 'P&L operacional em GBP' },
  { id: 'C14', nome: 'Resultado da reserva em BRL' },
  { id: 'C15', nome: 'Taxa de câmbio ausente bloqueia o fechamento' },
  { id: 'C16', nome: 'Custo operacional de trading não vira aporte' },
  { id: 'C17', nome: 'Caixa retirado em BRL' },
  { id: 'C18', nome: 'Sinal: redução de proteção' },
  { id: 'C19', nome: 'Sinal: gasto extraordinário anormal' },
  { id: 'C20', nome: 'Sinal: Vida para Trading' },
  { id: 'C21', nome: 'Sinal: reserva fora da finalidade' },
  { id: 'C22', nome: 'Sinal: queda de runway' },
  { id: 'C23', nome: 'Sinal: compromisso sem provisão' },
  { id: 'C24', nome: 'Sinal: retirada após mês forte (exige histórico)' },
  { id: 'C25', nome: 'Estado: avanço só após 2 fechamentos consecutivos' },
  { id: 'C26', nome: 'Estado: regressão no primeiro fechamento que confirma' },
  { id: 'C27', nome: 'Provisões: status coberta, em risco, ritmo e dado insuficiente' },
  { id: 'C28', nome: 'Provisões: desempate por vencimento, prioridade e proporcional' },
  { id: 'C29', nome: 'Posições: os quatro eventos de event sourcing' },
  { id: 'C30', nome: 'Posições: correção por evento compensatório' },
  { id: 'C31', nome: 'Snapshot de posição ausente bloqueia o fechamento' },
  { id: 'C32', nome: 'Fechamento imutável e checksum reprodutível' },
  { id: 'C33', nome: 'Restatement gera nova versão sem sobrescrever' },
  { id: 'C34', nome: 'View-model respeita a allowlist' },
  { id: 'C35', nome: 'View-model expõe error, stale e null com motivo' },
  { id: 'C36', nome: 'Log de auditoria registra antes e depois' },
  { id: 'C37', nome: 'Acessibilidade do dashboard' },
  { id: 'C38', nome: 'Layout mobile do dashboard' },
  { id: 'C39', nome: 'Navegação por teclado do dashboard' },
  { id: 'C40', nome: 'Fila: resolução exige escolha explícita e é auditada' },
  { id: 'C41', nome: 'Período fechado protegido contra reclassificação' },
  { id: 'C42', nome: 'Obrigação e objetivo materializam subledger versionado' },
  { id: 'C43', nome: 'Aporte e retirada de posição viram evento append-only' },
  { id: 'C44', nome: 'Diagnóstico de setup explica o que bloqueia o fechamento' },
  { id: 'C45', nome: 'Taxa de câmbio: política, cache materializado e erro seguro' },
  { id: 'C46', nome: 'Abas visíveis geradas idempotentemente do modelo canônico' },
  { id: 'C47', nome: 'Dashboard consome apenas o payload allowlisted' },
  { id: 'C48', nome: 'Painel restrito e sem endpoint mutável' },
  { id: 'C49', nome: 'Publicação manual da taxa da competência' },
  { id: 'C50', nome: 'Evento manual inválido é recusado, nunca ignorado' },
  { id: 'C51', nome: 'Parâmetro depreciado sai da configuração sem perder histórico' },
  { id: 'C52', nome: 'Superfície de quatro abas e fila totalmente abstraída' },
  { id: 'C53', nome: 'Calibração: a regra nasce da decisão, com escopo exato e persistência conquistada' },
  { id: 'C54', nome: 'Passivo mínimo: obrigação com terceiro, recebido ≠ devido, sem contaminar patrimônio' },
  { id: 'C55', nome: 'Passivo brownfield: saldo inicial pré-existente e correção administrativa sem movimentar caixa' },
  { id: 'C56', nome: 'Competência inicial: fronteira YYYY-MM sobrevive à conversão Date do Sheets, fail-closed quando ausente/inválida' }
];

module.exports = { CENARIOS };
