'use strict';
/**
 * Gera o arquivo único para colar no Apps Script.
 *
 *   node tools/build.js            escreve dist/financeos.gs
 *   node tools/build.js --check    só verifica se o arquivo está atualizado
 *
 * Motivo de existir: no Apps Script o código global roda na ordem dos arquivos
 * do editor, e vários módulos leem FOS.Constants na carga. Colar 40 arquivos na
 * ordem errada quebra o projeto antes do primeiro clique. Um arquivo só elimina
 * a classe inteira do problema.
 */
const fs = require('fs');
const path = require('path');
const { ORDEM } = require('./ordem');

const RAIZ = path.join(__dirname, '..');
const SRC = path.join(RAIZ, 'src');
const DESTINO = path.join(RAIZ, 'dist', 'financeos.gs');

function montar() {
  const partes = [
    '/**',
    ' * Finance OS — arquivo único para Google Apps Script.',
    ' *',
    ' * GERADO por `npm run build` a partir de src/. Não edite aqui: edite os',
    ' * arquivos de src/ e gere de novo, senão a próxima geração desfaz a edição.',
    ' *',
    ' * Além deste arquivo, o projeto do Apps Script precisa de:',
    ' *   - um arquivo HTML chamado `dashboard` com o conteúdo de src/ui/dashboard.html;',
    ' *   - o manifesto de src/appsscript.json.',
    ' *',
    ' * A ordem de concatenação abaixo é a ordem canônica de carga (tools/ordem.js).',
    ' */',
    ''
  ];

  ORDEM.forEach((arquivo) => {
    const caminho = path.join(SRC, arquivo);
    if (!fs.existsSync(caminho)) {
      console.error('Arquivo ausente na ordem canônica: ' + arquivo);
      process.exit(1);
    }
    partes.push('/* ===== src/' + arquivo + ' ===== */');
    partes.push(fs.readFileSync(caminho, 'utf8').trimEnd());
    partes.push('');
  });

  return partes.join('\n') + '\n';
}

function main() {
  const conteudo = montar();
  const verificar = process.argv.indexOf('--check') !== -1;

  if (verificar) {
    if (!fs.existsSync(DESTINO)) {
      console.error('dist/financeos.gs não existe. Rode: npm run build');
      process.exit(1);
    }
    if (fs.readFileSync(DESTINO, 'utf8') !== conteudo) {
      console.error('dist/financeos.gs está desatualizado. Rode: npm run build');
      process.exit(1);
    }
    console.log('dist/financeos.gs está atualizado (' + ORDEM.length + ' arquivos).');
    return;
  }

  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  fs.writeFileSync(DESTINO, conteudo);
  const kb = Math.round(Buffer.byteLength(conteudo, 'utf8') / 1024);
  console.log('dist/financeos.gs gerado: ' + ORDEM.length + ' arquivos, ' + kb + ' KB.');
}

if (require.main === module) main();

module.exports = { montar, DESTINO, ORDEM };
