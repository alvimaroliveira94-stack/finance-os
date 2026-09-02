/**
 * Ciclo de 90 dias — SETE sinais binários independentes.
 *
 * Decisão canônica: não existe score, nota ou índice composto. Cada sinal é
 * verdadeiro, falso ou DADO_INSUFICIENTE, e é lido isoladamente.
 * Nenhum sinal dispara ação automática: sinal é leitura, não execução.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;
  var S = C.SINAL;

  var PARAM_LIMITE_GASTO_EXTRA = 'LIMITE_GASTO_EXTRAORDINARIO_PCT_CAIXA_VIDA';
  var PARAM_QUEDA_RUNWAY = 'QUEDA_RUNWAY_PCT_SINAL';
  var PARAM_MES_FORTE = 'MES_FORTE_PCT_ACIMA_MEDIA';
  var PARAM_FECHAMENTOS_MES_FORTE = 'FECHAMENTOS_MINIMOS_MES_FORTE';

  function sinal(codigo, valor, detalhe) {
    return { codigo: codigo, valor: valor, status: 'OK', reason: null, detalhe: detalhe || null };
  }
  function sinalInsuficiente(codigo, reason) {
    return { codigo: codigo, valor: null, status: 'DADO_INSUFICIENTE', reason: reason, detalhe: null };
  }
  function sinalNulo(codigo, reason) {
    return { codigo: codigo, valor: null, status: 'NULL', reason: reason, detalhe: null };
  }

  function anterior(ctx) {
    var lista = ctx.fechamentosAnteriores || [];
    return lista.length ? lista[lista.length - 1] : null;
  }

  /** 1. Redução de proteção: provisões acumuladas caíram em relação ao mês anterior. */
  function reducaoProtecao(ctx) {
    var ant = anterior(ctx);
    if (!ant) return sinalInsuficiente(S.REDUCAO_PROTECAO, 'SEM_FECHAMENTO_ANTERIOR');
    var atualTotal = FOS.Core.sum(ctx.provisoes, function (p) { return Number(p.valor_acumulado) || 0; });
    var antTotal = Number(ant.protecao_total);
    if (!Number.isFinite(antTotal)) return sinalNulo(S.REDUCAO_PROTECAO, 'PROTECAO_ANTERIOR_INDISPONIVEL');
    return sinal(S.REDUCAO_PROTECAO, atualTotal < antTotal,
      'protecao_anterior=' + antTotal + '; protecao_atual=' + atualTotal);
  }

  /** 2. Gasto extraordinário anormal: acima do limite reversível sobre o caixa de vida. */
  function gastoExtraordinarioAnormal(ctx) {
    var limite = ctx.config.param(PARAM_LIMITE_GASTO_EXTRA);
    if (limite.value === null) return sinalNulo(S.GASTO_EXTRAORDINARIO_ANORMAL, limite.reason || 'LIMITE_INDISPONIVEL');
    if (!FOS.Core.isOk(ctx.caixaVida)) {
      return sinalNulo(S.GASTO_EXTRAORDINARIO_ANORMAL, ctx.caixaVida.reason || 'CAIXA_VIDA_INDISPONIVEL');
    }
    var gastos = Math.abs(FOS.Core.sum(
      FOS.Ledger.daCompetencia(ctx.linhas, ctx.competencia).filter(function (l) {
        return l.categoria === C.CATEGORIA.GASTO_EXTRAORDINARIO;
      }),
      function (l) { return Number(l.valor_origem); }
    ));
    var teto = FOS.Core.round2(ctx.caixaVida.value * Number(limite.value));
    return sinal(S.GASTO_EXTRAORDINARIO_ANORMAL, gastos > teto,
      'gastos=' + gastos + '; teto=' + teto + ' (' + limite.value + ' do caixa de vida)');
  }

  /** 3. Vida para Trading: houve aporte extraordinário saindo do caixa de vida. */
  function vidaParaTrading(ctx) {
    var aportes = (ctx.eventos || []).filter(function (e) {
      return String(e.tipo_evento).toUpperCase() === C.TIPO_EVENTO.APORTE_EXTRAORDINARIO
        && String(e.status || '') !== FOS.Events.STATUS_EVENTO.CANCELADO
        && FOS.Dates.inCompetencia(String(e.data), ctx.competencia);
    });
    return sinal(S.VIDA_PARA_TRADING, aportes.length > 0, 'eventos=' + aportes.length);
  }

  /** 4. Reserva fora da finalidade: provisão aberta teve acumulado reduzido. */
  function reservaForaDaFinalidade(ctx) {
    var ant = anterior(ctx);
    if (!ant) return sinalInsuficiente(S.RESERVA_FORA_DA_FINALIDADE, 'SEM_FECHAMENTO_ANTERIOR');
    var anteriores = {};
    (ant.provisoes || []).forEach(function (p) { anteriores[String(p.provisao_id)] = p; });
    var desviadas = (ctx.provisoes || []).filter(function (p) {
      var a = anteriores[String(p.provisao_id)];
      if (!a) return false;
      var caiu = Number(p.valor_acumulado) < Number(a.valor_acumulado);
      if (!caiu) return false;
      var venceu = p.vencimento && FOS.Dates.isIso(String(p.vencimento))
        && FOS.Dates.diffDays(String(p.vencimento), ctx.dataReferencia) <= 0;
      return !venceu; // queda antes do vencimento = uso fora da finalidade
    });
    return sinal(S.RESERVA_FORA_DA_FINALIDADE, desviadas.length > 0,
      desviadas.map(function (p) { return p.provisao_id; }).join(',') || null);
  }

  /** 5. Queda de runway acima do percentual configurado. */
  function quedaRunway(ctx) {
    var pct = ctx.config.param(PARAM_QUEDA_RUNWAY);
    if (pct.value === null) return sinalNulo(S.QUEDA_RUNWAY, pct.reason || 'PARAMETRO_INDISPONIVEL');
    var ant = anterior(ctx);
    if (!ant) return sinalInsuficiente(S.QUEDA_RUNWAY, 'SEM_FECHAMENTO_ANTERIOR');
    if (!FOS.Core.isOk(ctx.runway)) return sinalNulo(S.QUEDA_RUNWAY, ctx.runway.reason || 'RUNWAY_INDISPONIVEL');
    var antRunway = Number(ant.runway_meses);
    if (!Number.isFinite(antRunway)) return sinalInsuficiente(S.QUEDA_RUNWAY, 'RUNWAY_ANTERIOR_INDISPONIVEL');
    if (antRunway <= 0) return sinalNulo(S.QUEDA_RUNWAY, 'RUNWAY_ANTERIOR_NAO_POSITIVO');
    var queda = FOS.Core.round2((antRunway - ctx.runway.value) / antRunway);
    return sinal(S.QUEDA_RUNWAY, queda > Number(pct.value),
      'queda=' + queda + '; limite=' + pct.value);
  }

  /** 6. Compromisso sem provisão: obrigação declarada sem provisão correspondente. */
  function compromissoSemProvisao(ctx) {
    var idsProvisoes = {};
    (ctx.provisoes || []).forEach(function (p) { idsProvisoes[String(p.provisao_id)] = true; });
    var obrigacoes = (ctx.eventos || []).filter(function (e) {
      return String(e.tipo_evento).toUpperCase() === C.TIPO_EVENTO.NOVA_OBRIGACAO
        && String(e.status || '') !== FOS.Events.STATUS_EVENTO.CANCELADO
        && FOS.Dates.inCompetencia(String(e.data), ctx.competencia);
    });
    var descobertas = obrigacoes.filter(function (e) { return !idsProvisoes[String(e.referencia_id)]; });
    return sinal(S.COMPROMISSO_SEM_PROVISAO, descobertas.length > 0,
      descobertas.map(function (e) { return e.evento_id; }).join(',') || null);
  }

  /**
   * 7. Retirada ou redução alocativa do patrimônio após mês forte.
   * Exige o mínimo de fechamentos anteriores (parâmetro, padrão 3) para que
   * exista base de comparação de "mês forte".
   */
  function retiradaAposMesForte(ctx) {
    var minimo = ctx.config.param(PARAM_FECHAMENTOS_MES_FORTE).value;
    if (minimo === null) minimo = 3;
    var anteriores = ctx.fechamentosAnteriores || [];
    if (anteriores.length < Number(minimo)) {
      return sinalInsuficiente(S.RETIRADA_APOS_MES_FORTE,
        'HISTORICO_MENOR_QUE_' + minimo + '_FECHAMENTOS');
    }
    var pct = ctx.config.param(PARAM_MES_FORTE);
    if (pct.value === null) return sinalNulo(S.RETIRADA_APOS_MES_FORTE, pct.reason || 'PARAMETRO_INDISPONIVEL');

    var base = anteriores.slice(-Number(minimo));
    var valores = base.map(function (f) { return Number(f.caixa_retirado_brl); })
      .filter(function (v) { return Number.isFinite(v); });
    if (valores.length < Number(minimo)) {
      return sinalInsuficiente(S.RETIRADA_APOS_MES_FORTE, 'CAIXA_RETIRADO_ANTERIOR_INDISPONIVEL');
    }
    var media = FOS.Core.round2(FOS.Core.sum(valores) / valores.length);
    var atual = FOS.Core.isOk(ctx.caixaRetiradoBrl) ? ctx.caixaRetiradoBrl.value : null;
    if (atual === null) return sinalNulo(S.RETIRADA_APOS_MES_FORTE, 'CAIXA_RETIRADO_ATUAL_INDISPONIVEL');
    var mesForte = atual > FOS.Core.round2(media * (1 + Number(pct.value)));

    var houveRetirada = (ctx.eventos || []).some(function (e) {
      return String(e.tipo_evento).toUpperCase() === C.TIPO_EVENTO.RETIRADA_POSICAO
        && String(e.status || '') !== FOS.Events.STATUS_EVENTO.CANCELADO
        && FOS.Dates.inCompetencia(String(e.data), ctx.competencia);
    });
    var reducaoAlocativa = false;
    var ant = anterior(ctx);
    if (ant && Number.isFinite(Number(ant.patrimonio_capital_investido))) {
      reducaoAlocativa = Number(ctx.patrimonioCapitalInvestido) < Number(ant.patrimonio_capital_investido);
    }
    return sinal(S.RETIRADA_APOS_MES_FORTE, mesForte && (houveRetirada || reducaoAlocativa),
      'mes_forte=' + mesForte + '; retirada=' + houveRetirada + '; reducao_alocativa=' + reducaoAlocativa);
  }

  /** Os sete sinais, sempre na mesma ordem, sempre independentes. */
  function avaliarTodos(ctx) {
    return [
      reducaoProtecao(ctx),
      gastoExtraordinarioAnormal(ctx),
      vidaParaTrading(ctx),
      reservaForaDaFinalidade(ctx),
      quedaRunway(ctx),
      compromissoSemProvisao(ctx),
      retiradaAposMesForte(ctx)
    ];
  }

  FOS.Signals = {
    PARAM_LIMITE_GASTO_EXTRA: PARAM_LIMITE_GASTO_EXTRA,
    PARAM_QUEDA_RUNWAY: PARAM_QUEDA_RUNWAY,
    PARAM_MES_FORTE: PARAM_MES_FORTE,
    avaliarTodos: avaliarTodos,
    reducaoProtecao: reducaoProtecao,
    gastoExtraordinarioAnormal: gastoExtraordinarioAnormal,
    vidaParaTrading: vidaParaTrading,
    reservaForaDaFinalidade: reservaForaDaFinalidade,
    quedaRunway: quedaRunway,
    compromissoSemProvisao: compromissoSemProvisao,
    retiradaAposMesForte: retiradaAposMesForte
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
