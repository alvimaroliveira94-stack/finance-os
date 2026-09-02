/**
 * Base comum dos subledgers versionados (30_PROVISOES e 31_OBJETIVOS).
 * Versionamento: cada alteração acrescenta uma linha com versao+1 e
 * vigente_desde; a linha anterior recebe vigente_ate apenas na projeção
 * (a planilha permanece append-only).
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  /** Versão corrente de cada entidade (maior versao por id). */
  function correntes(linhas, campoId) {
    var porId = {};
    (linhas || []).forEach(function (l) {
      var id = String(l[campoId]);
      var atual = porId[id];
      if (!atual || Number(l.versao) > Number(atual.versao)) porId[id] = l;
    });
    return FOS.Core.sortBy(Object.keys(porId).map(function (id) { return porId[id]; }),
      [function (l) { return String(l[campoId]); }]);
  }

  /** Estado de uma entidade em uma competência (versão vigente naquele mês). */
  function vigenteEm(linhas, campoId, id, competencia) {
    var fim = FOS.Dates.competenciaRange(competencia).fim;
    var candidatas = (linhas || []).filter(function (l) {
      if (String(l[campoId]) !== String(id)) return false;
      var desde = String(l.vigente_desde || '');
      if (!FOS.Dates.isIso(desde)) return true;
      return FOS.Dates.diffDays(desde, fim) <= 0;
    });
    if (!candidatas.length) return null;
    return FOS.Core.sortBy(candidatas, [function (l) { return -Number(l.versao); }])[0];
  }

  /**
   * Versões vigentes de todas as entidades numa competência.
   * É o que o fechamento usa: reprocessar um mês antigo não pode enxergar
   * versões criadas depois dele.
   */
  function correntesEm(linhas, campoId, competencia) {
    var ids = {};
    (linhas || []).forEach(function (l) { ids[String(l[campoId])] = true; });
    return Object.keys(ids).sort().map(function (id) {
      return vigenteEm(linhas, campoId, id, competencia);
    }).filter(function (l) { return !!l; });
  }

  /** Nova versão de uma entidade, preservando identidade e histórico. */
  function novaVersao(atual, alteracoes, agora, motivo) {
    var nova = FOS.Core.clone(atual);
    Object.keys(alteracoes || {}).forEach(function (k) {
      if (k === 'versao' || k === 'criado_em') return;
      nova[k] = alteracoes[k];
    });
    nova.versao = Number(atual.versao) + 1;
    nova.vigente_desde = agora ? String(agora).slice(0, 10) : atual.vigente_desde;
    nova.motivo_versao = motivo || 'ATUALIZACAO';
    return nova;
  }

  FOS.Subledger = {
    correntes: correntes,
    correntesEm: correntesEm,
    vigenteEm: vigenteEm,
    novaVersao: novaVersao
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
