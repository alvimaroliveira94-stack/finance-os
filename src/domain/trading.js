/**
 * Métricas de trading — QUATRO números independentes.
 *
 * Decisão canônica: não existe "resultado líquido de trading" misturando
 * moedas. As quatro métricas são reportadas lado a lado, cada uma com sua
 * moeda e seu próprio status:
 *   1. caixa retirado (BRL)          — o que efetivamente chegou na vida
 *   2. P&L operacional (GBP)         — final - inicial + saques - aportes
 *   3. resultado da reserva (BRL)    — final - inicial + retiradas - aportes
 *   4. custo operacional (BRL)       — custo de trading pago pela conta de vida
 *
 * Custo operacional pago pelo Inter é categoria CUSTO_TRADING: é custo,
 * nunca aporte de capital.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  function saldoNaData(saldos, contaId, dataLimite, incluirLimite) {
    var candidatos = (saldos || []).filter(function (s) {
      if (String(s.conta_id) !== String(contaId)) return false;
      var d = FOS.Dates.diffDays(String(s.data_referencia), dataLimite);
      return incluirLimite ? d <= 0 : d < 0;
    });
    if (!candidatos.length) return null;
    var ordenados = FOS.Core.sortBy(candidatos, [
      function (s) { return String(s.data_referencia); },
      function (s) { return String(s.registro_id); }
    ]);
    var ultimo = ordenados[ordenados.length - 1];
    return {
      saldo: FOS.Core.round2(Number(FOS.Normalize.valor(ultimo.saldo))),
      data: String(ultimo.data_referencia),
      registro_id: ultimo.registro_id
    };
  }

  function contasTrading(config, moeda) {
    return config.contasPorUniverso(C.UNIVERSO.TRADING).filter(function (c) {
      return c.ativa && (!moeda || c.moeda === moeda);
    });
  }

  function eventosDaCompetencia(eventos, competencia, tipo) {
    return (eventos || []).filter(function (e) {
      if (String(e.tipo_evento).toUpperCase() !== tipo) return false;
      if (String(e.status || '') === FOS.Events.STATUS_EVENTO.CANCELADO) return false;
      return FOS.Dates.inCompetencia(String(e.data), competencia);
    });
  }

  /** 1. Caixa retirado em BRL: créditos SAQUE_TRADING no ledger da competência. */
  function caixaRetiradoBrl(linhasLedger, competencia) {
    var linhas = FOS.Ledger.daCompetencia(linhasLedger, competencia)
      .filter(function (l) { return l.categoria === C.CATEGORIA.SAQUE_TRADING; });
    return FOS.Core.value(FOS.Core.sum(linhas, function (l) { return Number(l.valor_origem); }));
  }

  /**
   * 2. P&L operacional em GBP.
   * Exige capital inicial e final medidos por saldos semanais e o valor em
   * GBP dos saques/aportes do período (campo valor_origem_moeda do evento).
   */
  function pnlOperacionalGbp(params) {
    var config = params.config;
    var saldos = params.saldos;
    var eventos = params.eventos;
    var competencia = params.competencia;
    var range = FOS.Dates.competenciaRange(competencia);
    var contas = contasTrading(config, C.MOEDA.GBP);
    if (!contas.length) {
      return FOS.Core.nullValue('SEM_CONTAS_TRADING_GBP');
    }

    var inicial = 0;
    var final = 0;
    var faltando = [];
    contas.forEach(function (conta) {
      var ini = saldoNaData(saldos, conta.conta_id, range.inicio, false);
      var fim = saldoNaData(saldos, conta.conta_id, range.fim, true);
      if (!ini) faltando.push('SALDO_INICIAL_AUSENTE:' + conta.conta_id);
      if (!fim) faltando.push('SALDO_FINAL_AUSENTE:' + conta.conta_id);
      if (ini) inicial = FOS.Core.round2(inicial + ini.saldo);
      if (fim) final = FOS.Core.round2(final + fim.saldo);
    });
    if (faltando.length) {
      return FOS.Core.insufficient(faltando.join(';'));
    }

    var saques = eventosDaCompetencia(eventos, competencia, C.TIPO_EVENTO.SAQUE_TRADING);
    var aportes = eventosDaCompetencia(eventos, competencia, C.TIPO_EVENTO.APORTE_EXTRAORDINARIO);
    var semGbp = saques.concat(aportes).filter(function (e) {
      return String(e.moeda_origem || '').toUpperCase() !== C.MOEDA.GBP
        || FOS.Normalize.valor(e.valor_origem_moeda) === null;
    });
    if (semGbp.length) {
      return FOS.Core.nullValue('EVENTO_SEM_VALOR_EM_GBP:' + semGbp.map(function (e) {
        return e.evento_id;
      }).join(','));
    }

    var saquesGbp = FOS.Core.sum(saques, function (e) { return Math.abs(FOS.Normalize.valor(e.valor_origem_moeda)); });
    var aportesGbp = FOS.Core.sum(aportes, function (e) { return Math.abs(FOS.Normalize.valor(e.valor_origem_moeda)); });

    var pnl = FOS.Core.round2(final - inicial + saquesGbp - aportesGbp);
    var out = FOS.Core.value(pnl);
    out.componentes = {
      capital_inicial_gbp: inicial,
      capital_final_gbp: final,
      saques_gbp: saquesGbp,
      aportes_extraordinarios_gbp: aportesGbp
    };
    return out;
  }

  /** 3. Resultado da reserva BRL: final - inicial + retiradas - aportes. */
  function resultadoReservaBrl(params) {
    var config = params.config;
    var contaId = params.contaReserva;
    var competencia = params.competencia;
    var range = FOS.Dates.competenciaRange(competencia);
    var conta = config.conta(contaId);
    if (!conta) return FOS.Core.nullValue('CONTA_RESERVA_DESCONHECIDA:' + contaId);

    var ini = saldoNaData(params.saldos, contaId, range.inicio, false);
    var fim = saldoNaData(params.saldos, contaId, range.fim, true);
    if (!ini || !fim) {
      return FOS.Core.insufficient(!ini ? 'SALDO_INICIAL_AUSENTE:' + contaId : 'SALDO_FINAL_AUSENTE:' + contaId);
    }

    var retiradas = FOS.Core.sum(
      eventosDaCompetencia(params.eventos, competencia, C.TIPO_EVENTO.SAQUE_TRADING)
        .filter(function (e) { return String(e.conta_origem) === contaId; }),
      function (e) { return Math.abs(FOS.Normalize.valor(e.valor)); }
    );
    var aportes = FOS.Core.sum(
      eventosDaCompetencia(params.eventos, competencia, C.TIPO_EVENTO.APORTE_EXTRAORDINARIO)
        .filter(function (e) { return String(e.conta_destino) === contaId; }),
      function (e) { return Math.abs(FOS.Normalize.valor(e.valor)); }
    );

    var resultado = FOS.Core.round2(fim.saldo - ini.saldo + retiradas - aportes);
    var out = FOS.Core.value(resultado);
    out.componentes = {
      saldo_inicial: ini.saldo,
      saldo_final: fim.saldo,
      retiradas: retiradas,
      aportes: aportes
    };
    return out;
  }

  /** 4. Custo operacional de trading em BRL (pago pela conta de vida). */
  function custoOperacionalBrl(linhasLedger, competencia) {
    var linhas = FOS.Ledger.daCompetencia(linhasLedger, competencia)
      .filter(function (l) { return l.categoria === C.CATEGORIA.CUSTO_TRADING; });
    return FOS.Core.value(Math.abs(FOS.Core.sum(linhas, function (l) { return Number(l.valor_origem); })));
  }

  /**
   * As quatro métricas juntas. Deliberadamente sem campo "total": qualquer
   * soma entre elas misturaria moedas e naturezas diferentes.
   */
  function metricas(params) {
    return {
      competencia: params.competencia,
      caixa_retirado_brl: caixaRetiradoBrl(params.linhas, params.competencia),
      pnl_operacional_gbp: pnlOperacionalGbp(params),
      resultado_reserva_brl: resultadoReservaBrl(params),
      custo_operacional_brl: custoOperacionalBrl(params.linhas, params.competencia)
    };
  }

  /** Capital de trading em GBP no fim da competência (para patrimônio/efeito cambial). */
  function capitalTradingGbp(config, saldos, competencia) {
    var range = FOS.Dates.competenciaRange(competencia);
    var contas = contasTrading(config, C.MOEDA.GBP);
    var total = 0;
    var faltando = [];
    contas.forEach(function (conta) {
      var s = saldoNaData(saldos, conta.conta_id, range.fim, true);
      if (!s) faltando.push(conta.conta_id);
      else total = FOS.Core.round2(total + s.saldo);
    });
    if (faltando.length) return FOS.Core.insufficient('SALDO_AUSENTE:' + faltando.join(','));
    return FOS.Core.value(total);
  }

  FOS.Trading = {
    saldoNaData: saldoNaData,
    contasTrading: contasTrading,
    caixaRetiradoBrl: caixaRetiradoBrl,
    pnlOperacionalGbp: pnlOperacionalGbp,
    resultadoReservaBrl: resultadoReservaBrl,
    custoOperacionalBrl: custoOperacionalBrl,
    capitalTradingGbp: capitalTradingGbp,
    metricas: metricas
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
