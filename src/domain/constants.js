/**
 * Enums canônicos do Finance OS.
 * Estes valores são decisões financeiras canônicas: não alterar sem
 * decisão explícita do usuário. Parâmetros numéricos ficam em
 * 00_CONFIG_PARAMETROS (configuráveis), não aqui.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  /** Abas visíveis (superfícies de leitura/entrada humana). */
  var ABAS_VISIVEIS = {
    HOME: 'HOME',
    MOVIMENTACOES: 'MOVIMENTAÇÕES',
    PLANEJAMENTO: 'PLANEJAMENTO',
    PATRIMONIO: 'PATRIMÔNIO'
  };

  /** Estruturas internas (motor). Ordem = ordem de criação no workbook. */
  var ABAS_INTERNAS = {
    CONFIG: '00_CONFIG_PARAMETROS',
    IMPORT_EXTRATO: '10_IMPORT_EXTRATO',
    EVENTOS_MANUAIS: '11_EVENTOS_MANUAIS',
    SALDOS_TRADING: '12_SALDOS_TRADING_SEMANAL',
    REGRAS: '20_REGRAS_CLASSIFICACAO',
    FILA_REVISAO: '21_FILA_REVISAO',
    LEDGER: '22_LEDGER_CANONICO_MOVIMENTACOES',
    PROVISOES: '30_PROVISOES',
    OBJETIVOS: '31_OBJETIVOS',
    POSICOES: '32_LEDGER_POSICOES',
    FECHAMENTOS: '40_FECHAMENTOS',
    RESTATEMENTS: '41_RESTATEMENTS',
    LOG: '90_LOG_AUDITORIA'
  };

  /** Universos separados por firewall. */
  var UNIVERSO = {
    VIDA: 'VIDA',
    TRADING: 'TRADING',
    PATRIMONIO: 'PATRIMONIO'
  };

  /** Modo de ingestão por conta. Firewall depende disto. */
  var MODO_INGESTAO = {
    IMPORTACAO_MENSAL: 'IMPORTACAO_MENSAL',
    SALDO_SEMANAL: 'SALDO_SEMANAL'
  };

  /** Categorias canônicas de classificação. */
  var CATEGORIA = {
    CUSTO_VIDA: 'CUSTO_VIDA',
    CUSTO_TRADING: 'CUSTO_TRADING',
    SAQUE_TRADING: 'SAQUE_TRADING',
    GASTO_EXTRAORDINARIO: 'GASTO_EXTRAORDINARIO',
    APORTE_EXTRAORDINARIO: 'APORTE_EXTRAORDINARIO',
    TRANSFERENCIA_INTERNA: 'TRANSFERENCIA_INTERNA',
    PATRIMONIO_OBJETIVOS: 'PATRIMONIO_OBJETIVOS'
  };

  /** Tipos de evento manual (aba 11). Exatamente sete. */
  var TIPO_EVENTO = {
    SAQUE_TRADING: 'SAQUE_TRADING',
    GASTO_EXTRAORDINARIO: 'GASTO_EXTRAORDINARIO',
    APORTE_EXTRAORDINARIO: 'APORTE_EXTRAORDINARIO',
    NOVA_OBRIGACAO: 'NOVA_OBRIGACAO',
    NOVO_OBJETIVO: 'NOVO_OBJETIVO',
    APORTE_POSICAO: 'APORTE_POSICAO',
    RETIRADA_POSICAO: 'RETIRADA_POSICAO'
  };

  /** Tipos de evento do ledger de posições (aba 32). */
  var EVENTO_POSICAO = {
    APORTE: 'APORTE',
    RETIRADA: 'RETIRADA',
    DISTRIBUICAO: 'DISTRIBUICAO',
    SNAPSHOT_VALOR_MERCADO: 'SNAPSHOT_VALOR_MERCADO'
  };

  /** Estados do fechamento mensal. */
  var ESTADO_FECHAMENTO = {
    ABERTO: 'ABERTO',
    EM_REVISAO: 'EM_REVISAO',
    FECHADO: 'FECHADO'
  };

  /** Estados do ciclo financeiro, do mais frágil ao mais expansivo. */
  var ESTADO_CICLO = {
    FRAGIL: 'FRAGIL',
    ESTABILIZANDO: 'ESTABILIZANDO',
    ESTAVEL: 'ESTAVEL',
    EXPANSAO: 'EXPANSAO'
  };

  var ORDEM_ESTADO_CICLO = [
    ESTADO_CICLO.FRAGIL,
    ESTADO_CICLO.ESTABILIZANDO,
    ESTADO_CICLO.ESTAVEL,
    ESTADO_CICLO.EXPANSAO
  ];

  /** Status de provisão/objetivo. */
  var STATUS_PROVISAO = {
    COBERTA: 'COBERTA',
    EM_RITMO: 'EM_RITMO',
    FORA_DE_RITMO: 'FORA_DE_RITMO',
    EM_RISCO: 'EM_RISCO',
    DADO_INSUFICIENTE: 'DADO_INSUFICIENTE'
  };

  /** Os sete sinais binários independentes do ciclo de 90 dias. */
  var SINAL = {
    REDUCAO_PROTECAO: 'REDUCAO_PROTECAO',
    GASTO_EXTRAORDINARIO_ANORMAL: 'GASTO_EXTRAORDINARIO_ANORMAL',
    VIDA_PARA_TRADING: 'VIDA_PARA_TRADING',
    RESERVA_FORA_DA_FINALIDADE: 'RESERVA_FORA_DA_FINALIDADE',
    QUEDA_RUNWAY: 'QUEDA_RUNWAY',
    COMPROMISSO_SEM_PROVISAO: 'COMPROMISSO_SEM_PROVISAO',
    RETIRADA_APOS_MES_FORTE: 'RETIRADA_APOS_MES_FORTE'
  };

  /** Status de linha de staging de importação. */
  var STATUS_IMPORT = {
    NOVA: 'NOVA',
    DUPLICADA: 'DUPLICADA',
    REJEITADA: 'REJEITADA'
  };

  /** Status de item da fila de revisão. */
  var STATUS_FILA = {
    ABERTO: 'ABERTO',
    RESOLVIDO: 'RESOLVIDO',
    DESCARTADO: 'DESCARTADO'
  };

  /** Origem do item de fila. */
  var ORIGEM_FILA = {
    CLASSIFICACAO: 'CLASSIFICACAO',
    CONCILIACAO: 'CONCILIACAO',
    IMPORTACAO: 'IMPORTACAO'
  };

  /** Status de um parâmetro em 00_CONFIG_PARAMETROS. */
  var STATUS_PARAMETRO = {
    ATIVO: 'ATIVO',
    BLOQUEADO: 'BLOQUEADO',
    // Parâmetro que já existiu e deixou de ser canônico. Diferente de
    // BLOQUEADO: BLOQUEADO é uma decisão pendente, DEPRECIADO é uma decisão
    // tomada — o sistema não o consome e não volta a cobrá-lo.
    DEPRECIADO: 'DEPRECIADO'
  };

  /** Status de valor exposto ao dashboard (leitura). */
  var STATUS_VALOR = {
    OK: 'OK',
    NULL: 'NULL',
    STALE: 'STALE',
    ERROR: 'ERROR',
    DADO_INSUFICIENTE: 'DADO_INSUFICIENTE'
  };

  /** Moedas suportadas no V1. */
  var MOEDA = { BRL: 'BRL', GBP: 'GBP' };

  /**
   * Fronteira reconhecida entre universos: única travessia controlada.
   * Movimentos internos entre Betfair/Neteller/Wise não são controlados.
   */
  var FRONTEIRA_RECONHECIDA = { origem: 'WISE', destino: 'INTER_CC' };

  function values(enumObj) {
    return Object.keys(enumObj).map(function (k) { return enumObj[k]; });
  }

  function isValid(enumObj, v) {
    return values(enumObj).indexOf(v) !== -1;
  }

  FOS.Constants = {
    ABAS_VISIVEIS: ABAS_VISIVEIS,
    ABAS_INTERNAS: ABAS_INTERNAS,
    UNIVERSO: UNIVERSO,
    MODO_INGESTAO: MODO_INGESTAO,
    CATEGORIA: CATEGORIA,
    TIPO_EVENTO: TIPO_EVENTO,
    EVENTO_POSICAO: EVENTO_POSICAO,
    ESTADO_FECHAMENTO: ESTADO_FECHAMENTO,
    ESTADO_CICLO: ESTADO_CICLO,
    ORDEM_ESTADO_CICLO: ORDEM_ESTADO_CICLO,
    STATUS_PROVISAO: STATUS_PROVISAO,
    SINAL: SINAL,
    STATUS_IMPORT: STATUS_IMPORT,
    STATUS_FILA: STATUS_FILA,
    ORIGEM_FILA: ORIGEM_FILA,
    STATUS_PARAMETRO: STATUS_PARAMETRO,
    STATUS_VALOR: STATUS_VALOR,
    MOEDA: MOEDA,
    FRONTEIRA_RECONHECIDA: FRONTEIRA_RECONHECIDA,
    values: values,
    isValid: isValid
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
