/**
 * Estado do ciclo financeiro.
 *
 * Regras canônicas:
 *  - o estado SUGERIDO é contínuo (recalculado a cada fechamento);
 *  - o avanço FORMAL só ocorre após 2 fechamentos consecutivos sustentando
 *    o estado superior;
 *  - a regressão ocorre no PRIMEIRO fechamento que confirma a deterioração.
 * Assimetria proposital: subir exige confirmação, descer exige apenas o fato.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;
  var E = C.ESTADO_CICLO;
  var ORDEM = C.ORDEM_ESTADO_CICLO;

  var PARAM_RUNWAY_ESTABILIZANDO = 'RUNWAY_MINIMO_ESTABILIZANDO_MESES';
  var PARAM_RUNWAY_ESTAVEL = 'RUNWAY_MINIMO_ESTAVEL_MESES';
  var PARAM_RUNWAY_EXPANSAO = 'RUNWAY_MINIMO_EXPANSAO_MESES';
  var PARAM_FECHAMENTOS_AVANCO = 'FECHAMENTOS_PARA_AVANCO_ESTADO';

  function indice(estado) {
    return ORDEM.indexOf(estado);
  }

  /**
   * Estado sugerido a partir de runway e saúde das provisões.
   * @param {Object} params {config, runway (managed), provisoes (avaliações)}
   */
  function sugerir(params) {
    var runway = params.runway;
    if (!FOS.Core.isOk(runway)) {
      return {
        estado: null,
        status: runway && runway.status === 'DADO_INSUFICIENTE' ? 'DADO_INSUFICIENTE' : 'NULL',
        reason: (runway && runway.reason) || 'RUNWAY_INDISPONIVEL'
      };
    }
    var config = params.config;
    var lim1 = config.param(PARAM_RUNWAY_ESTABILIZANDO).value;
    var lim2 = config.param(PARAM_RUNWAY_ESTAVEL).value;
    var lim3 = config.param(PARAM_RUNWAY_EXPANSAO).value;
    if (lim1 === null || lim2 === null || lim3 === null) {
      return { estado: null, status: 'NULL', reason: 'LIMIARES_DE_ESTADO_INDISPONIVEIS' };
    }

    var estado;
    if (runway.value < Number(lim1)) estado = E.FRAGIL;
    else if (runway.value < Number(lim2)) estado = E.ESTABILIZANDO;
    else if (runway.value < Number(lim3)) estado = E.ESTAVEL;
    else estado = E.EXPANSAO;

    var provisoes = params.provisoes || [];
    var emRisco = provisoes.filter(function (p) { return p.status === C.STATUS_PROVISAO.EM_RISCO; });
    var foraDeRitmo = provisoes.filter(function (p) { return p.status === C.STATUS_PROVISAO.FORA_DE_RITMO; });
    var motivos = [];
    if (emRisco.length && indice(estado) > indice(E.ESTABILIZANDO)) {
      estado = E.ESTABILIZANDO;
      motivos.push('PROVISAO_EM_RISCO_LIMITA_ESTADO');
    }
    if (foraDeRitmo.length && indice(estado) > indice(E.ESTAVEL)) {
      estado = E.ESTAVEL;
      motivos.push('PROVISAO_FORA_DE_RITMO_LIMITA_EXPANSAO');
    }
    return {
      estado: estado,
      status: 'OK',
      reason: motivos.length ? motivos.join(';') : null,
      runway_meses: runway.value
    };
  }

  /**
   * Aplica avanço/regressão formal.
   * @param {Object} params
   * @param {?string} params.estadoFormalAnterior
   * @param {Array<?string>} params.sugeridosRecentes do mais antigo ao mais
   *        recente, INCLUINDO o estado sugerido do fechamento atual
   * @param {number} params.fechamentosParaAvanco
   */
  function aplicar(params) {
    var sugeridos = (params.sugeridosRecentes || []).slice();
    var atual = sugeridos.length ? sugeridos[sugeridos.length - 1] : null;
    var formalAnterior = params.estadoFormalAnterior || null;
    var minimo = Number(params.fechamentosParaAvanco || 2);

    if (!atual) {
      return {
        estado_formal: formalAnterior,
        estado_sugerido: null,
        movimento: 'DADO_INSUFICIENTE',
        motivo: 'ESTADO_SUGERIDO_INDISPONIVEL'
      };
    }
    if (!formalAnterior) {
      return {
        estado_formal: atual,
        estado_sugerido: atual,
        movimento: 'INICIAL',
        motivo: 'PRIMEIRO_FECHAMENTO_DEFINE_ESTADO_FORMAL'
      };
    }
    if (indice(atual) < indice(formalAnterior)) {
      return {
        estado_formal: atual,
        estado_sugerido: atual,
        movimento: 'REGRESSAO',
        motivo: 'DETERIORACAO_CONFIRMADA_NO_PRIMEIRO_FECHAMENTO'
      };
    }
    if (indice(atual) > indice(formalAnterior)) {
      var janela = sugeridos.slice(-minimo);
      if (janela.length < minimo || janela.some(function (s) { return !s; })) {
        return {
          estado_formal: formalAnterior,
          estado_sugerido: atual,
          movimento: 'MANUTENCAO',
          motivo: 'AGUARDANDO_' + minimo + '_FECHAMENTOS_CONSECUTIVOS'
        };
      }
      var candidato = janela.reduce(function (menor, s) {
        return indice(s) < indice(menor) ? s : menor;
      }, janela[0]);
      if (indice(candidato) > indice(formalAnterior)) {
        return {
          estado_formal: candidato,
          estado_sugerido: atual,
          movimento: 'AVANCO',
          motivo: minimo + '_FECHAMENTOS_CONSECUTIVOS_SUSTENTANDO_' + candidato
        };
      }
      return {
        estado_formal: formalAnterior,
        estado_sugerido: atual,
        movimento: 'MANUTENCAO',
        motivo: 'AGUARDANDO_' + minimo + '_FECHAMENTOS_CONSECUTIVOS'
      };
    }
    return {
      estado_formal: formalAnterior,
      estado_sugerido: atual,
      movimento: 'MANUTENCAO',
      motivo: 'ESTADO_SUGERIDO_IGUAL_AO_FORMAL'
    };
  }

  FOS.State = {
    PARAM_RUNWAY_ESTABILIZANDO: PARAM_RUNWAY_ESTABILIZANDO,
    PARAM_RUNWAY_ESTAVEL: PARAM_RUNWAY_ESTAVEL,
    PARAM_RUNWAY_EXPANSAO: PARAM_RUNWAY_EXPANSAO,
    PARAM_FECHAMENTOS_AVANCO: PARAM_FECHAMENTOS_AVANCO,
    indice: indice,
    sugerir: sugerir,
    aplicar: aplicar
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
