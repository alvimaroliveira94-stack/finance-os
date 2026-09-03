/**
 * Passivos (aba 33) — subledger versionado de obrigação com terceiro.
 *
 * PASSIVO = quanto devo. Existe para o disponível não contar como livre um
 * dinheiro que já tem dono. Nasce de NOVO_PASSIVO, baixa por
 * AMORTIZACAO_PASSIVO — nunca editado à mão.
 *
 * Deliberadamente simples: sem ritmo, sem histórico de fechamentos, sem
 * meses restantes. O MVP só precisa saber, em cada competência, quanto está
 * em aberto e se já venceu — Provisions.avaliar resolve um problema mais
 * rico (ritmo de acumulação) que o passivo não tem.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  var STATUS = {
    ABERTO: 'ABERTO',
    VENCIDO: 'VENCIDO',
    QUITADO: 'QUITADO'
  };

  /**
   * @param {Object} passivo versão corrente
   * @param {{dataReferencia:string}} contexto data do fechamento (ISO)
   */
  function avaliar(passivo, contexto) {
    var original = Number(FOS.Config.parseNumber(passivo.valor_devido_original) || 0);
    var aberto = Number(FOS.Config.parseNumber(passivo.valor_aberto) || 0);
    var amortizado = FOS.Core.round2(original - aberto);

    var status;
    var motivo;
    if (aberto <= 0) {
      status = STATUS.QUITADO;
      motivo = 'SALDO_ZERADO';
    } else {
      var vencido = passivo.vencimento && FOS.Dates.isIso(String(passivo.vencimento))
        && FOS.Dates.diffDays(String(passivo.vencimento), contexto.dataReferencia) < 0;
      if (vencido) {
        status = STATUS.VENCIDO;
        motivo = 'VENCIDO_E_ABERTO';
      } else {
        status = STATUS.ABERTO;
        motivo = 'DENTRO_DO_PRAZO';
      }
    }

    return {
      passivo_id: passivo.passivo_id,
      nome: passivo.nome,
      credor: passivo.credor || '',
      moeda: passivo.moeda || null,
      valor_devido_original: original,
      valor_aberto: aberto,
      valor_amortizado: amortizado,
      vencimento: passivo.vencimento || null,
      status: status,
      motivo: motivo
    };
  }

  /** Soma do saldo em aberto — o termo que o disponível deduz integralmente. */
  function totalAberto(avaliacoes) {
    return FOS.Core.sum(avaliacoes || [], function (p) { return Number(p.valor_aberto) || 0; });
  }

  /**
   * Custo financeiro retido na origem — SEMPRE derivado, nunca armazenado
   * nem lançado como movimentação. O ledger não tem (e não pode ter) uma
   * linha para ele: nenhum banco moveu esse dinheiro.
   */
  function custoRetidoNaOrigem(valorDevidoOriginal, valorRecebido) {
    return FOS.Core.round2(Number(valorDevidoOriginal) - Number(valorRecebido));
  }

  FOS.Liabilities = {
    STATUS: STATUS,
    avaliar: avaliar,
    totalAberto: totalAberto,
    custoRetidoNaOrigem: custoRetidoNaOrigem
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
