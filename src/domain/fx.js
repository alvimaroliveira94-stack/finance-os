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

  /** Prefixo da chave de taxa materializada em 00_CONFIG_PARAMETROS. */
  var SECAO_TAXA = 'TAXA';

  function chaveCache(parNome, dataIso) {
    return parNome + '@' + dataIso;
  }

  /**
   * Linha de cache de taxa para a aba 00. Materializar na planilha é o que
   * permite reprocessar um fechamento antigo com a MESMA taxa usada na época,
   * sem depender do provedor estar no ar.
   */
  function linhaDeCache(moedaEstrangeira, moedaGerencial, dataIso, taxa, provedor, agora, reason) {
    var bloqueada = taxa === null || taxa === undefined || !Number.isFinite(Number(taxa));
    return {
      secao: SECAO_TAXA,
      chave: chaveCache(par(moedaEstrangeira, moedaGerencial), dataIso),
      valor: bloqueada ? '' : Number(taxa),
      tipo: 'NUMERO',
      unidade: moedaGerencial + ' por ' + moedaEstrangeira,
      universo: '',
      modo_ingestao: '',
      moeda: moedaEstrangeira,
      ativa: '',
      elegivel_importacao: '',
      status: bloqueada ? 'BLOQUEADO' : 'ATIVO',
      reason: bloqueada ? (reason || 'TAXA_NAO_PUBLICADA') : '',
      versao: 1,
      atualizado_em: agora || '',
      descricao: 'Cache de taxa (' + (provedor || 'DESCONHECIDO') + '). Não editar à mão.'
    };
  }

  /** Tabela de taxas a partir das linhas de cache da aba 00. */
  function tabelaDeCache(configRows) {
    var tabela = {};
    (configRows || []).forEach(function (r) {
      if (String(r.secao || '').toUpperCase() !== SECAO_TAXA) return;
      if (String(r.status || '').toUpperCase() === 'BLOQUEADO') return;
      var partes = String(r.chave || '').split('@');
      if (partes.length !== 2) return;
      var valor = Number(r.valor);
      if (!Number.isFinite(valor)) return;
      tabela[partes[0]] = tabela[partes[0]] || {};
      tabela[partes[0]][partes[1]] = valor;
    });
    return tabela;
  }

  FOS.Fx = {
    SECAO_TAXA: SECAO_TAXA,
    par: par,
    chaveCache: chaveCache,
    linhaDeCache: linhaDeCache,
    tabelaDeCache: tabelaDeCache,
    resolver: resolver,
    converter: converter,
    efeitoCambial: efeitoCambial,
    tabelaDeRegistros: tabelaDeRegistros
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
