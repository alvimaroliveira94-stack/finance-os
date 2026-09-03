/**
 * Regras determinísticas versionadas (aba 20) e motor de classificação.
 * Nunca há classificação por adivinhação: sem regra, com ambiguidade ou com
 * confiança abaixo do mínimo, a linha vai para a fila de revisão (aba 21).
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  /** Universo derivado da categoria canônica. */
  var UNIVERSO_POR_CATEGORIA = {
    CUSTO_VIDA: C.UNIVERSO.VIDA,
    CUSTO_TRADING: C.UNIVERSO.TRADING,
    SAQUE_TRADING: C.UNIVERSO.TRADING,
    GASTO_EXTRAORDINARIO: C.UNIVERSO.VIDA,
    APORTE_EXTRAORDINARIO: C.UNIVERSO.TRADING,
    TRANSFERENCIA_INTERNA: C.UNIVERSO.VIDA,
    PATRIMONIO_OBJETIVOS: C.UNIVERSO.PATRIMONIO,
    MOVIMENTACAO_COM_TERCEIRO: C.UNIVERSO.VIDA
  };

  var OPERADORES = {
    CONTEM: function (campo, ref) { return String(campo).indexOf(String(ref).toUpperCase()) !== -1; },
    NAO_CONTEM: function (campo, ref) { return String(campo).indexOf(String(ref).toUpperCase()) === -1; },
    IGUAL: function (campo, ref) { return String(campo) === String(ref).toUpperCase(); },
    PREFIXO: function (campo, ref) { return String(campo).indexOf(String(ref).toUpperCase()) === 0; },
    REGEX: function (campo, ref) { return new RegExp(String(ref), 'i').test(String(campo)); },
    MAIOR_QUE: function (campo, ref) { return Number(campo) > Number(ref); },
    MENOR_QUE: function (campo, ref) { return Number(campo) < Number(ref); }
  };

  function valorDoCampo(tx, campo) {
    switch (String(campo)) {
      case 'descricao_normalizada': return tx.descricao_normalizada;
      case 'valor': return tx.valor;
      case 'valor_absoluto': return Math.abs(Number(tx.valor));
      case 'conta_id': return tx.conta_id;
      // Assinatura segura da movimentação. É o campo que uma regra calibrada
      // usa com IGUAL: casa o padrão exato aprovado, e nada além dele.
      case 'assinatura': return FOS.Calibration.assinatura(tx).chave;
      default: return null;
    }
  }

  function sinalCompativel(regra, tx) {
    var sinal = String(regra.sinal_valor || 'QUALQUER').toUpperCase();
    if (sinal === 'QUALQUER' || sinal === '') return true;
    if (sinal === 'DEBITO') return Number(tx.valor) < 0;
    if (sinal === 'CREDITO') return Number(tx.valor) > 0;
    return true;
  }

  function vigente(regra, dataIso) {
    var desde = regra.vigente_desde;
    var ate = regra.vigente_ate;
    if (desde && FOS.Dates.isIso(String(desde)) && FOS.Dates.diffDays(dataIso, String(desde)) < 0) return false;
    if (ate && FOS.Dates.isIso(String(ate)) && FOS.Dates.diffDays(dataIso, String(ate)) > 0) return false;
    return true;
  }

  /** Regras ativas e vigentes para a transação, ordenadas de forma estável. */
  function aplicaveis(regras, tx) {
    return FOS.Core.sortBy((regras || []).filter(function (r) {
      if (FOS.Config.parseBool(r.ativo) !== true) return false;
      if (!vigente(r, tx.data)) return false;
      if (r.conta_escopo && String(r.conta_escopo).trim() !== '' && String(r.conta_escopo) !== tx.conta_id) return false;
      if (!sinalCompativel(r, tx)) return false;
      var op = OPERADORES[String(r.operador || '').toUpperCase()];
      if (!op) return false;
      var campo = valorDoCampo(tx, r.campo);
      if (campo === null) return false;
      try {
        return op(campo, r.valor_referencia);
      } catch (e) {
        return false;
      }
    }), [
      function (r) { return Number(r.prioridade) || 9999; },
      function (r) { return String(r.regra_id); },
      function (r) { return -(Number(r.versao) || 1); }
    ]);
  }

  /**
   * Classifica uma transação.
   * @returns {{decidido:boolean, categoria:?string, universo:?string,
   *            regra_id:?string, regra_versao:?number, confianca:?number,
   *            motivo:?string, candidatos:Array}}
   */
  function classificar(tx, regras, confiancaMinima) {
    var matches = aplicaveis(regras, tx);
    if (!matches.length) {
      return {
        decidido: false, categoria: null, universo: null, regra_id: null, regra_versao: null,
        confianca: null, motivo: 'SEM_REGRA_APLICAVEL', candidatos: []
      };
    }
    var melhorPrioridade = Number(matches[0].prioridade) || 9999;
    var empatadas = matches.filter(function (r) { return (Number(r.prioridade) || 9999) === melhorPrioridade; });
    var categorias = {};
    empatadas.forEach(function (r) { categorias[String(r.categoria)] = true; });
    if (Object.keys(categorias).length > 1) {
      return {
        decidido: false, categoria: null, universo: null, regra_id: null, regra_versao: null,
        confianca: null, motivo: 'AMBIGUIDADE_REGRAS',
        candidatos: empatadas.map(function (r) {
          return { regra_id: r.regra_id, versao: Number(r.versao) || 1, categoria: r.categoria };
        })
      };
    }
    var escolhida = matches[0];
    var confianca = FOS.Config.parseNumber(escolhida.confianca);
    if (confianca === null) confianca = 0;
    if (confianca < confiancaMinima) {
      return {
        decidido: false, categoria: null, universo: null,
        regra_id: escolhida.regra_id, regra_versao: Number(escolhida.versao) || 1,
        confianca: confianca, motivo: 'CONFIANCA_ABAIXO_DO_MINIMO',
        candidatos: [{ regra_id: escolhida.regra_id, versao: Number(escolhida.versao) || 1, categoria: escolhida.categoria }]
      };
    }
    var categoria = String(escolhida.categoria);
    if (!C.isValid(C.CATEGORIA, categoria)) {
      return {
        decidido: false, categoria: null, universo: null,
        regra_id: escolhida.regra_id, regra_versao: Number(escolhida.versao) || 1,
        confianca: confianca, motivo: 'CATEGORIA_NAO_CANONICA', candidatos: []
      };
    }
    return {
      decidido: true,
      categoria: categoria,
      universo: String(escolhida.universo || '').toUpperCase() || UNIVERSO_POR_CATEGORIA[categoria],
      regra_id: escolhida.regra_id,
      regra_versao: Number(escolhida.versao) || 1,
      confianca: confianca,
      motivo: null,
      candidatos: []
    };
  }

  FOS.Rules = {
    classificar: classificar,
    aplicaveis: aplicaveis,
    OPERADORES: OPERADORES,
    UNIVERSO_POR_CATEGORIA: UNIVERSO_POR_CATEGORIA
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
