'use strict';
/**
 * Preview local do dashboard, SOMENTE com dataset sintético.
 *
 *   node tools/preview.js            gera out/preview-*.html
 *   node tools/preview.js --abrir    imprime os caminhos gerados
 *
 * Este harness não faz parte da arquitetura de produção: ele apenas injeta
 * o mesmo payload que o Apps Script injetaria, para inspeção visual em
 * desktop e mobile. Nenhum dado real é usado em nenhuma hipótese.
 */
const fs = require('fs');
const path = require('path');

const FOS = require('../test/_load');
const dataset = require('../test/fixtures/dataset');

const RAIZ = path.join(__dirname, '..');
const SAIDA = path.join(RAIZ, 'out');
const HTML = fs.readFileSync(path.join(RAIZ, 'src', 'ui', 'dashboard.html'), 'utf8');

/** Mesma injeção usada pelo Apps Script (ver src/main.js). */
function injetar(painel) {
  const json = JSON.stringify(painel === undefined ? null : painel)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return HTML.replace('/*__PAINEL__*/null', json);
}

function workbookCompleto() {
  const ctx = dataset.workbookComMovimento({ agora: '2026-03-05T12:00:00Z' });
  ctx.workflows.materializarEventos();
  ctx.workflows.fecharCompetencia('2026-01');
  ctx.workflows.fecharCompetencia('2026-02');
  // Uma reapresentação, para o histórico mostrar versão 2 marcada.
  ctx.repositorio.anexar(FOS.Constants.ABAS_INTERNAS.POSICOES, [dataset.eventoPosicao({
    evento_id: 'PE002C', tipo_evento: 'SNAPSHOT_VALOR_MERCADO', data: '2026-01-31',
    valor: 2100, compensa_evento_id: 'PE002'
  })]);
  ctx.workflows.reapresentarCompetencia('2026-01', 'Snapshot de mercado corrigido pela corretora (sintético)');
  return ctx;
}

function main() {
  if (!fs.existsSync(SAIDA)) fs.mkdirSync(SAIDA, { recursive: true });

  const ctx = workbookCompleto();
  const painel = ctx.workflows.painel('2026-02', { agora: '2026-03-05' });
  const vazamentos = FOS.ViewModel.auditarVazamento(painel);
  if (vazamentos.length) {
    console.error('ABORTADO: o payload contém campos proibidos: ' + vazamentos.join(', '));
    process.exit(1);
  }

  const arquivos = [];
  function escrever(nome, conteudo) {
    const destino = path.join(SAIDA, nome);
    fs.writeFileSync(destino, conteudo);
    arquivos.push(destino);
  }

  escrever('preview-painel.html', injetar(painel));

  // Estado vazio: workbook sem nenhum fechamento.
  const semFechamento = dataset.montarWorkbook();
  escrever('preview-vazio.html', injetar(semFechamento.workflows.painel(null, { agora: '2026-03-05' })));

  // Estado stale: mesmo fechamento lido meses depois.
  escrever('preview-stale.html', injetar(ctx.workflows.painel('2026-01', { agora: '2026-09-01' })));

  // Estado parcial: o fechamento fecha, mas com parâmetro bloqueado na aba 00.
  // Prova visual da regra "nunca zero falso": campo vazio com motivo.
  const parcial = dataset.montarWorkbook({ agora: '2026-03-05T12:00:00Z' });
  parcial.repositorio.substituir(
    FOS.Constants.ABAS_INTERNAS.CONFIG,
    parcial.repositorio.configLinhas().map((r) => (
      r.chave === 'SALDO_INICIAL_CAIXA_VIDA_BRL'
        ? Object.assign({}, r, { status: 'BLOQUEADO', reason: 'AGUARDANDO_SALDO_REAL', valor: '' })
        : r))
  );
  parcial.workflows.importarExtrato({
    contaId: 'INTER_CC', nomeArquivo: 'extrato-janeiro.csv', conteudo: dataset.CSV_JANEIRO
  });
  parcial.workflows.conciliarEventos();
  parcial.workflows.materializarEventos();
  parcial.workflows.fecharCompetencia('2026-01');
  escrever('preview-parcial.html', injetar(parcial.workflows.painel('2026-01', { agora: '2026-02-05' })));

  // Estado de erro: snapshot ilegível.
  const painelErro = FOS.ViewModel.construirPainel({
    snapshot: null, erro: 'SNAPSHOT_ILEGIVEL', agora: '2026-03-05',
    historico: painel.historico, restatements: painel.restatements, bloqueios: []
  });
  escrever('preview-erro.html', injetar(painelErro));

  console.log('Preview gerado (dataset sintético):');
  arquivos.forEach((a) => console.log('  ' + a));
  console.log('\nCompetência: ' + (painel.atual.dados ? painel.atual.dados.competencia : 'n/d')
    + ' · status: ' + painel.atual.status
    + ' · fechamentos no histórico: ' + painel.historico.length);
}

if (require.main === module) main();

module.exports = { injetar, workbookCompleto };
