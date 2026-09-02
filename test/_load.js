'use strict';
/**
 * Carrega os arquivos de src na mesma ordem em que o Apps Script os
 * concatena no escopo global, e devolve o namespace FOS.
 * É assim que o mesmo código roda no GAS e sob Node sem module system.
 */
const path = require('path');
const fs = require('fs');

const { ORDEM } = require('../tools/ordem');

// main.js só existe dentro do Apps Script (usa SpreadsheetApp/HtmlService):
// os testes carregam tudo, menos ele.
const ORDEM_TESTE = ORDEM.filter(function (a) { return a !== 'main.js'; });

const raiz = path.join(__dirname, '..', 'src');

ORDEM_TESTE.forEach(function (arquivo) {
  const caminho = path.join(raiz, arquivo);
  const codigo = fs.readFileSync(caminho, 'utf8');
  // eslint-disable-next-line no-new-func
  const executar = new Function(codigo + '\n//# sourceURL=' + caminho);
  executar.call(globalThis);
});

/** Lista de arquivos carregados, usada pelo teste de estrutura do projeto. */
globalThis.FOS.__arquivos = ORDEM_TESTE.slice();

module.exports = globalThis.FOS;
