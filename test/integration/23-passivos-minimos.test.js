'use strict';
/**
 * Passivo mínimo canônico (33_PASSIVOS).
 *
 * Nasceu de um caso real: um empréstimo cujo caixa recebido foi MENOR que a
 * obrigação assumida — a diferença é juro descontado na origem. PASSIVO =
 * quanto devo. A categoria neutra (MOVIMENTACAO_COM_TERCEIRO) diz que o
 * caixa se moveu; só a aba 33 sabe quanto ainda se deve.
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
const fs = require('fs');
const path = require('path');
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');
const { corromperParametroComoDateDoSheets } = require('../fixtures/fakes');

const C = FOS.Constants;
const A = C.ABAS_INTERNAS;
const MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');

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

/** Resolve TODOS os itens de classificação abertos com a mesma categoria —
 *  usado para colocar duas linhas de extrato no ledger antes de testar
 *  ambiguidade de conciliação (a ambiguidade é entre linhas do LEDGER, e uma
 *  linha só entra no ledger depois de classificada). */
function resolverTodasClassificacoes(workflows, ctx, categoria) {
  FOS.Queue.abertos(ctx.repositorio.fila()).forEach((item) => {
    workflows.resolverItemFila({ item_id: item.item_id, decisao: 'CLASSIFICAR', categoria: categoria, ator: 'TESTE' });
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
  // Conciliar primeiro: NOVO_PASSIVO só materializa com o crédito já
  // conciliado no ledger (portão de prova bancária). Mesma ordem de
  // fosRegistrarEvento.
  ctx.workflows.conciliarEventos();
  ctx.workflows.materializarEventos();
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
  // Conciliar primeiro: AMORTIZACAO_PASSIVO só reduz o saldo com o débito já
  // conciliado no ledger (mesmo portão de NOVO_PASSIVO).
  wfFev.conciliarEventos();
  wfFev.materializarEventos();
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

  it('o catálogo de eventos passou de sete para nove tipos com este MVP', { scenario: 'C54' }, () => {
    // Contagem total do catálogo (agora onze, com o brownfield do C55) é
    // responsabilidade do describe "Passivo brownfield" — este teste só
    // documenta a marca histórica dos dois primeiros tipos de passivo.
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
      const ctx = dataset.montarWorkbook({ comDados: false, agora: '2026-01-10T12:00:00Z' });
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVP_SIMPLES', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-10',
        conta_destino: 'INTER_CC', valor: 1000, vencimento: '2026-06-30', referencia_id: 'PAS_SIMPLES',
        credor: 'CREDOR SIMPLES', descricao: 'Emprestimo sem desconto'
      })]);
      ctx.workflows.importarExtrato({
        contaId: 'INTER_CC', nomeArquivo: 'jan.csv',
        conteudo: 'data;descricao;valor\n10/01/2026;CREDITO EMPRESTIMO SIMPLES TESTE;1000,00'
      });
      resolverUnico(ctx.workflows, ctx, 'MOVIMENTACAO_COM_TERCEIRO');
      ctx.workflows.conciliarEventos();
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
      wfMar.conciliarEventos();
      const r = wfMar.materializarEventos();

      assert.equal(r.passivos.length, 1);
      const p = passivoCorrente(ctx);
      assert.equal(Number(p.versao), 3);
      assert.equal(Number(p.valor_aberto), 0);
      assert.equal(Number(p.valor_devido_original), 4500, 'o valor original nunca muda por amortização');

      // O custo retido na origem nunca volta: a soma de tudo que saiu do
      // banco para este passivo é 2000 + 2500 = 4500 — exatamente o devido,
      // nunca o que teria sido devido sem o desconto na origem.
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
      ctx.workflows.conciliarEventos();
      ctx.workflows.materializarEventos();
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
      ctx.workflows.conciliarEventos();
      ctx.workflows.materializarEventos();
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

/* ------------------------------------------------------------------ */
/* Rollout brownfield: 11_EVENTOS_MANUAIS já populada sob o schema      */
/* anterior (16 colunas, sem os campos de passivo)                     */
/* ------------------------------------------------------------------ */

/**
 * As 16 colunas exatas, na ordem exata, do schema de produção anterior a
 * este MVP (commit 57c0eb3). Esta lista é intencionalmente literal — não
 * lida de FOS.Schema — porque o teste existe para provar que o schema
 * ATUAL preserva este prefixo, e usar o próprio schema atual para gerar a
 * lista tornaria o teste incapaz de detectar uma regressão nele.
 */
const COLUNAS_PRODUCAO_ANTERIOR = [
  'evento_id', 'tipo_evento', 'data', 'conta_origem', 'conta_destino',
  'valor', 'moeda', 'valor_origem_moeda', 'moeda_origem',
  'descricao', 'referencia_id', 'status',
  'fingerprint_conciliado', 'criado_em', 'criado_por', 'observacao'
];

/** Duas linhas sintéticas, valores distintos em toda coluna relevante —
 *  qualquer transposição de coluna muda pelo menos uma dessas leituras. */
const LINHA_ANTIGA_1 = [
  'EV-OLD-1', 'SAQUE_TRADING', '2026-01-15', 'WISE', 'INTER_CC',
  6000, 'BRL', 1000, 'GBP',
  'Saque antigo sintetico', 'REF-OLD-1', 'CONCILIADO',
  'FP-OLD-1', '2026-01-15T10:00:00Z', 'USUARIO', 'observacao antiga 1'
];
const LINHA_ANTIGA_2 = [
  'EV-OLD-2', 'GASTO_EXTRAORDINARIO', '2026-01-16', 'INTER_CC', 'BETFAIR',
  900, 'GBP', 150, 'BRL',
  'Gasto antigo sintetico', 'REF-OLD-2', 'PENDENTE',
  'FP-OLD-2', '2026-01-16T11:00:00Z', 'APPS_SCRIPT', 'observacao antiga 2'
];

/**
 * Planta, por baixo do domínio, uma 11_EVENTOS_MANUAIS já populada sob o
 * schema de produção anterior — exatamente o estado real descrito na
 * auditoria de rollout (planilha existente, aba 11 com linhas reais,
 * bundle antigo). Escreve direto em `planilha._abas`, contornando
 * Bootstrap.inicializar, porque o objetivo é controlar o "antes" com
 * precisão, não testar a instalação original.
 */
function comEventosManuaisNoSchemaAntigo() {
  const ctx = dataset.montarWorkbook({ comDados: false });
  ctx.planilha._abas[A.EVENTOS_MANUAIS] = {
    headers: COLUNAS_PRODUCAO_ANTERIOR.slice(),
    linhas: [LINHA_ANTIGA_1.slice(), LINHA_ANTIGA_2.slice()]
  };
  return ctx;
}

/** Lê a aba 11 pelo mesmo caminho que todo o sistema usa: cabeçalho vigente
 *  zipado por posição com as linhas — é o ponto exato que corrompe se o
 *  schema reordenar uma coluna existente. */
function lerEventosManuaisCru(ctx) {
  return ctx.planilha.lerTabela(A.EVENTOS_MANUAIS);
}

describe('Rollout brownfield: 11_EVENTOS_MANUAIS já populada', () => {
  it('append-only: o prefixo de 16 colunas do schema atual é idêntico ao de produção',
    { scenario: 'C54' }, () => {
      const atuais = FOS.Schema.get(A.EVENTOS_MANUAIS).colunas;
      assert.deep(atuais.slice(0, 16), COLUNAS_PRODUCAO_ANTERIOR,
        'as 16 primeiras colunas não podem mudar de nome nem de ordem');
      assert.deep(atuais.slice(16), ['valor_devido', 'vencimento', 'credor'],
        'os três campos de passivo só podem vir depois das 16 antigas');
    });

  it('Preparar planilha sobre aba antiga: as 16 células antigas continuam sob os mesmos headers, com os mesmos valores',
    { scenario: 'C54' }, () => {
      const ctx = comEventosManuaisNoSchemaAntigo();
      FOS.App.Bootstrap.inicializar({ planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria });

      const cabecalhos = ctx.planilha.cabecalhos(A.EVENTOS_MANUAIS);
      assert.deep(cabecalhos.slice(0, 16), COLUNAS_PRODUCAO_ANTERIOR,
        'o cabeçalho físico continua com o prefixo antigo, na mesma ordem');

      const linhas = lerEventosManuaisCru(ctx);
      assert.equal(linhas.length, 2, 'nenhuma linha perdida nem duplicada');

      const esperado1 = {};
      COLUNAS_PRODUCAO_ANTERIOR.forEach((col, i) => { esperado1[col] = LINHA_ANTIGA_1[i]; });
      const esperado2 = {};
      COLUNAS_PRODUCAO_ANTERIOR.forEach((col, i) => { esperado2[col] = LINHA_ANTIGA_2[i]; });

      COLUNAS_PRODUCAO_ANTERIOR.forEach((col) => {
        assert.equal(String(linhas[0][col]), String(esperado1[col]),
          'campo "' + col + '" da linha 1 mudou de valor — reinterpretação de dado real');
        assert.equal(String(linhas[1][col]), String(esperado2[col]),
          'campo "' + col + '" da linha 2 mudou de valor — reinterpretação de dado real');
      });
    });

  it('as três colunas novas nascem no final, vazias para toda linha antiga',
    { scenario: 'C54' }, () => {
      const ctx = comEventosManuaisNoSchemaAntigo();
      FOS.App.Bootstrap.inicializar({ planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria });

      const cabecalhos = ctx.planilha.cabecalhos(A.EVENTOS_MANUAIS);
      assert.deep(cabecalhos.slice(16), ['valor_devido', 'vencimento', 'credor']);

      const linhas = lerEventosManuaisCru(ctx);
      linhas.forEach((linha, i) => {
        assert.equal(linha.valor_devido, '', 'linha antiga ' + (i + 1) + ' não pode ganhar valor_devido sozinha');
        assert.equal(linha.vencimento, '', 'linha antiga ' + (i + 1) + ' não pode ganhar vencimento sozinha');
        assert.equal(linha.credor, '', 'linha antiga ' + (i + 1) + ' não pode ganhar credor sozinho');
      });
    });

  it('eventos antigos continuam válidos e reconciliáveis depois do rollout',
    { scenario: 'C54' }, () => {
      // Prova de ponta a ponta: não só o cabeçalho preserva o nome certo —
      // o domínio lê os valores corretos e aceita o evento como sempre
      // aceitou. Se o prefixo tivesse deslocado, isto teria falhado com
      // VALOR_INVALIDO, CONTA_ORIGEM_DESCONHECIDA ou similar.
      const ctx = comEventosManuaisNoSchemaAntigo();
      FOS.App.Bootstrap.inicializar({ planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria });

      const config = ctx.repositorio.config();
      const eventos = ctx.repositorio.eventos();
      const saque = eventos.filter((e) => e.evento_id === 'EV-OLD-1')[0];
      assert.ok(saque, 'evento antigo precisa continuar legível pelo repositório');
      assert.equal(saque.conta_origem, 'WISE');
      assert.equal(saque.conta_destino, 'INTER_CC');
      assert.equal(Number(saque.valor), 6000);
      const r = FOS.Events.validar(saque, config);
      assert.ok(r.ok, 'SAQUE_TRADING antigo precisa continuar válido: ' + JSON.stringify(r.erros));
    });

  it('Preparar planilha rodado de novo não move nem altera nada além do já estável',
    { scenario: 'C54' }, () => {
      const ctx = comEventosManuaisNoSchemaAntigo();
      FOS.App.Bootstrap.inicializar({ planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria });
      const primeiraLeitura = JSON.stringify(lerEventosManuaisCru(ctx));
      const primeiroCabecalho = JSON.stringify(ctx.planilha.cabecalhos(A.EVENTOS_MANUAIS));

      // Segunda "instalação" — mesmo bundle, mesmo comando, planilha já
      // migrada. Idempotência: zero mutação semântica adicional.
      FOS.App.Bootstrap.inicializar({ planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria });

      assert.equal(JSON.stringify(lerEventosManuaisCru(ctx)), primeiraLeitura,
        'segunda execução não pode alterar nenhuma célula da aba 11');
      assert.equal(JSON.stringify(ctx.planilha.cabecalhos(A.EVENTOS_MANUAIS)), primeiroCabecalho);
    });
});

/* ------------------------------------------------------------------ */
/* Portão de conciliação: nenhuma mutação canônica em 33_PASSIVOS antes */
/* da prova bancária (ADR 0008 §12)                                     */
/* ------------------------------------------------------------------ */

describe('Passivo: portão de conciliação — nascimento nunca antecipa o crédito', () => {
  it('sem candidato algum no ledger: zero linhas em 33_PASSIVOS, recusa explícita',
    { scenario: 'C54' }, () => {
      const ctx = dataset.montarWorkbook({ comDados: false, agora: '2026-01-10T12:00:00Z' });
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVP_SEM_CAND', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-10',
        conta_destino: 'INTER_CC', valor: 1000, vencimento: '2026-06-30', referencia_id: 'PAS_SEM_CAND',
        credor: 'CREDOR SEM CANDIDATO', descricao: 'Emprestimo sem extrato importado'
      })]);
      // Nenhum extrato importado: não existe candidato algum no ledger.
      ctx.workflows.conciliarEventos();
      const r = ctx.workflows.materializarEventos();

      assert.equal(r.passivos.length, 0, 'nenhum passivo nasce sem crédito conciliado');
      assert.equal(ctx.repositorio.passivos().length, 0);
      assert.equal(r.invalidos.length, 1);
      assert.equal(r.invalidos[0].evento_id, 'EVP_SEM_CAND');
      assert.equal(r.invalidos[0].erros[0].codigo, 'PASSIVO_SEM_CONCILIACAO');
    });

  it('conciliação ambígua (duas candidatas): zero linhas em 33_PASSIVOS enquanto não resolvida',
    { scenario: 'C54' }, () => {
      const ctx = dataset.montarWorkbook({ comDados: false, agora: '2026-01-10T12:00:00Z' });
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVP_AMBIGUO', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-05',
        conta_destino: 'INTER_CC', valor: 1000, vencimento: '2026-06-30', referencia_id: 'PAS_AMBIGUO',
        credor: 'CREDOR AMBIGUO', descricao: 'Emprestimo com duas linhas candidatas'
      })]);
      ctx.workflows.importarExtrato({
        contaId: 'INTER_CC', nomeArquivo: 'jan.csv',
        conteudo: [
          'data;descricao;valor',
          '05/01/2026;CREDITO EMPRESTIMO AMBIGUO A;1000,00',
          '06/01/2026;CREDITO EMPRESTIMO AMBIGUO B;1000,00'
        ].join('\n')
      });
      // As duas linhas precisam entrar no ledger antes de a ambiguidade
      // entre elas poder ser avaliada pela conciliação.
      resolverTodasClassificacoes(ctx.workflows, ctx, 'MOVIMENTACAO_COM_TERCEIRO');

      const conciliacao = ctx.workflows.conciliarEventos();
      assert.includes(conciliacao.pendentes.map((p) => p.motivo), 'AMBIGUIDADE_CONCILIACAO');
      const r = ctx.workflows.materializarEventos();

      assert.equal(r.passivos.length, 0, 'ambiguidade não é prova de conciliação — nenhum passivo nasce');
      assert.equal(ctx.repositorio.passivos().length, 0);
      assert.equal(r.invalidos[0].erros[0].codigo, 'PASSIVO_SEM_CONCILIACAO');
    });

  it('dado do evento com erro de digitação (valor não bate): nenhum passivo canônico nasce',
    { scenario: 'C54' }, () => {
      const ctx = dataset.montarWorkbook({ comDados: false, agora: '2026-01-10T12:00:00Z' });
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVP_TYPO', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-10',
        conta_destino: 'INTER_CC', valor: 999.99, vencimento: '2026-06-30', referencia_id: 'PAS_TYPO',
        credor: 'CREDOR TYPO', descricao: 'Valor digitado com erro (999,99 em vez de 1000)'
      })]);
      ctx.workflows.importarExtrato({
        contaId: 'INTER_CC', nomeArquivo: 'jan.csv',
        conteudo: 'data;descricao;valor\n10/01/2026;CREDITO EMPRESTIMO TYPO TESTE;1000,00'
      });
      resolverUnico(ctx.workflows, ctx, 'MOVIMENTACAO_COM_TERCEIRO');
      ctx.workflows.conciliarEventos();
      const r = ctx.workflows.materializarEventos();

      assert.equal(r.passivos.length, 0, 'valor declarado não bate com o extrato: nenhum candidato');
      assert.equal(ctx.repositorio.passivos().length, 0);
      assert.equal(r.invalidos[0].erros[0].codigo, 'PASSIVO_SEM_CONCILIACAO');
    });

  it('depois que a conciliação é resolvida, materializa uma única vez — nunca PASSIVO_JA_EXISTE',
    { scenario: 'C54' }, () => {
      const ctx = dataset.montarWorkbook({ comDados: false, agora: '2026-01-10T12:00:00Z' });
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVP_TARDE', tipo_evento: 'NOVO_PASSIVO', data: '2026-01-10',
        conta_destino: 'INTER_CC', valor: 1000, vencimento: '2026-06-30', referencia_id: 'PAS_TARDE',
        credor: 'CREDOR TARDE', descricao: 'Extrato ainda não chegou'
      })]);

      // Primeira execução de "Registrar evento": extrato de janeiro ainda
      // não foi importado. Nada é criado.
      ctx.workflows.conciliarEventos();
      const primeira = ctx.workflows.materializarEventos();
      assert.equal(primeira.passivos.length, 0);
      assert.equal(ctx.repositorio.passivos().length, 0);

      // O extrato chega depois — o usuário roda "Registrar evento" de novo.
      ctx.workflows.importarExtrato({
        contaId: 'INTER_CC', nomeArquivo: 'jan.csv',
        conteudo: 'data;descricao;valor\n10/01/2026;CREDITO EMPRESTIMO TARDE TESTE;1000,00'
      });
      resolverUnico(ctx.workflows, ctx, 'MOVIMENTACAO_COM_TERCEIRO');
      ctx.workflows.conciliarEventos();
      const segunda = ctx.workflows.materializarEventos();

      assert.equal(segunda.passivos.length, 1, 'agora existe candidato conciliado: materializa');
      assert.equal(segunda.invalidos.length, 0, 'nunca PASSIVO_JA_EXISTE: nada tinha sido criado antes');
      assert.equal(ctx.repositorio.passivos().length, 1);

      // Rodar "Registrar evento" uma terceira vez (idempotência): não
      // duplica nem reprocessa.
      ctx.workflows.conciliarEventos();
      const terceira = ctx.workflows.materializarEventos();
      assert.equal(terceira.passivos.length, 0);
      assert.deep(terceira.ignorados, [{ evento_id: 'EVP_TARDE', motivo: 'JA_MATERIALIZADO' }]);
      assert.equal(ctx.repositorio.passivos().length, 1, 'sem duplicar');
    });

  it('AMORTIZACAO_PASSIVO sem débito conciliado: saldo intacto, nenhuma versão nova',
    { scenario: 'C54' }, () => {
      const ctx = nascido(); // passivo aberto = 4500
      const wfFev = workflowsEm(ctx, '2026-02-15T12:00:00Z');
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVP_AMORT_SEM_DEB', tipo_evento: 'AMORTIZACAO_PASSIVO', data: '2026-02-15',
        conta_origem: 'INTER_CC', valor: 2000, referencia_id: 'PAS_TESTE',
        descricao: 'Amortizacao sem debito no extrato'
      })]);
      // Nenhum extrato de fevereiro importado: não há débito conciliado.
      const antes = passivoCorrente(ctx);
      wfFev.conciliarEventos();
      const r = wfFev.materializarEventos();
      const depois = passivoCorrente(ctx);

      assert.equal(r.passivos.length, 0, 'nenhuma versão nova nasce sem débito conciliado');
      assert.equal(r.invalidos[0].erros[0].codigo, 'AMORTIZACAO_SEM_CONCILIACAO');
      assert.equal(Number(depois.valor_aberto), Number(antes.valor_aberto), 'saldo intacto');
      assert.equal(Number(depois.versao), Number(antes.versao), 'nem sequer uma versão vazia é criada');
    });

  it('AMORTIZACAO_PASSIVO com débito ambíguo: saldo intacto até a ambiguidade ser resolvida',
    { scenario: 'C54' }, () => {
      const ctx = nascido(); // passivo aberto = 4500
      const wfFev = workflowsEm(ctx, '2026-02-15T12:00:00Z');
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVP_AMORT_AMBIGUO', tipo_evento: 'AMORTIZACAO_PASSIVO', data: '2026-02-15',
        conta_origem: 'INTER_CC', valor: 2000, referencia_id: 'PAS_TESTE',
        descricao: 'Amortizacao com dois debitos candidatos'
      })]);
      wfFev.importarExtrato({
        contaId: 'INTER_CC', nomeArquivo: 'fev.csv',
        conteudo: [
          'data;descricao;valor',
          '15/02/2026;DEBITO QUITACAO AMBIGUA A;-2000,00',
          '16/02/2026;DEBITO QUITACAO AMBIGUA B;-2000,00'
        ].join('\n')
      });
      resolverTodasClassificacoes(wfFev, ctx, 'MOVIMENTACAO_COM_TERCEIRO');

      const antes = passivoCorrente(ctx);
      const conciliacao = wfFev.conciliarEventos();
      assert.includes(conciliacao.pendentes.map((p) => p.motivo), 'AMBIGUIDADE_CONCILIACAO');
      const r = wfFev.materializarEventos();
      const depois = passivoCorrente(ctx);

      assert.equal(r.passivos.length, 0);
      assert.equal(r.invalidos[0].erros[0].codigo, 'AMORTIZACAO_SEM_CONCILIACAO');
      assert.equal(Number(depois.valor_aberto), Number(antes.valor_aberto));
      assert.equal(Number(depois.versao), Number(antes.versao));
    });

  it('NOVA_OBRIGACAO, NOVO_OBJETIVO e posição materializam igual, com conciliarEventos rodando antes',
    { scenario: 'C54' }, () => {
      // O portão é exclusivo dos dois tipos de passivo. Prova que a nova
      // ordem (conciliar antes de materializar) não muda nada para os
      // outros tipos de evento manual.
      const ctx = dataset.montarWorkbook({ comDados: false, agora: '2026-01-10T12:00:00Z' });
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [
        dataset.evento({
          evento_id: 'EVN_OBR', tipo_evento: 'NOVA_OBRIGACAO', data: '2026-01-10',
          valor: 3000, referencia_id: 'PROV_ORDEM', descricao: 'Provisao de controle'
        }),
        dataset.evento({
          evento_id: 'EVN_OBJ', tipo_evento: 'NOVO_OBJETIVO', data: '2026-01-10',
          valor: 20000, referencia_id: 'OBJ_ORDEM', descricao: 'Objetivo de controle'
        }),
        dataset.evento({
          evento_id: 'EVN_POS', tipo_evento: 'APORTE_POSICAO', data: '2026-01-10',
          conta_origem: 'INTER_CC', valor: 1500, referencia_id: 'POS_ORDEM'
        })
      ]);

      ctx.workflows.conciliarEventos();
      const r = ctx.workflows.materializarEventos();

      assert.equal(r.invalidos.length, 0, JSON.stringify(r.invalidos));
      assert.equal(r.provisoes.length, 1);
      assert.equal(r.objetivos.length, 1);
      assert.equal(r.posicoes.length, 1);
      assert.equal(Number(r.provisoes[0].valor_alvo), 3000);
      assert.equal(Number(r.objetivos[0].valor_alvo), 20000);
      assert.equal(Number(r.posicoes[0].valor), 1500);
    });

  it('Registrar evento: a ordem no código é sempre conciliar antes de materializar',
    { scenario: 'C54' }, () => {
      // Teste estrutural, não comportamental: lê o texto real de main.js e
      // prova que a chamada a conciliarEventos() vem antes da chamada a
      // materializarEventos() dentro de fosRegistrarEvento. Se alguém
      // reverter para a ordem perigosa (materializar antes de conciliar),
      // este teste — e só ele, dos testes de comportamento acima — detecta
      // a regressão sem precisar rodar o comando de verdade.
      const comando = MAIN.slice(
        MAIN.indexOf('function fosRegistrarEvento'),
        MAIN.indexOf('/**\n * Publicar taxa do mês')
      );
      const posConciliar = comando.indexOf('amb.workflows.conciliarEventos()');
      const posMaterializar = comando.indexOf('amb.workflows.materializarEventos()');
      assert.ok(posConciliar !== -1 && posMaterializar !== -1,
        'as duas chamadas precisam existir dentro de fosRegistrarEvento');
      assert.ok(posConciliar < posMaterializar,
        'conciliarEventos() precisa rodar antes de materializarEventos() — '
        + 'NOVO_PASSIVO/AMORTIZACAO_PASSIVO dependem da conciliação já ter acontecido');
    });
});

/* ------------------------------------------------------------------ */
/* Passivo brownfield: SALDO_INICIAL_PASSIVO e CORRECAO_PASSIVO        */
/* ------------------------------------------------------------------ */

/** Declara uma dívida pré-existente por SALDO_INICIAL_PASSIVO — sem
 *  extrato, sem conciliação: é assim que ela entra no sistema. */
function comSaldoInicialPassivo(camposEvento) {
  const ctx = dataset.montarWorkbook({ comDados: false, agora: '2026-01-10T12:00:00Z' });
  ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento(Object.assign({
    evento_id: 'EVB1', tipo_evento: 'SALDO_INICIAL_PASSIVO', data: '2026-01-05',
    referencia_id: 'PAS_BROWNFIELD', credor: 'CREDOR BROWNFIELD',
    vencimento: '2027-06-30', valor: 3300, descricao: 'Divida pre-existente sintetica'
  }, camposEvento || {}))]);
  return ctx;
}

/** comSaldoInicialPassivo() já materializado — base para os testes de
 *  CORRECAO_PASSIVO e de amortização normal de uma dívida brownfield. */
function nascidoBrownfield() {
  const ctx = comSaldoInicialPassivo();
  ctx.workflows.conciliarEventos();
  ctx.workflows.materializarEventos();
  return ctx;
}

describe('Passivo brownfield: SALDO_INICIAL_PASSIVO', () => {
  it('o catálogo de eventos agora tem exatamente onze tipos', { scenario: 'C55' }, () => {
    assert.equal(C.values(C.TIPO_EVENTO).length, 11);
    assert.includes(C.values(C.TIPO_EVENTO), 'SALDO_INICIAL_PASSIVO');
    assert.includes(C.values(C.TIPO_EVENTO), 'CORRECAO_PASSIVO');
    assert.notOk(FOS.Events.spec('SALDO_INICIAL_PASSIVO').concilia, 'nunca concilia');
    assert.notOk(FOS.Events.spec('CORRECAO_PASSIVO').concilia, 'nunca concilia');
  });

  it('evento válido cria o passivo sem qualquer conciliação', { scenario: 'C55' }, () => {
    const ctx = nascidoBrownfield();
    const p = passivoCorrente(ctx);
    assert.ok(p, 'esperado o passivo brownfield criado');
    assert.equal(p.passivo_id, 'PAS_BROWNFIELD');
    assert.equal(Number(p.versao), 1);
    assert.equal(p.credor, 'CREDOR BROWNFIELD');
    assert.equal(p.origem_evento_id, 'EVB1');
  });

  it('nenhuma linha de ledger é criada ou alterada por ele', { scenario: 'C55' }, () => {
    const ctx = nascidoBrownfield();
    assert.equal(ctx.repositorio.ledger().length, 0, 'SALDO_INICIAL_PASSIVO nunca toca 22_LEDGER');
  });

  it('valor_devido_original == valor_aberto == evento.valor', { scenario: 'C55' }, () => {
    const ctx = nascidoBrownfield();
    const p = passivoCorrente(ctx);
    assert.equal(Number(p.valor_devido_original), 3300);
    assert.equal(Number(p.valor_aberto), 3300);
    assert.equal(Number(p.valor_devido_original), Number(p.valor_aberto));
  });

  it('vigente_desde reflete evento.data — a data de abertura, não a de materialização',
    { scenario: 'C55' }, () => {
      const ctx = nascidoBrownfield();
      assert.equal(passivoCorrente(ctx).vigente_desde, '2026-01-05');
    });

  it('data dentro da abertura é aceita', { scenario: 'C55' }, () => {
    const config = FOS.Config.build(FOS.App.Seed.configRows());
    const r = FOS.Events.validar(dataset.evento({
      evento_id: 'X', tipo_evento: 'SALDO_INICIAL_PASSIVO', data: '2026-01-31',
      referencia_id: 'PAS_X', credor: 'CREDOR X', vencimento: '2027-01-01', valor: 1000
    }), config);
    assert.ok(r.ok, JSON.stringify(r.erros));
  });

  it('data posterior ao fim da competência inicial recusa com SALDO_INICIAL_FORA_DA_ABERTURA',
    { scenario: 'C55' }, () => {
      const config = FOS.Config.build(FOS.App.Seed.configRows());
      const r = FOS.Events.validar(dataset.evento({
        evento_id: 'X', tipo_evento: 'SALDO_INICIAL_PASSIVO', data: '2026-02-01',
        referencia_id: 'PAS_X', credor: 'CREDOR X', vencimento: '2027-01-01', valor: 1000
      }), config);
      assert.notOk(r.ok);
      assert.includes(r.erros.map((e) => e.codigo), 'SALDO_INICIAL_FORA_DA_ABERTURA');
    });

  it('sem COMPETENCIA_INICIAL_CAIXA_VIDA disponível, recusa fechado — nunca vira bypass do portão',
    { scenario: 'C55' }, () => {
      const linhasSemParam = FOS.App.Seed.configRows()
        .filter((r) => !(r.secao === 'PARAMETRO' && r.chave === FOS.Life.PARAM_COMPETENCIA_INICIAL));
      const config = FOS.Config.build(linhasSemParam);
      const r = FOS.Events.validar(dataset.evento({
        evento_id: 'X', tipo_evento: 'SALDO_INICIAL_PASSIVO', data: '2026-01-05',
        referencia_id: 'PAS_X', credor: 'CREDOR X', vencimento: '2027-01-01', valor: 1000
      }), config);
      assert.notOk(r.ok);
      assert.includes(r.erros.map((e) => e.codigo), 'COMPETENCIA_INICIAL_INDISPONIVEL');
    });

  it('passivo_id duplicado recusa, mesmo entre SALDO_INICIAL_PASSIVO e NOVO_PASSIVO',
    { scenario: 'C55' }, () => {
      const ctx = nascidoBrownfield();
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVB_DUP', tipo_evento: 'SALDO_INICIAL_PASSIVO', data: '2026-01-06',
        referencia_id: 'PAS_BROWNFIELD', credor: 'OUTRO CREDOR', vencimento: '2027-01-01', valor: 500
      })]);
      const r = ctx.workflows.materializarEventos();
      assert.equal(r.passivos.length, 0);
      assert.equal(r.invalidos[0].erros[0].codigo, 'PASSIVO_JA_EXISTE');
      assert.equal(FOS.Subledger.correntes(ctx.repositorio.passivos(), 'passivo_id').length, 1);
    });

  it('setup brownfield (Preparar planilha) continua idempotente com onze tipos no dropdown',
    { scenario: 'C55' }, () => {
      const ctx = dataset.montarWorkbook({ comDados: false });
      FOS.App.Bootstrap.inicializar({ planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria });
      const dropdowns = ctx.planilha.chamadasDe('validarColunaPorLista')
        .filter((v) => v.nome === A.EVENTOS_MANUAIS && v.coluna === 'tipo_evento');
      assert.equal(dropdowns.length, 2, 'reaplicar a mesma regra é idempotente no Sheets');
      assert.equal(dropdowns[0].valores.length, 11);
      assert.deep(dropdowns[0].valores, dropdowns[1].valores);
    });

  it('nenhum schema existente se desloca: 11_EVENTOS_MANUAIS continua com as mesmas 19 colunas',
    { scenario: 'C55' }, () => {
      const colunas = FOS.Schema.get(A.EVENTOS_MANUAIS).colunas;
      assert.equal(colunas.length, 19, 'SALDO_INICIAL_PASSIVO/CORRECAO_PASSIVO não precisam de coluna nova');
      assert.deep(colunas.slice(16), ['valor_devido', 'vencimento', 'credor']);
    });
});

describe('Passivo brownfield: CORRECAO_PASSIVO', () => {
  it('passivo existente gera nova versão — só valor_aberto muda', { scenario: 'C55' }, () => {
    const ctx = nascidoBrownfield();
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EVB2', tipo_evento: 'CORRECAO_PASSIVO', data: '2026-01-15',
      referencia_id: 'PAS_BROWNFIELD', valor: 3000, observacao: 'Saldo real informado pelo credor'
    })]);
    const wfCorrecao = workflowsEm(ctx, '2026-02-01T09:00:00Z');
    const r = wfCorrecao.materializarEventos();
    assert.equal(r.passivos.length, 1);

    const p = passivoCorrente(ctx);
    assert.equal(Number(p.versao), 2);
    assert.equal(Number(p.valor_aberto), 3000);
    assert.equal(Number(p.valor_devido_original), 3300, 'valor_devido_original nunca muda por correção');
    assert.equal(p.credor, 'CREDOR BROWNFIELD', 'credor intacto');
    assert.equal(p.vencimento, '2027-06-30', 'vencimento intacto');
    assert.equal(p.moeda, 'BRL', 'moeda intacta');
    assert.equal(p.nome, 'Divida pre-existente sintetica', 'nome intacto');
    assert.includes(p.motivo_versao, 'CORRECAO_PASSIVO:EVB2');
  });

  it('versão anterior continua vigente para competências antes da correção — o mecanismo já existente',
    { scenario: 'C55' }, () => {
      const ctx = nascidoBrownfield();
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVB2', tipo_evento: 'CORRECAO_PASSIVO', data: '2026-01-15',
        referencia_id: 'PAS_BROWNFIELD', valor: 3000, observacao: 'Saldo real informado pelo credor'
      })]);
      const wfCorrecao = workflowsEm(ctx, '2026-02-01T09:00:00Z');
      wfCorrecao.materializarEventos();

      const linhas = ctx.repositorio.passivos();
      // A versão corrigida nasce com vigente_desde = agora da correção
      // (fevereiro): reprocessar janeiro não pode enxergá-la — o mesmo
      // "vigente_ate por projeção" que já vale para provisão/objetivo.
      assert.equal(FOS.Subledger.correntesEm(linhas, 'passivo_id', '2026-01')[0].valor_aberto, 3300);
      assert.equal(FOS.Subledger.correntesEm(linhas, 'passivo_id', '2026-02')[0].valor_aberto, 3000);
    });

  it('valor = 0 é aceito — quitação por correção administrativa', { scenario: 'C55' }, () => {
    const ctx = nascidoBrownfield();
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EVB2', tipo_evento: 'CORRECAO_PASSIVO', data: '2026-01-15',
      referencia_id: 'PAS_BROWNFIELD', valor: 0, observacao: 'Divida quitada antes do sistema existir'
    })]);
    const r = ctx.workflows.materializarEventos();
    assert.equal(r.passivos.length, 1);
    assert.equal(Number(passivoCorrente(ctx).valor_aberto), 0);
  });

  it('valor negativo recusa com VALOR_INVALIDO', { scenario: 'C55' }, () => {
    const config = FOS.Config.build(FOS.App.Seed.configRows());
    const r = FOS.Events.validar(dataset.evento({
      evento_id: 'X', tipo_evento: 'CORRECAO_PASSIVO', data: '2026-01-15',
      referencia_id: 'PAS_BROWNFIELD', valor: -1, observacao: 'motivo qualquer'
    }), config);
    assert.notOk(r.ok);
    assert.includes(r.erros.map((e) => e.codigo), 'VALOR_INVALIDO');
  });

  it('valor acima do valor_devido_original recusa com CORRECAO_ACIMA_DO_ORIGINAL',
    { scenario: 'C55' }, () => {
      const ctx = nascidoBrownfield();
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVB2', tipo_evento: 'CORRECAO_PASSIVO', data: '2026-01-15',
        referencia_id: 'PAS_BROWNFIELD', valor: 3301, observacao: 'motivo qualquer'
      })]);
      const antes = passivoCorrente(ctx);
      const r = ctx.workflows.materializarEventos();
      assert.equal(r.passivos.length, 0);
      assert.equal(r.invalidos[0].erros[0].codigo, 'CORRECAO_ACIMA_DO_ORIGINAL');
      const depois = passivoCorrente(ctx);
      assert.equal(Number(depois.valor_aberto), Number(antes.valor_aberto));
      assert.equal(Number(depois.versao), Number(antes.versao));
    });

  it('referência inexistente recusa com PASSIVO_INEXISTENTE', { scenario: 'C55' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EVB_FANTASMA', tipo_evento: 'CORRECAO_PASSIVO', data: '2026-01-15',
      referencia_id: 'PAS_INEXISTENTE', valor: 100, observacao: 'motivo qualquer'
    })]);
    const r = ctx.workflows.materializarEventos();
    assert.equal(r.passivos.length, 0);
    assert.equal(r.invalidos[0].erros[0].codigo, 'PASSIVO_INEXISTENTE');
  });

  it('observação vazia recusa com OBSERVACAO_OBRIGATORIA', { scenario: 'C55' }, () => {
    const config = FOS.Config.build(FOS.App.Seed.configRows());
    const r = FOS.Events.validar(dataset.evento({
      evento_id: 'X', tipo_evento: 'CORRECAO_PASSIVO', data: '2026-01-15',
      referencia_id: 'PAS_BROWNFIELD', valor: 3000
    }), config);
    assert.notOk(r.ok);
    assert.includes(r.erros.map((e) => e.codigo), 'OBSERVACAO_OBRIGATORIA');
  });

  it('não há conciliação nem alteração de ledger', { scenario: 'C55' }, () => {
    const ctx = nascidoBrownfield();
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EVB2', tipo_evento: 'CORRECAO_PASSIVO', data: '2026-01-15',
      referencia_id: 'PAS_BROWNFIELD', valor: 3000, observacao: 'motivo qualquer'
    })]);
    const antesLedger = ctx.repositorio.ledger().length;
    const conciliacao = ctx.workflows.conciliarEventos();
    ctx.workflows.materializarEventos();
    assert.equal(ctx.repositorio.ledger().length, antesLedger, 'CORRECAO_PASSIVO nunca toca 22_LEDGER');
    assert.equal(conciliacao.conciliadas, 0);
  });
});

describe('Passivo brownfield: não-regressão', () => {
  it('disponível e runway continuam coerentes com um passivo brownfield em aberto',
    { scenario: 'C55' }, () => {
      const ctx = nascidoBrownfield();
      const r = ctx.workflows.fecharCompetencia('2026-01');
      assert.ok(r.validacao.ok, JSON.stringify(r.validacao.violacoes));
      const s = r.snapshot;
      // caixa = 10000 (inicial) — nenhum movimento bancário entrou
      assert.equal(s.vida.caixa_vida_brl.value, 10000);
      assert.equal(s.vida.passivos_abertos_brl.value, 3300);
      assert.equal(s.vida.disponivel_brl.value, 6700, '10000 - 0 - 0 - 3300');
    });

  it('amortizar uma dívida brownfield reduz o saldo normalmente, exigindo débito conciliado como sempre',
    { scenario: 'C55' }, () => {
      const ctx = nascidoBrownfield();
      const wfFev = workflowsEm(ctx, '2026-02-15T12:00:00Z');
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVB_AMORT', tipo_evento: 'AMORTIZACAO_PASSIVO', data: '2026-02-15',
        conta_origem: 'INTER_CC', valor: 300, referencia_id: 'PAS_BROWNFIELD',
        descricao: 'Parcela sintetica de fevereiro'
      })]);

      // Sem débito conciliado ainda: recusa — mesmo portão do round anterior,
      // não importa se o passivo nasceu de NOVO_PASSIVO ou brownfield.
      const semExtrato = wfFev.materializarEventos();
      assert.equal(semExtrato.passivos.length, 0);
      assert.equal(semExtrato.invalidos[0].erros[0].codigo, 'AMORTIZACAO_SEM_CONCILIACAO');

      wfFev.importarExtrato({
        contaId: 'INTER_CC', nomeArquivo: 'fev.csv',
        conteudo: 'data;descricao;valor\n15/02/2026;DEBITO PARCELA BROWNFIELD;-300,00'
      });
      resolverUnico(wfFev, ctx, 'MOVIMENTACAO_COM_TERCEIRO');
      wfFev.conciliarEventos();
      const comExtrato = wfFev.materializarEventos();
      assert.equal(comExtrato.passivos.length, 1);
      assert.equal(Number(passivoCorrente(ctx).valor_aberto), 3000, '3300 - 300');

      // A parcela vira MOVIMENTACAO_COM_TERCEIRO, nunca CUSTO_VIDA.
      const linhaLedger = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
        .filter((l) => Number(l.valor_origem) === -300)[0];
      assert.ok(linhaLedger);
      assert.equal(linhaLedger.categoria, 'MOVIMENTACAO_COM_TERCEIRO');
    });

  it('classificar uma movimentação como MOVIMENTACAO_COM_TERCEIRO não amortiza passivo sozinho',
    { scenario: 'C55' }, () => {
      // Sem AMORTIZACAO_PASSIVO declarado, nenhuma inferência automática:
      // classificar a linha na fila não move valor_aberto.
      const ctx = nascidoBrownfield();
      const wfFev = workflowsEm(ctx, '2026-02-15T12:00:00Z');
      wfFev.importarExtrato({
        contaId: 'INTER_CC', nomeArquivo: 'fev.csv',
        conteudo: 'data;descricao;valor\n15/02/2026;DEBITO PARCELA BROWNFIELD;-300,00'
      });
      resolverUnico(wfFev, ctx, 'MOVIMENTACAO_COM_TERCEIRO');
      wfFev.conciliarEventos();
      wfFev.materializarEventos();
      assert.equal(Number(passivoCorrente(ctx).valor_aberto), 3300, 'saldo intacto sem evento de amortização');
    });

  it('eventos não relacionados a passivo materializam igual, com os dois tipos novos no catálogo',
    { scenario: 'C55' }, () => {
      const ctx = dataset.montarWorkbook({ comDados: false, agora: '2026-01-10T12:00:00Z' });
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [
        dataset.evento({
          evento_id: 'EVN_OBR', tipo_evento: 'NOVA_OBRIGACAO', data: '2026-01-10',
          valor: 3000, referencia_id: 'PROV_C55', descricao: 'Provisao de controle'
        }),
        dataset.evento({
          evento_id: 'EVN_OBJ', tipo_evento: 'NOVO_OBJETIVO', data: '2026-01-10',
          valor: 20000, referencia_id: 'OBJ_C55', descricao: 'Objetivo de controle'
        })
      ]);
      ctx.workflows.conciliarEventos();
      const r = ctx.workflows.materializarEventos();
      assert.equal(r.invalidos.length, 0, JSON.stringify(r.invalidos));
      assert.equal(r.provisoes.length, 1);
      assert.equal(r.objetivos.length, 1);
    });

  it('uma segunda "Registrar evento" é idempotente para os dois tipos novos', { scenario: 'C55' }, () => {
    const ctx = nascidoBrownfield();
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EVB2', tipo_evento: 'CORRECAO_PASSIVO', data: '2026-01-15',
      referencia_id: 'PAS_BROWNFIELD', valor: 3000, observacao: 'motivo qualquer'
    })]);
    ctx.workflows.materializarEventos();
    const antes = ctx.repositorio.passivos().length;

    ctx.workflows.conciliarEventos();
    const r = ctx.workflows.materializarEventos();
    assert.equal(r.passivos.length, 0);
    assert.deep(r.ignorados.map((i) => i.evento_id).sort(), ['EVB1', 'EVB2']);
    assert.equal(ctx.repositorio.passivos().length, antes, 'sem duplicar');
  });
});

/**
 * Reprodução exata do smoke real: `SALDO_INICIAL_PASSIVO` lançava
 * `DomainError: COMPETENCIA_INVALIDA` quando COMPETENCIA_INICIAL_CAIXA_VIDA
 * chegava corrompida pelo Sheets (Date em vez de texto YYYY-MM). Ver
 * test/integration/15-auditoria-final.test.js para os mesmos consumidores
 * cobertos do lado de caixaVida/fecharCompetencia; aqui é especificamente
 * o caminho de FOS.Events.validar que o smoke encontrou primeiro.
 */
describe('Passivo brownfield: SALDO_INICIAL_PASSIVO sobrevive à competência inicial corrompida pelo Sheets', () => {
  function ctxComCompetenciaCorrompida() {
    const ctx = dataset.montarWorkbook({ comDados: false, agora: '2026-08-10T12:00:00Z' });
    corromperParametroComoDateDoSheets(ctx.planilha, 'COMPETENCIA_INICIAL_CAIXA_VIDA', new Date(2026, 7, 1));
    return ctx;
  }

  it('validar() não lança mais — reprodução exata do smoke (evento.data = 2026-08-01)',
    { scenario: 'C56' }, () => {
      const ctx = ctxComCompetenciaCorrompida();
      const config = ctx.repositorio.config();
      // Confirma a premissa do smoke: a célula corrompida chega como
      // "2026-08-01" no Config, não "2026-08".
      assert.equal(config.param('COMPETENCIA_INICIAL_CAIXA_VIDA').value, '2026-08',
        'depois da normalização em Config.build, já não é mais 2026-08-01');

      const evento = dataset.evento({
        evento_id: 'EVB_SMOKE', tipo_evento: 'SALDO_INICIAL_PASSIVO', data: '2026-08-01',
        referencia_id: 'PAS_SMOKE', credor: 'CREDOR SMOKE', vencimento: '2027-01-01', valor: 1000
      });
      // Chamada direta, sem try/catch: se validar() lançar (o bug do
      // smoke), a exceção propaga e este teste falha sozinho — é
      // exatamente esse o comportamento que não pode mais acontecer.
      const r = FOS.Events.validar(evento, config);
      assert.ok(r.ok, JSON.stringify(r.erros));
    });

  it('evento dentro da abertura é aceito, incluindo o último dia do mês (2026-08-31)',
    { scenario: 'C56' }, () => {
      const ctx = ctxComCompetenciaCorrompida();
      const config = ctx.repositorio.config();
      const r = FOS.Events.validar(dataset.evento({
        evento_id: 'X', tipo_evento: 'SALDO_INICIAL_PASSIVO', data: '2026-08-31',
        referencia_id: 'PAS_X', credor: 'CREDOR X', vencimento: '2027-01-01', valor: 1000
      }), config);
      assert.ok(r.ok, JSON.stringify(r.erros));
    });

  it('evento depois da abertura recusa com SALDO_INICIAL_FORA_DA_ABERTURA (2026-09-01)',
    { scenario: 'C56' }, () => {
      const ctx = ctxComCompetenciaCorrompida();
      const config = ctx.repositorio.config();
      const r = FOS.Events.validar(dataset.evento({
        evento_id: 'X', tipo_evento: 'SALDO_INICIAL_PASSIVO', data: '2026-09-01',
        referencia_id: 'PAS_X', credor: 'CREDOR X', vencimento: '2027-01-01', valor: 1000
      }), config);
      assert.notOk(r.ok);
      assert.includes(r.erros.map((e) => e.codigo), 'SALDO_INICIAL_FORA_DA_ABERTURA');
    });

  it('materializarEventos() também não lança — ponta a ponta via o workflow real',
    { scenario: 'C56' }, () => {
      const ctx = ctxComCompetenciaCorrompida();
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EVB_SMOKE2', tipo_evento: 'SALDO_INICIAL_PASSIVO', data: '2026-08-01',
        referencia_id: 'PAS_SMOKE2', credor: 'CREDOR SMOKE 2', vencimento: '2027-01-01', valor: 1000
      })]);
      // Idem: chamada direta, sem try/catch — uma exceção aqui já reprova
      // o teste sozinha.
      ctx.workflows.conciliarEventos();
      const r = ctx.workflows.materializarEventos();
      assert.equal(r.passivos.length, 1);
      assert.equal(r.invalidos.length, 0, JSON.stringify(r.invalidos));
    });
});
