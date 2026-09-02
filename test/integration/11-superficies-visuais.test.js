'use strict';
/**
 * Cenários de superfície visual.
 * Nesta onda o dashboard ainda não existe: o que existe é o contrato de
 * dados que ele vai consumir (view-model com allowlist). Estes testes ficam
 * declarados e PENDENTES para a próxima onda, junto com a implementação
 * das abas visíveis e do HTML de leitura.
 */
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');

describe('Superfícies visuais (próxima onda)', () => {
  it('contrato de dados do dashboard já está pronto e estável', { scenario: 'C34' }, () => {
    const ctx = dataset.workbookComMovimento();
    ctx.workflows.fecharCompetencia('2026-01');
    const vm = ctx.workflows.viewModel('2026-01', { agora: '2026-02-05' });
    // O dashboard só pode depender destas chaves de topo.
    assert.deep(Object.keys(vm.dados).sort(), [
      'acoes', 'cambio', 'competencia', 'estado', 'estado_ciclo', 'fechado_em',
      'gerado_em', 'moeda_gerencial', 'objetivos', 'patrimonio', 'provisoes',
      'qualidade', 'sinais', 'somente_leitura', 'trading', 'vida'
    ]);
  });

  it('todo indicador da HOME tem rótulo, valor, status e motivo',
    { scenario: 'C37', pending: 'depende da renderização da aba HOME e do HTML de leitura' }, () => {});

  it('contraste e leitura por leitor de tela nos cartões de sinal',
    { scenario: 'C37', pending: 'depende do HTML do dashboard' }, () => {});

  it('layout mobile mantém as quatro métricas de trading separadas',
    { scenario: 'C38', pending: 'depende do CSS responsivo do dashboard' }, () => {});

  it('navegação por teclado percorre HOME, MOVIMENTAÇÕES, PLANEJAMENTO e PATRIMÔNIO',
    { scenario: 'C39', pending: 'depende das abas visíveis populadas' }, () => {});
});
