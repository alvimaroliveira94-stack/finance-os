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
   * Normaliza uma entrada da tabela de taxas.
   *
   * A tabela aceita duas formas: um número puro (provedor manual, provedor
   * HTTP) ou um registro completo vindo do cache materializado, que carrega
   * também o dia efetivo da cotação e a versão publicada. Isso permite que o
   * fechamento registre "taxa de referência 2026-05-31, cotação PTAX de
   * 2026-05-29" sem que o domínio precise conhecer calendário de feriados.
   */
  function entradaDeTaxa(bruto) {
    if (bruto === null || bruto === undefined || bruto === '') return null;
    var valor = typeof bruto === 'object' ? bruto.valor : bruto;
    var numero = Number(valor);
    if (valor === '' || valor === null || valor === undefined || !Number.isFinite(numero)) return null;
    if (typeof bruto !== 'object') {
      return { valor: numero, data_cotacao: null, versao: 1, provedor: null };
    }
    return {
      valor: numero,
      data_cotacao: bruto.data_cotacao || null,
      versao: Number(bruto.versao) || 1,
      provedor: bruto.provedor || null
    };
  }

  /**
   * Resolve a taxa para uma data exata. Sem taxa exata, sem chute.
   *
   * Não existe fallback para "o dia útil anterior" aqui de propósito: o
   * domínio não conhece feriado nem calendário bancário, e adivinhar seria
   * exatamente o chute silencioso que esta arquitetura proíbe. Quem publica a
   * taxa informa qual cotação usou e sob qual data de referência ela vale.
   *
   * @returns {{value:?number, status:string, reason:?string, provedor:?string,
   *            data:?string, data_cotacao:?string, versao:?number, par:string}}
   */
  function resolver(tabela, moedaEstrangeira, moedaGerencial, dataIso, provedor) {
    var chave = par(moedaEstrangeira, moedaGerencial);
    if (String(moedaEstrangeira).toUpperCase() === String(moedaGerencial).toUpperCase()) {
      return {
        value: 1, status: 'OK', reason: null, provedor: 'IDENTIDADE',
        data: dataIso, data_cotacao: dataIso, versao: null, par: chave
      };
    }
    var serie = (tabela || {})[chave];
    if (!serie) {
      return {
        value: null, status: 'NULL', provedor: provedor || null, data: null,
        data_cotacao: null, versao: null, par: chave,
        reason: 'TAXA_INDISPONIVEL_PAR:' + chave
      };
    }
    var entrada = entradaDeTaxa(serie[dataIso]);
    if (!entrada) {
      return {
        value: null, status: 'NULL', provedor: provedor || null, data: null,
        data_cotacao: null, versao: null, par: chave,
        reason: 'TAXA_INDISPONIVEL_DATA:' + chave + '@' + dataIso
      };
    }
    return {
      value: entrada.valor, status: 'OK', reason: null,
      provedor: entrada.provedor || provedor || 'PTAX',
      data: dataIso,
      data_cotacao: entrada.data_cotacao || dataIso,
      versao: entrada.versao,
      par: chave
    };
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
   *
   * `dataIso` é a data de REFERÊNCIA (o último dia da competência, que é a
   * data à qual a taxa pertence). `opcoes.dataCotacao` é o dia efetivo da
   * cotação publicada — pode ser anterior, quando não houve PTAX na data de
   * referência. Guardar os dois separadamente é o que torna a política
   * auditável: a planilha diz qual cotação foi usada e por quê.
   *
   * O nome do provedor fica em `modo_ingestao`, legível por máquina, para
   * que o snapshot de fechamento possa registrar a fonte oficial da taxa.
   *
   * @param {{versao?:number, dataCotacao?:string}} [opcoes]
   */
  function linhaDeCache(moedaEstrangeira, moedaGerencial, dataIso, taxa, provedor, agora, reason, opcoes) {
    var o = opcoes || {};
    var bloqueada = taxa === null || taxa === undefined || taxa === '' || !Number.isFinite(Number(taxa));
    var cotacao = o.dataCotacao || (bloqueada ? '' : dataIso);
    var nota = cotacao && cotacao !== dataIso
      ? ' Cotação de ' + cotacao + ' aplicada à data de referência ' + dataIso + '.'
      : '';
    return {
      secao: SECAO_TAXA,
      chave: chaveCache(par(moedaEstrangeira, moedaGerencial), dataIso),
      valor: bloqueada ? '' : Number(taxa),
      tipo: 'NUMERO',
      unidade: moedaGerencial + ' por ' + moedaEstrangeira,
      universo: '',
      modo_ingestao: provedor || '',
      moeda: moedaEstrangeira,
      ativa: '',
      elegivel_importacao: '',
      status: bloqueada ? 'BLOQUEADO' : 'ATIVO',
      reason: bloqueada ? (reason || 'TAXA_NAO_PUBLICADA') : '',
      versao: Number(o.versao) > 0 ? Number(o.versao) : 1,
      atualizado_em: agora || '',
      descricao: 'Cache de taxa (' + (provedor || 'DESCONHECIDO') + ').' + nota
        + ' Não editar à mão: use o menu Finance OS.',
      data_cotacao: cotacao
    };
  }

  /**
   * Linhas de cache já interpretadas, em ordem de versão crescente.
   *
   * A aba 00 é append-only: corrigir uma taxa publicada significa acrescentar
   * uma linha de versão maior, nunca editar a linha anterior. Esta função é a
   * leitura crua — quem escolhe a versão vigente é tabelaDeCache.
   *
   * @param {Array<Object>} configRows linhas da aba 00
   * @param {string} [chaveFiltro] restringe a uma chave 'BRL/GBP@2026-05-31'
   */
  function linhasDeCache(configRows, chaveFiltro) {
    var lista = [];
    (configRows || []).forEach(function (r) {
      if (String(r.secao || '').toUpperCase() !== SECAO_TAXA) return;
      var chave = String(r.chave || '');
      var partes = chave.split('@');
      if (partes.length !== 2 || !partes[0] || !partes[1]) return;
      if (chaveFiltro && chave !== chaveFiltro) return;
      var bruto = r.valor;
      var numero = Number(bruto);
      var valor = (bruto === '' || bruto === null || bruto === undefined || !Number.isFinite(numero))
        ? null : numero;
      lista.push({
        chave: chave,
        par: partes[0],
        data: partes[1],
        valor: valor,
        data_cotacao: String(r.data_cotacao || '') || null,
        modo_ingestao: String(r.modo_ingestao || '') || null,
        status: String(r.status || 'ATIVO').toUpperCase(),
        reason: String(r.reason || '') || null,
        versao: Number(r.versao) > 0 ? Number(r.versao) : 1,
        atualizado_em: r.atualizado_em || null
      });
    });
    return FOS.Core.sortBy(lista, [function (e) { return e.versao; }]);
  }

  /** Maior versão já publicada para uma chave (0 se a chave é inédita). */
  function versaoDeCache(configRows, chave) {
    return linhasDeCache(configRows, chave).reduce(function (maior, e) {
      return e.versao > maior ? e.versao : maior;
    }, 0);
  }

  /** Linha vigente de uma chave: a de maior versão, ou null. */
  function vigenteDeCache(configRows, chave) {
    var linhas = linhasDeCache(configRows, chave);
    return linhas.length ? linhas[linhas.length - 1] : null;
  }

  /**
   * Tabela de taxas a partir das linhas de cache da aba 00.
   *
   * A versão vigente de cada chave é a de MAIOR número de versão, nunca a
   * última linha lida: a ordem física das linhas na planilha não pode alterar
   * o resultado de um fechamento. Uma linha BLOQUEADA de versão maior
   * despublica a taxa anterior — é assim que se retira uma taxa errada sem
   * apagar histórico.
   */
  function tabelaDeCache(configRows) {
    var vigentes = {};
    linhasDeCache(configRows).forEach(function (e) {
      var atual = vigentes[e.chave];
      if (!atual || e.versao >= atual.versao) vigentes[e.chave] = e;
    });
    var tabela = {};
    Object.keys(vigentes).forEach(function (chave) {
      var e = vigentes[chave];
      if (e.status === 'BLOQUEADO' || e.valor === null) return;
      tabela[e.par] = tabela[e.par] || {};
      tabela[e.par][e.data] = {
        valor: e.valor,
        data_cotacao: e.data_cotacao,
        versao: e.versao,
        provedor: e.modo_ingestao
      };
    });
    return tabela;
  }

  FOS.Fx = {
    SECAO_TAXA: SECAO_TAXA,
    par: par,
    chaveCache: chaveCache,
    linhaDeCache: linhaDeCache,
    linhasDeCache: linhasDeCache,
    versaoDeCache: versaoDeCache,
    vigenteDeCache: vigenteDeCache,
    tabelaDeCache: tabelaDeCache,
    entradaDeTaxa: entradaDeTaxa,
    resolver: resolver,
    converter: converter,
    efeitoCambial: efeitoCambial,
    tabelaDeRegistros: tabelaDeRegistros
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
