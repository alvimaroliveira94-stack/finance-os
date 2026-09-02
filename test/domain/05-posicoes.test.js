'use strict';
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');

const E = FOS.Constants.EVENTO_POSICAO;

describe('Ledger de posições (event sourcing)', () => {
  it('aplica os quatro tipos de evento', { scenario: 'C29' }, () => {
    const projecao = FOS.Positions.projetar(dataset.POSICOES, { ateData: '2026-02-28' });
    const p = projecao.POS_ETF;
    assert.equal(p.capital_investido, 3500, 'aportes somam capital');
    assert.equal(p.distribuicoes, 30, 'distribuição não altera capital investido');
    assert.equal(p.valor_mercado, 3650, 'último snapshot vale');
    assert.equal(p.data_snapshot, '2026-02-28');
    assert.equal(p.resultado_nao_realizado, 150);
    assert.equal(p.quantidade, 34);
  });

  it('retirada reduz capital investido', { scenario: 'C29' }, () => {
    const eventos = dataset.POSICOES.concat([
      dataset.eventoPosicao({ evento_id: 'PE100', tipo_evento: E.RETIRADA, data: '2026-03-10', valor: 500, quantidade: 5 })
    ]);
    const p = FOS.Positions.projetar(eventos, { ateData: '2026-03-31' }).POS_ETF;
    assert.equal(p.capital_investido, 3000);
    assert.equal(p.quantidade, 29);
  });

  it('respeita o corte de data', { scenario: 'C29' }, () => {
    const p = FOS.Positions.projetar(dataset.POSICOES, { ateData: '2026-01-31' }).POS_ETF;
    assert.equal(p.capital_investido, 2000);
    assert.equal(p.valor_mercado, 2050);
  });

  it('recusa evento não compensatório com valor negativo', { scenario: 'C30' }, () => {
    const r = FOS.Positions.validarEvento(
      dataset.eventoPosicao({ evento_id: 'X', tipo_evento: E.APORTE, data: '2026-01-01', valor: -100 }), []
    );
    assert.notOk(r.ok);
    assert.includes(r.erros.map((e) => e.codigo), 'VALOR_NAO_POSITIVO');
  });

  it('corrige aporte por evento compensatório, sem apagar o original', { scenario: 'C30' }, () => {
    const original = dataset.POSICOES.filter((e) => e.evento_id === 'PE003')[0];
    const compensatorio = FOS.Positions.eventoCompensatorio(original, 'PE003C', dataset.AGORA, 'valor lançado errado');
    assert.equal(compensatorio.valor, -1500);
    assert.equal(compensatorio.compensa_evento_id, 'PE003');

    const validacao = FOS.Positions.validarEvento(compensatorio, dataset.POSICOES);
    assert.ok(validacao.ok, JSON.stringify(validacao.erros));

    const eventos = dataset.POSICOES.concat([compensatorio]);
    const p = FOS.Positions.projetar(eventos, { ateData: '2026-02-28' }).POS_ETF;
    assert.equal(p.capital_investido, 2000, 'o aporte errado foi neutralizado');
    assert.equal(eventos.filter((e) => e.evento_id === 'PE003').length, 1, 'o evento original continua no ledger');
  });

  it('recusa compensação com valor que não é o inverso exato', { scenario: 'C30' }, () => {
    const r = FOS.Positions.validarEvento(dataset.eventoPosicao({
      evento_id: 'PE003X', tipo_evento: E.APORTE, data: '2026-02-10', valor: -1400, compensa_evento_id: 'PE003'
    }), dataset.POSICOES);
    assert.notOk(r.ok);
    assert.includes(r.erros.map((e) => e.codigo), 'COMPENSACAO_VALOR_INVALIDO');
  });

  it('recusa compensação de evento inexistente ou de outro tipo', { scenario: 'C30' }, () => {
    const inexistente = FOS.Positions.validarEvento(dataset.eventoPosicao({
      evento_id: 'X', tipo_evento: E.APORTE, data: '2026-02-10', valor: -1, compensa_evento_id: 'NAO_EXISTE'
    }), dataset.POSICOES);
    assert.includes(inexistente.erros.map((e) => e.codigo), 'EVENTO_COMPENSADO_INEXISTENTE');

    const outroTipo = FOS.Positions.validarEvento(dataset.eventoPosicao({
      evento_id: 'X', tipo_evento: E.RETIRADA, data: '2026-02-10', valor: -1500, compensa_evento_id: 'PE003'
    }), dataset.POSICOES);
    assert.includes(outroTipo.erros.map((e) => e.codigo), 'COMPENSACAO_TIPO_DIFERENTE');
  });

  it('snapshot é corrigido por snapshot compensatório, que substitui o anterior', { scenario: 'C30' }, () => {
    const eventos = dataset.POSICOES.concat([dataset.eventoPosicao({
      evento_id: 'PE005C', tipo_evento: E.SNAPSHOT_VALOR_MERCADO, data: '2026-02-28',
      valor: 3600, compensa_evento_id: 'PE005'
    })]);
    const p = FOS.Positions.projetar(eventos, { ateData: '2026-02-28' }).POS_ETF;
    assert.equal(p.valor_mercado, 3600);
    assert.throws(
      () => FOS.Positions.eventoCompensatorio(
        dataset.POSICOES.filter((e) => e.evento_id === 'PE005')[0], 'X', dataset.AGORA, 'y'
      ),
      'COMPENSACAO_NAO_SUPORTADA'
    );
  });

  it('marca posição sem snapshot e deixa valor de mercado nulo', { scenario: 'C31' }, () => {
    const eventos = [dataset.eventoPosicao({
      evento_id: 'PX1', posicao_id: 'POS_SEM_SNAP', tipo_evento: E.APORTE, data: '2026-01-05', valor: 1000
    })];
    const projecao = FOS.Positions.projetar(eventos, { ateData: '2026-01-31' });
    assert.isNull(projecao.POS_SEM_SNAP.valor_mercado);
    assert.equal(projecao.POS_SEM_SNAP.snapshot_status, 'AUSENTE');
    assert.isNull(projecao.POS_SEM_SNAP.resultado_nao_realizado);
    assert.equal(FOS.Positions.semSnapshot(projecao).length, 1);
    assert.notOk(FOS.Invariants.snapshotsAtivos(projecao).ok);
  });

  it('marca snapshot antigo como STALE sem inventar valor', { scenario: 'C31' }, () => {
    const projecao = FOS.Positions.projetar(dataset.POSICOES, { ateData: '2026-04-30', maxDiasSnapshot: 20 });
    assert.equal(projecao.POS_ETF.snapshot_status, 'STALE');
    assert.equal(projecao.POS_ETF.valor_mercado, 3720);
  });
});
