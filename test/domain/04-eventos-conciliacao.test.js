'use strict';
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');

const C = FOS.Constants;
const config = FOS.Config.build(FOS.App.Seed.configRows());

function linhaLedger(campos) {
  return Object.assign({
    linha_id: 'LED-x',
    fingerprint: 'fp-x',
    versao_gerencial: 1,
    data_origem: '2026-01-15',
    descricao_origem: 'TRANSFERENCIA RECEBIDA WISE',
    valor_origem: 6000,
    moeda_origem: 'BRL',
    conta_id: 'INTER_CC',
    categoria: C.CATEGORIA.SAQUE_TRADING,
    universo: C.UNIVERSO.TRADING,
    evento_conciliado_id: ''
  }, campos);
}

describe('Eventos manuais', () => {
  it('reconhece exatamente sete tipos', { scenario: 'C06' }, () => {
    assert.equal(C.values(C.TIPO_EVENTO).length, 7);
    C.values(C.TIPO_EVENTO).forEach((tipo) => {
      assert.ok(FOS.Events.spec(tipo), 'sem especificação para ' + tipo);
    });
  });

  it('valida os sete tipos com dados coerentes', { scenario: 'C06' }, () => {
    const casos = [
      dataset.evento({ evento_id: 'E1', tipo_evento: 'SAQUE_TRADING', data: '2026-01-15', conta_origem: 'WISE', conta_destino: 'INTER_CC', valor: 6000, valor_origem_moeda: 1000, moeda_origem: 'GBP' }),
      dataset.evento({ evento_id: 'E2', tipo_evento: 'GASTO_EXTRAORDINARIO', data: '2026-01-16', conta_origem: 'INTER_CC', valor: 900 }),
      dataset.evento({ evento_id: 'E3', tipo_evento: 'APORTE_EXTRAORDINARIO', data: '2026-01-17', conta_origem: 'INTER_CC', conta_destino: 'BETFAIR', valor: 2000, valor_origem_moeda: 320, moeda_origem: 'GBP' }),
      dataset.evento({ evento_id: 'E4', tipo_evento: 'NOVA_OBRIGACAO', data: '2026-01-18', valor: 3000, referencia_id: 'PROV_X' }),
      dataset.evento({ evento_id: 'E5', tipo_evento: 'NOVO_OBJETIVO', data: '2026-01-19', valor: 20000, referencia_id: 'OBJ_X' }),
      dataset.evento({ evento_id: 'E6', tipo_evento: 'APORTE_POSICAO', data: '2026-01-20', conta_origem: 'INTER_CC', valor: 1500, referencia_id: 'POS_ETF' }),
      dataset.evento({ evento_id: 'E7', tipo_evento: 'RETIRADA_POSICAO', data: '2026-01-21', conta_destino: 'INTER_CC', valor: 500, referencia_id: 'POS_ETF' })
    ];
    casos.forEach((e) => {
      const r = FOS.Events.validar(e, config);
      assert.ok(r.ok, e.tipo_evento + ': ' + JSON.stringify(r.erros));
    });
  });

  it('recusa tipo fora do catálogo', { scenario: 'C06' }, () => {
    const r = FOS.Events.validar(dataset.evento({ evento_id: 'EX', tipo_evento: 'INVENTADO', data: '2026-01-01', valor: 1 }), config);
    assert.notOk(r.ok);
    assert.equal(r.erros[0].codigo, 'TIPO_EVENTO_INVALIDO');
  });

  it('exige valor positivo: o sinal vem do tipo do evento', { scenario: 'C06' }, () => {
    const r = FOS.Events.validar(dataset.evento({
      evento_id: 'EX', tipo_evento: 'GASTO_EXTRAORDINARIO', data: '2026-01-01', conta_origem: 'INTER_CC', valor: -100
    }), config);
    assert.notOk(r.ok);
    assert.includes(r.erros.map((e) => e.codigo), 'VALOR_INVALIDO');
  });

  it('recusa universo de origem incompatível', { scenario: 'C07' }, () => {
    const r = FOS.Events.validar(dataset.evento({
      evento_id: 'EX', tipo_evento: 'GASTO_EXTRAORDINARIO', data: '2026-01-01', conta_origem: 'BETFAIR', valor: 100
    }), config);
    assert.notOk(r.ok);
    assert.includes(r.erros.map((e) => e.codigo), 'UNIVERSO_ORIGEM_INCOMPATIVEL');
  });

  it('recusa saque de trading fora da fronteira reconhecida', { scenario: 'C07' }, () => {
    const r = FOS.Events.validar(dataset.evento({
      evento_id: 'EX', tipo_evento: 'SAQUE_TRADING', data: '2026-01-01',
      conta_origem: 'BETFAIR', conta_destino: 'INTER_CC', valor: 1000
    }), config);
    assert.notOk(r.ok);
    assert.includes(r.erros.map((e) => e.codigo), 'FRONTEIRA_NAO_RECONHECIDA');
  });

  it('exige referência para obrigação, objetivo e posição', { scenario: 'C07' }, () => {
    ['NOVA_OBRIGACAO', 'NOVO_OBJETIVO'].forEach((tipo) => {
      const r = FOS.Events.validar(dataset.evento({ evento_id: 'EX', tipo_evento: tipo, data: '2026-01-01', valor: 10 }), config);
      assert.includes(r.erros.map((e) => e.codigo), 'REFERENCIA_OBRIGATORIA');
    });
  });

  it('define a expectativa de conciliação com o sinal correto', { scenario: 'C08' }, () => {
    const saque = FOS.Events.expectativaConciliacao(dataset.evento({
      evento_id: 'E1', tipo_evento: 'SAQUE_TRADING', data: '2026-01-15',
      conta_origem: 'WISE', conta_destino: 'INTER_CC', valor: 6000
    }));
    assert.equal(saque.valor_esperado, 6000);
    assert.equal(saque.conta_id, 'INTER_CC');

    const gasto = FOS.Events.expectativaConciliacao(dataset.evento({
      evento_id: 'E2', tipo_evento: 'GASTO_EXTRAORDINARIO', data: '2026-01-16',
      conta_origem: 'INTER_CC', valor: 900
    }));
    assert.equal(gasto.valor_esperado, -900);

    assert.isNull(FOS.Events.expectativaConciliacao(dataset.evento({
      evento_id: 'E4', tipo_evento: 'NOVA_OBRIGACAO', data: '2026-01-18', valor: 3000, referencia_id: 'P'
    })));
  });
});

describe('Conciliação', () => {
  const evento = dataset.evento({
    evento_id: 'EV001', tipo_evento: 'SAQUE_TRADING', data: '2026-01-15',
    conta_origem: 'WISE', conta_destino: 'INTER_CC', valor: 6000
  });

  it('concilia com valor exato, conta compatível e dentro da janela', { scenario: 'C08' }, () => {
    const r = FOS.Matching.conciliar({
      eventos: [evento],
      linhas: [linhaLedger({ fingerprint: 'fp-1', data_origem: '2026-01-17' })],
      janelaDias: 3,
      agora: dataset.AGORA
    });
    assert.equal(r.conciliacoes.length, 1);
    assert.equal(r.conciliacoes[0].fingerprint, 'fp-1');
    assert.equal(r.itensFila.length, 0);
  });

  it('não concilia fora da janela de dias', { scenario: 'C08' }, () => {
    const r = FOS.Matching.conciliar({
      eventos: [evento],
      linhas: [linhaLedger({ fingerprint: 'fp-1', data_origem: '2026-01-19' })],
      janelaDias: 3,
      agora: dataset.AGORA
    });
    assert.equal(r.conciliacoes.length, 0);
    assert.equal(r.pendentes[0].motivo, 'CONCILIACAO_SEM_CANDIDATO');
    assert.equal(r.itensFila.length, 0,
      'falta de candidato não é ambiguidade: quem cobra é a invariante do fechamento');
  });

  it('não concilia com valor diferente nem com conta diferente', { scenario: 'C08' }, () => {
    const valorDiferente = FOS.Matching.conciliar({
      eventos: [evento],
      linhas: [linhaLedger({ fingerprint: 'fp-1', valor_origem: 5999.99 })],
      janelaDias: 3, agora: dataset.AGORA
    });
    assert.equal(valorDiferente.conciliacoes.length, 0);

    const contaDiferente = FOS.Matching.conciliar({
      eventos: [evento],
      linhas: [linhaLedger({ fingerprint: 'fp-1', conta_id: 'NUBANK' })],
      janelaDias: 3, agora: dataset.AGORA
    });
    assert.equal(contaDiferente.conciliacoes.length, 0);
  });

  it('manda ambiguidade para a fila em vez de escolher', { scenario: 'C09' }, () => {
    const r = FOS.Matching.conciliar({
      eventos: [evento],
      linhas: [
        linhaLedger({ fingerprint: 'fp-1', data_origem: '2026-01-14' }),
        linhaLedger({ fingerprint: 'fp-2', data_origem: '2026-01-16' })
      ],
      janelaDias: 3,
      agora: dataset.AGORA
    });
    assert.equal(r.conciliacoes.length, 0);
    assert.equal(r.pendentes[0].motivo, 'AMBIGUIDADE_CONCILIACAO');
    assert.equal(r.itensFila[0].origem, C.ORIGEM_FILA.CONCILIACAO);
    assert.includes(r.itensFila[0].candidatos, 'fp-1');
    assert.includes(r.itensFila[0].candidatos, 'fp-2');
  });

  it('não usa a mesma linha para dois eventos', { scenario: 'C09' }, () => {
    const outro = dataset.evento({
      evento_id: 'EV002', tipo_evento: 'SAQUE_TRADING', data: '2026-01-15',
      conta_origem: 'WISE', conta_destino: 'INTER_CC', valor: 6000
    });
    const r = FOS.Matching.conciliar({
      eventos: [evento, outro],
      linhas: [linhaLedger({ fingerprint: 'fp-1' })],
      janelaDias: 3,
      agora: dataset.AGORA
    });
    assert.equal(r.conciliacoes.length, 1);
    assert.equal(r.pendentes.length, 1);
  });

  it('ignora eventos que não têm contrapartida no extrato', { scenario: 'C08' }, () => {
    const r = FOS.Matching.conciliar({
      eventos: [dataset.evento({
        evento_id: 'EV020', tipo_evento: 'NOVA_OBRIGACAO', data: '2026-01-03', valor: 3000, referencia_id: 'PROV_IPTU'
      })],
      linhas: [],
      janelaDias: 3,
      agora: dataset.AGORA
    });
    assert.equal(r.conciliacoes.length, 0);
    assert.equal(r.pendentes.length, 0);
    assert.equal(r.itensFila.length, 0);
  });
});
