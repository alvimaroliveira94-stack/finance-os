/**
 * Núcleo compartilhado do domínio Finance OS.
 * Domínio puro: nenhuma referência a SpreadsheetApp, DriveApp ou UrlFetchApp.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  /** Erro de domínio com código estável, usado em testes e no log de auditoria. */
  function DomainError(code, message, details) {
    var err = new Error(code + ': ' + message);
    err.name = 'DomainError';
    err.code = code;
    err.details = details || null;
    return err;
  }

  function fail(code, message, details) {
    throw DomainError(code, message, details);
  }

  /**
   * Valor gerenciado: todo campo exposto ao dashboard carrega status e motivo.
   * Valor bloqueado/indisponível é sempre null + reason, nunca zero ou chute.
   */
  function value(v) {
    return { value: v, status: 'OK', reason: null };
  }
  function nullValue(reason, status) {
    return { value: null, status: status || 'NULL', reason: reason || 'VALOR_INDISPONIVEL' };
  }
  function errorValue(reason) {
    return { value: null, status: 'ERROR', reason: reason || 'ERRO_DE_CALCULO' };
  }
  function staleValue(v, reason) {
    return { value: v === undefined ? null : v, status: 'STALE', reason: reason || 'DADO_DESATUALIZADO' };
  }
  function insufficient(reason) {
    return { value: null, status: 'DADO_INSUFICIENTE', reason: reason || 'HISTORICO_INSUFICIENTE' };
  }
  function isOk(managed) {
    return !!managed && managed.status === 'OK' && managed.value !== null;
  }

  /** Cópia profunda determinística de estruturas simples (sem Date/Map/Set). */
  function clone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(clone);
    var out = {};
    Object.keys(obj).forEach(function (k) { out[k] = clone(obj[k]); });
    return out;
  }

  /** Arredondamento monetário estável (evita ruído de ponto flutuante). */
  function round2(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return n;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /** Serialização canônica: chaves ordenadas, saída estável para checksum. */
  function canonicalJson(obj) {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj === 'number') return Number.isFinite(obj) ? String(round2(obj)) : 'null';
    if (typeof obj === 'boolean' || typeof obj === 'string') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
    var keys = Object.keys(obj).sort();
    return '{' + keys.map(function (k) {
      return JSON.stringify(k) + ':' + canonicalJson(obj[k]);
    }).join(',') + '}';
  }

  function sum(list, pick) {
    return round2((list || []).reduce(function (acc, item) {
      var v = pick ? pick(item) : item;
      return acc + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }, 0));
  }

  function groupBy(list, pick) {
    var out = {};
    (list || []).forEach(function (item) {
      var key = pick(item);
      (out[key] = out[key] || []).push(item);
    });
    return out;
  }

  function sortBy(list, pickers) {
    var picks = Array.isArray(pickers) ? pickers : [pickers];
    return (list || []).slice().sort(function (a, b) {
      for (var i = 0; i < picks.length; i++) {
        var va = picks[i](a);
        var vb = picks[i](b);
        if (va < vb) return -1;
        if (va > vb) return 1;
      }
      return 0;
    });
  }

  FOS.Core = {
    DomainError: DomainError,
    fail: fail,
    value: value,
    nullValue: nullValue,
    errorValue: errorValue,
    staleValue: staleValue,
    insufficient: insufficient,
    isOk: isOk,
    clone: clone,
    canonicalJson: canonicalJson,
    round2: round2,
    sum: sum,
    groupBy: groupBy,
    sortBy: sortBy
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
