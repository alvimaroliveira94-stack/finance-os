'use strict';
/**
 * Harness local de testes.
 *   node tools/test.js                 roda tudo
 *   node tools/test.js --filter=domain roda só um diretório
 *   node tools/test.js --scenarios     mostra apenas a matriz de cenários
 */
const fs = require('fs');
const path = require('path');
const runner = require('../test/_runner');
const { CENARIOS } = require('../test/scenarios');

const argv = process.argv.slice(2);
const filtro = (argv.find((a) => a.startsWith('--filter=')) || '').split('=')[1] || '';
const somenteCenarios = argv.includes('--scenarios');

const raiz = path.join(__dirname, '..', 'test');
const diretorios = ['domain', 'integration'].filter((d) => !filtro || d.indexOf(filtro) !== -1);

globalThis.__fosTest = runner;

const arquivos = [];
diretorios.forEach((dir) => {
  const completo = path.join(raiz, dir);
  if (!fs.existsSync(completo)) return;
  fs.readdirSync(completo)
    .filter((f) => f.endsWith('.test.js'))
    .sort()
    .forEach((f) => arquivos.push(path.join(completo, f)));
});

arquivos.forEach((f) => require(f));

console.log('Finance OS — testes locais');
console.log('Arquivos de teste: ' + arquivos.length);

const resultado = runner.run({ quiet: somenteCenarios });

console.log('\nMatriz de cenários canônicos');
let faltando = [];
CENARIOS.forEach((c) => {
  const r = resultado.scenarios[c.id];
  let marca;
  if (!r) {
    marca = c.visual ? '~ PENDENTE (onda visual)' : '! SEM TESTE';
    if (!c.visual) faltando.push(c.id);
  } else if (r.fail) marca = 'x FALHOU (' + r.fail + ')';
  else if (r.pass) marca = 'ok (' + r.pass + ' teste(s))';
  else marca = '~ PENDENTE (' + r.pending + ')';
  console.log('  ' + c.id + ' ' + c.nome.padEnd(58, ' ') + ' ' + marca);
});

console.log('\nResumo: ' + resultado.pass + ' passaram, '
  + resultado.failCount + ' falharam, ' + resultado.pending + ' pendentes.');

if (resultado.failures.length) {
  console.log('\nFalhas:');
  resultado.failures.forEach((f) => {
    console.log('\n  ' + f.label);
    console.log('    ' + (f.error && f.error.message ? f.error.message : String(f.error)));
    if (f.error && f.error.stack && !f.error.assertion) {
      console.log(f.error.stack.split('\n').slice(1, 4).join('\n'));
    }
  });
}

if (faltando.length) {
  console.log('\nCenários obrigatórios sem teste: ' + faltando.join(', '));
}

process.exit(resultado.failCount || faltando.length ? 1 : 0);
