/**
 * Fingerprint determinístico de transação importada.
 *
 * hash(data + valor + descricao_normalizada + conta + ordinal_ocorrencia)
 *
 * O ordinal de ocorrência é a posição da linha dentro do grupo de linhas
 * idênticas do MESMO arquivo. Consequências desejadas:
 *  - reimportar o mesmo arquivo produz os mesmos fingerprints (zero linhas novas);
 *  - duas transações legítimas idênticas no mesmo arquivo recebem ordinais
 *    diferentes e permanecem distintas.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  function chaveOcorrencia(tx) {
    return [tx.data, FOS.Core.round2(tx.valor).toFixed(2), tx.descricao_normalizada, tx.conta_id].join('|');
  }

  /**
   * Atribui ordinal_ocorrencia (1-based) a cada linha do arquivo.
   * A ordem de leitura do arquivo é a ordem canônica: linhas idênticas são
   * numeradas na sequência em que aparecem.
   */
  function atribuirOrdinais(transacoes) {
    var contador = {};
    return (transacoes || []).map(function (tx) {
      var k = chaveOcorrencia(tx);
      contador[k] = (contador[k] || 0) + 1;
      var out = FOS.Core.clone(tx);
      out.ordinal_ocorrencia = contador[k];
      return out;
    });
  }

  function calcular(tx) {
    if (typeof tx.ordinal_ocorrencia !== 'number' || tx.ordinal_ocorrencia < 1) {
      FOS.Core.fail('ORDINAL_AUSENTE', 'ordinal_ocorrencia é obrigatório para o fingerprint');
    }
    return FOS.Hash.hashParts([
      tx.data,
      FOS.Core.round2(tx.valor).toFixed(2),
      tx.descricao_normalizada,
      tx.conta_id,
      tx.ordinal_ocorrencia
    ]);
  }

  /** Aplica ordinais e fingerprints a um arquivo inteiro, em uma passada. */
  function aplicar(transacoes) {
    return atribuirOrdinais(transacoes).map(function (tx) {
      tx.fingerprint = calcular(tx);
      return tx;
    });
  }

  FOS.Fingerprint = {
    calcular: calcular,
    atribuirOrdinais: atribuirOrdinais,
    aplicar: aplicar,
    chaveOcorrencia: chaveOcorrencia
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
