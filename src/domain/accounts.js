/**
 * Firewall de contas entre universos.
 * Trading, Vida e Patrimônio são separados. Contas de trading nunca entram
 * em importação transacional; delas só entram saldos semanais (aba 12).
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  /**
   * Uma conta é elegível para importação de extrato se, e somente se:
   * universo VIDA, modo IMPORTACAO_MENSAL, ativa e marcada como elegível.
   */
  function elegibilidadeImportacao(conta) {
    if (!conta) {
      return { elegivel: false, motivo: 'CONTA_DESCONHECIDA' };
    }
    if (conta.universo === C.UNIVERSO.TRADING) {
      return { elegivel: false, motivo: 'FIREWALL_TRADING_SEM_IMPORTACAO_TRANSACIONAL' };
    }
    if (conta.universo !== C.UNIVERSO.VIDA) {
      return { elegivel: false, motivo: 'UNIVERSO_NAO_IMPORTAVEL:' + conta.universo };
    }
    if (conta.modo_ingestao !== C.MODO_INGESTAO.IMPORTACAO_MENSAL) {
      return { elegivel: false, motivo: 'MODO_INGESTAO_INCOMPATIVEL:' + conta.modo_ingestao };
    }
    if (!conta.ativa) {
      return { elegivel: false, motivo: 'CONTA_INATIVA' };
    }
    if (!conta.elegivel_importacao) {
      return { elegivel: false, motivo: 'CONTA_NAO_ELEGIVEL' };
    }
    return { elegivel: true, motivo: null };
  }

  /** Contas cujo saldo semanal é aceito na aba 12. */
  function aceitaSaldoSemanal(conta) {
    if (!conta) return { aceita: false, motivo: 'CONTA_DESCONHECIDA' };
    if (conta.universo !== C.UNIVERSO.TRADING) {
      return { aceita: false, motivo: 'SALDO_SEMANAL_APENAS_TRADING' };
    }
    if (!conta.ativa) return { aceita: false, motivo: 'CONTA_INATIVA' };
    return { aceita: true, motivo: null };
  }

  /**
   * Travessia de fronteira reconhecida (Wise -> Inter).
   * Movimentos internos entre Betfair/Neteller/Wise não são controlados.
   */
  function isFronteiraReconhecida(contaOrigem, contaDestino) {
    return contaOrigem === C.FRONTEIRA_RECONHECIDA.origem
      && contaDestino === C.FRONTEIRA_RECONHECIDA.destino;
  }

  function isMovimentoInternoTradingNaoControlado(config, contaOrigem, contaDestino) {
    var o = config.conta(contaOrigem);
    var d = config.conta(contaDestino);
    if (!o || !d) return false;
    return o.universo === C.UNIVERSO.TRADING && d.universo === C.UNIVERSO.TRADING;
  }

  FOS.Accounts = {
    elegibilidadeImportacao: elegibilidadeImportacao,
    aceitaSaldoSemanal: aceitaSaldoSemanal,
    isFronteiraReconhecida: isFronteiraReconhecida,
    isMovimentoInternoTradingNaoControlado: isMovimentoInternoTradingNaoControlado
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
