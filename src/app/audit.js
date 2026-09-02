/**
 * Log de auditoria (aba 90).
 * Toda ação relevante registra ANTES e DEPOIS. O log é append-only e é a
 * primeira coisa a consultar quando um número não bate.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.App = FOS.App || {};
  var A = FOS.Constants.ABAS_INTERNAS;

  var LIMITE_TEXTO = 4000;

  function serializar(valor) {
    if (valor === undefined || valor === null) return '';
    var texto = typeof valor === 'string' ? valor : FOS.Core.canonicalJson(valor);
    if (texto.length > LIMITE_TEXTO) {
      return texto.slice(0, LIMITE_TEXTO) + '...[truncado:' + texto.length + ']';
    }
    return texto;
  }

  function criar(repositorio, relogio, ator) {
    var buffer = [];
    return {
      registrar: function (registro) {
        var agora = relogio.agora();
        var linha = {
          log_id: 'LOG-' + FOS.Hash.hashParts([agora, registro.acao, registro.entidade_id, buffer.length]).slice(0, 14),
          timestamp: agora,
          ator: registro.ator || ator || 'SISTEMA',
          acao: registro.acao,
          entidade: registro.entidade,
          entidade_id: registro.entidade_id || '',
          antes: serializar(registro.antes),
          depois: serializar(registro.depois),
          resultado: registro.resultado || 'OK',
          detalhe: serializar(registro.detalhe)
        };
        buffer.push(linha);
        return linha;
      },

      /** Grava tudo o que foi acumulado. Chamado ao fim de cada workflow. */
      persistir: function () {
        if (!buffer.length) return 0;
        var escritas = repositorio.anexar(A.LOG, buffer);
        buffer = [];
        return escritas;
      },

      pendentes: function () { return buffer.slice(); }
    };
  }

  FOS.App.criarAuditoria = criar;
  FOS.App.serializarParaLog = serializar;
})(typeof globalThis !== 'undefined' ? globalThis : this);
