/**
 * Universo Vida: caixa, custo de vida, disponível, runway e funções do dinheiro.
 *
 * O caixa de vida é derivado: saldo inicial declarado em 00 (parâmetro
 * configurável) mais o ledger canônico até a data de referência. Se o
 * parâmetro estiver bloqueado, o caixa é null + reason — nunca zero.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  var PARAM_SALDO_INICIAL = 'SALDO_INICIAL_CAIXA_VIDA_BRL';
  var PARAM_COMPETENCIA_INICIAL = 'COMPETENCIA_INICIAL_CAIXA_VIDA';
  var PARAM_MESES_MEDIA_CUSTO = 'MESES_MEDIA_CUSTO_VIDA';

  function linhasAte(linhas, competencia) {
    var fim = FOS.Dates.competenciaRange(competencia).fim;
    return FOS.Ledger.visaoCorrente(linhas).filter(function (l) {
      return FOS.Dates.diffDays(String(l.data_origem), fim) <= 0;
    });
  }

  /** Caixa de vida ao fim da competência. */
  function caixaVida(config, linhas, competencia) {
    var saldoInicial = config.param(PARAM_SALDO_INICIAL);
    if (saldoInicial.value === null) {
      return FOS.Core.nullValue(saldoInicial.reason || 'SALDO_INICIAL_INDISPONIVEL');
    }
    var compInicial = config.param(PARAM_COMPETENCIA_INICIAL);
    if (compInicial.value === null) {
      // Fail-closed, não fail-open: sem uma fronteira de abertura confiável
      // (ausente, ou num formato que Config.build não conseguiu normalizar
      // para YYYY-MM), "contar tudo" e "não contar nada" são igualmente um
      // chute. O mesmo código que os outros consumidores deste parâmetro já
      // usam para o mesmo caso.
      return FOS.Core.nullValue(compInicial.reason || 'COMPETENCIA_INICIAL_INDISPONIVEL');
    }
    var relevantes = linhasAte(linhas, competencia).filter(function (l) {
      if (FOS.Dates.competenciaOf(String(l.data_origem)) < compInicial.value) return false;
      var conta = config.conta(l.conta_id);
      return conta && conta.universo === C.UNIVERSO.VIDA;
    });
    var movimento = FOS.Core.sum(relevantes, function (l) { return Number(l.valor_origem); });
    return FOS.Core.value(FOS.Core.round2(Number(saldoInicial.value) + movimento));
  }

  /** Custo de vida da competência (valor positivo). */
  function custoVidaMes(linhas, competencia) {
    var doMes = FOS.Ledger.daCompetencia(linhas, competencia)
      .filter(function (l) { return l.categoria === C.CATEGORIA.CUSTO_VIDA; });
    return FOS.Core.value(Math.abs(FOS.Core.sum(doMes, function (l) { return Number(l.valor_origem); })));
  }

  /** Média de custo de vida nos últimos N meses com movimento observado. */
  function custoVidaMedio(config, linhas, competencia) {
    var meses = config.param(PARAM_MESES_MEDIA_CUSTO).value;
    if (meses === null || !Number.isFinite(Number(meses)) || Number(meses) < 1) meses = 3;
    var soma = 0;
    var observados = 0;
    for (var i = 0; i < Number(meses); i++) {
      var comp = FOS.Dates.addMonths(competencia, -i);
      var doMes = FOS.Ledger.daCompetencia(linhas, comp)
        .filter(function (l) { return l.categoria === C.CATEGORIA.CUSTO_VIDA; });
      if (!doMes.length) continue;
      soma += Math.abs(FOS.Core.sum(doMes, function (l) { return Number(l.valor_origem); }));
      observados++;
    }
    if (!observados) return FOS.Core.insufficient('SEM_CUSTO_VIDA_OBSERVADO');
    var media = FOS.Core.value(FOS.Core.round2(soma / observados));
    media.meses_observados = observados;
    return media;
  }

  /**
   * Funções do dinheiro: para que serve cada real do caixa de vida.
   * PROTECAO = provisões acumuladas; OBJETIVOS = objetivos acumulados;
   * PASSIVOS_ABERTOS = dívida com terceiro ainda não quitada, deduzida
   * INTEGRALMENTE (não proporcional ao prazo: não é seu em nenhuma fração);
   * LIVRE = o que sobra (pode ser negativo, e isso é informação, não erro).
   *
   * @param {number} [passivosAbertoTotal] soma de valor_aberto dos passivos
   *   vigentes na competência. Omitido (ou 0) quando não há passivo algum.
   */
  function funcoesDoDinheiro(caixa, provisoes, objetivos, passivosAbertoTotal) {
    if (!FOS.Core.isOk(caixa)) {
      return {
        status: caixa.status, reason: caixa.reason,
        protecao: null, objetivos: null, passivos_abertos: null, livre: null, total: null
      };
    }
    var protecao = FOS.Core.sum(provisoes, function (p) { return Number(p.valor_acumulado) || 0; });
    var objetivo = FOS.Core.sum(objetivos, function (o) { return Number(o.valor_acumulado) || 0; });
    var passivos = Number(passivosAbertoTotal) || 0;
    return {
      status: 'OK',
      reason: null,
      protecao: protecao,
      objetivos: objetivo,
      passivos_abertos: passivos,
      livre: FOS.Core.round2(caixa.value - protecao - objetivo - passivos),
      total: caixa.value
    };
  }

  /** Disponível = caixa de vida menos o que já tem função definida. */
  function disponivel(caixa, funcoes) {
    if (!FOS.Core.isOk(caixa)) return FOS.Core.nullValue(caixa.reason || 'CAIXA_INDISPONIVEL');
    if (funcoes.status !== 'OK') return FOS.Core.nullValue(funcoes.reason || 'FUNCOES_INDISPONIVEIS');
    return FOS.Core.value(funcoes.livre);
  }

  /** Runway em meses: disponível dividido pelo custo de vida médio. */
  function runway(disponivelManaged, custoMedio) {
    if (!FOS.Core.isOk(disponivelManaged)) {
      return FOS.Core.nullValue(disponivelManaged.reason || 'DISPONIVEL_INDISPONIVEL');
    }
    if (!FOS.Core.isOk(custoMedio)) {
      return FOS.Core.insufficient(custoMedio.reason || 'CUSTO_MEDIO_INDISPONIVEL');
    }
    if (custoMedio.value <= 0) {
      return FOS.Core.nullValue('CUSTO_VIDA_MEDIO_NAO_POSITIVO');
    }
    return FOS.Core.value(FOS.Core.round2(disponivelManaged.value / custoMedio.value));
  }

  FOS.Life = {
    PARAM_SALDO_INICIAL: PARAM_SALDO_INICIAL,
    PARAM_COMPETENCIA_INICIAL: PARAM_COMPETENCIA_INICIAL,
    PARAM_MESES_MEDIA_CUSTO: PARAM_MESES_MEDIA_CUSTO,
    caixaVida: caixaVida,
    custoVidaMes: custoVidaMes,
    custoVidaMedio: custoVidaMedio,
    funcoesDoDinheiro: funcoesDoDinheiro,
    disponivel: disponivel,
    runway: runway
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
