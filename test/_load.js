'use strict';
/**
 * Carrega os arquivos de src na mesma ordem em que o Apps Script os
 * concatena no escopo global, e devolve o namespace FOS.
 * É assim que o mesmo código roda no GAS e sob Node sem module system.
 */
const path = require('path');
const fs = require('fs');

const ORDEM = [
  'domain/core.js',
  'domain/hash.js',
  'domain/dates.js',
  'domain/constants.js',
  'domain/schema.js',
  'domain/normalize.js',
  'domain/config.js',
  'domain/accounts.js',
  'domain/fingerprint.js',
  'domain/parsers.js',
  'domain/import.js',
  'domain/rules.js',
  'domain/queue.js',
  'domain/ledger.js',
  'domain/events.js',
  'domain/matching.js',
  'domain/subledger.js',
  'domain/provisions.js',
  'domain/objectives.js',
  'domain/positions.js',
  'domain/fx.js',
  'domain/trading.js',
  'domain/life.js',
  'domain/signals.js',
  'domain/state.js',
  'domain/invariants.js',
  'domain/closing.js',
  'domain/restatement.js',
  'domain/viewmodel.js',
  'adapters/clock.js',
  'adapters/spreadsheet.js',
  'adapters/drive.js',
  'adapters/rates.js',
  'app/repository.js',
  'app/audit.js',
  'app/seed.js',
  'app/bootstrap.js',
  'app/workflows.js'
];

const raiz = path.join(__dirname, '..', 'src');

ORDEM.forEach(function (arquivo) {
  const caminho = path.join(raiz, arquivo);
  const codigo = fs.readFileSync(caminho, 'utf8');
  // eslint-disable-next-line no-new-func
  const executar = new Function(codigo + '\n//# sourceURL=' + caminho);
  executar.call(globalThis);
});

/** Lista de arquivos carregados, usada pelo teste de estrutura do projeto. */
globalThis.FOS.__arquivos = ORDEM.slice();

module.exports = globalThis.FOS;
