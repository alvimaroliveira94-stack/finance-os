'use strict';
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');

const S = FOS.Constants.STATUS_PROVISAO;

function provisao(campos) {
  return Object.assign({
    provisao_id: 'PROV_X',
    versao: 1,
    nome: 'Provisão sintética',
    valor_alvo: 3000,
    valor_acumulado: 1000,
    vencimento: '2026-06-10',
    prioridade: 1,
    moeda: 'BRL'
  }, campos);
}

function contexto(campos) {
  return Object.assign({
    dataReferencia: '2026-03-31',
    competencia: '2026-03',
    historico: [
      { competencia: '2026-01', valor_acumulado: 500 },
      { competencia: '2026-02', valor_acumulado: 800 }
    ],
    fechamentosMinimos: 2
  }, campos);
}

describe('Status de provisão', () => {
  it('coberta quando o valor faltante não é positivo', { scenario: 'C27' }, () => {
    const r = FOS.Provisions.avaliar(provisao({ valor_acumulado: 3000 }), contexto());
    assert.equal(r.status, S.COBERTA);
    assert.equal(r.valor_faltante, 0);
  });

  it('em risco quando vencida e ainda descoberta', { scenario: 'C27' }, () => {
    const r = FOS.Provisions.avaliar(provisao({ vencimento: '2026-02-10' }), contexto());
    assert.equal(r.status, S.EM_RISCO);
    assert.equal(r.motivo, 'VENCIDA_E_DESCOBERTA');
  });

  it('coberta tem precedência sobre vencida', { scenario: 'C27' }, () => {
    const r = FOS.Provisions.avaliar(provisao({ vencimento: '2026-02-10', valor_acumulado: 3200 }), contexto());
    assert.equal(r.status, S.COBERTA);
  });

  it('dado insuficiente com menos de dois fechamentos', { scenario: 'C27' }, () => {
    const r = FOS.Provisions.avaliar(provisao(), contexto({
      historico: [{ competencia: '2026-02', valor_acumulado: 800 }]
    }));
    assert.equal(r.status, S.DADO_INSUFICIENTE);
    assert.equal(r.motivo, 'HISTORICO_MENOR_QUE_2_FECHAMENTOS');
    assert.isNull(r.ritmo_observado);
  });

  it('em ritmo quando a acumulação observada cobre a necessária', { scenario: 'C27' }, () => {
    // acumulado 1000, faltam 2000 em 3 meses -> necessário 666,67/mês
    // observado (1000-500)/2 = 250 -> fora de ritmo
    const foraDeRitmo = FOS.Provisions.avaliar(provisao(), contexto());
    assert.equal(foraDeRitmo.status, S.FORA_DE_RITMO);
    assert.equal(foraDeRitmo.ritmo_observado, 250);
    assert.equal(foraDeRitmo.ritmo_necessario, 666.67);
    assert.equal(foraDeRitmo.meses_restantes, 3);

    const emRitmo = FOS.Provisions.avaliar(provisao({ valor_acumulado: 2600 }), contexto({
      historico: [
        { competencia: '2026-01', valor_acumulado: 500 },
        { competencia: '2026-02', valor_acumulado: 1500 }
      ]
    }));
    assert.equal(emRitmo.status, S.EM_RITMO);
    assert.equal(emRitmo.ritmo_observado, 1050);
  });

  it('trata vencimento no próprio mês como um mês restante', { scenario: 'C27' }, () => {
    const r = FOS.Provisions.avaliar(provisao({ vencimento: '2026-03-31' }), contexto());
    assert.equal(r.meses_restantes, 1);
    assert.equal(r.ritmo_necessario, 2000);
  });
});

describe('Desempate de alocação entre provisões', () => {
  const base = [
    { provisao_id: 'A', valor_faltante: 1000, vencimento: '2026-05-10', prioridade: 2 },
    { provisao_id: 'B', valor_faltante: 1000, vencimento: '2026-04-10', prioridade: 3 },
    { provisao_id: 'C', valor_faltante: 1000, vencimento: '2026-04-10', prioridade: 1 }
  ];

  it('prioriza o vencimento mais próximo', { scenario: 'C28' }, () => {
    const r = FOS.Provisions.alocar(base, 1000);
    const porId = {};
    r.alocacoes.forEach((a) => { porId[a.provisao_id] = a.alocado; });
    assert.equal(porId.C, 1000, 'vencimento mais próximo com melhor prioridade primeiro');
    assert.equal(porId.B, 0);
    assert.equal(porId.A, 0);
  });

  it('usa a prioridade explícita como segundo critério', { scenario: 'C28' }, () => {
    const r = FOS.Provisions.alocar(base, 2000);
    const porId = {};
    r.alocacoes.forEach((a) => { porId[a.provisao_id] = a.alocado; });
    assert.equal(porId.C, 1000);
    assert.equal(porId.B, 1000);
    assert.equal(porId.A, 0);
  });

  it('ordena prioridade numericamente, não como texto', { scenario: 'C28' }, () => {
    const numerica = [
      { provisao_id: 'P10', valor_faltante: 1000, vencimento: '2026-04-10', prioridade: 10 },
      { provisao_id: 'P2', valor_faltante: 1000, vencimento: '2026-04-10', prioridade: 2 }
    ];
    const r = FOS.Provisions.alocar(numerica, 1000);
    const primeira = r.alocacoes.filter((a) => a.alocado > 0)[0];
    assert.equal(primeira.provisao_id, 'P2');
  });

  it('rateia proporcionalmente quando há empate real', { scenario: 'C28' }, () => {
    const empate = [
      { provisao_id: 'X', valor_faltante: 3000, vencimento: '2026-04-10', prioridade: 1 },
      { provisao_id: 'Y', valor_faltante: 1000, vencimento: '2026-04-10', prioridade: 1 }
    ];
    const r = FOS.Provisions.alocar(empate, 1000);
    const porId = {};
    r.alocacoes.forEach((a) => { porId[a.provisao_id] = a.alocado; });
    assert.equal(porId.X, 750);
    assert.equal(porId.Y, 250);
    assert.equal(r.alocacoes[0].criterio, 'PROPORCIONAL');
  });

  it('não aloca além da capacidade e devolve o restante', { scenario: 'C28' }, () => {
    const r = FOS.Provisions.alocar(base, 5000);
    assert.equal(r.capacidade_restante, 2000);
    assert.ok(r.alocacoes.every((a) => a.alocado <= 1000));
  });

  it('ignora provisões já cobertas', { scenario: 'C28' }, () => {
    const r = FOS.Provisions.alocar(base.concat([
      { provisao_id: 'D', valor_faltante: 0, vencimento: '2026-04-01', prioridade: 1 }
    ]), 1000);
    assert.notOk(r.alocacoes.some((a) => a.provisao_id === 'D'));
  });
});

describe('Objetivos', () => {
  const objetivo = {
    objetivo_id: 'OBJ_X', nome: 'Reserva', valor_alvo: 20000,
    valor_acumulado: 2000, prazo: '2027-12-31', prioridade: 2, moeda: 'BRL'
  };

  it('atingido quando o alvo foi alcançado', { scenario: 'C27' }, () => {
    const r = FOS.Objectives.avaliar(Object.assign({}, objetivo, { valor_acumulado: 20000 }), contexto());
    assert.equal(r.status, FOS.Objectives.STATUS_OBJETIVO.ATINGIDO);
  });

  it('prazo expirado não é risco de inadimplência', { scenario: 'C27' }, () => {
    const r = FOS.Objectives.avaliar(Object.assign({}, objetivo, { prazo: '2026-01-31' }), contexto());
    assert.equal(r.status, FOS.Objectives.STATUS_OBJETIVO.PRAZO_EXPIRADO);
  });

  it('usa a mesma lógica de ritmo das provisões', { scenario: 'C27' }, () => {
    const r = FOS.Objectives.avaliar(objetivo, contexto());
    assert.equal(r.status, S.FORA_DE_RITMO);
    assert.equal(r.valor_faltante, 18000);
  });
});
