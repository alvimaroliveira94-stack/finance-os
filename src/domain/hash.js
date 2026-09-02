/**
 * Hash determinístico puro (FNV-1a de 64 bits simulado em blocos de 32 bits).
 * Puro de propósito: o mesmo algoritmo roda no Apps Script e no Node, sem
 * depender de Utilities.computeDigest (que é adaptador de plataforma).
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  function pad8(hex) {
    var s = String(hex);
    while (s.length < 8) s = '0' + s;
    return s.slice(-8);
  }

  /**
   * FNV-1a 64 bits com aritmética exata via BigInt quando disponível
   * (Apps Script V8 e Node suportam BigInt).
   */
  function fnv1a64(input) {
    var str = String(input === undefined || input === null ? '' : input);
    var hash = BigInt('14695981039346656037');
    var prime = BigInt('1099511628211');
    var mask = BigInt('18446744073709551615');
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      // Alimenta o hash byte a byte para independer da representação interna.
      hash = (hash ^ BigInt(code & 0xff)) & mask;
      hash = (hash * prime) & mask;
      hash = (hash ^ BigInt((code >>> 8) & 0xff)) & mask;
      hash = (hash * prime) & mask;
    }
    var hex = hash.toString(16);
    while (hex.length < 16) hex = '0' + hex;
    return hex;
  }

  /**
   * Hash de partes com separador de unidade (0x1f), que não ocorre em campos
   * de planilha; evita colisão por concatenação ambígua.
   */
  function hashParts(parts) {
    return fnv1a64((parts || []).map(function (p) {
      return p === null || p === undefined ? '' : String(p);
    }).join(String.fromCharCode(31)));
  }

  FOS.Hash = { fnv1a64: fnv1a64, hashParts: hashParts, pad8: pad8 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
