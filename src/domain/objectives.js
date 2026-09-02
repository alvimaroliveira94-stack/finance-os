/**
 * Objetivos (aba 31) — subledger versionado de metas de patrimônio.
 * Compartilha a lógica de ritmo das provisões, mas objetivo vencido não é
 * risco de inadimplência: é objetivo NAO_ATINGIDO (prazo estourado).
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var S = FOS.Constants.STATUS_PROVISAO;

  var STATUS_OBJETIVO = {
    ATINGIDO: 'ATINGIDO',
    EM_RITMO: S.EM_RITMO,
    FORA_DE_RITMO: S.FORA_DE_RITMO,
    PRAZO_EXPIRADO: 'PRAZO_EXPIRADO',
    DADO_INSUFICIENTE: S.DADO_INSUFICIENTE
  };

  function avaliar(objetivo, contexto) {
    var provisaoLike = {
      provisao_id: objetivo.objetivo_id,
      nome: objetivo.nome,
      valor_alvo: objetivo.valor_alvo,
      valor_acumulado: objetivo.valor_acumulado,
      vencimento: objetivo.prazo,
      prioridade: objetivo.prioridade,
      moeda: objetivo.moeda
    };
    var aval = FOS.Provisions.avaliar(provisaoLike, contexto);
    var out = {
      objetivo_id: objetivo.objetivo_id,
      nome: objetivo.nome,
      valor_alvo: aval.valor_alvo,
      valor_acumulado: aval.valor_acumulado,
      valor_faltante: aval.valor_faltante,
      prazo: objetivo.prazo || null,
      prioridade: aval.prioridade,
      moeda: aval.moeda,
      ritmo_observado: aval.ritmo_observado,
      ritmo_necessario: aval.ritmo_necessario,
      meses_restantes: aval.meses_restantes,
      motivo: aval.motivo,
      status: null
    };
    if (aval.status === S.COBERTA) out.status = STATUS_OBJETIVO.ATINGIDO;
    else if (aval.status === S.EM_RISCO) out.status = STATUS_OBJETIVO.PRAZO_EXPIRADO;
    else out.status = aval.status;
    return out;
  }

  FOS.Objectives = { STATUS_OBJETIVO: STATUS_OBJETIVO, avaliar: avaliar };
})(typeof globalThis !== 'undefined' ? globalThis : this);
