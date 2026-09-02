/**
 * Datas como string ISO (YYYY-MM-DD) e competências como YYYY-MM.
 * O domínio não usa Date do runtime para não depender do timezone da
 * planilha nem do servidor: toda comparação é textual/numérica pura.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  var ISO = /^\d{4}-\d{2}-\d{2}$/;
  var COMPETENCIA = /^\d{4}-\d{2}$/;

  function daysInMonth(year, month) {
    var lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) return 29;
    return lengths[month - 1];
  }

  function isRealDate(iso) {
    var y = Number(iso.slice(0, 4));
    var m = Number(iso.slice(5, 7));
    var d = Number(iso.slice(8, 10));
    if (m < 1 || m > 12 || d < 1) return false;
    return d <= daysInMonth(y, m);
  }

  function isIso(v) {
    return typeof v === 'string' && ISO.test(v) && isRealDate(v);
  }

  function assertIso(date, field) {
    if (!isIso(date)) {
      FOS.Core.fail('DATA_INVALIDA', 'Data inválida em ' + (field || 'campo') + ': ' + date);
    }
    return date;
  }

  /** Número de dia contínuo (dia juliano) para diferenças e comparações. */
  function toDayNumber(iso) {
    assertIso(iso);
    var y = Number(iso.slice(0, 4));
    var m = Number(iso.slice(5, 7));
    var d = Number(iso.slice(8, 10));
    var a = Math.floor((14 - m) / 12);
    var y2 = y + 4800 - a;
    var m2 = m + 12 * a - 3;
    return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2
      + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
  }

  function diffDays(a, b) {
    return toDayNumber(a) - toDayNumber(b);
  }

  function competenciaOf(iso) {
    assertIso(iso);
    return iso.slice(0, 7);
  }

  function assertCompetencia(comp) {
    if (typeof comp !== 'string' || !COMPETENCIA.test(comp) || Number(comp.slice(5, 7)) < 1 || Number(comp.slice(5, 7)) > 12) {
      FOS.Core.fail('COMPETENCIA_INVALIDA', 'Competência inválida: ' + comp);
    }
    return comp;
  }

  function competenciaRange(comp) {
    assertCompetencia(comp);
    var y = Number(comp.slice(0, 4));
    var m = Number(comp.slice(5, 7));
    var last = daysInMonth(y, m);
    return { inicio: comp + '-01', fim: comp + '-' + (last < 10 ? '0' + last : String(last)) };
  }

  function addMonths(comp, delta) {
    assertCompetencia(comp);
    var y = Number(comp.slice(0, 4));
    var m = Number(comp.slice(5, 7)) + delta;
    y += Math.floor((m - 1) / 12);
    m = ((m - 1) % 12 + 12) % 12 + 1;
    return String(y) + '-' + (m < 10 ? '0' + m : String(m));
  }

  function monthsBetween(compA, compB) {
    assertCompetencia(compA);
    assertCompetencia(compB);
    return (Number(compB.slice(0, 4)) - Number(compA.slice(0, 4))) * 12
      + (Number(compB.slice(5, 7)) - Number(compA.slice(5, 7)));
  }

  function inRange(iso, inicio, fim) {
    return toDayNumber(iso) >= toDayNumber(inicio) && toDayNumber(iso) <= toDayNumber(fim);
  }

  function inCompetencia(iso, comp) {
    var r = competenciaRange(comp);
    return inRange(iso, r.inicio, r.fim);
  }

  FOS.Dates = {
    isIso: isIso,
    assertIso: assertIso,
    daysInMonth: daysInMonth,
    toDayNumber: toDayNumber,
    diffDays: diffDays,
    competenciaOf: competenciaOf,
    assertCompetencia: assertCompetencia,
    competenciaRange: competenciaRange,
    addMonths: addMonths,
    monthsBetween: monthsBetween,
    inRange: inRange,
    inCompetencia: inCompetencia
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
