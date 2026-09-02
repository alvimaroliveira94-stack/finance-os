/**
 * Ledger canônico de movimentações (aba 22).
 * Append-only: a origem (data, descrição, valor, conta, arquivo) é imutável
 * e reclassificações geram uma NOVA linha com versao_gerencial incrementada.
 * A visão corrente é derivada (maior versão por fingerprint), nunca um UPDATE.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  var CAMPOS_ORIGEM = [
    'fingerprint', 'data_origem', 'descricao_origem', 'valor_origem',
    'moeda_origem', 'conta_id', 'import_id', 'arquivo_hash'
  ];

  function linhaId(fingerprint, versao) {
    return 'LED-' + String(fingerprint).slice(0, 12) + '-v' + versao;
  }

  /** Cria a linha versão 1 a partir de uma linha de staging classificada. */
  function novaLinha(staging, classificacao, agora, ator) {
    return {
      linha_id: linhaId(staging.fingerprint, 1),
      fingerprint: staging.fingerprint,
      versao_gerencial: 1,
      data_origem: staging.data,
      descricao_origem: staging.descricao_original,
      valor_origem: FOS.Core.round2(staging.valor),
      moeda_origem: staging.moeda,
      conta_id: staging.conta_id,
      import_id: staging.import_id,
      arquivo_hash: staging.arquivo_hash,
      categoria: classificacao.categoria,
      subcategoria: classificacao.subcategoria || '',
      universo: classificacao.universo,
      regra_id: classificacao.regra_id || '',
      regra_versao: classificacao.regra_versao || '',
      confianca: classificacao.confianca === null || classificacao.confianca === undefined ? '' : classificacao.confianca,
      evento_conciliado_id: '',
      motivo_versao: 'CLASSIFICACAO_INICIAL',
      classificado_em: agora,
      classificado_por: ator || 'SISTEMA',
      criado_em: agora
    };
  }

  /**
   * Reclassificação: nova versão com a MESMA origem.
   * Lança se alguém tentar alterar um campo de origem.
   */
  function reclassificar(linhaAtual, alteracoes, agora, ator, motivo) {
    CAMPOS_ORIGEM.forEach(function (campo) {
      if (Object.prototype.hasOwnProperty.call(alteracoes, campo)
        && String(alteracoes[campo]) !== String(linhaAtual[campo])) {
        FOS.Core.fail('ORIGEM_IMUTAVEL',
          'Campo de origem não pode ser alterado: ' + campo,
          { campo: campo, fingerprint: linhaAtual.fingerprint });
      }
    });
    var versao = Number(linhaAtual.versao_gerencial) + 1;
    var nova = FOS.Core.clone(linhaAtual);
    ['categoria', 'subcategoria', 'universo', 'regra_id', 'regra_versao', 'confianca', 'evento_conciliado_id']
      .forEach(function (campo) {
        if (Object.prototype.hasOwnProperty.call(alteracoes, campo)) nova[campo] = alteracoes[campo];
      });
    nova.versao_gerencial = versao;
    nova.linha_id = linhaId(linhaAtual.fingerprint, versao);
    nova.motivo_versao = motivo || 'RECLASSIFICACAO';
    nova.classificado_em = agora;
    nova.classificado_por = ator || 'SISTEMA';
    return nova;
  }

  /** Visão corrente: maior versao_gerencial por fingerprint. */
  function visaoCorrente(linhas) {
    var porFingerprint = {};
    (linhas || []).forEach(function (l) {
      var fp = l.fingerprint;
      var atual = porFingerprint[fp];
      if (!atual || Number(l.versao_gerencial) > Number(atual.versao_gerencial)) {
        porFingerprint[fp] = l;
      }
    });
    return FOS.Core.sortBy(Object.keys(porFingerprint).map(function (fp) { return porFingerprint[fp]; }), [
      function (l) { return String(l.data_origem); },
      function (l) { return String(l.fingerprint); }
    ]);
  }

  function fingerprints(linhas) {
    var vistos = {};
    (linhas || []).forEach(function (l) { vistos[l.fingerprint] = true; });
    return Object.keys(vistos);
  }

  function daCompetencia(linhas, competencia) {
    return visaoCorrente(linhas).filter(function (l) {
      return FOS.Dates.inCompetencia(String(l.data_origem), competencia);
    });
  }

  function porCategoria(linhas, categoria) {
    return (linhas || []).filter(function (l) { return l.categoria === categoria; });
  }

  function totalCategoria(linhas, categoria) {
    return FOS.Core.sum(porCategoria(linhas, categoria), function (l) { return Number(l.valor_origem); });
  }

  FOS.Ledger = {
    CAMPOS_ORIGEM: CAMPOS_ORIGEM,
    linhaId: linhaId,
    novaLinha: novaLinha,
    reclassificar: reclassificar,
    visaoCorrente: visaoCorrente,
    fingerprints: fingerprints,
    daCompetencia: daCompetencia,
    porCategoria: porCategoria,
    totalCategoria: totalCategoria
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
