/**
 * Ledger de posições (aba 32) — event sourcing append-only.
 *
 * Quatro eventos: APORTE, RETIRADA, DISTRIBUICAO e SNAPSHOT_VALOR_MERCADO.
 * Correção NUNCA é update: é evento compensatório.
 *  - eventos aditivos (APORTE/RETIRADA/DISTRIBUICAO): o compensatório tem o
 *    mesmo tipo e valor exatamente inverso, e ambos permanecem no ledger;
 *  - SNAPSHOT: o compensatório substitui o snapshot referenciado, que passa
 *    a ser ignorado na projeção (mas continua no histórico).
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;
  var E = C.EVENTO_POSICAO;

  var ADITIVOS = [E.APORTE, E.RETIRADA, E.DISTRIBUICAO];

  function validarEvento(evento, eventosExistentes) {
    var erros = [];
    var tipo = String(evento.tipo_evento || '').toUpperCase();
    if (!C.isValid(E, tipo)) {
      erros.push({ codigo: 'TIPO_EVENTO_POSICAO_INVALIDO', detalhe: String(evento.tipo_evento) });
      return { ok: false, erros: erros };
    }
    if (!FOS.Dates.isIso(String(evento.data))) {
      erros.push({ codigo: 'DATA_INVALIDA', detalhe: String(evento.data) });
    }
    if (String(evento.posicao_id || '').trim() === '') {
      erros.push({ codigo: 'POSICAO_OBRIGATORIA', detalhe: '' });
    }
    var valor = FOS.Normalize.valor(evento.valor);
    if (valor === null) {
      erros.push({ codigo: 'VALOR_INVALIDO', detalhe: String(evento.valor) });
    }
    var compensa = String(evento.compensa_evento_id || '').trim();
    if (compensa === '') {
      if (valor !== null && valor <= 0) {
        erros.push({
          codigo: 'VALOR_NAO_POSITIVO',
          detalhe: 'Evento não compensatório exige valor positivo; use evento compensatório para corrigir'
        });
      }
    } else {
      var original = (eventosExistentes || []).filter(function (e) {
        return String(e.evento_id) === compensa;
      })[0];
      if (!original) {
        erros.push({ codigo: 'EVENTO_COMPENSADO_INEXISTENTE', detalhe: compensa });
      } else {
        if (String(original.posicao_id) !== String(evento.posicao_id)) {
          erros.push({ codigo: 'COMPENSACAO_POSICAO_DIFERENTE', detalhe: compensa });
        }
        if (String(original.tipo_evento).toUpperCase() !== tipo) {
          erros.push({ codigo: 'COMPENSACAO_TIPO_DIFERENTE', detalhe: compensa });
        }
        if (ADITIVOS.indexOf(tipo) !== -1) {
          var esperado = FOS.Core.round2(-Number(FOS.Normalize.valor(original.valor)));
          if (valor !== esperado) {
            erros.push({
              codigo: 'COMPENSACAO_VALOR_INVALIDO',
              detalhe: 'esperado ' + esperado + ' para compensar ' + compensa + ', recebido ' + valor
            });
          }
        }
      }
    }
    return { ok: erros.length === 0, erros: erros };
  }

  function snapshotsSuperseded(eventos) {
    var superseded = {};
    (eventos || []).forEach(function (e) {
      var compensa = String(e.compensa_evento_id || '').trim();
      if (compensa && String(e.tipo_evento).toUpperCase() === E.SNAPSHOT_VALOR_MERCADO) {
        superseded[compensa] = true;
      }
    });
    return superseded;
  }

  /**
   * Projeta o estado de cada posição a partir dos eventos.
   * @param {Array} eventos
   * @param {{ateData?:string, maxDiasSnapshot?:number}} [opcoes]
   */
  function projetar(eventos, opcoes) {
    var opts = opcoes || {};
    var superseded = snapshotsSuperseded(eventos);
    var lista = FOS.Core.sortBy((eventos || []).filter(function (e) {
      if (opts.ateData && FOS.Dates.diffDays(String(e.data), opts.ateData) > 0) return false;
      return true;
    }), [
      function (e) { return String(e.data); },
      function (e) { return String(e.evento_id); }
    ]);

    var posicoes = {};
    lista.forEach(function (e) {
      var id = String(e.posicao_id);
      var p = posicoes[id] = posicoes[id] || {
        posicao_id: id,
        moeda: String(e.moeda || '').toUpperCase(),
        capital_investido: 0,
        distribuicoes: 0,
        quantidade: 0,
        valor_mercado: null,
        data_snapshot: null,
        snapshot_status: 'AUSENTE',
        eventos_aplicados: 0,
        moedas_conflitantes: false
      };
      if (p.moeda && String(e.moeda || '').toUpperCase() && p.moeda !== String(e.moeda).toUpperCase()) {
        p.moedas_conflitantes = true;
      }
      var tipo = String(e.tipo_evento).toUpperCase();
      var valor = Number(FOS.Normalize.valor(e.valor));
      var qtd = FOS.Config.parseNumber(e.quantidade);
      p.eventos_aplicados++;
      if (tipo === E.APORTE) {
        p.capital_investido = FOS.Core.round2(p.capital_investido + valor);
        if (qtd !== null) p.quantidade = FOS.Core.round2(p.quantidade + qtd);
      } else if (tipo === E.RETIRADA) {
        p.capital_investido = FOS.Core.round2(p.capital_investido - valor);
        if (qtd !== null) p.quantidade = FOS.Core.round2(p.quantidade - qtd);
      } else if (tipo === E.DISTRIBUICAO) {
        p.distribuicoes = FOS.Core.round2(p.distribuicoes + valor);
      } else if (tipo === E.SNAPSHOT_VALOR_MERCADO) {
        if (!superseded[String(e.evento_id)]) {
          p.valor_mercado = FOS.Core.round2(valor);
          p.data_snapshot = String(e.data);
          p.snapshot_status = 'OK';
        }
      }
    });

    Object.keys(posicoes).forEach(function (id) {
      var p = posicoes[id];
      if (p.valor_mercado === null) {
        p.snapshot_status = 'AUSENTE';
        p.resultado_nao_realizado = null;
      } else {
        if (opts.maxDiasSnapshot && opts.ateData
          && FOS.Dates.diffDays(opts.ateData, p.data_snapshot) > opts.maxDiasSnapshot) {
          p.snapshot_status = 'STALE';
        }
        p.resultado_nao_realizado = FOS.Core.round2(p.valor_mercado - p.capital_investido);
      }
    });

    return posicoes;
  }

  function listar(projecao) {
    return FOS.Core.sortBy(Object.keys(projecao).map(function (k) { return projecao[k]; }),
      [function (p) { return p.posicao_id; }]);
  }

  /** Posições sem snapshot ativo — bloqueiam o fechamento. */
  function semSnapshot(projecao) {
    return listar(projecao).filter(function (p) { return p.snapshot_status === 'AUSENTE'; });
  }

  /** Cria o evento compensatório correto para um evento aditivo existente. */
  function eventoCompensatorio(original, novoId, agora, motivo) {
    var tipo = String(original.tipo_evento).toUpperCase();
    if (ADITIVOS.indexOf(tipo) === -1) {
      FOS.Core.fail('COMPENSACAO_NAO_SUPORTADA',
        'Snapshot é corrigido por novo snapshot compensatório, não por inversão de valor');
    }
    return {
      evento_id: novoId,
      posicao_id: original.posicao_id,
      tipo_evento: tipo,
      data: original.data,
      valor: FOS.Core.round2(-Number(FOS.Normalize.valor(original.valor))),
      moeda: original.moeda,
      quantidade: FOS.Config.parseNumber(original.quantidade) === null
        ? '' : FOS.Core.round2(-Number(original.quantidade)),
      compensa_evento_id: original.evento_id,
      origem: 'COMPENSACAO',
      criado_em: agora,
      observacao: motivo || 'Evento compensatório'
    };
  }

  FOS.Positions = {
    ADITIVOS: ADITIVOS,
    validarEvento: validarEvento,
    projetar: projetar,
    listar: listar,
    semSnapshot: semSnapshot,
    eventoCompensatorio: eventoCompensatorio
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
