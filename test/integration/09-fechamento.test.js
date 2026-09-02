'use strict';
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');

const C = FOS.Constants;
const A = C.ABAS_INTERNAS;

describe('Fechamento mensal', () => {
  it('fecha uma competência limpa e congela o snapshot completo', { scenario: 'C32' }, () => {
    const ctx = dataset.workbookComMovimento();
    const r = ctx.workflows.fecharCompetencia('2026-01');

    assert.ok(r.validacao.ok, JSON.stringify(r.validacao.violacoes));
    assert.equal(r.fechamento.estado, C.ESTADO_FECHAMENTO.FECHADO);

    const s = r.snapshot;
    // O snapshot congela tudo o que o fechamento precisa provar depois.
    ['trading', 'cambio', 'vida', 'provisoes', 'objetivos', 'patrimonio',
      'estado_ciclo', 'sinais', 'qualidade', 'acoes', 'metadados'].forEach((chave) => {
      assert.ok(s[chave] !== undefined, 'snapshot sem ' + chave);
    });
    assert.equal(s.trading.saldos_congelados.length, 4);
    assert.equal(s.sinais.length, 7);
    // 10000 inicial + 6000 saque - 2500 - 800 - 300 - 200
    assert.equal(s.vida.caixa_vida_brl.value, 12200);
    assert.equal(s.trading.metricas.caixa_retirado_brl.value, 6000);
    assert.equal(s.trading.metricas.pnl_operacional_gbp.value, 1300);
    assert.equal(s.trading.metricas.custo_operacional_brl.value, 200);
    assert.equal(s.cambio.taxa, 6.3);
    assert.equal(s.qualidade.nivel, 'COMPLETO');
  });

  it('checksum é reprodutível a partir da linha gravada', { scenario: 'C32' }, () => {
    const ctx = dataset.workbookComMovimento();
    const r = ctx.workflows.fecharCompetencia('2026-01');
    const linha = ctx.repositorio.fechamentos()[0];
    assert.equal(FOS.Closing.checksumDaLinha(linha), linha.checksum);
    assert.equal(linha.checksum, r.fechamento.checksum);
  });

  it('checksum muda se alguém adulterar o snapshot gravado', { scenario: 'C32' }, () => {
    const ctx = dataset.workbookComMovimento();
    ctx.workflows.fecharCompetencia('2026-01');
    const linha = ctx.repositorio.fechamentos()[0];
    const adulterado = JSON.parse(linha.snapshot_json);
    adulterado.vida.caixa_vida_brl.value = 999999;
    const falsificada = Object.assign({}, linha, { snapshot_json: JSON.stringify(adulterado) });
    assert.notEqual(FOS.Closing.checksumDaLinha(falsificada), linha.checksum);
    assert.notOk(FOS.Invariants.fechamentoAnteriorImutavel(falsificada, FOS.Closing.checksumDaLinha).ok);
  });

  it('recusa fechar duas vezes a mesma competência', { scenario: 'C32' }, () => {
    const ctx = dataset.workbookComMovimento();
    ctx.workflows.fecharCompetencia('2026-01');
    assert.throws(() => ctx.workflows.fecharCompetencia('2026-01'), 'COMPETENCIA_JA_FECHADA');
  });

  it('transições respeitam ABERTO, EM_REVISAO e FECHADO', { scenario: 'C32' }, () => {
    assert.equal(FOS.Closing.transicionar('ABERTO', 'EM_REVISAO'), 'EM_REVISAO');
    assert.equal(FOS.Closing.transicionar('EM_REVISAO', 'FECHADO'), 'FECHADO');
    assert.throws(() => FOS.Closing.transicionar('ABERTO', 'FECHADO'), 'TRANSICAO_INVALIDA');
    assert.throws(() => FOS.Closing.transicionar('FECHADO', 'EM_REVISAO'), 'TRANSICAO_INVALIDA');
  });

  it('taxa de câmbio ausente bloqueia o fechamento', { scenario: 'C15' }, () => {
    const ctx = dataset.workbookComMovimento({ taxas: [] });
    const r = ctx.workflows.fecharCompetencia('2026-01');
    assert.notOk(r.validacao.ok);
    assert.includes(r.validacao.violacoes.map((v) => v.codigo), 'TAXA_CAMBIAL_DISPONIVEL');
    assert.equal(r.fechamento.estado, C.ESTADO_FECHAMENTO.EM_REVISAO);
    assert.equal(ctx.repositorio.fechamentos().length, 0, 'nada é gravado como FECHADO');
    assert.isNull(r.snapshot.cambio.taxa);
    assert.isNull(r.snapshot.cambio.efeito_cambial_brl.value);
    assert.includes(r.snapshot.cambio.efeito_cambial_brl.reason, 'TAXA_INDISPONIVEL');
    // P&L em GBP não depende de taxa: continua reportado normalmente em GBP.
    assert.equal(r.snapshot.trading.metricas.pnl_operacional_gbp.value, 1300);
    assert.equal(r.snapshot.qualidade.nivel, 'BLOQUEADO');
  });

  it('posição sem snapshot bloqueia o fechamento', { scenario: 'C31' }, () => {
    const ctx = dataset.workbookComMovimento();
    ctx.repositorio.anexar(A.POSICOES, [dataset.eventoPosicao({
      evento_id: 'PZ1', posicao_id: 'POS_SEM_SNAP', tipo_evento: 'APORTE', data: '2026-01-10', valor: 900
    })]);
    const r = ctx.workflows.fecharCompetencia('2026-01');
    assert.notOk(r.validacao.ok);
    assert.includes(r.validacao.violacoes.map((v) => v.codigo), 'SNAPSHOTS_ATIVOS');
    assert.isNull(r.snapshot.patrimonio.brl_gerencial.value);
    assert.equal(r.snapshot.patrimonio.brl_gerencial.reason, 'POSICAO_SEM_SNAPSHOT');
  });

  it('item aberto na fila bloqueia o fechamento', { scenario: 'C09' }, () => {
    const ctx = dataset.workbookComMovimento();
    ctx.repositorio.anexar(A.FILA_REVISAO, [FOS.Queue.novoItem({
      origem: C.ORIGEM_FILA.CLASSIFICACAO, referencia: 'fp-desconhecido',
      motivo: 'SEM_REGRA_APLICAVEL', agora: dataset.AGORA
    })]);
    const r = ctx.workflows.fecharCompetencia('2026-01');
    assert.notOk(r.validacao.ok);
    assert.includes(r.validacao.violacoes.map((v) => v.codigo), 'FILA_REVISAO_VAZIA');
  });

  it('evento conciliável não conciliado bloqueia o fechamento', { scenario: 'C08' }, () => {
    const ctx = dataset.montarWorkbook();
    ctx.workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'extrato-janeiro.csv', conteudo: dataset.CSV_JANEIRO
    });
    // sem conciliar: EV001 continua pendente
    const r = ctx.workflows.fecharCompetencia('2026-01');
    assert.notOk(r.validacao.ok);
    assert.includes(r.validacao.violacoes.map((v) => v.codigo), 'CONCILIACOES_COMPLETAS');
  });

  it('estado do ciclo evolui ao longo de fechamentos consecutivos', { scenario: 'C25' }, () => {
    const ctx = dataset.workbookComMovimento();
    const jan = ctx.workflows.fecharCompetencia('2026-01');
    assert.equal(jan.snapshot.estado_ciclo.movimento, 'INICIAL');

    const fev = ctx.workflows.fecharCompetencia('2026-02');
    assert.ok(fev.validacao.ok, JSON.stringify(fev.validacao.violacoes));
    assert.ok(['MANUTENCAO', 'AVANCO', 'REGRESSAO'].indexOf(fev.snapshot.estado_ciclo.movimento) !== -1);
    assert.equal(ctx.repositorio.fechamentos().length, 2);
  });

  it('o segundo fechamento enxerga o primeiro como histórico', { scenario: 'C18' }, () => {
    const ctx = dataset.workbookComMovimento();
    ctx.workflows.fecharCompetencia('2026-01');
    const fev = ctx.workflows.fecharCompetencia('2026-02');
    const reducao = fev.snapshot.sinais.filter((s) => s.codigo === C.SINAL.REDUCAO_PROTECAO)[0];
    assert.equal(reducao.status, 'OK', 'com um fechamento anterior o sinal já é calculável');
    const mesForte = fev.snapshot.sinais.filter((s) => s.codigo === C.SINAL.RETIRADA_APOS_MES_FORTE)[0];
    assert.equal(mesForte.status, 'DADO_INSUFICIENTE', 'ainda faltam três fechamentos');
  });
});

describe('Restatement', () => {
  function fecharEReapresentar() {
    const ctx = dataset.workbookComMovimento();
    ctx.workflows.fecharCompetencia('2026-01');
    const original = ctx.repositorio.fechamentos()[0];
    // Uma correção posterior: snapshot de mercado revisado dentro de janeiro.
    ctx.repositorio.anexar(A.POSICOES, [dataset.eventoPosicao({
      evento_id: 'PE002C', tipo_evento: 'SNAPSHOT_VALOR_MERCADO', data: '2026-01-31',
      valor: 2100, compensa_evento_id: 'PE002'
    })]);
    const r = ctx.workflows.reapresentarCompetencia('2026-01', 'Snapshot de mercado corrigido pela corretora');
    return { ctx, original, r };
  }

  it('gera nova versão sem tocar no fechamento original', { scenario: 'C33' }, () => {
    const { ctx, original, r } = fecharEReapresentar();
    assert.ok(r.ok, JSON.stringify(r.validacao && r.validacao.violacoes));

    const fechamentos = ctx.repositorio.fechamentos();
    assert.equal(fechamentos.length, 2);
    const v1 = fechamentos.filter((f) => Number(f.versao) === 1)[0];
    assert.equal(v1.checksum, original.checksum, 'a versão 1 permanece idêntica');
    assert.equal(FOS.Closing.checksumDaLinha(v1), original.checksum);

    const v2 = fechamentos.filter((f) => Number(f.versao) === 2)[0];
    assert.equal(v2.estado, C.ESTADO_FECHAMENTO.FECHADO);
    assert.notEqual(v2.checksum, v1.checksum);
    assert.equal(FOS.Restatement.versaoVigente(fechamentos, '2026-01').versao, 2);
  });

  it('registra motivo e campos alterados', { scenario: 'C33' }, () => {
    const { ctx, r } = fecharEReapresentar();
    const linha = ctx.repositorio.restatements()[0];
    assert.equal(linha.versao_origem, 1);
    assert.equal(linha.versao_nova, 2);
    assert.includes(linha.motivo, 'corrigido');
    assert.ok(r.restatement.campos_alterados.length > 0);
    assert.ok(r.restatement.campos_alterados.some((c) => c.indexOf('patrimonio') === 0));
  });

  it('exige motivo explícito', { scenario: 'C33' }, () => {
    const ctx = dataset.workbookComMovimento();
    ctx.workflows.fecharCompetencia('2026-01');
    assert.throws(() => ctx.workflows.reapresentarCompetencia('2026-01', ''), 'MOTIVO_OBRIGATORIO');
  });

  it('recusa restatement de competência sem fechamento', { scenario: 'C33' }, () => {
    const ctx = dataset.workbookComMovimento();
    assert.throws(() => ctx.workflows.reapresentarCompetencia('2026-01', 'x'), 'FECHAMENTO_INEXISTENTE');
  });
});
