/**
 * Fila de revisão (aba 21).
 * Toda ambiguidade, baixa confiança ou conciliação incerta vira item aqui.
 * A fila é o único caminho para decisão humana: o sistema nunca chuta.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  function itemId(origem, referencia, motivo) {
    return 'FILA-' + FOS.Hash.hashParts([origem, referencia, motivo]).slice(0, 12);
  }

  function novoItem(params) {
    var origem = params.origem;
    if (!C.isValid(C.ORIGEM_FILA, origem)) {
      FOS.Core.fail('ORIGEM_FILA_INVALIDA', 'Origem de fila inválida: ' + origem);
    }
    return {
      item_id: itemId(origem, params.referencia, params.motivo),
      origem: origem,
      referencia: params.referencia,
      motivo: params.motivo,
      detalhe: params.detalhe || '',
      candidatos: params.candidatos ? FOS.Core.canonicalJson(params.candidatos) : '',
      status: C.STATUS_FILA.ABERTO,
      resolucao: '',
      criado_em: params.agora || '',
      resolvido_em: '',
      resolvido_por: ''
    };
  }

  function abertos(itens) {
    return (itens || []).filter(function (i) { return String(i.status) === C.STATUS_FILA.ABERTO; });
  }

  function resolver(item, resolucao, agora, ator) {
    if (String(item.status) !== C.STATUS_FILA.ABERTO) {
      FOS.Core.fail('ITEM_FILA_NAO_ABERTO', 'Item já resolvido: ' + item.item_id);
    }
    var novo = FOS.Core.clone(item);
    novo.status = C.STATUS_FILA.RESOLVIDO;
    novo.resolucao = resolucao;
    novo.resolvido_em = agora;
    novo.resolvido_por = ator || 'USUARIO';
    return novo;
  }

  FOS.Queue = { novoItem: novoItem, itemId: itemId, abertos: abertos, resolver: resolver };
})(typeof globalThis !== 'undefined' ? globalThis : this);
