/**
 * Semente sintética de configuração.
 *
 * ATENÇÃO: todos os valores aqui são FICTÍCIOS e existem apenas para o
 * sistema arrancar e para os testes rodarem. Nenhum dado pessoal, saldo real,
 * conta real ou valor financeiro real do usuário entra neste repositório.
 * Em produção, estes números são editados diretamente na aba 00.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.App = FOS.App || {};
  var C = FOS.Constants;

  function parametro(chave, valor, tipo, unidade, descricao, status, reason) {
    return {
      secao: 'PARAMETRO',
      chave: chave,
      valor: status === C.STATUS_PARAMETRO.BLOQUEADO ? '' : valor,
      tipo: tipo,
      unidade: unidade || '',
      universo: '',
      modo_ingestao: '',
      moeda: '',
      ativa: '',
      elegivel_importacao: '',
      status: status || C.STATUS_PARAMETRO.ATIVO,
      reason: reason || '',
      versao: 1,
      atualizado_em: '',
      descricao: descricao || ''
    };
  }

  function conta(id, nome, universo, modo, moeda, ativa, elegivel) {
    return {
      secao: 'CONTA',
      chave: id,
      valor: nome,
      tipo: 'TEXTO',
      unidade: '',
      universo: universo,
      modo_ingestao: modo,
      moeda: moeda,
      ativa: ativa ? 'TRUE' : 'FALSE',
      elegivel_importacao: elegivel ? 'TRUE' : 'FALSE',
      status: C.STATUS_PARAMETRO.ATIVO,
      reason: '',
      versao: 1,
      atualizado_em: '',
      descricao: ''
    };
  }

  function enumRow(nome, valor) {
    return {
      secao: 'ENUM', chave: nome, valor: valor, tipo: 'TEXTO', unidade: '',
      universo: '', modo_ingestao: '', moeda: '', ativa: '', elegivel_importacao: '',
      status: C.STATUS_PARAMETRO.ATIVO, reason: '', versao: 1, atualizado_em: '', descricao: ''
    };
  }

  var PARAMETROS = [
    parametro('MOEDA_GERENCIAL', 'BRL', 'TEXTO', '', 'Moeda de consolidação gerencial.'),
    parametro('PROVEDOR_TAXA_CAMBIO', 'PTAX', 'TEXTO', '', 'Provedor abstrato de taxa; PTAX é a implementação prevista.'),
    parametro('JANELA_CONCILIACAO_DIAS', 3, 'NUMERO', 'dias', 'Janela de conciliação evento x extrato.'),
    parametro('CONFIANCA_MINIMA_CLASSIFICACAO', 0.9, 'NUMERO', '', 'Abaixo disso a linha vai para a fila de revisão.'),
    parametro('FECHAMENTOS_PARA_AVANCO_ESTADO', 2, 'NUMERO', 'fechamentos', 'Fechamentos consecutivos exigidos para avanço formal de estado.'),
    parametro('FECHAMENTOS_MINIMOS_PROVISAO', 2, 'NUMERO', 'fechamentos', 'Mínimo de histórico para avaliar ritmo de provisão.'),
    parametro('FECHAMENTOS_MINIMOS_MES_FORTE', 3, 'NUMERO', 'fechamentos', 'Mínimo de histórico para classificar mês forte.'),
    parametro('LIMITE_GASTO_EXTRAORDINARIO_PCT_CAIXA_VIDA', 0.3, 'PERCENTUAL', '', 'Limite reversível de gasto extraordinário sobre o caixa de vida.'),
    parametro('QUEDA_RUNWAY_PCT_SINAL', 0.2, 'PERCENTUAL', '', 'Queda relativa de runway que aciona o sinal.'),
    parametro('MES_FORTE_PCT_ACIMA_MEDIA', 0.2, 'PERCENTUAL', '', 'Quanto acima da média caracteriza mês forte.'),
    parametro('RUNWAY_MINIMO_ESTABILIZANDO_MESES', 1, 'NUMERO', 'meses', 'Limiar de runway para sair de FRAGIL.'),
    parametro('RUNWAY_MINIMO_ESTAVEL_MESES', 3, 'NUMERO', 'meses', 'Limiar de runway para ESTAVEL.'),
    parametro('RUNWAY_MINIMO_EXPANSAO_MESES', 6, 'NUMERO', 'meses', 'Limiar de runway para EXPANSAO.'),
    parametro('MESES_MEDIA_CUSTO_VIDA', 3, 'NUMERO', 'meses', 'Janela de média do custo de vida para o runway.'),
    parametro('CONTA_RESERVA_TRADING_BRL', 'RESERVA_BANCA_BRL', 'TEXTO', '', 'Conta da reserva de banca em BRL.'),
    parametro('SALDO_INICIAL_CAIXA_VIDA_BRL', 10000, 'NUMERO', 'BRL', 'SINTÉTICO. Substituir pelo saldo real na planilha de produção.'),
    parametro('COMPETENCIA_INICIAL_CAIXA_VIDA', '2026-01', 'TEXTO', '', 'Competência a partir da qual o ledger conta para o caixa.'),
    parametro('MAX_IDADE_VIEWMODEL_DIAS', 45, 'NUMERO', 'dias', 'Acima disso o dashboard marca o dado como STALE.'),
    parametro('POLITICA_TAXA_CAMBIO', 'MANUAL', 'TEXTO', '',
      'MANUAL usa apenas as taxas publicadas pelo menu Finance OS > Publicar taxa do mês; '
      + 'HTTP consulta o provedor configurado.'),
    parametro('URL_PROVEDOR_TAXA_CAMBIO', '', 'TEXTO', '',
      'URL https do provedor de taxa, com {data} e {moeda}.', C.STATUS_PARAMETRO.BLOQUEADO,
      'POLITICA_MANUAL_NO_V1'),
    parametro('TIMEOUT_PROVEDOR_TAXA_MS', 15000, 'NUMERO', 'ms', 'Acima disso a consulta é tratada como indisponível.')
    // CUSTO_VIDA_ALVO_MENSAL_BRL e PATRIMONIO_ALVO_BRL saíram da semente:
    // nenhum consumidor no domínio, nenhum efeito em fechamento ou painel.
    // Meta de patrimônio é objetivo versionado (aba 31); custo de vida
    // operacional vem do ledger observado. Ver Config.PARAMETROS_DEPRECIADOS.
  ];

  /** Catálogo de contas sintético, conforme o desenho de universos aprovado. */
  var CONTAS = [
    conta('INTER_CC', 'Inter Conta Corrente', C.UNIVERSO.VIDA, C.MODO_INGESTAO.IMPORTACAO_MENSAL, C.MOEDA.BRL, true, true),
    conta('NUBANK', 'Nubank', C.UNIVERSO.VIDA, C.MODO_INGESTAO.IMPORTACAO_MENSAL, C.MOEDA.BRL, false, false),
    conta('BETFAIR', 'Betfair', C.UNIVERSO.TRADING, C.MODO_INGESTAO.SALDO_SEMANAL, C.MOEDA.GBP, true, false),
    conta('NETELLER', 'Neteller', C.UNIVERSO.TRADING, C.MODO_INGESTAO.SALDO_SEMANAL, C.MOEDA.GBP, true, false),
    conta('WISE', 'Wise', C.UNIVERSO.TRADING, C.MODO_INGESTAO.SALDO_SEMANAL, C.MOEDA.GBP, true, false),
    conta('RESERVA_BANCA_BRL', 'Reserva de Banca BRL', C.UNIVERSO.TRADING, C.MODO_INGESTAO.SALDO_SEMANAL, C.MOEDA.BRL, true, false)
  ];

  var ENUMS = []
    .concat(C.values(C.CATEGORIA).map(function (v) { return enumRow('CATEGORIA', v); }))
    .concat(C.values(C.TIPO_EVENTO).map(function (v) { return enumRow('TIPO_EVENTO', v); }))
    .concat(C.values(C.EVENTO_POSICAO).map(function (v) { return enumRow('EVENTO_POSICAO', v); }))
    .concat(C.values(C.UNIVERSO).map(function (v) { return enumRow('UNIVERSO', v); }))
    .concat(C.values(C.ESTADO_CICLO).map(function (v) { return enumRow('ESTADO_CICLO', v); }))
    .concat(C.values(C.SINAL).map(function (v) { return enumRow('SINAL', v); }));

  function regra(id, prioridade, campo, operador, referencia, categoria, confianca, opcoes) {
    var o = opcoes || {};
    return {
      regra_id: id,
      versao: o.versao || 1,
      prioridade: prioridade,
      ativo: 'TRUE',
      campo: campo,
      operador: operador,
      valor_referencia: referencia,
      conta_escopo: o.conta_escopo || '',
      sinal_valor: o.sinal_valor || 'QUALQUER',
      categoria: categoria,
      subcategoria: o.subcategoria || '',
      universo: FOS.Rules.UNIVERSO_POR_CATEGORIA[categoria],
      confianca: confianca,
      vigente_desde: o.vigente_desde || '',
      vigente_ate: o.vigente_ate || '',
      observacao: o.observacao || 'Regra sintética de exemplo.'
    };
  }

  /**
   * Regras sintéticas. A ordem por prioridade é o que dá determinismo:
   * a fronteira Wise->Inter é reconhecida antes de qualquer regra genérica.
   */
  var REGRAS = [
    regra('R001', 10, 'descricao_normalizada', 'CONTEM', 'WISE', C.CATEGORIA.SAQUE_TRADING, 0.95,
      { sinal_valor: 'CREDITO', conta_escopo: 'INTER_CC', observacao: 'Fronteira reconhecida Wise -> Inter.' }),
    regra('R010', 20, 'descricao_normalizada', 'CONTEM', 'CORRETORA TRADING', C.CATEGORIA.CUSTO_TRADING, 0.95,
      { sinal_valor: 'DEBITO', observacao: 'Custo operacional de trading pago pela conta de vida.' }),
    regra('R011', 20, 'descricao_normalizada', 'CONTEM', 'ASSINATURA DADOS ESPORTIVOS', C.CATEGORIA.CUSTO_TRADING, 0.95,
      { sinal_valor: 'DEBITO' }),
    regra('R020', 30, 'descricao_normalizada', 'CONTEM', 'SUPERMERCADO', C.CATEGORIA.CUSTO_VIDA, 0.95,
      { sinal_valor: 'DEBITO' }),
    regra('R021', 30, 'descricao_normalizada', 'CONTEM', 'ALUGUEL', C.CATEGORIA.CUSTO_VIDA, 0.98,
      { sinal_valor: 'DEBITO' }),
    regra('R022', 30, 'descricao_normalizada', 'CONTEM', 'ENERGIA', C.CATEGORIA.CUSTO_VIDA, 0.95,
      { sinal_valor: 'DEBITO' }),
    regra('R030', 40, 'descricao_normalizada', 'CONTEM', 'TRANSFERENCIA ENTRE CONTAS PROPRIAS',
      C.CATEGORIA.TRANSFERENCIA_INTERNA, 0.95),
    regra('R040', 50, 'descricao_normalizada', 'CONTEM', 'APORTE CORRETORA PATRIMONIO',
      C.CATEGORIA.PATRIMONIO_OBJETIVOS, 0.95, { sinal_valor: 'DEBITO' }),
    regra('R050', 60, 'descricao_normalizada', 'CONTEM', 'DESPESA MEDICA', C.CATEGORIA.GASTO_EXTRAORDINARIO, 0.95,
      { sinal_valor: 'DEBITO' }),
    regra('R900', 90, 'descricao_normalizada', 'CONTEM', 'PIX RECEBIDO', C.CATEGORIA.CUSTO_VIDA, 0.4,
      { sinal_valor: 'CREDITO', observacao: 'Confiança baixa de propósito: cai na fila de revisão.' })
  ];

  FOS.App.Seed = {
    PARAMETROS: PARAMETROS,
    CONTAS: CONTAS,
    ENUMS: ENUMS,
    REGRAS: REGRAS,
    configRows: function () { return PARAMETROS.concat(CONTAS).concat(ENUMS); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
