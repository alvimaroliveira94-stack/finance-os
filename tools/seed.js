'use strict';
/**
 * Gera o conteúdo sintético de 00_CONFIG_PARAMETROS e 20_REGRAS_CLASSIFICACAO
 * em TSV, para colar na planilha durante o setup manual.
 *
 *   node tools/seed.js config
 *   node tools/seed.js regras
 *
 * Os valores são fictícios e servem para o sistema arrancar; ajuste-os na
 * própria planilha antes de usar com dados reais.
 */
const FOS = require('../test/_load');

function tsv(aba, linhas) {
  const colunas = FOS.Schema.get(aba).colunas;
  const cabecalho = colunas.join('\t');
  const corpo = linhas.map((obj) => colunas.map((c) => {
    const v = obj[c];
    return v === undefined || v === null ? '' : String(v);
  }).join('\t'));
  return [cabecalho].concat(corpo).join('\n');
}

const alvo = (process.argv[2] || 'config').toLowerCase();
const A = FOS.Constants.ABAS_INTERNAS;

if (alvo === 'config') {
  console.log(tsv(A.CONFIG, FOS.App.Seed.configRows()));
} else if (alvo === 'regras') {
  console.log(tsv(A.REGRAS, FOS.App.Seed.REGRAS));
} else {
  console.error('Uso: node tools/seed.js [config|regras]');
  process.exit(1);
}
