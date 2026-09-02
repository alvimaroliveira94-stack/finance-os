/**
 * Conversão gerencial de moeda.
 *
 * O provedor de taxa é abstrato (PTAX é a implementação prevista, mas o
 * domínio só conhece uma tabela data->taxa). Regras duras:
 *  - não existe fallback silencioso: taxa ausente devolve null + reason e
 *    BLOQUEIA o fechamento;
 *  - o efeito cambial é sempre reportado separadamente do resultado
 *    operacional, nunca somado a ele.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  /**
   * Tabela de taxas: { 'BRL/GBP': { '2026-01-31': 6.42, ... } }
   * Sempre "quantas unidades da moeda gerencial por 1 unidade da moeda estrangeira".
   */
  function par(moedaEstrangeira, moedaGerencial) {
    return String(moedaGerencial).toUpperCase() + '/' + String(moedaEstrangeira).toUpperCase();
  }

  /**
   * Resolve a taxa para uma data exata. Sem taxa exata, sem chute.
   * @returns {{value:?number, status:string, reason:?string, provedor:?string, data:?string}}
   */
  function resolver(tabela, moedaEstrangeira, moedaGerencial, dataIso, provedor) {
    if (String(moedaEstrangeira).toUpperCase() === String(moedaGerencial).toUpperCase()) {
      return { value: 1, status: 'OK', reason: null, provedor: 'IDENTIDADE', data: dataIso };
    }
    var chave = par(moedaEstrangeira, moedaGerencial);
    var serie = (tabela || {})[chave];
    if (!serie) {
      return {
        value: null, status: 'NULL', provedor: provedor || null, data: null,
        reason: 'TAXA_INDISPONIVEL_PAR:' + chave
      };
    }
    var taxa = serie[dataIso];
    if (taxa === undefined || taxa === null || !Number.isFinite(Number(taxa))) {
      return {
        value: null, status: 'NULL', provedor: provedor || null, data: null,
        reason: 'TAXA_INDISPONIVEL_DATA:' + chave + '@' + dataIso
      };
    }
    return { value: Number(taxa), status: 'OK', reason: null, provedor: provedor || 'PTAX', data: dataIso };
  }

  /** Converte um valor para a moeda gerencial. Taxa ausente => null + reason. */
  function converter(valor, taxaResolvida) {
    if (!taxaResolvida || taxaResolvida.value === null) {
      return FOS.Core.nullValue(taxaResolvida ? taxaResolvida.reason : 'TAXA_INDISPONIVEL');
    }
    if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) {
      return FOS.Core.nullValue('VALOR_INDISPONIVEL_PARA_CONVERSAO');
    }
    return FOS.Core.value(FOS.Core.round2(Number(valor) * taxaResolvida.value));
  }

  /**
   * Efeito cambial isolado sobre um saldo em moeda estrangeira.
   * efeito = saldo_inicial_moeda * (taxa_final - taxa_inicial)
   * Ou seja: a parte da variação em BRL que não veio de operação.
   */
  function efeitoCambial(saldoInicialMoeda, taxaInicial, taxaFinal) {
    if (taxaInicial === null || taxaFinal === null
      || !Number.isFinite(Number(taxaInicial)) || !Number.isFinite(Number(taxaFinal))) {
      return FOS.Core.nullValue('TAXA_INDISPONIVEL_PARA_EFEITO_CAMBIAL');
    }
    if (saldoInicialMoeda === null || !Number.isFinite(Number(saldoInicialMoeda))) {
      return FOS.Core.nullValue('SALDO_INICIAL_INDISPONIVEL');
    }
    return FOS.Core.value(FOS.Core.round2(Number(saldoInicialMoeda) * (Number(taxaFinal) - Number(taxaInicial))));
  }

  /** Converte a lista de registros da aba de taxas em tabela indexada. */
  function tabelaDeRegistros(registros) {
    var tabela = {};
    (registros || []).forEach(function (r) {
      var chave = par(r.moeda_estrangeira, r.moeda_gerencial);
      tabela[chave] = tabela[chave] || {};
      tabela[chave][String(r.data)] = Number(r.taxa);
    });
    return tabela;
  }

  FOS.Fx = {
    par: par,
    resolver: resolver,
    converter: converter,
    efeitoCambial: efeitoCambial,
    tabelaDeRegistros: tabelaDeRegistros
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
