'use strict';
/**
 * Fakes de plataforma usados nos testes de integração.
 * Implementam o mesmo contrato dos adaptadores reais, em memória.
 */
const FOS = require('../_load');

/** Planilha em memória: tabelas nomeadas com cabeçalho na primeira linha. */
function planilhaFake() {
  const abas = {};
  return {
    _abas: abas,
    listarAbas() { return Object.keys(abas); },
    criarAba(nome, headers) {
      if (!abas[nome]) abas[nome] = { headers: (headers || []).slice(), linhas: [] };
      else if (headers && headers.length) abas[nome].headers = headers.slice();
      return nome;
    },
    cabecalhos(nome) {
      if (!abas[nome]) throw FOS.Core.DomainError('ABA_INEXISTENTE', 'Aba não encontrada: ' + nome);
      return abas[nome].headers.slice();
    },
    lerTabela(nome) {
      if (!abas[nome]) throw FOS.Core.DomainError('ABA_INEXISTENTE', 'Aba não encontrada: ' + nome);
      return abas[nome].linhas.map((row) => FOS.Schema.toObject(abas[nome].headers, row));
    },
    anexarLinhas(nome, objetos) {
      if (!objetos || !objetos.length) return 0;
      if (!abas[nome]) throw FOS.Core.DomainError('ABA_INEXISTENTE', 'Aba não encontrada: ' + nome);
      const headers = abas[nome].headers;
      objetos.forEach((obj) => {
        abas[nome].linhas.push(headers.map((h) => (obj[h] === undefined || obj[h] === null ? '' : obj[h])));
      });
      return objetos.length;
    },
    substituirTabela(nome, objetos) {
      abas[nome].linhas = [];
      return this.anexarLinhas(nome, objetos);
    }
  };
}

/** Drive em memória: nome do arquivo -> conteúdo. */
function driveFake(arquivos) {
  return {
    lerArquivoPorNome(nome) {
      if (!(nome in arquivos)) {
        throw FOS.Core.DomainError('ARQUIVO_NAO_ENCONTRADO', 'Arquivo não encontrado: ' + nome);
      }
      return { nome, conteudo: arquivos[nome] };
    },
    lerArquivoPorId(id) { return this.lerArquivoPorNome(id); }
  };
}

/** UrlFetchApp fake, para testar o provedor de taxa sem rede. */
function urlFetchFake(respostas) {
  return {
    chamadas: [],
    fetch(url) {
      this.chamadas.push(url);
      const r = respostas[url];
      if (!r) return { getResponseCode: () => 404, getContentText: () => '' };
      return { getResponseCode: () => r.codigo || 200, getContentText: () => r.corpo || '' };
    }
  };
}

module.exports = { planilhaFake, driveFake, urlFetchFake };
