'use strict';
/**
 * Ordem canônica de carga dos arquivos de src/.
 *
 * Por que isso importa: no Apps Script todo o código global de todos os
 * arquivos é executado antes de qualquer função ser chamada, na ordem em que
 * os arquivos aparecem no editor. Vários módulos leem `FOS.Constants` no
 * momento da carga, então colar os arquivos fora desta ordem quebra o projeto
 * com TypeError antes mesmo de abrir o menu.
 *
 * Esta lista é a fonte única dessa ordem: o loader dos testes e o build do
 * arquivo único usam exatamente ela.
 */
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
  'domain/calibration.js',
  'domain/queue.js',
  'domain/ledger.js',
  'domain/events.js',
  'domain/matching.js',
  'domain/subledger.js',
  'domain/provisions.js',
  'domain/objectives.js',
  'domain/liabilities.js',
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
  'domain/surfaces.js',
  'adapters/clock.js',
  'adapters/spreadsheet.js',
  'adapters/drive.js',
  'adapters/rates.js',
  'app/repository.js',
  'app/audit.js',
  'app/seed.js',
  'app/bootstrap.js',
  'app/workflows.js',
  'main.js'
];

module.exports = { ORDEM };
