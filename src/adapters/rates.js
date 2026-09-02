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
   * Provedor de cache: lê as taxas já materializadas na aba 00.
   * É sempre consultado ANTES do provedor externo, para que reprocessar um
   * fechamento antigo use a mesma taxa usada na época.
   */
  function provedorCache(configRows) {
    return {
      nome: 'CACHE',
      tabela: function () { return FOS.Fx.tabelaDeCache(configRows); }
    };
  }

  /**
   * Provedor HTTP parametrizado (PTAX ou equivalente).
   *
   * Contrato de segurança:
   *  - a URL vem da configuração, nunca do código;
   *  - só aceita https;
   *  - qualquer falha (rede, HTTP != 200, corpo inesperado, estouro de
   *    tempo) devolve null + reason. Nunca inventa taxa, nunca repete a
   *    taxa de outro dia;
   *  - nenhuma credencial é enviada ou armazenada.
   *
   * @param {Object} urlFetchApp adaptador de rede
   * @param {{url:string, extrair:Function, nome?:string, timeoutMs?:number, relogio?:Object}} opcoes
   */
  function provedorHttp(urlFetchApp, opcoes) {
    var opts = opcoes || {};
    return {
      nome: opts.nome || 'PTAX',
      obter: function (moedaEstrangeira, moedaGerencial, dataIso) {
        var url = String(opts.url || '')
          .replace('{data}', encodeURIComponent(dataIso))
          .replace('{moeda}', encodeURIComponent(moedaEstrangeira))
          .replace('{moeda_gerencial}', encodeURIComponent(moedaGerencial));
        if (url.indexOf('https://') !== 0) {
          return { value: null, reason: 'PROVEDOR_URL_INVALIDA' };
        }
        var inicio = opts.relogio && opts.relogio.agoraMs ? opts.relogio.agoraMs() : null;
        var resposta;
        try {
          resposta = urlFetchApp.fetch(url, {
            method: 'get',
            muteHttpExceptions: true,
            followRedirects: false,
            validateHttpsCertificates: true
          });
        } catch (e) {
          return { value: null, reason: 'PROVEDOR_INDISPONIVEL:' + (e && e.message ? e.message : 'ERRO') };
        }
        if (inicio !== null && opts.timeoutMs) {
          var duracao = opts.relogio.agoraMs() - inicio;
          if (duracao > Number(opts.timeoutMs)) {
            return { value: null, reason: 'PROVEDOR_TEMPO_EXCEDIDO:' + duracao + 'ms' };
          }
        }
        var codigo = resposta.getResponseCode();
        if (codigo !== 200) {
          return { value: null, reason: 'PROVEDOR_HTTP_' + codigo };
        }
        var taxa;
        try {
          taxa = opts.extrair(resposta.getContentText(), dataIso);
        } catch (e2) {
          return { value: null, reason: 'PROVEDOR_RESPOSTA_INESPERADA' };
        }
        if (taxa === null || taxa === undefined || !Number.isFinite(Number(taxa)) || Number(taxa) <= 0) {
          return { value: null, reason: 'TAXA_NAO_PUBLICADA:' + dataIso };
        }
        return { value: Number(taxa), reason: null };
      }
    };
  }

  var PARAM_POLITICA = 'POLITICA_TAXA_CAMBIO';
  var PARAM_URL = 'URL_PROVEDOR_TAXA_CAMBIO';
  var POLITICA_HTTP = 'HTTP';
  var POLITICA_MANUAL = 'MANUAL';

  /** Política de taxa vigente na aba 00. MANUAL é o padrão do V1. */
  function politicaDeTaxa(config) {
    return String(config.param(PARAM_POLITICA).value || POLITICA_MANUAL).toUpperCase();
  }

  /**
   * A URL do provedor é exigida pela configuração atual?
   *
   * Sob política MANUAL a ausência dela é decisão tomada, não pendência: o
   * V1 não consulta ninguém. Só sob HTTP a falta da URL é algo a resolver.
   */
  function exigeUrlDoProvedor(config) {
    return politicaDeTaxa(config) === POLITICA_HTTP;
  }

  /**
   * Provedor configurado a partir da aba 00 (política do usuário).
   * Política MANUAL é o padrão do V1: nenhuma chamada externa acontece.
   */
  function provedorConfigurado(config, configRows, deps) {
    var politica = politicaDeTaxa(config);
    var cache = provedorCache(configRows);
    if (politica !== 'HTTP') {
      return { nome: politica === 'HTTP' ? 'HTTP' : 'MANUAL', primario: cache, externo: null, politica: politica };
    }
    var url = config.param(PARAM_URL).value;
    if (!url || !(deps && deps.urlFetchApp)) {
      return { nome: 'HTTP_INDISPONIVEL', primario: cache, externo: null, politica: politica };
    }
    return {
      nome: 'HTTP',
      primario: cache,
      politica: politica,
      externo: provedorHttp(deps.urlFetchApp, {
        url: url,
        nome: String(config.param('PROVEDOR_TAXA_CAMBIO').value || 'PTAX'),
        timeoutMs: config.param('TIMEOUT_PROVEDOR_TAXA_MS').value || 15000,
        relogio: deps.relogio,
        extrair: deps.extrair || function (texto) {
          var dados = JSON.parse(texto);
          return dados && dados.taxa !== undefined ? Number(dados.taxa) : null;
        }
      })
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
    var chave = FOS.Fx.par(moedaEstrangeira, moedaGerencial);
    if (provedor && typeof provedor.obter === 'function') {
      var r = provedor.obter(moedaEstrangeira, moedaGerencial, dataIso);
      if (r.value === null) {
        return {
          value: null, status: 'NULL', reason: r.reason || 'TAXA_INDISPONIVEL',
          provedor: provedor.nome, data: null, data_cotacao: null, versao: null, par: chave
        };
      }
      return {
        value: r.value, status: 'OK', reason: null, provedor: provedor.nome,
        data: dataIso, data_cotacao: dataIso, versao: null, par: chave
      };
    }
    return {
      value: null, status: 'NULL', reason: 'PROVEDOR_NAO_CONFIGURADO',
      provedor: null, data: null, data_cotacao: null, versao: null, par: chave
    };
  }

  FOS.Adapters.PARAM_POLITICA_TAXA = PARAM_POLITICA;
  FOS.Adapters.PARAM_URL_PROVEDOR_TAXA = PARAM_URL;
  FOS.Adapters.politicaDeTaxa = politicaDeTaxa;
  FOS.Adapters.exigeUrlDoProvedor = exigeUrlDoProvedor;
  FOS.Adapters.provedorManual = provedorManual;
  FOS.Adapters.provedorCache = provedorCache;
  FOS.Adapters.provedorHttp = provedorHttp;
  FOS.Adapters.provedorConfigurado = provedorConfigurado;
  FOS.Adapters.resolverTaxa = resolverTaxa;
})(typeof globalThis !== 'undefined' ? globalThis : this);
