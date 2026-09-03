'use strict';
/**
 * Passivo mínimo canônico (33_PASSIVOS).
 *
 * Nasceu de um caso real: um empréstimo de R$ 5.000 devidos, dos quais só
 * R$ 4.430 entraram no banco — a diferença é juro descontado na origem.
 * PASSIVO = quanto devo. A categoria neutra (MOVIMENTACAO_COM_TERCEIRO) diz
 * que o caixa se moveu; só a aba 33 sabe quanto ainda se deve.
 *
 * Duas verdades, dois donos, nunca fundidos:
 *  - 22_LEDGER: o caixa que entrou (`valor`, conciliado com o extrato);
 *  - 33_PASSIVOS: a obrigação assumida (`valor_devido`), versionada.
 * A diferença entre as duas é SEMPRE derivada — nunca uma terceira linha.
 *
 * TODO o dado deste arquivo é sintético. Nenhum nome de banco, credor, id de
 * passivo ou valor do caso real aparece aqui — os números foram trocados
 * para exercitar a mesma relação estrutural (recebido < devido) com um
 * fixture inteiramente inventado.
 */
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');

const C = FOS.Constants;
const A = C.ABAS_INTERNAS;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Workflows presos a um relógio diferente, mesmo repositório — simula
 *  "materializar em fevereiro" depois de "materializar em janeiro" sem
 *  reconstruir o workbook. */
function workflowsEm(ctx, agoraIso) {
  return FOS.App.criarWorkflows({
    repositorio: ctx.repositorio,
    relogio: FOS.Adapters.relogioFixo(agoraIso),
    ator: 'TESTE',
    auditoria: ctx.auditoria,
    provedorTaxa: FOS.Adapters.provedorManual(dataset.TAXAS)
  });
}

/** Resolve o único item aberto da fila com a categoria dada. */
function resolverUnico(workflows, ctx, categoria) {
  const abertos = FOS.Queue.abertos(ctx.repositorio.fila());
  assert.equal(abertos.length, 1, 'esperado exatamente um item aberto na fila');
  return workflows.resolverItemFila({
    item_id: abertos[0].item_id, decisao: 'CLASSIFICAR', categoria: categoria, ator: 'TESTE'
  });
}

const CSV_NASCIMENTO = [
  'data;descricao;valor',
  '05/01/2026;ALUGUEL JANEIRO;-2500,00',
  '10/01/2026;CREDITO EMPRESTIMO COOPERATIVA TESTE;4000,00'
].join('\n');

const CSV_AMORTIZACAO_PARCIAL = [
  'data;descricao;valor',
  '15/02/2026;DEBITO QUITACAO COOPERATIVA TESTE;-2000,00'
].join('\n');

const CSV_AMORTIZACAO_FINAL = [
  'data;descricao;valor',
  '20/03/2026;DEBITO QUITACAO FINAL COOPERATIVA TESTE;-2500,00'
].join('\n');

/**
 * Workbook com o empréstimo sintético nascido e conciliado em janeiro/2026,
 * já fechado. R$ 4.000 recebidos, R$ 4.500 devidos — 500 de diferença
 * derivada, nunca lançada. Base para os testes de fechamento e de saldo.
 */
function nascido() {
  const ctx = dataset.montarWorkbook({ comDados: false, agora: '2026-01-10T12:00:00Z' });
  ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
    evento_id: 'EVP1', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-10',
    conta_destino: 'INTER_CC', valor: 4000, valor_devido: 4500,
    vencimento: '2026-04-30', referencia_id: 'PAS_TESTE', credor: 'COOPERATIVA TESTE',
    descricao: 'Emprestimo sintetico', observacao: 'juros descontados na origem'
  })]);
  ctx.workflows.importarExtrato({ contaId: 'INTER_CC', nomeArquivo: 'jan.csv', conteudo: CSV_NASCIMENTO });
  resolverUnico(ctx.workflows, ctx, 'MOVIMENTACAO_COM_TERCEIRO');
  ctx.workflows.materializarEventos();
  ctx.workflows.conciliarEventos();
  return ctx;
}

/** nascido() + fechamento de janeiro/2026. */
function nascidoEFechado() {
  const ctx = nascido();
  const fechamento = ctx.workflows.fecharCompetencia('2026-01');
  return { ctx, fechamento };
}

/** nascidoEFechado() + amortização parcial de R$ 2.000 em fevereiro/2026. */
function comAmortizacaoParcial() {
  const { ctx } = nascidoEFechado();
  const wfFev = workflowsEm(ctx, '2026-02-15T12:00:00Z');
  ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
    evento_id: 'EVP2', tipo_evento: 'AMORTIZACAO_PASSIVO', data: '2026-02-15',
    conta_origem: 'INTER_CC', valor: 2000, referencia_id: 'PAS_TESTE',
    descricao: 'Amortizacao parcial'
  })]);
  wfFev.importarExtrato({ contaId: 'INTER_CC', nomeArquivo: 'fev.csv', conteudo: CSV_AMORTIZACAO_PARCIAL });
  resolverUnico(wfFev, ctx, 'MOVIMENTACAO_COM_TERCEIRO');
  wfFev.materializarEventos();
  wfFev.conciliarEventos();
  return { ctx, wfFev };
}

function passivoCorrente(ctx) {
  return FOS.Subledger.correntes(ctx.repositorio.passivos(), 'passivo_id')[0];
}

/* ------------------------------------------------------------------ */
/* Catálogo                                                            */
/* ------------------------------------------------------------------ */

describe('Passivo: catálogo canônico', () => {
  it('a oitava categoria existe e mapeia para o universo VIDA', { scenario: 'C54' }, () => {
    assert.equal(C.values(C.CATEGORIA).length, 8);
    assert.includes(C.values(C.CATEGORIA), 'MOVIMENTACAO_COM_TERCEIRO');
    assert.equal(FOS.Rules.UNIVERSO_POR_CATEGORIA.MOVIMENTACAO_COM_TERCEIRO, C.UNIVERSO.VIDA);
  });

  it('o catálogo de eventos passa de sete para nove tipos', { scenario: 'C54' }, () => {
    assert.equal(C.values(C.TIPO_EVENTO).length, 9);
    assert.includes(C.values(C.TIPO_EVENTO), 'NOVO_PASSIVO');
    assert.includes(C.values(C.TIPO_EVENTO), 'AMORTIZACAO_PASSIVO');
    assert.ok(FOS.Events.spec('NOVO_PASSIVO').concilia);
    assert.ok(FOS.Events.spec('AMORTIZACAO_PASSIVO').concilia);
  });

  it('vencimento é exigido só em NOVO_PASSIVO, e não participa da conciliação',
    { scenario: 'C54' }, () => {
      const config = FOS.Config.build(FOS.App.Seed.configRows());
      const semVencimento = FOS.Events.validar(dataset.evento({
        evento_id: 'X', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-10',
        conta_destino: 'INTER_CC', valor: 4000, valor_devido: 4500, referencia_id: 'PAS_X',
        credor: 'CREDOR X'
      }), config);
      assert.notOk(semVencimento.ok);
      assert.includes(semVencimento.erros.map((e) => e.codigo), 'VENCIMENTO_INVALIDO');

      const amortizacaoSemVencimento = FOS.Events.validar(dataset.evento({
        evento_id: 'X', tipo_evento: 'AMORTIZACAO_PASSIVO', data: '2026-02-10',
        conta_origem: 'INTER_CC', valor: 2000, referencia_id: 'PAS_X'
      }), config);
      assert.ok(amortizacaoSemVencimento.ok, 'amortização não exige vencimento próprio');

      const exp = FOS.Events.expectativaConciliacao(dataset.evento({
        evento_id: 'X', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-10',
        conta_destino: 'INTER_CC', valor: 4000, valor_devido: 4500,
        vencimento: '2026-12-31', referencia_id: 'PAS_X', credor: 'CREDOR X'
      }));
      assert.equal(exp.data, '2026-01-10', 'a conciliação usa a data da movimentação, não o vencimento');
      assert.equal(exp.valor_esperado, 4000, 'a conciliação usa o caixa recebido, não o devido');
    });

  it('credor é exigido só em NOVO_PASSIVO, e não participa da conciliação',
    { scenario: 'C54' }, () => {
      const config = FOS.Config.build(FOS.App.Seed.configRows());
      const semCredor = FOS.Events.validar(dataset.evento({
        evento_id: 'X', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-10',
        conta_destino: 'INTER_CC', valor: 4000, valor_devido: 4500,
        vencimento: '2026-04-30', referencia_id: 'PAS_X'
      }), config);
      assert.notOk(semCredor.ok);
      assert.includes(semCredor.erros.map((e) => e.codigo), 'CREDOR_OBRIGATORIO');

      const credorEmBranco = FOS.Events.validar(dataset.evento({
        evento_id: 'X', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-10',
        conta_destino: 'INTER_CC', valor: 4000, valor_devido: 4500,
        vencimento: '2026-04-30', referencia_id: 'PAS_X', credor: '   '
      }), config);
      assert.notOk(credorEmBranco.ok, 'espaço em branco não conta como credor informado');
      assert.includes(credorEmBranco.erros.map((e) => e.codigo), 'CREDOR_OBRIGATORIO');

      const amortizacaoSemCredor = FOS.Events.validar(dataset.evento({
        evento_id: 'X', tipo_evento: 'AMORTIZACAO_PASSIVO', data: '2026-02-10',
        conta_origem: 'INTER_CC', valor: 2000, referencia_id: 'PAS_X'
      }), config);
      assert.ok(amortizacaoSemCredor.ok, 'amortização não exige credor — já está no nascimento');

      const exp = FOS.Events.expectativaConciliacao(dataset.evento({
        evento_id: 'X', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-10',
        conta_destino: 'INTER_CC', valor: 4000, valor_devido: 4500,
        vencimento: '2026-12-31', referencia_id: 'PAS_X', credor: 'CREDOR X'
      }));
      assert.notOk(Object.prototype.hasOwnProperty.call(exp, 'credor'),
        'credor não participa da expectativa de conciliação');
    });

  it('valor_devido não pode ser menor que o valor recebido', { scenario: 'C54' }, () => {
    const config = FOS.Config.build(FOS.App.Seed.configRows());
    const r = FOS.Events.validar(dataset.evento({
      evento_id: 'X', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-10',
      conta_destino: 'INTER_CC', valor: 4000, valor_devido: 3000,
      vencimento: '2026-04-30', referencia_id: 'PAS_X', credor: 'CREDOR X'
    }), config);
    assert.notOk(r.ok);
    assert.includes(r.erros.map((e) => e.codigo), 'VALOR_DEVIDO_MENOR_QUE_RECEBIDO');
  });

  it('sem valor_devido, a obrigação nasce igual ao caixa recebido', { scenario: 'C54' }, () => {
    const config = FOS.Config.build(FOS.App.Seed.configRows());
    const r = FOS.Events.validar(dataset.evento({
      evento_id: 'X', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-10',
      conta_destino: 'INTER_CC', valor: 4000, vencimento: '2026-04-30', referencia_id: 'PAS_X',
      credor: 'CREDOR X'
    }), config);
    assert.ok(r.ok, JSON.stringify(r.erros));
  });
});

/* ------------------------------------------------------------------ */
/* Nascimento: recebido ≠ devido                                       */
/* ------------------------------------------------------------------ */

describe('Passivo: nascimento com diferença retida na origem', () => {
  it('o crédito bancário concilia pelo valor efetivamente recebido', { scenario: 'C54' }, () => {
    const ctx = nascido();
    const linha = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
      .filter((l) => String(l.data_origem) === '2026-01-10')[0];
    assert.ok(linha, 'esperada a linha do crédito no ledger');
    assert.equal(linha.valor_origem, 4000, 'o ledger é dono do caixa recebido, não do devido');
    assert.equal(linha.categoria, 'MOVIMENTACAO_COM_TERCEIRO');
    assert.ok(linha.evento_conciliado_id, 'a linha precisa estar conciliada com o evento');
  });

  it('a obrigação nasce pelo valor_devido, não pelo recebido', { scenario: 'C54' }, () => {
    const ctx = nascido();
    const p = passivoCorrente(ctx);
    assert.equal(p.passivo_id, 'PAS_TESTE');
    assert.equal(Number(p.versao), 1);
    assert.equal(p.nome, 'Emprestimo sintetico');
    assert.equal(p.credor, 'COOPERATIVA TESTE');
    assert.equal(Number(p.valor_devido_original), 4500);
    assert.equal(Number(p.valor_aberto), 4500);
    assert.equal(p.moeda, 'BRL');
    assert.equal(p.vencimento, '2026-04-30');
    assert.equal(p.origem_evento_id, 'EVP1');
  });

  it('credor e observacao chegam ao passivo por campos distintos, sem se misturar',
    { scenario: 'C54' }, () => {
      const ctx = nascido();
      const p = passivoCorrente(ctx);
      // credor e observacao do evento têm textos DIFERENTES de propósito:
      // se o código voltasse a ler credor de observacao (ou vice-versa),
      // qualquer uma das duas asserções abaixo pegaria a regressão.
      assert.equal(p.credor, 'COOPERATIVA TESTE');
      assert.equal(p.observacao, 'juros descontados na origem');
      assert.notEqual(p.credor, p.observacao, 'são dois campos, nunca o mesmo texto');
    });

  it('a diferença é derivada — 500 — e nunca é armazenada', { scenario: 'C54' }, () => {
    const ctx = nascido();
    const p = passivoCorrente(ctx);
    const diferenca = FOS.Liabilities.custoRetidoNaOrigem(p.valor_devido_original, 4000);
    assert.equal(diferenca, 500);
    // Não existe campo algum no schema de 33_PASSIVOS chamado diferença,
    // custo ou juro: é sempre recalculada a partir dos dois valores.
    assert.equal(FOS.Schema.get(A.PASSIVOS).colunas.indexOf('valor_recebido'), -1);
    assert.equal(FOS.Schema.get(A.PASSIVOS).colunas.filter((c) => /custo|juro|diferenca/i.test(c)).length, 0);
  });

  it('nenhuma linha artificial de 500 existe no ledger', { scenario: 'C54' }, () => {
    const ctx = nascido();
    const linhas = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger());
    assert.equal(linhas.length, 2, 'só ALUGUEL e o crédito do empréstimo — nada mais');
    assert.equal(linhas.filter((l) => Math.abs(Number(l.valor_origem)) === 500).length, 0,
      'o custo retido na origem nunca vira movimentação');
  });

  it('confiança 1,0 num empréstimo sem desconto também funciona: passivo = caixa',
    { scenario: 'C54' }, () => {
      const ctx = dataset.montarWorkbook({ comDados: false });
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVP_SIMPLES', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-10',
        conta_destino: 'INTER_CC', valor: 1000, vencimento: '2026-06-30', referencia_id: 'PAS_SIMPLES',
        credor: 'CREDOR SIMPLES', descricao: 'Emprestimo sem desconto'
      })]);
      const r = ctx.workflows.materializarEventos();
      assert.equal(r.passivos.length, 1);
      assert.equal(Number(r.passivos[0].valor_devido_original), 1000);
      assert.equal(Number(r.passivos[0].valor_aberto), 1000);
      assert.equal(r.passivos[0].credor, 'CREDOR SIMPLES');
    });
});

/* ------------------------------------------------------------------ */
/* Alcance exato e idempotência                                        */
/* ------------------------------------------------------------------ */

describe('Passivo: alcance exato e idempotência', () => {
  it('NOVO_PASSIVO não pode reusar o id de um passivo já existente', { scenario: 'C54' }, () => {
    const ctx = nascido();
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EVP_DUP', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-15',
      conta_destino: 'INTER_CC', valor: 100, vencimento: '2026-06-30', referencia_id: 'PAS_TESTE',
      credor: 'CREDOR DUP'
    })]);
    const r = ctx.workflows.materializarEventos();
    assert.equal(r.passivos.length, 0);
    assert.equal(r.invalidos.length, 1);
    assert.equal(r.invalidos[0].erros[0].codigo, 'PASSIVO_JA_EXISTE');
    assert.equal(FOS.Subledger.correntes(ctx.repositorio.passivos(), 'passivo_id').length, 1);
  });

  it('AMORTIZACAO_PASSIVO exige um passivo existente', { scenario: 'C54' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EVP_FANTASMA', tipo_evento: 'AMORTIZACAO_PASSIVO', data: '2026-01-15',
      conta_origem: 'INTER_CC', valor: 500, referencia_id: 'PAS_INEXISTENTE'
    })]);
    const r = ctx.workflows.materializarEventos();
    assert.equal(r.passivos.length, 0);
    assert.equal(r.invalidos[0].erros[0].codigo, 'PASSIVO_INEXISTENTE');
  });

  it('amortização não pode exceder o saldo aberto — falha explícita, saldo intacto',
    { scenario: 'C54' }, () => {
      const { ctx } = comAmortizacaoParcial(); // saldo em aberto = 2500
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVP_EXCESSO', tipo_evento: 'AMORTIZACAO_PASSIVO', data: '2026-02-20',
        conta_origem: 'INTER_CC', valor: 3000, referencia_id: 'PAS_TESTE'
      })]);
      const antes = FOS.Subledger.correntes(ctx.repositorio.passivos(), 'passivo_id')[0];
      const r = ctx.workflows.materializarEventos();
      assert.equal(r.passivos.length, 0, 'nenhuma versão nova nasce de uma amortização inválida');
      assert.equal(r.invalidos[0].erros[0].codigo, 'AMORTIZACAO_EXCEDE_SALDO');
      const depois = FOS.Subledger.correntes(ctx.repositorio.passivos(), 'passivo_id')[0];
      assert.equal(Number(depois.valor_aberto), Number(antes.valor_aberto));
      assert.equal(Number(depois.versao), Number(antes.versao), 'nem sequer uma versão vazia é criada');
    });

  it('rodar materializarEventos de novo não duplica nem reprocessa', { scenario: 'C54' }, () => {
    const ctx = nascido();
    const antes = ctx.repositorio.passivos().length;
    const r = ctx.workflows.materializarEventos();
    assert.equal(r.passivos.length, 0);
    assert.deep(r.ignorados, [{ evento_id: 'EVP1', motivo: 'JA_MATERIALIZADO' }]);
    assert.equal(ctx.repositorio.passivos().length, antes);
  });

  it('a auditoria registra antes/depois de cada materialização, inclusive a que falha',
    { scenario: 'C54' }, () => {
      const { ctx } = comAmortizacaoParcial();
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVP_EXCESSO', tipo_evento: 'AMORTIZACAO_PASSIVO', data: '2026-02-20',
        conta_origem: 'INTER_CC', valor: 3000, referencia_id: 'PAS_TESTE'
      })]);
      ctx.workflows.materializarEventos();
      const log = ctx.repositorio.log().filter((l) => l.acao === 'MATERIALIZAR_EVENTOS');
      assert.ok(log.length >= 3, 'nascimento, amortização parcial e a tentativa inválida');
      const ultima = log[log.length - 1];
      assert.equal(ultima.resultado, 'PARCIAL');
      assert.includes(ultima.detalhe, 'AMORTIZACAO_EXCEDE_SALDO');
    });
});

/* ------------------------------------------------------------------ */
/* Amortização e saldo histórico                                       */
/* ------------------------------------------------------------------ */

describe('Passivo: amortização e saldo por competência', () => {
  it('amortização parcial reduz valor_aberto sem tocar valor_devido_original',
    { scenario: 'C54' }, () => {
      const { ctx } = comAmortizacaoParcial();
      const p = passivoCorrente(ctx);
      assert.equal(Number(p.versao), 2);
      assert.equal(Number(p.valor_devido_original), 4500, 'a obrigação original nunca muda');
      assert.equal(Number(p.valor_aberto), 2500);
      assert.equal(p.origem_evento_id, 'EVP2');
      assert.includes(p.motivo_versao, 'AMORTIZACAO_PASSIVO:EVP2');
    });

  it('quitação total leva valor_aberto a exatamente zero, sem recriar o custo retido',
    { scenario: 'C54' }, () => {
      const { ctx, wfFev } = comAmortizacaoParcial();
      const wfMar = workflowsEm(ctx, '2026-03-20T12:00:00Z');
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVP3', tipo_evento: 'AMORTIZACAO_PASSIVO', data: '2026-03-20',
        conta_origem: 'INTER_CC', valor: 2500, referencia_id: 'PAS_TESTE',
        descricao: 'Amortizacao final'
      })]);
      wfMar.importarExtrato({ contaId: 'INTER_CC', nomeArquivo: 'mar.csv', conteudo: CSV_AMORTIZACAO_FINAL });
      resolverUnico(wfMar, ctx, 'MOVIMENTACAO_COM_TERCEIRO');
      const r = wfMar.materializarEventos();
      wfMar.conciliarEventos();

      assert.equal(r.passivos.length, 1);
      const p = passivoCorrente(ctx);
      assert.equal(Number(p.versao), 3);
      assert.equal(Number(p.valor_aberto), 0);
      assert.equal(Number(p.valor_devido_original), 4500, 'o valor original permanece 4500, não 5000');

      // Os 570/500 nunca voltam: a soma de tudo que saiu do banco para este
      // passivo é 2000 + 2500 = 4500, nunca 5000.
      const linhasLedger = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
        .filter((l) => l.categoria === 'MOVIMENTACAO_COM_TERCEIRO');
      const totalPago = FOS.Core.sum(
        linhasLedger.filter((l) => Number(l.valor_origem) < 0), (l) => Number(l.valor_origem)
      );
      assert.equal(Math.abs(totalPago), 4500);
    });

  it('saldo histórico: reprocessar um mês antigo não enxerga a amortização futura',
    { scenario: 'C54' }, () => {
      const { ctx } = comAmortizacaoParcial();
      const linhas = ctx.repositorio.passivos();
      assert.equal(FOS.Subledger.correntesEm(linhas, 'passivo_id', '2026-01')[0].valor_aberto, 4500);
      assert.equal(FOS.Subledger.correntesEm(linhas, 'passivo_id', '2026-02')[0].valor_aberto, 2500);
    });
});

/* ------------------------------------------------------------------ */
/* Fechamento: disponível, runway, custo de vida, patrimônio           */
/* ------------------------------------------------------------------ */

describe('Passivo: impacto no fechamento', () => {
  it('disponivel_brl deduz o passivo em aberto integralmente', { scenario: 'C54' }, () => {
    const { fechamento } = nascidoEFechado();
    assert.ok(fechamento.validacao.ok, JSON.stringify(fechamento.validacao.violacoes));
    const s = fechamento.snapshot;
    // caixa = 10000 (inicial) + 4000 (emprestimo) - 2500 (aluguel) = 11500
    assert.equal(s.vida.caixa_vida_brl.value, 11500);
    assert.equal(s.vida.passivos_abertos_brl.value, 4500);
    // disponivel = 11500 - 0 (protecao) - 0 (objetivos) - 4500 (passivo) = 7000
    assert.equal(s.vida.disponivel_brl.value, 7000);
    assert.equal(s.vida.funcoes_do_dinheiro.passivos_abertos, 4500);
  });

  it('runway reflete o disponível já deduzido do passivo', { scenario: 'C54' }, () => {
    const { fechamento } = nascidoEFechado();
    const s = fechamento.snapshot;
    // custo_vida_medio = 2500 (só janeiro observado); runway = 7000/2500
    assert.equal(s.vida.custo_vida_medio_brl.value, 2500);
    assert.equal(s.vida.runway_meses.value, 2.8);
  });

  it('custo de vida do mês não é tocado pelo passivo', { scenario: 'C54' }, () => {
    const { fechamento } = nascidoEFechado();
    assert.equal(fechamento.snapshot.vida.custo_vida_mes_brl.value, 2500,
      'só o ALUGUEL — o crédito do empréstimo não é custo de vida');
  });

  it('patrimonio_brl_gerencial não é afetado: continua só posições', { scenario: 'C54' }, () => {
    const { fechamento } = nascidoEFechado();
    // Sem nenhuma posição no workbook: patrimônio fica em zero, nunca em
    // função do passivo — prova que os dois números são independentes.
    assert.equal(fechamento.snapshot.patrimonio.brl_gerencial.value, 0);
    assert.equal(fechamento.snapshot.patrimonio.capital_investido_total, 0);
  });

  it('o snapshot expõe o array de passivos avaliados', { scenario: 'C54' }, () => {
    const { fechamento } = nascidoEFechado();
    const passivos = fechamento.snapshot.passivos;
    assert.equal(passivos.length, 1);
    assert.equal(passivos[0].passivo_id, 'PAS_TESTE');
    assert.equal(passivos[0].status, 'ABERTO');
    assert.equal(passivos[0].valor_aberto, 4500);
    assert.equal(passivos[0].valor_amortizado, 0);
  });

  it('sem passivo algum, disponivel e runway ficam exatamente como antes',
    { scenario: 'C54' }, () => {
      const ctx = dataset.montarWorkbook({ comDados: false });
      ctx.workflows.importarExtrato({
        contaId: 'INTER_CC', nomeArquivo: 'jan.csv',
        conteudo: 'data;descricao;valor\n05/01/2026;ALUGUEL JANEIRO;-2500,00'
      });
      const r = ctx.workflows.fecharCompetencia('2026-01');
      assert.ok(r.validacao.ok, JSON.stringify(r.validacao.violacoes));
      assert.equal(r.snapshot.vida.passivos_abertos_brl.value, 0);
      assert.equal(r.snapshot.vida.caixa_vida_brl.value, 7500);
      assert.equal(r.snapshot.vida.disponivel_brl.value, 7500,
        'sem passivo, disponível é igual ao caixa (menos provisão/objetivo, aqui zero)');
    });

  it('status VENCIDO aparece quando o saldo segue aberto após o vencimento',
    { scenario: 'C54' }, () => {
      const ctx = dataset.montarWorkbook({ comDados: false });
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVP_VENC', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-05',
        conta_destino: 'INTER_CC', valor: 1000, vencimento: '2026-01-10', referencia_id: 'PAS_VENCIDO',
        credor: 'CREDOR VENCIDO', descricao: 'Emprestimo vencido'
      })]);
      ctx.workflows.importarExtrato({
        contaId: 'INTER_CC', nomeArquivo: 'jan.csv',
        conteudo: 'data;descricao;valor\n05/01/2026;CREDITO EMPRESTIMO VENCIDO TESTE;1000,00'
      });
      resolverUnico(ctx.workflows, ctx, 'MOVIMENTACAO_COM_TERCEIRO');
      ctx.workflows.materializarEventos();
      ctx.workflows.conciliarEventos();
      const r = ctx.workflows.fecharCompetencia('2026-01');
      assert.ok(r.validacao.ok, JSON.stringify(r.validacao.violacoes));
      const p = r.snapshot.passivos[0];
      assert.equal(p.status, 'VENCIDO', 'vencimento em 10/01, fechamento em 31/01: já venceu e segue aberto');
      assert.equal(p.motivo, 'VENCIDO_E_ABERTO');
    });
});

/* ------------------------------------------------------------------ */
/* Invariante: saldo dentro dos limites                                */
/* ------------------------------------------------------------------ */

describe('Passivo: invariante de saldo', () => {
  it('detecta saldo acima do valor devido original — comportamento não suportado',
    { scenario: 'C54' }, () => {
      // O workflow normal nunca produz isto (a invariante 2 e o portão de
      // amortização impedem). Simula o que juro capitalizado faria: saldo
      // crescendo sozinho, sem passar pelo workflow — exatamente o cenário
      // que a invariante existe para pegar, injetando a linha direto na aba.
      const ctx = dataset.montarWorkbook({ comDados: false });
      ctx.repositorio.anexar(A.PASSIVOS, [{
        passivo_id: 'PAS_JURO_CAPITALIZADO', versao: 1, nome: 'Ruim', credor: 'X',
        valor_devido_original: 1000, valor_aberto: 1500, moeda: 'BRL', vencimento: '2026-12-31',
        origem_evento_id: 'EVX', vigente_desde: '2026-01-01', vigente_ate: '',
        criado_em: dataset.AGORA, motivo_versao: 'TESTE', observacao: ''
      }]);
      const inv = FOS.Invariants.passivosSaldoValido(ctx.repositorio.passivos());
      assert.notOk(inv.ok);
      assert.includes(inv.detalhe, 'FORA_DOS_LIMITES:PAS_JURO_CAPITALIZADO@v1');
    });

  it('detecta saldo negativo', { scenario: 'C54' }, () => {
    const inv = FOS.Invariants.passivosSaldoValido([{
      passivo_id: 'PAS_NEG', versao: 1, valor_devido_original: 1000, valor_aberto: -1
    }]);
    assert.notOk(inv.ok);
  });

  it('passa quando todos os saldos estão entre 0 e o valor devido original',
    { scenario: 'C54' }, () => {
      const inv = FOS.Invariants.passivosSaldoValido([
        { passivo_id: 'A', versao: 1, valor_devido_original: 1000, valor_aberto: 1000 },
        { passivo_id: 'A', versao: 2, valor_devido_original: 1000, valor_aberto: 0 }
      ]);
      assert.ok(inv.ok);
    });

  it('um passivo com saldo corrompido bloqueia o fechamento inteiro', { scenario: 'C54' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    ctx.repositorio.anexar(A.PASSIVOS, [{
      passivo_id: 'PAS_JURO_CAPITALIZADO', versao: 1, nome: 'Ruim', credor: 'X',
      valor_devido_original: 1000, valor_aberto: 1500, moeda: 'BRL', vencimento: '2026-12-31',
      origem_evento_id: 'EVX', vigente_desde: '2026-01-01', vigente_ate: '',
      criado_em: dataset.AGORA, motivo_versao: 'TESTE', observacao: ''
    }]);
    const r = ctx.workflows.fecharCompetencia('2026-01');
    assert.notOk(r.validacao.ok);
    assert.includes(r.validacao.violacoes.map((v) => v.codigo), 'PASSIVOS_SALDO_VALIDO');
    assert.equal(r.fechamento.estado, C.ESTADO_FECHAMENTO.EM_REVISAO,
      'saldo fora dos limites nunca produz um fechamento FECHADO');
  });
});

/* ------------------------------------------------------------------ */
/* Superfície: aba interna, PLANEJAMENTO simples                       */
/* ------------------------------------------------------------------ */

describe('Passivo: superfície', () => {
  it('33_PASSIVOS é interna, oculta, e não é ponto de entrada', { scenario: 'C54' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    assert.ok(ctx.planilha.abaEstaOculta(A.PASSIVOS));
    assert.includes(FOS.App.Bootstrap.ABAS_INTERNAS_OCULTAS, A.PASSIVOS);
    const entradas = Object.keys(FOS.App.Bootstrap.ABAS_DE_ENTRADA)
      .map((k) => FOS.App.Bootstrap.ABAS_DE_ENTRADA[k]);
    assert.equal(entradas.indexOf(A.PASSIVOS), -1);
    assert.throws(() => FOS.App.Bootstrap.abrirEntrada(ctx.planilha, A.PASSIVOS), 'ABA_NAO_E_ENTRADA');
  });

  it('PLANEJAMENTO mostra credor, saldo aberto, vencimento e status — nada além disso',
    { scenario: 'C54' }, () => {
      const { fechamento } = nascidoEFechado();
      const painel = FOS.ViewModel.construirPainel({ snapshot: fechamento.snapshot, agora: dataset.AGORA });
      const linhas = FOS.Surfaces.planejamento(painel);
      const passivo = linhas.filter((l) => l.bloco === 'PASSIVO' && l.item === 'Emprestimo sintetico')[0];
      assert.ok(passivo, 'esperada a linha do passivo em PLANEJAMENTO');
      assert.equal(passivo.motivo, 'COOPERATIVA TESTE', 'credor');
      assert.equal(passivo.faltante, 4500, 'saldo aberto');
      assert.equal(passivo.vencimento, '2026-04-30');
      assert.equal(passivo.status, 'ABERTO');
      assert.equal(passivo.alvo, 4500, 'o devido original, para contexto');
      assert.equal(passivo.acumulado, 0, 'nada amortizado ainda');
    });

  it('acumulado sobe com a amortização, espelhando o padrão de provisão',
    { scenario: 'C54' }, () => {
      const { ctx } = comAmortizacaoParcial();
      const r = ctx.workflows.fecharCompetencia('2026-02');
      assert.ok(r.validacao.ok, JSON.stringify(r.validacao.violacoes));
      const painel = FOS.ViewModel.construirPainel({ snapshot: r.snapshot, agora: dataset.AGORA });
      const linhas = FOS.Surfaces.planejamento(painel);
      const passivo = linhas.filter((l) => l.bloco === 'PASSIVO')[0];
      assert.equal(passivo.faltante, 2500);
      assert.equal(passivo.acumulado, 2000, 'alvo (4500) - faltante (2500) = já amortizado');
    });

  it('sem nenhum passivo, aparece a linha "Nenhum passivo registrado"', { scenario: 'C54' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    ctx.workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'jan.csv',
      conteudo: 'data;descricao;valor\n05/01/2026;ALUGUEL JANEIRO;-2500,00'
    });
    const r = ctx.workflows.fecharCompetencia('2026-01');
    const painel = FOS.ViewModel.construirPainel({ snapshot: r.snapshot, agora: dataset.AGORA });
    const linhas = FOS.Surfaces.planejamento(painel);
    assert.ok(linhas.some((l) => l.bloco === 'PASSIVO' && l.motivo === 'SEM_PASSIVOS'));
  });

  it('o view-model expõe só os campos permitidos do passivo, nunca origem_evento_id',
    { scenario: 'C54' }, () => {
      const { fechamento } = nascidoEFechado();
      const painel = FOS.ViewModel.construirPainel({ snapshot: fechamento.snapshot, agora: dataset.AGORA });
      assert.equal(painel.atual.dados.passivos.length, 1);
      assert.deep(Object.keys(painel.atual.dados.passivos[0]).sort(), [
        'credor', 'nome', 'passivo_id', 'status', 'valor_aberto', 'valor_devido_original', 'vencimento'
      ]);
      const vazamentos = FOS.ViewModel.auditarVazamento(painel);
      assert.deep(vazamentos, []);
    });
});

/* ------------------------------------------------------------------ */
/* Passivo × Provisão: separação estrutural                            */
/* ------------------------------------------------------------------ */

describe('Passivo × Provisão: exclusão mútua no nível que o modelo garante', () => {
  it('são tabelas e ids independentes: nada no código funde os dois', { scenario: 'C54' }, () => {
    // Mesmo reusando o mesmo texto de identificador nas duas tabelas, elas
    // não colidem: cada uma é lida da sua própria aba, por Subledger.correntes
    // aplicado a uma lista diferente. Não existe join implícito entre 30 e 33.
    const ctx = dataset.montarWorkbook({ comDados: false });
    ctx.repositorio.anexar(A.PROVISOES, [dataset.provisao('ID_COMPARTILHADO', 1, 200, '2026-01-01')]);
    ctx.repositorio.anexar(A.PASSIVOS, [{
      passivo_id: 'ID_COMPARTILHADO', versao: 1, nome: 'Passivo com id igual ao da provisão',
      credor: 'X', valor_devido_original: 900, valor_aberto: 900, moeda: 'BRL',
      vencimento: '2026-12-31', origem_evento_id: 'EVY', vigente_desde: '2026-01-01',
      vigente_ate: '', criado_em: dataset.AGORA, motivo_versao: 'TESTE', observacao: ''
    }]);

    const provisaoCorrente = FOS.Subledger.correntes(ctx.repositorio.provisoes(), 'provisao_id')[0];
    const passivoCorrenteVal = FOS.Subledger.correntes(ctx.repositorio.passivos(), 'passivo_id')[0];
    assert.equal(provisaoCorrente.valor_acumulado, 200);
    assert.equal(Number(passivoCorrenteVal.valor_aberto), 900);
    assert.notEqual(provisaoCorrente.valor_acumulado, passivoCorrenteVal.valor_aberto,
      'nenhum valor de uma tabela vaza ou se mistura com o da outra');
  });

  it('cada um deduz o disponível exatamente uma vez, de forma independente e aditiva',
    { scenario: 'C54' }, () => {
      const ctx = dataset.montarWorkbook({ comDados: false });
      ctx.repositorio.anexar(A.PROVISOES, [dataset.provisao('PROV_SEP', 1, 300, '2026-01-01')]);
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVP_SEP', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-05',
        conta_destino: 'INTER_CC', valor: 1000, vencimento: '2026-06-30', referencia_id: 'PAS_SEP',
        credor: 'CREDOR SEP', descricao: 'Passivo separado'
      })]);
      ctx.workflows.importarExtrato({
        contaId: 'INTER_CC', nomeArquivo: 'jan.csv',
        conteudo: 'data;descricao;valor\n05/01/2026;CREDITO EMPRESTIMO SEPARADO TESTE;1000,00'
      });
      resolverUnico(ctx.workflows, ctx, 'MOVIMENTACAO_COM_TERCEIRO');
      ctx.workflows.materializarEventos();
      ctx.workflows.conciliarEventos();
      const r = ctx.workflows.fecharCompetencia('2026-01');
      assert.ok(r.validacao.ok, JSON.stringify(r.validacao.violacoes));

      const funcoes = r.snapshot.vida.funcoes_do_dinheiro;
      assert.equal(funcoes.protecao, 300, 'a provisão continua sendo contada como proteção');
      assert.equal(funcoes.passivos_abertos, 1000, 'o passivo é um termo à parte, não misturado à proteção');
      // caixa = 10000 + 1000 = 11000; livre = 11000 - 300 (protecao) - 0 - 1000 (passivo) = 9700
      assert.equal(funcoes.livre, 9700);
    });

  it('não existe verificação automática de duplicidade entre as duas — Human Authority',
    { scenario: 'C54' }, () => {
      // Documenta o limite deliberado do MVP: se o usuário declarar a MESMA
      // obrigação real como provisão E como passivo, o sistema deduz as
      // duas, sem avisar. Isso é decisão humana (não duplicar a declaração),
      // não uma garantia estrutural — construir essa checagem cruzada seria
      // infraestrutura especulativa para um erro que ainda não aconteceu.
      const ctx = dataset.montarWorkbook({ comDados: false });
      ctx.repositorio.anexar(A.PROVISOES, [dataset.provisao('MESMA_OBRIGACAO', 1, 1000, '2026-01-01')]);
      ctx.repositorio.anexar(A.PASSIVOS, [{
        passivo_id: 'MESMA_OBRIGACAO_PASSIVO', versao: 1, nome: 'Mesma coisa declarada duas vezes',
        credor: 'X', valor_devido_original: 1000, valor_aberto: 1000, moeda: 'BRL',
        vencimento: '2026-12-31', origem_evento_id: 'EVZ', vigente_desde: '2026-01-01',
        vigente_ate: '', criado_em: dataset.AGORA, motivo_versao: 'TESTE', observacao: ''
      }]);
      const r = ctx.workflows.fecharCompetencia('2026-01');
      assert.ok(r.validacao.ok, 'o sistema não recusa — a checagem não existe no MVP, por decisão');
      assert.equal(r.snapshot.vida.funcoes_do_dinheiro.protecao, 1000);
      assert.equal(r.snapshot.vida.funcoes_do_dinheiro.passivos_abertos, 1000);
    });
});
