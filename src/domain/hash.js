/**
 * Hash determinístico puro: FNV-1a de 64 bits sobre os bytes UTF-8 da entrada.
 *
 * Duas restrições moldaram esta implementação:
 *  - roda igual no Apps Script V8 e no Node, sem depender de
 *    Utilities.computeDigest (que é adaptador de plataforma);
 *  - não usa BigInt: o suporte a BigInt no Apps Script não é garantido, e uma
 *    divergência aqui mudaria todo fingerprint e todo checksum. A aritmética é
 *    feita em quatro limbs de 16 bits, exata dentro de Number.
 *
 * O resultado bate com os vetores oficiais do FNV-1a 64 (ver teste de hash),
 * o que torna a implementação verificável contra uma referência externa.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  /** Bytes UTF-8 de uma string, incluindo pares substitutos. */
  function bytesUtf8(str) {
    var texto = String(str === undefined || str === null ? '' : str);
    var bytes = [];
    for (var i = 0; i < texto.length; i++) {
      var codigo = texto.charCodeAt(i);
      if (codigo >= 0xd800 && codigo <= 0xdbff && i + 1 < texto.length) {
        var proximo = texto.charCodeAt(i + 1);
        if (proximo >= 0xdc00 && proximo <= 0xdfff) {
          codigo = ((codigo - 0xd800) << 10) + (proximo - 0xdc00) + 0x10000;
          i++;
        }
      }
      if (codigo < 0x80) {
        bytes.push(codigo);
      } else if (codigo < 0x800) {
        bytes.push(0xc0 | (codigo >> 6), 0x80 | (codigo & 0x3f));
      } else if (codigo < 0x10000) {
        bytes.push(0xe0 | (codigo >> 12), 0x80 | ((codigo >> 6) & 0x3f), 0x80 | (codigo & 0x3f));
      } else {
        bytes.push(
          0xf0 | (codigo >> 18),
          0x80 | ((codigo >> 12) & 0x3f),
          0x80 | ((codigo >> 6) & 0x3f),
          0x80 | (codigo & 0x3f)
        );
      }
    }
    return bytes;
  }

  function hex4(n) {
    var s = n.toString(16);
    while (s.length < 4) s = '0' + s;
    return s;
  }

  /**
   * FNV-1a 64 bits.
   * offset basis = 0xcbf29ce484222325, primo = 0x100000001b3.
   * O primo é 2^40 + 0x1b3, então na base 2^16 ele só contribui em dois
   * lugares: 0x1b3 no limb 0 e 0x100 no limb 2.
   */
  function fnv1a64(input) {
    var bytes = bytesUtf8(input);
    var v0 = 0x2325;
    var v1 = 0x8422;
    var v2 = 0x9ce4;
    var v3 = 0xcbf2;

    for (var i = 0; i < bytes.length; i++) {
      v0 = (v0 ^ bytes[i]) & 0xffff;

      var r0 = v0 * 0x1b3;
      var r1 = v1 * 0x1b3;
      var r2 = v2 * 0x1b3 + v0 * 0x100;
      var r3 = v3 * 0x1b3 + v1 * 0x100;

      var carrega = r0 >>> 16;
      v0 = r0 & 0xffff;
      r1 += carrega;
      carrega = r1 >>> 16;
      v1 = r1 & 0xffff;
      r2 += carrega;
      carrega = r2 >>> 16;
      v2 = r2 & 0xffff;
      r3 += carrega;
      v3 = r3 & 0xffff;
    }
    return hex4(v3) + hex4(v2) + hex4(v1) + hex4(v0);
  }

  /**
   * Hash de partes com separador de unidade (0x1f), que não ocorre em campos
   * de planilha; evita colisão por concatenação ambígua.
   */
  function hashParts(partes) {
    return fnv1a64((partes || []).map(function (p) {
      return p === null || p === undefined ? '' : String(p);
    }).join(String.fromCharCode(31)));
  }

  function pad8(hex) {
    var s = String(hex);
    while (s.length < 8) s = '0' + s;
    return s.slice(-8);
  }

  FOS.Hash = { fnv1a64: fnv1a64, hashParts: hashParts, bytesUtf8: bytesUtf8, pad8: pad8 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
