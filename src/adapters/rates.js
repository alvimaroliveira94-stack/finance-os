/**
 * Adaptador de taxa de câmbio (provedor abstrato, PTAX como implementação).
 *
 * Regras:
 *  - o provedor NUNCA inventa taxa: sem cotação para a data exata devolve null;
 *  - a única rede usada é UrlFetchApp, isolada aqui;
 *  - a resposta é normalizada para a tabela que o domínio entende.
 *
 * A URL do provedor é parâmetro de configuração (aba 00), não constante de
 * código, e nenhuma credencial é usada ou armazenada.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.Adapters = FOS.Adapters || {};

  /**
   * Provedor manual: as taxas vêm de registros já presentes na planilha.
   * É o padrão do V1 — sem rede, sem dependência externa.
   */
  function provedorManual(registros) {
    return {
      nome: 'MANUAL',
      tabela: function () { return FOS.Fx.tabelaDeRegistros(registros); }
    };
  }

  /**
   * Provedor HTTP genérico (PTAX ou equivalente).
   * @param {Object} urlFetchApp
   * @param {{url:string, extrair:Function, nome?:string}} opcoes
   *   extrair(respostaTexto, data) -> number|null
   */
  function provedorHttp(urlFetchApp, opcoes) {
    return {
      nome: opcoes.nome || 'PTAX',
      obter: function (moedaEstrangeira, moedaGerencial, dataIso) {
        var url = String(opcoes.url).replace('{data}', dataIso).replace('{moeda}', moedaEstrangeira);
        var resposta;
        try {
          resposta = urlFetchApp.fetch(url, { muteHttpExceptions: true });
        } catch (e) {
          return { value: null, reason: 'PROVEDOR_INDISPONIVEL:' + e.message };
        }
        if (resposta.getResponseCode() !== 200) {
          return { value: null, reason: 'PROVEDOR_HTTP_' + resposta.getResponseCode() };
        }
        var taxa = opcoes.extrair(resposta.getContentText(), dataIso);
        if (taxa === null || taxa === undefined || !Number.isFinite(Number(taxa))) {
          return { value: null, reason: 'TAXA_NAO_PUBLICADA:' + dataIso };
        }
        return { value: Number(taxa), reason: null };
      }
    };
  }

  /**
   * Resolve a taxa por qualquer provedor, devolvendo sempre o formato do
   * domínio ({value, status, reason, provedor, data}).
   */
  function resolverTaxa(provedor, moedaEstrangeira, moedaGerencial, dataIso) {
    if (provedor && typeof provedor.tabela === 'function') {
      return FOS.Fx.resolver(provedor.tabela(), moedaEstrangeira, moedaGerencial, dataIso, provedor.nome);
    }
    if (provedor && typeof provedor.obter === 'function') {
      var r = provedor.obter(moedaEstrangeira, moedaGerencial, dataIso);
      if (r.value === null) {
        return { value: null, status: 'NULL', reason: r.reason || 'TAXA_INDISPONIVEL', provedor: provedor.nome, data: null };
      }
      return { value: r.value, status: 'OK', reason: null, provedor: provedor.nome, data: dataIso };
    }
    return { value: null, status: 'NULL', reason: 'PROVEDOR_NAO_CONFIGURADO', provedor: null, data: null };
  }

  FOS.Adapters.provedorManual = provedorManual;
  FOS.Adapters.provedorHttp = provedorHttp;
  FOS.Adapters.resolverTaxa = resolverTaxa;
})(typeof globalThis !== 'undefined' ? globalThis : this);
