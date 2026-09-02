'use strict';
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');
const { urlFetchFake } = require('../fixtures/fakes');

const C = FOS.Constants;
const A = C.ABAS_INTERNAS;
const V = C.ABAS_VISIVEIS;

/** Extrato com uma linha sem regra: garante item na fila de revisão. */
const CSV_COM_PENDENCIA = [
  'data;descricao;valor',
  '05/01/2026;ALUGUEL JANEIRO;-2500,00',
  '12/01/2026;LOJA DESCONHECIDA XPTO;-430,00',
  '15/01/2026;TRANSFERENCIA RECEBIDA WISE;6000,00'
].join('\n');

function comPendencia() {
  const ctx = dataset.montarWorkbook();
  ctx.workflows.importarExtrato({
    contaId: 'INTER_CC', nomeArquivo: 'janeiro-com-pendencia.csv', conteudo: CSV_COM_PENDENCIA
  });
  return ctx;
}

describe('Fila de revisão: resolução', () => {
  it('classificação sem regra vira item aberto na fila', { scenario: 'C40' }, () => {
    const ctx = comPendencia();
    const abertos = FOS.Queue.abertos(ctx.repositorio.fila());
    assert.equal(abertos.length, 1);
    assert.equal(abertos[0].motivo, 'SEM_REGRA_APLICAVEL');
    assert.equal(ctx.repositorio.ledger().length, 2, 'só as linhas com regra entram classificadas');
  });

  it('recusa resolver sem decisão explícita do usuário', { scenario: 'C40' }, () => {
    const ctx = comPendencia();
    const item = FOS.Queue.abertos(ctx.repositorio.fila())[0];
    assert.throws(() => ctx.workflows.resolverItemFila({ item_id: item.item_id }), 'DECISAO_OBRIGATORIA');
    assert.throws(
      () => ctx.workflows.resolverItemFila({ item_id: item.item_id, decisao: 'CLASSIFICAR' }),
      'CATEGORIA_OBRIGATORIA'
    );
    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 1, 'nada mudou');
  });

  it('resolver classifica a linha, fecha o item e registra antes/depois', { scenario: 'C40' }, () => {
    const ctx = comPendencia();
    const item = FOS.Queue.abertos(ctx.repositorio.fila())[0];
    const r = ctx.workflows.resolverItemFila({
      item_id: item.item_id, decisao: 'CLASSIFICAR',
      categoria: 'CUSTO_VIDA', subcategoria: 'CASA', ator: 'USUARIO'
    });

    assert.ok(r.alterado);
    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 0);
    assert.equal(ctx.repositorio.fila().length, 1, 'o item é atualizado, não duplicado');

    const linha = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
      .filter((l) => String(l.fingerprint) === String(item.referencia))[0];
    assert.equal(linha.categoria, 'CUSTO_VIDA');
    assert.equal(linha.subcategoria, 'CASA');
    assert.equal(linha.regra_id, 'MANUAL');
    assert.equal(Number(linha.versao_gerencial), 1, 'a linha estava só na fila: entra como versão 1');

    const log = ctx.repositorio.log().filter((l) => l.acao === 'RESOLVER_ITEM_FILA')[0];
    assert.equal(log.resultado, 'OK');
    assert.includes(log.antes, 'ABERTO');
    assert.includes(log.depois, 'RESOLVIDO');
  });

  it('resolver o mesmo item de novo é idempotente', { scenario: 'C40' }, () => {
    const ctx = comPendencia();
    const item = FOS.Queue.abertos(ctx.repositorio.fila())[0];
    ctx.workflows.resolverItemFila({ item_id: item.item_id, decisao: 'CLASSIFICAR', categoria: 'CUSTO_VIDA' });
    const antesLedger = ctx.repositorio.ledger().length;
    const segunda = ctx.workflows.resolverItemFila({
      item_id: item.item_id, decisao: 'CLASSIFICAR', categoria: 'CUSTO_VIDA'
    });
    assert.notOk(segunda.alterado);
    assert.equal(ctx.repositorio.ledger().length, antesLedger);
    assert.equal(ctx.repositorio.fila().length, 1);
  });

  it('recusa categoria fora do catálogo canônico', { scenario: 'C40' }, () => {
    const ctx = comPendencia();
    const item = FOS.Queue.abertos(ctx.repositorio.fila())[0];
    assert.throws(() => ctx.workflows.resolverItemFila({
      item_id: item.item_id, decisao: 'CLASSIFICAR', categoria: 'CATEGORIA_INVENTADA'
    }), 'CATEGORIA_NAO_CANONICA');
  });

  it('reclassificação preserva a origem e cria nova versão', { scenario: 'C40' }, () => {
    const ctx = comPendencia();
    const alvo = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
      .filter((l) => l.categoria === 'CUSTO_VIDA')[0];
    const r = ctx.workflows.reclassificarLinha({
      referencia: alvo.fingerprint, categoria: 'GASTO_EXTRAORDINARIO', motivo: 'Revisão manual'
    });
    assert.equal(Number(r.linha.versao_gerencial), 2);
    assert.equal(r.linha.valor_origem, alvo.valor_origem);
    assert.equal(r.linha.data_origem, alvo.data_origem);
    assert.ok(FOS.Invariants.ledgerAppendOnly(ctx.repositorio.ledger()).ok);
  });

  it('conciliação ambígua é resolvida pela escolha do usuário', { scenario: 'C40' }, () => {
    const ctx = dataset.montarWorkbook();
    // Duas entradas idênticas na janela: o sistema não escolhe sozinho.
    ctx.workflows.importarExtrato({
      contaId: 'INTER_CC',
      nomeArquivo: 'ambiguo.csv',
      conteudo: [
        'data;descricao;valor',
        '14/01/2026;TRANSFERENCIA RECEBIDA WISE;6000,00',
        '16/01/2026;TRANSFERENCIA RECEBIDA WISE;6000,00'
      ].join('\n')
    });
    const conciliacao = ctx.workflows.conciliarEventos();
    assert.equal(conciliacao.conciliadas, 0);
    const item = FOS.Queue.abertos(ctx.repositorio.fila())
      .filter((i) => i.motivo === 'AMBIGUIDADE_CONCILIACAO')[0];
    assert.ok(item, 'a ambiguidade precisa virar item de fila');

    const escolhida = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())[0];
    const r = ctx.workflows.resolverItemFila({
      item_id: item.item_id, decisao: 'CONCILIAR', fingerprint: escolhida.fingerprint, ator: 'USUARIO'
    });
    assert.ok(r.alterado);
    const conciliada = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
      .filter((l) => l.fingerprint === escolhida.fingerprint)[0];
    assert.equal(conciliada.evento_conciliado_id, 'EV001');
  });
});

describe('Proteção de período fechado', () => {
  it('recusa reclassificar linha de competência já fechada', { scenario: 'C41' }, () => {
    const ctx = dataset.workbookComMovimento();
    ctx.workflows.fecharCompetencia('2026-01');
    const alvo = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
      .filter((l) => String(l.data_origem).indexOf('2026-01') === 0)[0];
    assert.throws(() => ctx.workflows.reclassificarLinha({
      referencia: alvo.fingerprint, categoria: 'GASTO_EXTRAORDINARIO', motivo: 'x'
    }), 'PERIODO_FECHADO');
  });

  it('continua permitindo reclassificar competência aberta', { scenario: 'C41' }, () => {
    const ctx = dataset.workbookComMovimento();
    ctx.workflows.fecharCompetencia('2026-01');
    const alvo = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
      .filter((l) => String(l.data_origem).indexOf('2026-02') === 0
        && l.categoria === C.CATEGORIA.CUSTO_VIDA)[0];
    const r = ctx.workflows.reclassificarLinha({
      referencia: alvo.fingerprint, categoria: 'GASTO_EXTRAORDINARIO', motivo: 'Revisão'
    });
    assert.ok(r.alterado);
  });

  it('a aba de movimentações marca o período de cada linha', { scenario: 'C41' }, () => {
    const ctx = dataset.workbookComMovimento();
    ctx.workflows.fecharCompetencia('2026-01');
    const linhas = FOS.Surfaces.movimentacoes({
      linhas: ctx.repositorio.ledger(),
      competenciasFechadas: ctx.workflows.competenciasFechadas()
    });
    const janeiro = linhas.filter((l) => String(l.data).indexOf('2026-01') === 0);
    const fevereiro = linhas.filter((l) => String(l.data).indexOf('2026-02') === 0);
    assert.ok(janeiro.length && janeiro.every((l) => l.periodo === 'FECHADO'));
    assert.ok(fevereiro.length && fevereiro.every((l) => l.periodo === 'ABERTO'));
    assert.includes(janeiro[0].editavel, 'restatement');
  });
});

describe('Materialização de eventos declarativos', () => {
  it('NOVA_OBRIGACAO cria provisão versionada com origem rastreável', { scenario: 'C42' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EV100', tipo_evento: 'NOVA_OBRIGACAO', data: '2026-06-10',
      valor: 4000, referencia_id: 'PROV_SEGURO', descricao: 'Seguro sintetico'
    })]);
    const r = ctx.workflows.materializarEventos();
    assert.equal(r.provisoes.length, 1);
    const p = ctx.repositorio.provisoes()[0];
    assert.equal(p.provisao_id, 'PROV_SEGURO');
    assert.equal(Number(p.versao), 1);
    assert.equal(Number(p.valor_alvo), 4000);
    assert.equal(Number(p.valor_acumulado), 0, 'nasce sem acumulação: nada é presumido');
    assert.equal(p.vencimento, '2026-06-10');
    assert.equal(p.origem_evento_id, 'EV100');
  });

  it('NOVO_OBJETIVO cria objetivo versionado', { scenario: 'C42' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EV200', tipo_evento: 'NOVO_OBJETIVO', data: '2027-12-31',
      valor: 50000, referencia_id: 'OBJ_CASA', descricao: 'Objetivo sintetico'
    })]);
    ctx.workflows.materializarEventos();
    const o = ctx.repositorio.objetivos()[0];
    assert.equal(o.objetivo_id, 'OBJ_CASA');
    assert.equal(Number(o.valor_alvo), 50000);
    assert.equal(o.prazo, '2027-12-31');
  });

  it('materializar duas vezes não duplica nada', { scenario: 'C42' }, () => {
    const ctx = dataset.workbookComMovimento();
    const primeira = ctx.workflows.materializarEventos();
    const provisoesDepois = ctx.repositorio.provisoes().length;
    const segunda = ctx.workflows.materializarEventos();
    assert.equal(segunda.provisoes.length, 0);
    assert.equal(segunda.objetivos.length, 0);
    assert.equal(segunda.posicoes.length, 0);
    assert.equal(ctx.repositorio.provisoes().length, provisoesDepois);
    assert.ok(segunda.ignorados.length >= primeira.provisoes.length);
  });

  it('nova versão da mesma obrigação preserva o histórico', { scenario: 'C42' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EV100', tipo_evento: 'NOVA_OBRIGACAO', data: '2026-06-10',
      valor: 4000, referencia_id: 'PROV_SEGURO', descricao: 'Seguro sintetico'
    })]);
    ctx.workflows.materializarEventos();
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EV101', tipo_evento: 'NOVA_OBRIGACAO', data: '2026-07-10',
      valor: 4500, referencia_id: 'PROV_SEGURO', descricao: 'Seguro sintetico reajustado'
    })]);
    ctx.workflows.materializarEventos();
    const linhas = ctx.repositorio.provisoes();
    assert.equal(linhas.length, 2, 'append-only: a versão 1 continua lá');
    const corrente = FOS.Subledger.correntes(linhas, 'provisao_id')[0];
    assert.equal(Number(corrente.versao), 2);
    assert.equal(Number(corrente.valor_alvo), 4500);
    assert.equal(Number(linhas[0].valor_alvo), 4000);
  });

  it('evento inválido não materializa e é reportado', { scenario: 'C42' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EV999', tipo_evento: 'NOVA_OBRIGACAO', data: '2026-06-10',
      valor: 1000, referencia_id: ''
    })]);
    const r = ctx.workflows.materializarEventos();
    assert.equal(r.provisoes.length, 0);
    assert.equal(r.invalidos.length, 1);
    assert.includes(r.invalidos[0].erros.map((e) => e.codigo), 'REFERENCIA_OBRIGATORIA');
  });
});

describe('Eventos de posição', () => {
  it('APORTE_POSICAO vira evento append-only na aba 32', { scenario: 'C43' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EV300', tipo_evento: 'APORTE_POSICAO', data: '2026-03-05',
      conta_origem: 'INTER_CC', valor: 2500, referencia_id: 'POS_FII'
    })]);
    const r = ctx.workflows.materializarEventos();
    assert.equal(r.posicoes.length, 1);
    const evento = ctx.repositorio.posicoes()[0];
    assert.equal(evento.tipo_evento, C.EVENTO_POSICAO.APORTE);
    assert.equal(evento.posicao_id, 'POS_FII');
    assert.equal(Number(evento.valor), 2500);
    assert.equal(evento.origem, 'EV300', 'o vínculo com o evento manual fica gravado');
  });

  it('RETIRADA_POSICAO vira evento de retirada', { scenario: 'C43' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EV301', tipo_evento: 'RETIRADA_POSICAO', data: '2026-03-06',
      conta_destino: 'INTER_CC', valor: 800, referencia_id: 'POS_FII'
    })]);
    ctx.workflows.materializarEventos();
    const evento = ctx.repositorio.posicoes()[0];
    assert.equal(evento.tipo_evento, C.EVENTO_POSICAO.RETIRADA);
    assert.equal(Number(evento.valor), 800);
  });

  it('DISTRIBUICAO e SNAPSHOT são registrados manualmente', { scenario: 'C43' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const distribuicao = ctx.workflows.registrarEventoPosicao({
      posicao_id: 'POS_FII', tipo_evento: 'DISTRIBUICAO', data: '2026-03-20', valor: 45
    });
    const snapshot = ctx.workflows.registrarEventoPosicao({
      posicao_id: 'POS_FII', tipo_evento: 'SNAPSHOT_VALOR_MERCADO', data: '2026-03-31', valor: 2600
    });
    assert.ok(distribuicao.ok && snapshot.ok);
    const projecao = FOS.Positions.projetar(ctx.repositorio.posicoes(), { ateData: '2026-03-31' });
    assert.equal(projecao.POS_FII.distribuicoes, 45);
    assert.equal(projecao.POS_FII.valor_mercado, 2600);
  });

  it('registrar o mesmo evento duas vezes é idempotente', { scenario: 'C43' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const primeiro = ctx.workflows.registrarEventoPosicao({
      posicao_id: 'POS_FII', tipo_evento: 'DISTRIBUICAO', data: '2026-03-20', valor: 45
    });
    const segundo = ctx.workflows.registrarEventoPosicao({
      evento_id: primeiro.evento.evento_id,
      posicao_id: 'POS_FII', tipo_evento: 'DISTRIBUICAO', data: '2026-03-20', valor: 45
    });
    assert.notOk(segundo.alterado);
    assert.equal(ctx.repositorio.posicoes().length, 1);
  });

  it('correção só acontece por evento compensatório', { scenario: 'C43' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const aporte = ctx.workflows.registrarEventoPosicao({
      posicao_id: 'POS_FII', tipo_evento: 'APORTE', data: '2026-03-05', valor: 2500
    });
    const negativo = ctx.workflows.registrarEventoPosicao({
      posicao_id: 'POS_FII', tipo_evento: 'APORTE', data: '2026-03-06', valor: -100
    });
    assert.notOk(negativo.ok, 'valor negativo direto é recusado');

    const compensacao = ctx.workflows.compensarEventoPosicao({
      evento_id: aporte.evento.evento_id, motivo: 'Valor lançado errado'
    });
    assert.ok(compensacao.ok);
    assert.equal(ctx.repositorio.posicoes().length, 2, 'o evento original continua no ledger');
    const projecao = FOS.Positions.projetar(ctx.repositorio.posicoes(), { ateData: '2026-03-31' });
    assert.equal(projecao.POS_FII.capital_investido, 0);
  });

  it('correção de snapshot exige o novo valor', { scenario: 'C43' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const snapshot = ctx.workflows.registrarEventoPosicao({
      posicao_id: 'POS_FII', tipo_evento: 'SNAPSHOT_VALOR_MERCADO', data: '2026-03-31', valor: 2600
    });
    assert.throws(() => ctx.workflows.compensarEventoPosicao({
      evento_id: snapshot.evento.evento_id, motivo: 'errado'
    }), 'VALOR_OBRIGATORIO');
    const r = ctx.workflows.compensarEventoPosicao({
      evento_id: snapshot.evento.evento_id, motivo: 'Cotação revisada', valor: 2550
    });
    assert.ok(r.ok);
    const projecao = FOS.Positions.projetar(ctx.repositorio.posicoes(), { ateData: '2026-03-31' });
    assert.equal(projecao.POS_FII.valor_mercado, 2550);
  });
});

describe('Diagnóstico de setup', () => {
  it('aponta parâmetro bloqueado e o impacto exato', { scenario: 'C44' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const linhas = ctx.repositorio.configLinhas().map((r) => (
      r.chave === 'SALDO_INICIAL_CAIXA_VIDA_BRL'
        ? Object.assign({}, r, { status: 'BLOQUEADO', reason: 'AGUARDANDO_SALDO_REAL', valor: '' })
        : r));
    ctx.repositorio.substituir(A.CONFIG, linhas);

    const diag = ctx.workflows.diagnosticoSetup();
    assert.notOk(diag.pronto);
    const bloqueio = diag.bloqueios.filter((b) => b.chave === 'SALDO_INICIAL_CAIXA_VIDA_BRL')[0];
    assert.ok(bloqueio, 'o parâmetro bloqueado precisa aparecer');
    assert.equal(bloqueio.reason, 'AGUARDANDO_SALDO_REAL');
    assert.includes(bloqueio.impacto, 'caixa de vida');
  });

  it('separa avisos de bloqueios', { scenario: 'C44' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const diag = ctx.workflows.diagnosticoSetup();
    assert.ok(diag.pronto, 'a semente sintética já nasce pronta: ' + JSON.stringify(diag.bloqueios));
    const avisos = diag.avisos.map((a) => a.chave);
    assert.includes(avisos, 'CUSTO_VIDA_ALVO_MENSAL_BRL');
    assert.includes(avisos, 'PATRIMONIO_ALVO_BRL');
    diag.avisos.forEach((a) => assert.includes(a.impacto, 'Não impede'));
  });

  it('avalia também as invariantes da competência informada', { scenario: 'C44' }, () => {
    const ctx = dataset.montarWorkbook();
    ctx.workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'extrato-janeiro.csv', conteudo: dataset.CSV_JANEIRO
    });
    const diag = ctx.workflows.diagnosticoSetup('2026-01');
    assert.notOk(diag.pronto);
    assert.includes(diag.bloqueios.map((b) => b.codigo), 'CONCILIACOES_COMPLETAS');
  });

  it('sem regras de classificação o diagnóstico bloqueia', { scenario: 'C44' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    ctx.repositorio.substituir(A.REGRAS, []);
    const diag = ctx.workflows.diagnosticoSetup();
    assert.includes(diag.bloqueios.map((b) => b.codigo), 'SEM_REGRAS_CLASSIFICACAO');
  });
});

describe('Taxa de câmbio: política e cache', () => {
  it('política MANUAL não consulta provedor externo', { scenario: 'C45' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const fetch = urlFetchFake({});
    const workflows = FOS.App.criarWorkflows({
      repositorio: ctx.repositorio, relogio: ctx.relogio, ator: 'TESTE',
      auditoria: ctx.auditoria, urlFetchApp: fetch
    });
    const r = workflows.atualizarCacheTaxas({ datas: ['2026-01-31'] });
    assert.equal(r.politica, 'MANUAL');
    assert.equal(fetch.chamadas.length, 0, 'política manual não pode chamar a rede');
    assert.equal(r.faltando[0].reason, 'POLITICA_MANUAL_SEM_PROVEDOR_EXTERNO');
  });

  it('política HTTP materializa a taxa na planilha', { scenario: 'C45' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const url = 'https://exemplo.invalido/ptax?data={data}&moeda={moeda}';
    ctx.repositorio.substituir(A.CONFIG, ctx.repositorio.configLinhas().map((r) => {
      if (r.chave === 'POLITICA_TAXA_CAMBIO') return Object.assign({}, r, { valor: 'HTTP' });
      if (r.chave === 'URL_PROVEDOR_TAXA_CAMBIO') {
        return Object.assign({}, r, { status: 'ATIVO', reason: '', valor: url });
      }
      return r;
    }));
    const fetch = urlFetchFake({
      'https://exemplo.invalido/ptax?data=2026-01-31&moeda=GBP': { codigo: 200, corpo: '{"taxa":6.31}' }
    });
    const workflows = FOS.App.criarWorkflows({
      repositorio: ctx.repositorio, relogio: ctx.relogio, ator: 'TESTE',
      auditoria: ctx.auditoria, urlFetchApp: fetch
    });
    const r = workflows.atualizarCacheTaxas({ datas: ['2026-01-31'] });
    assert.equal(r.politica, 'HTTP');
    assert.equal(r.gravadas, 1);
    assert.equal(r.faltando.length, 0);

    const cache = FOS.Fx.tabelaDeCache(ctx.repositorio.configLinhas());
    assert.equal(cache['BRL/GBP']['2026-01-31'].valor, 6.31);
    assert.equal(cache['BRL/GBP']['2026-01-31'].versao, 1);
    assert.equal(cache['BRL/GBP']['2026-01-31'].provedor, 'PTAX');

    // Segunda chamada usa o cache: nenhuma consulta nova.
    const chamadasAntes = fetch.chamadas.length;
    workflows.atualizarCacheTaxas({ datas: ['2026-01-31'] });
    assert.equal(fetch.chamadas.length, chamadasAntes, 'o cache evita nova consulta');
  });

  it('provedor fora do ar grava o motivo e não inventa taxa', { scenario: 'C45' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    ctx.repositorio.substituir(A.CONFIG, ctx.repositorio.configLinhas().map((r) => {
      if (r.chave === 'POLITICA_TAXA_CAMBIO') return Object.assign({}, r, { valor: 'HTTP' });
      if (r.chave === 'URL_PROVEDOR_TAXA_CAMBIO') {
        return Object.assign({}, r, { status: 'ATIVO', reason: '', valor: 'https://exemplo.invalido/{data}' });
      }
      return r;
    }));
    const workflows = FOS.App.criarWorkflows({
      repositorio: ctx.repositorio, relogio: ctx.relogio, ator: 'TESTE',
      auditoria: ctx.auditoria, urlFetchApp: urlFetchFake({})
    });
    const r = workflows.atualizarCacheTaxas({ datas: ['2026-01-31'] });
    assert.equal(r.faltando.length, 1);
    assert.includes(r.faltando[0].reason, 'PROVEDOR_HTTP_404');
    const cache = FOS.Fx.tabelaDeCache(ctx.repositorio.configLinhas());
    assert.notOk(cache['BRL/GBP'] && cache['BRL/GBP']['2026-01-31'], 'taxa ausente não vira número');

    // Quando o provedor volta, a nova tentativa precisa de versão maior para
    // prevalecer sobre a linha BLOQUEADA que ficou da tentativa anterior.
    const workflowsOk = FOS.App.criarWorkflows({
      repositorio: ctx.repositorio, relogio: ctx.relogio, ator: 'TESTE',
      auditoria: ctx.auditoria,
      urlFetchApp: urlFetchFake({
        'https://exemplo.invalido/2026-01-31': { codigo: 200, corpo: '{"taxa":6.31}' }
      })
    });
    assert.equal(workflowsOk.atualizarCacheTaxas({ datas: ['2026-01-31'] }).gravadas, 1);
    const depois = FOS.Fx.tabelaDeCache(ctx.repositorio.configLinhas());
    assert.equal(depois['BRL/GBP']['2026-01-31'].valor, 6.31);
    assert.equal(depois['BRL/GBP']['2026-01-31'].versao, 2);
  });

  it('URL sem https é recusada antes de qualquer chamada', { scenario: 'C45' }, () => {
    const fetch = urlFetchFake({});
    const provedor = FOS.Adapters.provedorHttp(fetch, {
      url: 'http://inseguro.invalido/{data}', extrair: () => 1
    });
    const r = provedor.obter('GBP', 'BRL', '2026-01-31');
    assert.isNull(r.value);
    assert.equal(r.reason, 'PROVEDOR_URL_INVALIDA');
    assert.equal(fetch.chamadas.length, 0);
  });

  it('resposta inesperada não vira taxa', { scenario: 'C45' }, () => {
    const provedor = FOS.Adapters.provedorHttp(urlFetchFake({
      'https://exemplo.invalido/2026-01-31': { codigo: 200, corpo: 'isto nao e json' }
    }), { url: 'https://exemplo.invalido/{data}', extrair: (t) => JSON.parse(t).taxa });
    const r = provedor.obter('GBP', 'BRL', '2026-01-31');
    assert.isNull(r.value);
    assert.equal(r.reason, 'PROVEDOR_RESPOSTA_INESPERADA');
  });

  it('taxa do cache bloqueia fechamento quando ausente', { scenario: 'C45' }, () => {
    const ctx = dataset.workbookComMovimento({ taxas: [] });
    const r = ctx.workflows.fecharCompetencia('2026-01');
    assert.notOk(r.validacao.ok);
    assert.includes(r.validacao.violacoes.map((v) => v.codigo), 'TAXA_CAMBIAL_DISPONIVEL');
  });
});

describe('Abas visíveis', () => {
  function workbookFechado() {
    const ctx = dataset.workbookComMovimento({ agora: '2026-03-05T12:00:00Z' });
    ctx.workflows.materializarEventos();
    ctx.workflows.fecharCompetencia('2026-01');
    ctx.workflows.fecharCompetencia('2026-02');
    return ctx;
  }

  it('gera as quatro abas a partir do modelo canônico', { scenario: 'C46' }, () => {
    const ctx = workbookFechado();
    const r = ctx.workflows.atualizarSuperficies('2026-02', { agora: '2026-03-05' });
    [V.HOME, V.MOVIMENTACOES, V.PLANEJAMENTO, V.PATRIMONIO].forEach((aba) => {
      assert.ok(ctx.repositorio.planilha.lerTabela(aba).length > 0, aba + ' ficou vazia');
    });
    const home = ctx.repositorio.planilha.lerTabela(V.HOME);
    const secoes = home.map((l) => l.secao);
    ['ESTADO', 'QUALIDADE', 'DINHEIRO', 'TRADING', 'SINAIS', 'ACOES', 'ALERTAS']
      .forEach((s) => assert.includes(secoes, s, 'HOME sem seção ' + s));
    assert.equal(home.filter((l) => l.secao === 'SINAIS').length, 7);
    assert.equal(home.filter((l) => l.secao === 'ACOES').length <= 3, true, 'no máximo três ações');
    assert.equal(r.painel.atual.status, 'OK');
  });

  it('é idempotente: rodar duas vezes não duplica linha', { scenario: 'C46' }, () => {
    const ctx = workbookFechado();
    ctx.workflows.atualizarSuperficies('2026-02', { agora: '2026-03-05' });
    const antes = ctx.repositorio.planilha.lerTabela(V.HOME).length;
    ctx.workflows.atualizarSuperficies('2026-02', { agora: '2026-03-05' });
    assert.equal(ctx.repositorio.planilha.lerTabela(V.HOME).length, antes);
  });

  it('HOME não inventa zero: valor ausente vai vazio com motivo', { scenario: 'C46' }, () => {
    const painel = FOS.ViewModel.construirPainel({
      snapshot: {
        competencia: '2026-01', estado: 'FECHADO', moeda_gerencial: 'BRL',
        qualidade: { nivel: 'PARCIAL', itens_fila_abertos: 0, conciliacoes_pendentes: 0 },
        vida: {
          caixa_vida_brl: FOS.Core.nullValue('SALDO_INICIAL_BLOQUEADO'),
          disponivel_brl: FOS.Core.nullValue('CAIXA_INDISPONIVEL'),
          runway_meses: FOS.Core.insufficient('SEM_CUSTO_VIDA_OBSERVADO'),
          custo_vida_mes_brl: FOS.Core.value(3000),
          custo_vida_medio_brl: FOS.Core.value(3000),
          funcoes_do_dinheiro: { status: 'NULL', reason: 'CAIXA_INDISPONIVEL' }
        },
        trading: { capital_gbp: FOS.Core.value(100), metricas: {} },
        estado_ciclo: { sugerido: null, formal: null, movimento: 'DADO_INSUFICIENTE' },
        sinais: [], acoes: [], provisoes: [], objetivos: [],
        patrimonio: { brl_gerencial: FOS.Core.nullValue('TAXA_INDISPONIVEL'), por_moeda: {}, posicoes: [] }
      },
      agora: '2026-02-05', historico: [], restatements: [], bloqueios: []
    });
    const linhas = FOS.Surfaces.home(painel);
    const caixa = linhas.filter((l) => l.indicador === 'Caixa de vida')[0];
    assert.equal(caixa.valor, '', 'sem valor a célula fica vazia');
    assert.equal(caixa.motivo, 'SALDO_INICIAL_BLOQUEADO');
    assert.equal(caixa.status, 'NULL');
  });

  it('sem fechamento as abas mostram estado vazio explicado', { scenario: 'C46' }, () => {
    const ctx = dataset.montarWorkbook();
    ctx.workflows.atualizarSuperficies(null, { agora: '2026-03-05' });
    const home = ctx.repositorio.planilha.lerTabela(V.HOME);
    assert.equal(home.length, 1);
    assert.equal(home[0].secao, 'SEM_DADOS');
    assert.equal(home[0].motivo, 'SEM_FECHAMENTO_DISPONIVEL');
  });

  it('PATRIMÔNIO mantém trading em bloco separado', { scenario: 'C46' }, () => {
    const ctx = workbookFechado();
    ctx.workflows.atualizarSuperficies('2026-02', { agora: '2026-03-05' });
    const linhas = ctx.repositorio.planilha.lerTabela(V.PATRIMONIO);
    const trading = linhas.filter((l) => l.bloco === 'TRADING_SEPARADO');
    assert.equal(trading.length, 1);
    assert.equal(trading[0].moeda, 'GBP');
    const gerencial = linhas.filter((l) => l.bloco === 'BRL_GERENCIAL')[0];
    assert.notEqual(gerencial.valor_mercado, trading[0].capital_investido,
      'trading não pode entrar no patrimônio gerencial');
  });

  it('bootstrap formata, protege a origem e oculta o motor', { scenario: 'C46' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const planilha = ctx.planilha;
    assert.ok(planilha.chamadasDe('formatarAba').length >= 4);
    const protecoes = planilha.chamadasDe('protegerColunas');
    assert.equal(protecoes.length, 1);
    assert.equal(protecoes[0].nome, V.MOVIMENTACOES);
    assert.includes(protecoes[0].colunas, 'valor');
    assert.includes(protecoes[0].colunas, 'descricao');
    assert.ok(planilha.abaEstaOculta(A.LEDGER), 'o ledger fica oculto');
    assert.ok(planilha.abaEstaOculta(A.LOG));
    assert.notOk(planilha.abaEstaOculta(A.EVENTOS_MANUAIS), 'as abas operacionais continuam visíveis');
    assert.notOk(planilha.abaEstaOculta(A.FILA_REVISAO));
    assert.notOk(planilha.abaEstaOculta(V.HOME));
  });

  it('categoria em MOVIMENTAÇÕES é validada por lista fechada', { scenario: 'C46' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const validacoes = ctx.planilha.chamadasDe('validarColunaPorLista');
    assert.equal(validacoes.length, 1);
    assert.equal(validacoes[0].coluna, 'categoria');
    assert.deep(validacoes[0].valores, C.values(C.CATEGORIA));
  });
});
