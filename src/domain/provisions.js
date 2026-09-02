/**
 * Provisões (aba 30) — status e alocação.
 *
 * Regras canônicas de status:
 *  1. valor_faltante <= 0                          -> COBERTA
 *  2. vencida e ainda descoberta                   -> EM_RISCO
 *  3. menos de 2 fechamentos de histórico          -> DADO_INSUFICIENTE
 *  4. caso contrário, ritmo observado nos 2 últimos fechamentos
 *     comparado ao ritmo necessário                -> EM_RITMO | FORA_DE_RITMO
 *
 * Desempate de alocação: vencimento mais próximo, depois prioridade
 * explícita, depois rateio proporcional ao valor faltante.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var S = FOS.Constants.STATUS_PROVISAO;

  function faltante(provisao) {
    var alvo = Number(FOS.Config.parseNumber(provisao.valor_alvo) || 0);
    var acumulado = Number(FOS.Config.parseNumber(provisao.valor_acumulado) || 0);
    return FOS.Core.round2(alvo - acumulado);
  }

  /**
   * @param {Object} provisao versão corrente
   * @param {Object} contexto
   * @param {string} contexto.dataReferencia data do fechamento (ISO)
   * @param {string} contexto.competencia competência do fechamento
   * @param {Array<{competencia:string, valor_acumulado:number}>} contexto.historico
   *        acumulados nos fechamentos anteriores, do mais antigo ao mais recente
   * @param {number} contexto.fechamentosMinimos parâmetro (padrão 2)
   */
  function avaliar(provisao, contexto) {
    var minimo = contexto.fechamentosMinimos === undefined ? 2 : contexto.fechamentosMinimos;
    var falta = faltante(provisao);
    var base = {
      provisao_id: provisao.provisao_id,
      nome: provisao.nome,
      valor_alvo: Number(FOS.Config.parseNumber(provisao.valor_alvo) || 0),
      valor_acumulado: Number(FOS.Config.parseNumber(provisao.valor_acumulado) || 0),
      valor_faltante: falta,
      vencimento: provisao.vencimento || null,
      prioridade: FOS.Config.parseNumber(provisao.prioridade),
      moeda: provisao.moeda || null,
      ritmo_observado: null,
      ritmo_necessario: null,
      meses_restantes: null,
      motivo: null
    };

    if (falta <= 0) {
      base.status = S.COBERTA;
      base.motivo = 'VALOR_FALTANTE_NAO_POSITIVO';
      return base;
    }

    var venceu = provisao.vencimento && FOS.Dates.isIso(String(provisao.vencimento))
      && FOS.Dates.diffDays(String(provisao.vencimento), contexto.dataReferencia) < 0;
    if (venceu) {
      base.status = S.EM_RISCO;
      base.motivo = 'VENCIDA_E_DESCOBERTA';
      return base;
    }

    var historico = (contexto.historico || []).filter(function (h) {
      return FOS.Config.parseNumber(h.valor_acumulado) !== null;
    });
    if (historico.length < minimo) {
      base.status = S.DADO_INSUFICIENTE;
      base.motivo = 'HISTORICO_MENOR_QUE_' + minimo + '_FECHAMENTOS';
      return base;
    }

    var ultimos = historico.slice(-minimo);
    var acumuladoInicial = Number(FOS.Config.parseNumber(ultimos[0].valor_acumulado));
    var ritmoObservado = FOS.Core.round2((base.valor_acumulado - acumuladoInicial) / minimo);

    var mesesRestantes = null;
    if (provisao.vencimento && FOS.Dates.isIso(String(provisao.vencimento))) {
      mesesRestantes = FOS.Dates.monthsBetween(
        contexto.competencia,
        FOS.Dates.competenciaOf(String(provisao.vencimento))
      );
    }
    if (mesesRestantes === null || mesesRestantes < 1) mesesRestantes = 1;
    var ritmoNecessario = FOS.Core.round2(falta / mesesRestantes);

    base.ritmo_observado = ritmoObservado;
    base.ritmo_necessario = ritmoNecessario;
    base.meses_restantes = mesesRestantes;
    base.status = ritmoObservado >= ritmoNecessario ? S.EM_RITMO : S.FORA_DE_RITMO;
    base.motivo = base.status === S.EM_RITMO ? 'RITMO_SUFICIENTE' : 'RITMO_INSUFICIENTE';
    return base;
  }

  function chaveDesempate(p) {
    var venc = p.vencimento && FOS.Dates.isIso(String(p.vencimento)) ? String(p.vencimento) : '9999-12-31';
    var prio = p.prioridade === null || p.prioridade === undefined ? 9999 : Number(p.prioridade);
    // Prioridade zero-padded: a chave é comparada como texto e "10" não pode
    // vir antes de "2".
    var prioTexto = String(Math.max(0, Math.min(99999, Math.round(prio))));
    while (prioTexto.length < 5) prioTexto = '0' + prioTexto;
    return venc + '|' + prioTexto;
  }

  /**
   * Aloca uma capacidade limitada entre provisões descobertas.
   * Ordem: vencimento mais próximo -> prioridade explícita -> proporcional.
   * @param {Array} avaliacoes saída de avaliar()
   * @param {number} capacidade
   */
  function alocar(avaliacoes, capacidade) {
    var restante = FOS.Core.round2(Number(capacidade) || 0);
    var alvos = (avaliacoes || []).filter(function (p) { return p.valor_faltante > 0; });
    var ordenadas = FOS.Core.sortBy(alvos, [
      function (p) { return chaveDesempate(p); },
      function (p) { return String(p.provisao_id); }
    ]);

    var grupos = [];
    var indicePorChave = {};
    ordenadas.forEach(function (p) {
      var k = chaveDesempate(p);
      if (indicePorChave[k] === undefined) {
        indicePorChave[k] = grupos.length;
        grupos.push({ chave: k, itens: [] });
      }
      grupos[indicePorChave[k]].itens.push(p);
    });

    var resultado = [];
    grupos.forEach(function (g) {
      var totalGrupo = FOS.Core.sum(g.itens, function (p) { return p.valor_faltante; });
      if (restante <= 0) {
        g.itens.forEach(function (p) {
          resultado.push({ provisao_id: p.provisao_id, alocado: 0, criterio: 'SEM_CAPACIDADE' });
        });
        return;
      }
      if (restante >= totalGrupo) {
        g.itens.forEach(function (p) {
          resultado.push({ provisao_id: p.provisao_id, alocado: p.valor_faltante, criterio: 'INTEGRAL' });
        });
        restante = FOS.Core.round2(restante - totalGrupo);
        return;
      }
      if (g.itens.length === 1) {
        resultado.push({ provisao_id: g.itens[0].provisao_id, alocado: restante, criterio: 'PARCIAL' });
        restante = 0;
        return;
      }
      // Empate real em vencimento e prioridade: rateio proporcional ao faltante.
      var capacidadeGrupo = restante;
      var distribuido = 0;
      g.itens.forEach(function (p, idx) {
        var parcela;
        if (idx === g.itens.length - 1) {
          parcela = FOS.Core.round2(capacidadeGrupo - distribuido);
        } else {
          parcela = FOS.Core.round2(capacidadeGrupo * (p.valor_faltante / totalGrupo));
          distribuido = FOS.Core.round2(distribuido + parcela);
        }
        resultado.push({ provisao_id: p.provisao_id, alocado: parcela, criterio: 'PROPORCIONAL' });
      });
      restante = 0;
    });

    return { alocacoes: resultado, capacidade_restante: restante };
  }

  FOS.Provisions = { faltante: faltante, avaliar: avaliar, alocar: alocar, chaveDesempate: chaveDesempate };
})(typeof globalThis !== 'undefined' ? globalThis : this);
