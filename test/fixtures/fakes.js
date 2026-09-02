'use strict';
/**
 * Fakes de plataforma usados nos testes de integração.
 * Implementam o mesmo contrato dos adaptadores reais, em memória.
 */
const FOS = require('../_load');

/**
 * Simula o que o Google Sheets faz com uma string 'AAAA-MM-DD' gravada numa
 * célula: interpreta como data e devolve um objeto Date na leitura.
 * O Date é criado com o construtor local, que é o comportamento do Apps
 * Script (o fuso do runtime é o do projeto).
 */
function comoCelulaDoSheets(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const [ano, mes, dia] = valor.split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

/**
 * Planilha em memória: tabelas nomeadas com cabeçalho na primeira linha.
 * @param {{datasComoDate?:boolean}} [opcoes] com datasComoDate a planilha
 *   devolve Date onde houver data, como o Sheets real faz.
 */
function planilhaFake(opcoes) {
  const opts = opcoes || {};
  const abas = {};
  const chamadas = [];
  const ocultas = {};
  return {
    _abas: abas,
    _chamadas: chamadas,
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
      return abas[nome].linhas.map((row) => FOS.Schema.toObject(
        abas[nome].headers,
        // Mesma normalização de fronteira do adaptador real.
        row.map((celula) => FOS.Adapters.normalizarCelula(celula, {}))
      ));
    },
    anexarLinhas(nome, objetos) {
      if (!objetos || !objetos.length) return 0;
      if (!abas[nome]) throw FOS.Core.DomainError('ABA_INEXISTENTE', 'Aba não encontrada: ' + nome);
      const headers = abas[nome].headers;
      objetos.forEach((obj) => {
        abas[nome].linhas.push(headers.map((h) => {
          const v = obj[h] === undefined || obj[h] === null ? '' : obj[h];
          return opts.datasComoDate ? comoCelulaDoSheets(v) : v;
        }));
      });
      return objetos.length;
    },
    // Formatação e proteção são cosméticas: o fake apenas registra as chamadas,
    // para que os testes provem que o bootstrap as aplica.
    formatarAba(nome, spec) { chamadas.push({ metodo: 'formatarAba', nome, spec }); return nome; },
    validarColunaPorLista(nome, coluna, valores) {
      chamadas.push({ metodo: 'validarColunaPorLista', nome, coluna, valores });
      return true;
    },
    protegerColunas(nome, colunas, descricao) {
      chamadas.push({ metodo: 'protegerColunas', nome, colunas, descricao });
      return nome;
    },
    ocultarAba(nome, oculta) {
      chamadas.push({ metodo: 'ocultarAba', nome, oculta });
      ocultas[nome] = !!oculta;
      return nome;
    },
    notaAba(nome, texto) { chamadas.push({ metodo: 'notaAba', nome, texto }); return nome; },
    ordenarAbas(ordem) { chamadas.push({ metodo: 'ordenarAbas', ordem }); return ordem; },
    abaEstaOculta(nome) { return !!ocultas[nome]; },
    chamadasDe(metodo) { return chamadas.filter((c) => c.metodo === metodo); },

    /** Espelha o adaptador real: escreve só as células que mudam. */
    atualizarCampos(nome, casa, campos) {
      chamadas.push({ metodo: 'atualizarCampos', nome, campos });
      if (!abas[nome]) throw FOS.Core.DomainError('ABA_INEXISTENTE', 'Aba não encontrada: ' + nome);
      const headers = abas[nome].headers;
      let alteradas = 0;
      this.lerTabela(nome).forEach((linha, i) => {
        if (!casa(linha)) return;
        let mudou = false;
        Object.keys(campos || {}).forEach((coluna) => {
          const idx = headers.indexOf(coluna);
          if (idx === -1 || linha[coluna] === campos[coluna]) return;
          abas[nome].linhas[i][idx] = campos[coluna];
          mudou = true;
        });
        if (mudou) alteradas++;
      });
      return alteradas;
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

module.exports = { planilhaFake, driveFake, urlFetchFake, comoCelulaDoSheets };
