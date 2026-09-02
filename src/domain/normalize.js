/**
 * Normalização determinística de descrições e valores.
 * Determinismo é requisito do fingerprint: a mesma linha de arquivo precisa
 * produzir sempre a mesma descrição normalizada, hoje e daqui a um ano.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  var ACENTOS = {
    'á': 'a', 'à': 'a', 'ã': 'a', 'â': 'a', 'ä': 'a',
    'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
    'ó': 'o', 'ò': 'o', 'õ': 'o', 'ô': 'o', 'ö': 'o',
    'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
    'ç': 'c', 'ñ': 'n'
  };

  function removeAcentos(str) {
    var s = String(str);
    if (typeof s.normalize === "function") {
      return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    return s.replace(/[\u00c0-\u017f]/g, function (ch) {
      var lower = ch.toLowerCase();
      var repl = ACENTOS[lower];
      return repl ? (ch === lower ? repl : repl.toUpperCase()) : ch;
    });
  }

  /**
   * Descrição normalizada:
   * maiúsculas, sem acentos, sem pontuação, espaços colapsados.
   * Não remove números: eles carregam informação de classificação.
   */
  function descricao(texto) {
    var s = String(texto === undefined || texto === null ? '' : texto);
    s = removeAcentos(s).toUpperCase();
    s = s.replace(/[^A-Z0-9 ]+/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  /**
   * Valor monetário: número com 2 casas. Aceita formatos pt-BR e en-US e
   * parênteses como negativo (comum em exportações de extrato).
   */
  function valor(v) {
    if (typeof v === 'number') {
      return Number.isFinite(v) ? FOS.Core.round2(v) : null;
    }
    var s = String(v === undefined || v === null ? '' : v).trim();
    if (s === '') return null;
    var negativo = false;
    if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
    s = s.replace(/[R$\s £]/gi, '');
    if (s.indexOf('-') === 0) { negativo = true; s = s.slice(1); }
    if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else if (s.indexOf(',') !== -1) {
      s = s.replace(',', '.');
    }
    var n = Number(s);
    if (!Number.isFinite(n)) return null;
    return FOS.Core.round2(negativo ? -n : n);
  }

  /** Data: aceita ISO, DD/MM/AAAA e AAAAMMDD (OFX). Devolve ISO ou null. */
  function data(v) {
    var s = String(v === undefined || v === null ? '' : v).trim();
    if (s === '') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return FOS.Dates.isIso(s) ? s : null;
    var br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) {
      var iso = br[3] + '-' + br[2] + '-' + br[1];
      return FOS.Dates.isIso(iso) ? iso : null;
    }
    var ofx = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (ofx) {
      var iso2 = ofx[1] + '-' + ofx[2] + '-' + ofx[3];
      return FOS.Dates.isIso(iso2) ? iso2 : null;
    }
    return null;
  }

  FOS.Normalize = { descricao: descricao, valor: valor, data: data, removeAcentos: removeAcentos };
})(typeof globalThis !== 'undefined' ? globalThis : this);
