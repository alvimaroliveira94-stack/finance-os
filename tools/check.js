'use strict';
/**
 * Verificação estática sem dependência externa (o "lint" deste projeto).
 *
 *   node tools/check.js
 *
 * Confere o que quebraria o empacotamento antes de qualquer teste rodar:
 * sintaxe de todo arquivo, JSON válido, ausência de API de Node em src/,
 * ausência de caracteres de controle e bundle atualizado.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const problemas = [];
let verificados = 0;

function listar(dir, filtro) {
  const completo = path.join(RAIZ, dir);
  if (!fs.existsSync(completo)) return [];
  return fs.readdirSync(completo, { withFileTypes: true }).flatMap((entrada) => {
    const relativo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) return listar(relativo, filtro);
    return filtro(entrada.name) ? [relativo] : [];
  });
}

const js = ['src', 'test', 'tools'].flatMap((d) => listar(d, (n) => n.endsWith('.js')));

js.forEach((arquivo) => {
  verificados++;
  try {
    execFileSync(process.execPath, ['--check', path.join(RAIZ, arquivo)], { stdio: 'pipe' });
  } catch (e) {
    problemas.push(arquivo + ': erro de sintaxe\n    ' + String(e.stderr).split('\n')[2]);
  }
});

['src/appsscript.json', 'package.json'].forEach((arquivo) => {
  verificados++;
  try {
    JSON.parse(fs.readFileSync(path.join(RAIZ, arquivo), 'utf8'));
  } catch (e) {
    problemas.push(arquivo + ': JSON inválido — ' + e.message);
  }
});

// src/ é código de produção do Apps Script: nada de API de Node ali.
const PROIBIDO_EM_SRC = [
  [/\brequire\s*\(/, 'require()'],
  [/\bmodule\.exports\b/, 'module.exports'],
  [/\bprocess\.[a-z]/, 'process'],
  [/\b__dirname\b/, '__dirname'],
  [/\bBuffer\b/, 'Buffer'],
  [/\bBigInt\b/, 'BigInt']
];

function semComentarios(texto) {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
}

listar('src', (n) => n.endsWith('.js')).forEach((arquivo) => {
  const codigo = semComentarios(fs.readFileSync(path.join(RAIZ, arquivo), 'utf8'));
  PROIBIDO_EM_SRC.forEach(([re, nome]) => {
    if (re.test(codigo)) problemas.push(arquivo + ': usa ' + nome + ', que não roda no Apps Script');
  });
});

// Caracteres de controle invisíveis já quebraram arquivo antes.
['src', 'test', 'tools', 'docs'].forEach((dir) => {
  listar(dir, () => true).forEach((arquivo) => {
    const bruto = fs.readFileSync(path.join(RAIZ, arquivo));
    for (let i = 0; i < bruto.length; i++) {
      const b = bruto[i];
      if ((b < 0x09 || (b > 0x0d && b < 0x20) || b === 0x7f)) {
        problemas.push(arquivo + ': caractere de controle na posição ' + i);
        break;
      }
    }
  });
});

try {
  execFileSync(process.execPath, [path.join(RAIZ, 'tools', 'build.js'), '--check'], { stdio: 'pipe' });
  verificados++;
} catch (e) {
  problemas.push('dist/financeos.gs desatualizado — rode: npm run build');
}

console.log('Verificação estática: ' + verificados + ' arquivos checados.');
if (problemas.length) {
  console.log('\nProblemas:');
  problemas.forEach((p) => console.log('  - ' + p));
  process.exit(1);
}
console.log('Nenhum problema encontrado.');
