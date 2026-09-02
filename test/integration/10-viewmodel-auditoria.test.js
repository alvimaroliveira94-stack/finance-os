'use strict';
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');

const C = FOS.Constants;
const A = C.ABAS_INTERNAS;

function workbookFechado() {
  const ctx = dataset.workbookComMovimento();
  ctx.workflows.fecharCompetencia('2026-01');
  return ctx;
}

describe('View-model do dashboard (somente leitura)', () => {
  it('expõe apenas os campos da allowlist', { scenario: 'C34' }, () => {
    const ctx = workbookFechado();
    // Relógio próximo do fechamento: sem isso o próprio view-model marcaria STALE.
    const vm = ctx.workflows.viewModel('2026-01', { agora: '2026-02-05' });
    assert.equal(vm.status, 'OK');
    assert.ok(vm.dados.somente_leitura);
    assert.equal(vm.dados.competencia, '2026-01');
    assert.equal(vm.dados.vida.caixa_vida_brl.value, 12200);
    assert.equal(vm.dados.trading.metricas.pnl_operacional_gbp.value, 1300);
    assert.equal(vm.dados.sinais.length, 7);
  });

  it('não deixa vazar nenhum campo de origem do ledger', { scenario: 'C34' }, () => {
    const ctx = workbookFechado();
    const vm = ctx.workflows.viewModel('2026-01');
    const vazamentos = FOS.ViewModel.auditarVazamento(vm);
    assert.deep(vazamentos, [], 'campos proibidos encontrados: ' + vazamentos.join(','));
    const texto = FOS.Core.canonicalJson(vm);
    ['ALUGUEL', 'SUPERMERCADO', 'extrato-janeiro.csv'].forEach((termo) => {
      assert.equal(texto.indexOf(termo), -1, 'descrição de transação vazou: ' + termo);
    });
  });

  it('descarta campos fora da allowlist mesmo se aparecerem no snapshot', { scenario: 'C34' }, () => {
    const vm = FOS.ViewModel.construir({
      competencia: '2026-01',
      estado: 'FECHADO',
      vida: { caixa_vida_brl: FOS.Core.value(100), segredo_interno: 'nao deve sair' },
      campo_novo_nao_previsto: 'tambem nao deve sair'
    }, {});
    assert.equal(vm.dados.vida.caixa_vida_brl.value, 100);
    assert.equal(vm.dados.vida.segredo_interno, undefined);
    assert.equal(vm.dados.campo_novo_nao_previsto, undefined);
  });

  it('sem fechamento devolve NULL com motivo, não zero', { scenario: 'C35' }, () => {
    const ctx = dataset.workbookComMovimento();
    const vm = ctx.workflows.viewModel('2026-01');
    assert.equal(vm.status, 'NULL');
    assert.equal(vm.reason, 'SEM_FECHAMENTO_DISPONIVEL');
    assert.isNull(vm.dados);
  });

  it('snapshot ilegível devolve ERROR', { scenario: 'C35' }, () => {
    const ctx = workbookFechado();
    ctx.planilha._abas[A.FECHAMENTOS].linhas.forEach((linha, i) => {
      const idx = ctx.planilha.cabecalhos(A.FECHAMENTOS).indexOf('snapshot_json');
      ctx.planilha._abas[A.FECHAMENTOS].linhas[i][idx] = '{json quebrado';
    });
    const vm = ctx.workflows.viewModel('2026-01');
    assert.equal(vm.status, 'ERROR');
    assert.equal(vm.reason, 'SNAPSHOT_ILEGIVEL');
  });

  it('fechamento antigo é marcado como STALE', { scenario: 'C35' }, () => {
    const ctx = workbookFechado();
    // Sem passar maxIdadeDias: o limite vem do parâmetro MAX_IDADE_VIEWMODEL_DIAS da aba 00.
    const vm = ctx.workflows.viewModel('2026-01', { agora: '2026-06-01' });
    assert.equal(vm.status, 'STALE');
    assert.includes(vm.reason, 'FECHAMENTO_DESATUALIZADO');
  });

  it('valores bloqueados chegam como null com reason', { scenario: 'C35' }, () => {
    const ctx = dataset.workbookComMovimento({ taxas: [] });
    const snapshot = ctx.workflows.revisarCompetencia('2026-01').snapshot;
    const vm = FOS.ViewModel.construir(snapshot, {});
    assert.isNull(vm.dados.cambio.taxa);
    assert.isNull(vm.dados.cambio.efeito_cambial_brl.value);
    assert.ok(vm.dados.cambio.efeito_cambial_brl.reason);
    assert.equal(vm.status, 'STALE', 'fechamento não finalizado não pode se passar por definitivo');
  });

  it('ações sugeridas nunca são executáveis', { scenario: 'C34' }, () => {
    const acoes = FOS.Closing.acoesSugeridas(
      [{ codigo: C.SINAL.QUEDA_RUNWAY, valor: true }],
      [{ provisao_id: 'P1', nome: 'X', status: C.STATUS_PROVISAO.EM_RISCO }]
    );
    assert.equal(acoes.length, 2);
    acoes.forEach((a) => assert.equal(a.executa_automaticamente, false));
  });
});

describe('Log de auditoria', () => {
  it('registra antes e depois de cada ação relevante', { scenario: 'C36' }, () => {
    const ctx = dataset.montarWorkbook();
    ctx.workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'extrato-janeiro.csv', conteudo: dataset.CSV_JANEIRO
    });
    ctx.workflows.conciliarEventos();
    ctx.workflows.fecharCompetencia('2026-01');

    const log = ctx.repositorio.log();
    const acoes = log.map((l) => l.acao);
    ['BOOTSTRAP', 'IMPORTAR_EXTRATO', 'CONCILIAR_EVENTOS', 'FECHAR_COMPETENCIA'].forEach((acao) => {
      assert.includes(acoes, acao);
    });

    const importacao = log.filter((l) => l.acao === 'IMPORTAR_EXTRATO')[0];
    assert.ok(importacao.antes !== '', 'log sem estado anterior');
    assert.ok(importacao.depois !== '', 'log sem estado posterior');
    assert.ok(importacao.timestamp);
    assert.equal(importacao.ator, 'TESTE');
    assert.notEqual(importacao.antes, importacao.depois);
  });

  it('registra rejeição de importação sem gravar linha nenhuma', { scenario: 'C03' }, () => {
    const ctx = dataset.montarWorkbook();
    const r = ctx.workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'extrato-marco.csv', conteudo: dataset.CSV_INVALIDO
    });
    assert.notOk(r.ok);
    assert.equal(ctx.repositorio.staging().length, 0);
    assert.equal(ctx.repositorio.ledger().length, 0);
    const log = ctx.repositorio.log().filter((l) => l.acao === 'IMPORTAR_EXTRATO')[0];
    assert.equal(log.resultado, 'REJEITADO');
    assert.includes(log.detalhe, 'ARQUIVO_COM_LINHAS_INVALIDAS');
  });

  it('trunca conteúdo longo sem quebrar o log', { scenario: 'C36' }, () => {
    const gigante = { texto: new Array(9000).join('x') };
    const serializado = FOS.App.serializarParaLog(gigante);
    assert.ok(serializado.length < 4100);
    assert.includes(serializado, 'truncado');
  });
});

describe('Fluxo completo de ponta a ponta', () => {
  it('importa, classifica, concilia, fecha e publica o view-model', { scenario: 'C05' }, () => {
    const ctx = dataset.montarWorkbook();

    const janeiro = ctx.workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'extrato-janeiro.csv', conteudo: dataset.CSV_JANEIRO
    });
    assert.ok(janeiro.ok);
    assert.equal(janeiro.classificadas, 5);
    assert.equal(janeiro.emFila, 0);

    const reimportacao = ctx.workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'extrato-janeiro.csv', conteudo: dataset.CSV_JANEIRO
    });
    assert.equal(reimportacao.escritas, 0, 'reimportação não pode gerar linha nova');
    assert.equal(ctx.repositorio.ledger().length, 5);

    ctx.workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'extrato-fevereiro.csv', conteudo: dataset.CSV_FEVEREIRO
    });
    const conciliacao = ctx.workflows.conciliarEventos();
    assert.equal(conciliacao.conciliadas, 3);
    assert.equal(conciliacao.pendentes.length, 0);

    const jan = ctx.workflows.fecharCompetencia('2026-01');
    assert.ok(jan.validacao.ok, JSON.stringify(jan.validacao.violacoes));
    const fev = ctx.workflows.fecharCompetencia('2026-02');
    assert.ok(fev.validacao.ok, JSON.stringify(fev.validacao.violacoes));

    const vm = ctx.workflows.viewModel('2026-02', { agora: '2026-03-05' });
    assert.equal(vm.status, 'OK');
    assert.equal(vm.dados.competencia, '2026-02');
    assert.deep(FOS.ViewModel.auditarVazamento(vm), []);
  });

  it('o ledger permanece append-only ao longo do fluxo', { scenario: 'C32' }, () => {
    const ctx = dataset.workbookComMovimento();
    const linhas = ctx.repositorio.ledger();
    assert.ok(FOS.Invariants.ledgerAppendOnly(linhas).ok);
    // conciliação gerou versão 2 para as linhas conciliadas, sem apagar a 1
    const conciliadas = linhas.filter((l) => Number(l.versao_gerencial) === 2);
    assert.equal(conciliadas.length, 3);
    conciliadas.forEach((v2) => {
      const v1 = linhas.filter((l) => l.fingerprint === v2.fingerprint && Number(l.versao_gerencial) === 1)[0];
      assert.ok(v1, 'versão 1 desapareceu');
      assert.equal(v1.valor_origem, v2.valor_origem);
      assert.equal(v1.evento_conciliado_id, '');
      assert.notEqual(v2.evento_conciliado_id, '');
    });
  });

  it('bootstrap é idempotente', { scenario: 'C36' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const antes = ctx.repositorio.configLinhas().length;
    FOS.App.Bootstrap.inicializar({ planilha: ctx.planilha, repositorio: ctx.repositorio });
    assert.equal(ctx.repositorio.configLinhas().length, antes);
    assert.equal(ctx.planilha.listarAbas().length, 17, '4 abas visíveis + 13 internas');
  });
});
