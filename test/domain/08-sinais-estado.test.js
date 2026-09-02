'use strict';
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');

const C = FOS.Constants;
const S = C.SINAL;
const E = C.ESTADO_CICLO;
const config = FOS.Config.build(FOS.App.Seed.configRows());

function ledger(campos) {
  return Object.assign({
    linha_id: 'L', fingerprint: 'f', versao_gerencial: 1,
    data_origem: '2026-03-10', descricao_origem: 'X', valor_origem: -100,
    moeda_origem: 'BRL', conta_id: 'INTER_CC', categoria: C.CATEGORIA.CUSTO_VIDA,
    universo: C.UNIVERSO.VIDA
  }, campos);
}

function fechamentoResumo(campos) {
  return Object.assign({
    competencia: '2026-02',
    runway_meses: 4,
    caixa_vida_brl: 12000,
    caixa_retirado_brl: 5000,
    protecao_total: 1200,
    patrimonio_capital_investido: 3500,
    estado_formal: E.ESTAVEL,
    estado_sugerido: E.ESTAVEL,
    provisoes: [{ provisao_id: 'PROV_IPTU', valor_acumulado: 1200, vencimento: '2026-06-10', status: 'EM_RITMO' }]
  }, campos);
}

function ctx(campos) {
  return Object.assign({
    config,
    competencia: '2026-03',
    dataReferencia: '2026-03-31',
    linhas: [],
    eventos: [],
    provisoes: [{ provisao_id: 'PROV_IPTU', valor_acumulado: 1900, vencimento: '2026-06-10', status: 'EM_RITMO' }],
    caixaVida: FOS.Core.value(12000),
    runway: FOS.Core.value(4),
    caixaRetiradoBrl: FOS.Core.value(5000),
    patrimonioCapitalInvestido: 3500,
    fechamentosAnteriores: [fechamentoResumo()]
  }, campos);
}

describe('Sinais do ciclo de 90 dias', () => {
  it('são sete, binários e independentes, sem score', () => {
    const sinais = FOS.Signals.avaliarTodos(ctx());
    assert.equal(sinais.length, 7);
    assert.deep(sinais.map((s) => s.codigo), [
      S.REDUCAO_PROTECAO, S.GASTO_EXTRAORDINARIO_ANORMAL, S.VIDA_PARA_TRADING,
      S.RESERVA_FORA_DA_FINALIDADE, S.QUEDA_RUNWAY, S.COMPROMISSO_SEM_PROVISAO,
      S.RETIRADA_APOS_MES_FORTE
    ]);
    sinais.forEach((s) => {
      assert.ok(s.valor === true || s.valor === false || s.valor === null);
      assert.notOk(Object.prototype.hasOwnProperty.call(s, 'peso'));
      assert.notOk(Object.prototype.hasOwnProperty.call(s, 'score'));
    });
  });

  it('redução de proteção compara com o fechamento anterior', { scenario: 'C18' }, () => {
    assert.equal(FOS.Signals.reducaoProtecao(ctx()).valor, false);
    const caiu = FOS.Signals.reducaoProtecao(ctx({
      provisoes: [{ provisao_id: 'PROV_IPTU', valor_acumulado: 900, vencimento: '2026-06-10' }]
    }));
    assert.equal(caiu.valor, true);
  });

  it('redução de proteção é DADO_INSUFICIENTE sem histórico', { scenario: 'C18' }, () => {
    const r = FOS.Signals.reducaoProtecao(ctx({ fechamentosAnteriores: [] }));
    assert.isNull(r.valor);
    assert.equal(r.status, 'DADO_INSUFICIENTE');
  });

  it('gasto extraordinário anormal usa o limite reversível de 30% do caixa de vida', { scenario: 'C19' }, () => {
    const dentro = FOS.Signals.gastoExtraordinarioAnormal(ctx({
      linhas: [ledger({ fingerprint: 'g1', valor_origem: -3000, categoria: C.CATEGORIA.GASTO_EXTRAORDINARIO })]
    }));
    assert.equal(dentro.valor, false);

    const acima = FOS.Signals.gastoExtraordinarioAnormal(ctx({
      linhas: [ledger({ fingerprint: 'g2', valor_origem: -3700, categoria: C.CATEGORIA.GASTO_EXTRAORDINARIO })]
    }));
    assert.equal(acima.valor, true);
    assert.includes(acima.detalhe, 'teto=3600');
  });

  it('gasto extraordinário fica nulo se o caixa de vida está indisponível', { scenario: 'C19' }, () => {
    const r = FOS.Signals.gastoExtraordinarioAnormal(ctx({
      caixaVida: FOS.Core.nullValue('SALDO_INICIAL_BLOQUEADO')
    }));
    assert.isNull(r.valor);
    assert.equal(r.reason, 'SALDO_INICIAL_BLOQUEADO');
  });

  it('Vida para Trading dispara com aporte extraordinário no período', { scenario: 'C20' }, () => {
    assert.equal(FOS.Signals.vidaParaTrading(ctx()).valor, false);
    const comAporte = FOS.Signals.vidaParaTrading(ctx({
      eventos: [{
        evento_id: 'EV', tipo_evento: 'APORTE_EXTRAORDINARIO', data: '2026-03-05',
        conta_origem: 'INTER_CC', conta_destino: 'BETFAIR', valor: 2000, status: 'PENDENTE'
      }]
    }));
    assert.equal(comAporte.valor, true);
  });

  it('reserva fora da finalidade: provisão aberta com acumulado reduzido', { scenario: 'C21' }, () => {
    const r = FOS.Signals.reservaForaDaFinalidade(ctx({
      provisoes: [{ provisao_id: 'PROV_IPTU', valor_acumulado: 400, vencimento: '2026-06-10' }]
    }));
    assert.equal(r.valor, true);
    assert.includes(r.detalhe, 'PROV_IPTU');
  });

  it('reserva usada após o vencimento não é desvio de finalidade', { scenario: 'C21' }, () => {
    const r = FOS.Signals.reservaForaDaFinalidade(ctx({
      provisoes: [{ provisao_id: 'PROV_IPTU', valor_acumulado: 0, vencimento: '2026-03-10' }]
    }));
    assert.equal(r.valor, false);
  });

  it('queda de runway compara com o limite configurado', { scenario: 'C22' }, () => {
    assert.equal(FOS.Signals.quedaRunway(ctx()).valor, false);
    const caiu = FOS.Signals.quedaRunway(ctx({ runway: FOS.Core.value(3) }));
    assert.equal(caiu.valor, true, 'queda de 25% acima do limite de 20%');
    const leve = FOS.Signals.quedaRunway(ctx({ runway: FOS.Core.value(3.4) }));
    assert.equal(leve.valor, false, 'queda de 15% abaixo do limite');
  });

  it('compromisso sem provisão detecta obrigação órfã', { scenario: 'C23' }, () => {
    const semProvisao = FOS.Signals.compromissoSemProvisao(ctx({
      eventos: [{
        evento_id: 'EV_OBR', tipo_evento: 'NOVA_OBRIGACAO', data: '2026-03-02',
        referencia_id: 'PROV_NOVA', valor: 1000, status: 'PENDENTE'
      }]
    }));
    assert.equal(semProvisao.valor, true);

    const comProvisao = FOS.Signals.compromissoSemProvisao(ctx({
      eventos: [{
        evento_id: 'EV_OBR', tipo_evento: 'NOVA_OBRIGACAO', data: '2026-03-02',
        referencia_id: 'PROV_IPTU', valor: 1000, status: 'PENDENTE'
      }]
    }));
    assert.equal(comProvisao.valor, false);
  });

  it('retirada após mês forte exige três fechamentos anteriores', { scenario: 'C24' }, () => {
    const semHistorico = FOS.Signals.retiradaAposMesForte(ctx());
    assert.isNull(semHistorico.valor);
    assert.equal(semHistorico.status, 'DADO_INSUFICIENTE');
    assert.includes(semHistorico.reason, 'HISTORICO_MENOR_QUE_3');
  });

  it('retirada após mês forte dispara com mês forte e retirada de posição', { scenario: 'C24' }, () => {
    const anteriores = [
      fechamentoResumo({ competencia: '2025-12', caixa_retirado_brl: 4000 }),
      fechamentoResumo({ competencia: '2026-01', caixa_retirado_brl: 5000 }),
      fechamentoResumo({ competencia: '2026-02', caixa_retirado_brl: 6000 })
    ];
    const comum = { fechamentosAnteriores: anteriores, caixaRetiradoBrl: FOS.Core.value(9000) };

    const semRetirada = FOS.Signals.retiradaAposMesForte(ctx(comum));
    assert.equal(semRetirada.valor, false);

    const comRetirada = FOS.Signals.retiradaAposMesForte(ctx(Object.assign({}, comum, {
      eventos: [{
        evento_id: 'EV_RET', tipo_evento: 'RETIRADA_POSICAO', data: '2026-03-20',
        conta_destino: 'INTER_CC', valor: 800, referencia_id: 'POS_ETF', status: 'PENDENTE'
      }]
    })));
    assert.equal(comRetirada.valor, true);
    assert.includes(comRetirada.detalhe, 'mes_forte=true');

    const mesFraco = FOS.Signals.retiradaAposMesForte(ctx(Object.assign({}, comum, {
      caixaRetiradoBrl: FOS.Core.value(5200),
      eventos: [{
        evento_id: 'EV_RET', tipo_evento: 'RETIRADA_POSICAO', data: '2026-03-20',
        conta_destino: 'INTER_CC', valor: 800, referencia_id: 'POS_ETF', status: 'PENDENTE'
      }]
    })));
    assert.equal(mesFraco.valor, false);
  });

  it('redução alocativa do patrimônio conta como retirada', { scenario: 'C24' }, () => {
    const anteriores = [
      fechamentoResumo({ competencia: '2025-12', caixa_retirado_brl: 4000 }),
      fechamentoResumo({ competencia: '2026-01', caixa_retirado_brl: 5000 }),
      fechamentoResumo({ competencia: '2026-02', caixa_retirado_brl: 6000, patrimonio_capital_investido: 4000 })
    ];
    const r = FOS.Signals.retiradaAposMesForte(ctx({
      fechamentosAnteriores: anteriores,
      caixaRetiradoBrl: FOS.Core.value(9000),
      patrimonioCapitalInvestido: 3000
    }));
    assert.equal(r.valor, true);
    assert.includes(r.detalhe, 'reducao_alocativa=true');
  });
});

describe('Estado do ciclo', () => {
  function sugerir(runway, provisoes) {
    return FOS.State.sugerir({ config, runway: FOS.Core.value(runway), provisoes: provisoes || [] });
  }

  it('sugere estado a partir do runway', () => {
    assert.equal(sugerir(0.5).estado, E.FRAGIL);
    assert.equal(sugerir(2).estado, E.ESTABILIZANDO);
    assert.equal(sugerir(4).estado, E.ESTAVEL);
    assert.equal(sugerir(8).estado, E.EXPANSAO);
  });

  it('provisão em risco limita o estado sugerido', () => {
    const r = sugerir(8, [{ status: C.STATUS_PROVISAO.EM_RISCO }]);
    assert.equal(r.estado, E.ESTABILIZANDO);
    assert.includes(r.reason, 'PROVISAO_EM_RISCO_LIMITA_ESTADO');
  });

  it('provisão fora de ritmo impede expansão', () => {
    assert.equal(sugerir(8, [{ status: C.STATUS_PROVISAO.FORA_DE_RITMO }]).estado, E.ESTAVEL);
  });

  it('runway indisponível não produz estado', () => {
    const r = FOS.State.sugerir({ config, runway: FOS.Core.insufficient('SEM_CUSTO'), provisoes: [] });
    assert.isNull(r.estado);
    assert.equal(r.status, 'DADO_INSUFICIENTE');
  });

  it('avanço formal exige dois fechamentos consecutivos', { scenario: 'C25' }, () => {
    const primeiro = FOS.State.aplicar({
      estadoFormalAnterior: E.ESTABILIZANDO,
      sugeridosRecentes: [E.ESTABILIZANDO, E.ESTAVEL],
      fechamentosParaAvanco: 2
    });
    assert.equal(primeiro.estado_formal, E.ESTABILIZANDO);
    assert.equal(primeiro.movimento, 'MANUTENCAO');

    const segundo = FOS.State.aplicar({
      estadoFormalAnterior: E.ESTABILIZANDO,
      sugeridosRecentes: [E.ESTAVEL, E.ESTAVEL],
      fechamentosParaAvanco: 2
    });
    assert.equal(segundo.estado_formal, E.ESTAVEL);
    assert.equal(segundo.movimento, 'AVANCO');
  });

  it('avanço nunca pula acima do menor estado sustentado na janela', { scenario: 'C25' }, () => {
    const r = FOS.State.aplicar({
      estadoFormalAnterior: E.ESTABILIZANDO,
      sugeridosRecentes: [E.ESTAVEL, E.EXPANSAO],
      fechamentosParaAvanco: 2
    });
    assert.equal(r.estado_formal, E.ESTAVEL);
    assert.equal(r.estado_sugerido, E.EXPANSAO);
  });

  it('regressão acontece no primeiro fechamento que confirma', { scenario: 'C26' }, () => {
    const r = FOS.State.aplicar({
      estadoFormalAnterior: E.ESTAVEL,
      sugeridosRecentes: [E.ESTAVEL, E.FRAGIL],
      fechamentosParaAvanco: 2
    });
    assert.equal(r.estado_formal, E.FRAGIL);
    assert.equal(r.movimento, 'REGRESSAO');
  });

  it('primeiro fechamento define o estado formal', { scenario: 'C25' }, () => {
    const r = FOS.State.aplicar({ estadoFormalAnterior: null, sugeridosRecentes: [E.ESTAVEL], fechamentosParaAvanco: 2 });
    assert.equal(r.estado_formal, E.ESTAVEL);
    assert.equal(r.movimento, 'INICIAL');
  });

  it('estado sugerido indisponível mantém o formal', { scenario: 'C26' }, () => {
    const r = FOS.State.aplicar({ estadoFormalAnterior: E.ESTAVEL, sugeridosRecentes: [null], fechamentosParaAvanco: 2 });
    assert.equal(r.estado_formal, E.ESTAVEL);
    assert.equal(r.movimento, 'DADO_INSUFICIENTE');
  });
});
