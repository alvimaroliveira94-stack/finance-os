/**
 * Relógio. Isolado para que todo teste seja determinístico:
 * o domínio jamais chama new Date() diretamente.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.Adapters = FOS.Adapters || {};

  /** Relógio real (usa o fuso do script; grava sempre em ISO 8601 UTC). */
  function relogioReal() {
    return {
      agora: function () { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); },
      hoje: function () { return new Date().toISOString().slice(0, 10); }
    };
  }

  /** Relógio fixo para testes e reprocessamentos determinísticos. */
  function relogioFixo(instanteIso) {
    return {
      agora: function () { return instanteIso; },
      hoje: function () { return String(instanteIso).slice(0, 10); }
    };
  }

  FOS.Adapters.relogioReal = relogioReal;
  FOS.Adapters.relogioFixo = relogioFixo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
