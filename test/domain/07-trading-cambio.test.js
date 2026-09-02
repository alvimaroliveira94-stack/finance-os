'use strict';
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');

const C = FOS.Constants;
const config = FOS.Config.build(FOS.App.Seed.configRows());

function ledger(campos) {
  return Object.assign({
    linha_id: 'LED-1', fingerprint: 'fp-1', versao_gerencial: 1,
    data_origem: '2026-01-15', descricao_origem: 'X', valor_origem: 0,
    moeda_origem: 'BRL', conta_id: 'INTER_CC', categoria: C.CATEGORIA.CUSTO_VIDA,
    universo: C.UNIVERSO.VIDA
  }, campos);
}

const LINHAS = [
  ledger({ linha_id: 'L1', fingerprint: 'f1', valor_origem: 6000, categoria: C.CATEGORIA.SAQUE_TRADING, data_origem: '2026-01-15' }),
  ledger({ linha_id: 'L2', fingerprint: 'f2', valor_origem: -200, categoria: C.CATEGORIA.CUSTO_TRADING, data_origem: '2026-01-20' }),
  ledger({ linha_id: 'L3', fingerprint: 'f3', valor_origem: -2500, categoria: C.CATEGORIA.CUSTO_VIDA, data_origem: '2026-01-05' }),
  ledger({ linha_id: 'L4', fingerprint: 'f4', valor_origem: -800, categoria: C.CATEGORIA.CUSTO_VIDA, data_origem: '2026-01-06' }),
  ledger({ linha_id: 'L5', fingerprint: 'f5', valor_origem: -300, categoria: C.CATEGORIA.CUSTO_VIDA, data_origem: '2026-02-11' })
];

describe('Métricas de trading', () => {
  const params = {
    config,
    competencia: '2026-01',
    linhas: LINHAS,
    saldos: dataset.SALDOS_TRADING,
    eventos: dataset.EVENTOS,
    contaReserva: 'RESERVA_BANCA_BRL'
  };

  it('caixa retirado em BRL vem do ledger', { scenario: 'C17' }, () => {
    const r = FOS.Trading.caixaRetiradoBrl(LINHAS, '2026-01');
    assert.equal(r.value, 6000);
    assert.equal(r.status, 'OK');
  });

  it('P&L operacional em GBP usa saldos semanais, saques e aportes', { scenario: 'C13' }, () => {
    const r = FOS.Trading.pnlOperacionalGbp(params);
    // inicial 7000, final 7300, saques 1000, aportes 0
    assert.equal(r.status, 'OK');
    assert.equal(r.componentes.capital_inicial_gbp, 7000);
    assert.equal(r.componentes.capital_final_gbp, 7300);
    assert.equal(r.componentes.saques_gbp, 1000);
    assert.equal(r.value, 1300);
  });

  it('P&L fica em DADO_INSUFICIENTE sem saldo inicial', { scenario: 'C13' }, () => {
    const semInicial = FOS.Trading.pnlOperacionalGbp(Object.assign({}, params, {
      saldos: dataset.SALDOS_TRADING.filter((s) => s.data_referencia !== '2025-12-28')
    }));
    assert.equal(semInicial.status, 'DADO_INSUFICIENTE');
    assert.isNull(semInicial.value);
    assert.includes(semInicial.reason, 'SALDO_INICIAL_AUSENTE');
  });

  it('P&L não é calculado se o saque não tem valor em GBP', { scenario: 'C13' }, () => {
    const eventos = dataset.EVENTOS.map((e) => (e.evento_id === 'EV001'
      ? Object.assign({}, e, { valor_origem_moeda: '', moeda_origem: '' }) : e));
    const r = FOS.Trading.pnlOperacionalGbp(Object.assign({}, params, { eventos }));
    assert.isNull(r.value);
    assert.includes(r.reason, 'EVENTO_SEM_VALOR_EM_GBP');
  });

  it('resultado da reserva em BRL é independente do P&L', { scenario: 'C14' }, () => {
    const r = FOS.Trading.resultadoReservaBrl(params);
    assert.equal(r.componentes.saldo_inicial, 20000);
    assert.equal(r.componentes.saldo_final, 20500);
    assert.equal(r.value, 500);
  });

  it('custo operacional de trading é positivo e separado do aporte', { scenario: 'C16' }, () => {
    const r = FOS.Trading.custoOperacionalBrl(LINHAS, '2026-01');
    assert.equal(r.value, 200);
    // o custo não entra em nenhuma métrica de capital
    assert.equal(FOS.Trading.caixaRetiradoBrl(LINHAS, '2026-01').value, 6000);
  });

  it('as quatro métricas são reportadas separadamente, sem número líquido', { scenario: 'C13' }, () => {
    const m = FOS.Trading.metricas(params);
    assert.deep(Object.keys(m).sort(), [
      'caixa_retirado_brl', 'competencia', 'custo_operacional_brl',
      'pnl_operacional_gbp', 'resultado_reserva_brl'
    ]);
    assert.notOk(Object.prototype.hasOwnProperty.call(m, 'total'));
    assert.notOk(Object.prototype.hasOwnProperty.call(m, 'liquido'));
  });
});

describe('Câmbio', () => {
  const tabela = FOS.Fx.tabelaDeRegistros(dataset.TAXAS);

  it('resolve a taxa da data exata', () => {
    const t = FOS.Fx.resolver(tabela, 'GBP', 'BRL', '2026-01-31', 'PTAX');
    assert.equal(t.value, 6.3);
    assert.equal(t.status, 'OK');
  });

  it('não usa taxa de outro dia como aproximação', { scenario: 'C15' }, () => {
    const t = FOS.Fx.resolver(tabela, 'GBP', 'BRL', '2026-01-30', 'PTAX');
    assert.isNull(t.value);
    assert.includes(t.reason, 'TAXA_INDISPONIVEL_DATA');
  });

  it('conversão sem taxa devolve null com motivo', { scenario: 'C15' }, () => {
    const semTaxa = FOS.Fx.resolver({}, 'GBP', 'BRL', '2026-01-31', 'PTAX');
    const convertido = FOS.Fx.converter(1000, semTaxa);
    assert.isNull(convertido.value);
    assert.includes(convertido.reason, 'TAXA_INDISPONIVEL');
  });

  it('converte quando a taxa existe', () => {
    const t = FOS.Fx.resolver(tabela, 'GBP', 'BRL', '2026-02-28', 'PTAX');
    assert.equal(FOS.Fx.converter(100, t).value, 650);
  });

  it('isola o efeito cambial do resultado operacional', () => {
    const efeito = FOS.Fx.efeitoCambial(7000, 6.2, 6.3);
    assert.close(efeito.value, 700, 0.01);
    assert.isNull(FOS.Fx.efeitoCambial(7000, null, 6.3).value);
  });

  it('mesma moeda tem taxa de identidade', () => {
    assert.equal(FOS.Fx.resolver(tabela, 'BRL', 'BRL', '2026-01-31').value, 1);
  });

  it('provedor manual e provedor HTTP entregam o mesmo formato', () => {
    const manual = FOS.Adapters.resolverTaxa(FOS.Adapters.provedorManual(dataset.TAXAS), 'GBP', 'BRL', '2026-01-31');
    assert.equal(manual.value, 6.3);

    const http = FOS.Adapters.provedorHttp(
      require('../fixtures/fakes').urlFetchFake({
        'https://exemplo.invalido/ptax?data=2026-01-31': { codigo: 200, corpo: '{"taxa":6.35}' }
      }),
      { url: 'https://exemplo.invalido/ptax?data={data}', extrair: (texto) => JSON.parse(texto).taxa }
    );
    const r = FOS.Adapters.resolverTaxa(http, 'GBP', 'BRL', '2026-01-31');
    assert.equal(r.value, 6.35);
    assert.equal(r.provedor, 'PTAX');
  });

  it('provedor indisponível não inventa taxa', { scenario: 'C15' }, () => {
    const http = FOS.Adapters.provedorHttp(
      require('../fixtures/fakes').urlFetchFake({}),
      { url: 'https://exemplo.invalido/{data}', extrair: () => null }
    );
    const r = FOS.Adapters.resolverTaxa(http, 'GBP', 'BRL', '2026-01-31');
    assert.isNull(r.value);
    assert.includes(r.reason, 'PROVEDOR_HTTP_404');
  });
});

describe('Universo Vida', () => {
  it('caixa de vida parte do saldo inicial configurado', () => {
    const caixa = FOS.Life.caixaVida(config, LINHAS, '2026-01');
    // 10000 + 6000 - 200 - 2500 - 800
    assert.equal(caixa.value, 12500);
  });

  it('caixa de vida é null quando o parâmetro está bloqueado', () => {
    const linhasConfig = FOS.App.Seed.configRows().map((r) => (
      r.chave === 'SALDO_INICIAL_CAIXA_VIDA_BRL'
        ? Object.assign({}, r, { status: 'BLOQUEADO', reason: 'AGUARDANDO_SALDO_REAL', valor: '' })
        : r));
    const bloqueado = FOS.Config.build(linhasConfig);
    const caixa = FOS.Life.caixaVida(bloqueado, LINHAS, '2026-01');
    assert.isNull(caixa.value);
    assert.equal(caixa.reason, 'AGUARDANDO_SALDO_REAL');
  });

  it('custo de vida do mês é positivo', () => {
    assert.equal(FOS.Life.custoVidaMes(LINHAS, '2026-01').value, 3300);
  });

  it('runway divide o disponível pelo custo médio observado', () => {
    const caixa = FOS.Core.value(12000);
    const funcoes = FOS.Life.funcoesDoDinheiro(caixa, [{ valor_acumulado: 1000 }], [{ valor_acumulado: 500 }]);
    assert.equal(funcoes.protecao, 1000);
    assert.equal(funcoes.objetivos, 500);
    assert.equal(funcoes.livre, 10500);

    const disponivel = FOS.Life.disponivel(caixa, funcoes);
    const runway = FOS.Life.runway(disponivel, FOS.Core.value(3000));
    assert.equal(runway.value, 3.5);
  });

  it('runway sem custo observado é DADO_INSUFICIENTE', () => {
    const r = FOS.Life.runway(FOS.Core.value(1000), FOS.Core.insufficient('SEM_CUSTO_VIDA_OBSERVADO'));
    assert.equal(r.status, 'DADO_INSUFICIENTE');
    assert.isNull(r.value);
  });
});
