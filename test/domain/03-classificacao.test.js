'use strict';
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');

const C = FOS.Constants;
const REGRAS = FOS.App.Seed.REGRAS;

function tx(campos) {
  return Object.assign({
    data: '2026-01-06',
    conta_id: 'INTER_CC',
    valor: -800,
    descricao_normalizada: 'SUPERMERCADO BOM PRECO',
    moeda: 'BRL',
    fingerprint: 'fp-teste',
    import_id: 'IMP-1',
    arquivo_hash: 'h1',
    descricao_original: 'Supermercado Bom Preco'
  }, campos);
}

describe('Classificação determinística', () => {
  it('classifica custo de vida por regra de descrição', { scenario: 'C05' }, () => {
    const d = FOS.Rules.classificar(tx(), REGRAS, 0.9);
    assert.ok(d.decidido);
    assert.equal(d.categoria, C.CATEGORIA.CUSTO_VIDA);
    assert.equal(d.universo, C.UNIVERSO.VIDA);
    assert.equal(d.regra_id, 'R020');
  });

  it('classifica custo de trading sem confundir com aporte de capital', { scenario: 'C16' }, () => {
    const d = FOS.Rules.classificar(
      tx({ descricao_normalizada: 'CORRETORA TRADING MENSALIDADE', valor: -200 }), REGRAS, 0.9
    );
    assert.equal(d.categoria, C.CATEGORIA.CUSTO_TRADING);
    assert.equal(d.universo, C.UNIVERSO.TRADING);
    assert.notEqual(d.categoria, C.CATEGORIA.APORTE_EXTRAORDINARIO);
  });

  it('reconhece a fronteira Wise para Inter como saque de trading', { scenario: 'C12' }, () => {
    const d = FOS.Rules.classificar(
      tx({ descricao_normalizada: 'TRANSFERENCIA RECEBIDA WISE', valor: 6000 }), REGRAS, 0.9
    );
    assert.equal(d.categoria, C.CATEGORIA.SAQUE_TRADING);
  });

  it('respeita o sinal do valor declarado na regra', { scenario: 'C05' }, () => {
    // A regra da fronteira só vale para crédito; um débito com a mesma
    // descrição não pode ser classificado como saque de trading.
    const d = FOS.Rules.classificar(
      tx({ descricao_normalizada: 'TRANSFERENCIA RECEBIDA WISE', valor: -6000 }), REGRAS, 0.9
    );
    assert.notOk(d.decidido);
    assert.equal(d.motivo, 'SEM_REGRA_APLICAVEL');
  });

  it('manda para a fila quando não há regra', { scenario: 'C05' }, () => {
    const d = FOS.Rules.classificar(tx({ descricao_normalizada: 'LOJA DESCONHECIDA XPTO' }), REGRAS, 0.9);
    assert.notOk(d.decidido);
    assert.equal(d.motivo, 'SEM_REGRA_APLICAVEL');
    assert.isNull(d.categoria);
  });

  it('manda para a fila quando a confiança está abaixo do mínimo', { scenario: 'C05' }, () => {
    const d = FOS.Rules.classificar(
      tx({ descricao_normalizada: 'PIX RECEBIDO DE TERCEIRO', valor: 500 }), REGRAS, 0.9
    );
    assert.notOk(d.decidido);
    assert.equal(d.motivo, 'CONFIANCA_ABAIXO_DO_MINIMO');
  });

  it('manda para a fila quando duas regras de mesma prioridade discordam', { scenario: 'C05' }, () => {
    const regras = REGRAS.concat([{
      regra_id: 'R021B', versao: 1, prioridade: 30, ativo: 'TRUE',
      campo: 'descricao_normalizada', operador: 'CONTEM', valor_referencia: 'SUPERMERCADO',
      conta_escopo: '', sinal_valor: 'DEBITO', categoria: C.CATEGORIA.GASTO_EXTRAORDINARIO,
      subcategoria: '', universo: C.UNIVERSO.VIDA, confianca: 0.95, vigente_desde: '', vigente_ate: ''
    }]);
    const d = FOS.Rules.classificar(tx(), regras, 0.9);
    assert.notOk(d.decidido);
    assert.equal(d.motivo, 'AMBIGUIDADE_REGRAS');
    assert.equal(d.candidatos.length, 2);
  });

  it('ignora regra fora de vigência e regra inativa', { scenario: 'C05' }, () => {
    const regras = [{
      regra_id: 'R100', versao: 1, prioridade: 10, ativo: 'TRUE',
      campo: 'descricao_normalizada', operador: 'CONTEM', valor_referencia: 'SUPERMERCADO',
      conta_escopo: '', sinal_valor: 'QUALQUER', categoria: C.CATEGORIA.CUSTO_VIDA,
      universo: C.UNIVERSO.VIDA, confianca: 0.99, vigente_desde: '2026-05-01', vigente_ate: ''
    }, {
      regra_id: 'R101', versao: 1, prioridade: 11, ativo: 'FALSE',
      campo: 'descricao_normalizada', operador: 'CONTEM', valor_referencia: 'SUPERMERCADO',
      conta_escopo: '', sinal_valor: 'QUALQUER', categoria: C.CATEGORIA.CUSTO_VIDA,
      universo: C.UNIVERSO.VIDA, confianca: 0.99, vigente_desde: '', vigente_ate: ''
    }];
    assert.notOk(FOS.Rules.classificar(tx(), regras, 0.9).decidido);
  });

  it('só aceita categoria canônica', { scenario: 'C05' }, () => {
    const regras = [{
      regra_id: 'RX', versao: 1, prioridade: 1, ativo: 'TRUE',
      campo: 'descricao_normalizada', operador: 'CONTEM', valor_referencia: 'SUPERMERCADO',
      conta_escopo: '', sinal_valor: 'QUALQUER', categoria: 'CATEGORIA_INVENTADA',
      confianca: 0.99, vigente_desde: '', vigente_ate: ''
    }];
    const d = FOS.Rules.classificar(tx(), regras, 0.9);
    assert.notOk(d.decidido);
    assert.equal(d.motivo, 'CATEGORIA_NAO_CANONICA');
  });

  it('tem exatamente as oito categorias canônicas', { scenario: 'C05' }, () => {
    assert.equal(C.values(C.CATEGORIA).length, 8);
  });
});

describe('Ledger canônico append-only', () => {
  const agora = dataset.AGORA;

  function linhaBase() {
    return FOS.Ledger.novaLinha(
      tx({ fingerprint: 'fp-1' }),
      { categoria: C.CATEGORIA.CUSTO_VIDA, universo: C.UNIVERSO.VIDA, regra_id: 'R020', regra_versao: 1, confianca: 0.95 },
      agora, 'TESTE'
    );
  }

  it('cria a versão 1 preservando a origem', () => {
    const l = linhaBase();
    assert.equal(l.versao_gerencial, 1);
    assert.equal(l.valor_origem, -800);
    assert.equal(l.data_origem, '2026-01-06');
    assert.equal(l.motivo_versao, 'CLASSIFICACAO_INICIAL');
  });

  it('reclassificação cria nova versão sem alterar a anterior', () => {
    const v1 = linhaBase();
    const v2 = FOS.Ledger.reclassificar(v1, { categoria: C.CATEGORIA.GASTO_EXTRAORDINARIO }, agora, 'USUARIO', 'REVISAO');
    assert.equal(v1.categoria, C.CATEGORIA.CUSTO_VIDA, 'a versão anterior não pode mudar');
    assert.equal(v2.versao_gerencial, 2);
    assert.equal(v2.categoria, C.CATEGORIA.GASTO_EXTRAORDINARIO);
    assert.equal(v2.valor_origem, v1.valor_origem);
    assert.notEqual(v2.linha_id, v1.linha_id);
  });

  it('recusa alteração de campo de origem', () => {
    const v1 = linhaBase();
    assert.throws(() => FOS.Ledger.reclassificar(v1, { valor_origem: -900 }, agora, 'X', 'Y'), 'ORIGEM_IMUTAVEL');
    assert.throws(() => FOS.Ledger.reclassificar(v1, { conta_id: 'NUBANK' }, agora, 'X', 'Y'), 'ORIGEM_IMUTAVEL');
  });

  it('visão corrente usa a maior versão de cada fingerprint', () => {
    const v1 = linhaBase();
    const v2 = FOS.Ledger.reclassificar(v1, { categoria: C.CATEGORIA.GASTO_EXTRAORDINARIO }, agora, 'X', 'Y');
    const corrente = FOS.Ledger.visaoCorrente([v1, v2]);
    assert.equal(corrente.length, 1);
    assert.equal(corrente[0].versao_gerencial, 2);
  });

  it('invariante detecta origem adulterada entre versões', () => {
    const v1 = linhaBase();
    const v2 = FOS.Core.clone(v1);
    v2.versao_gerencial = 2;
    v2.valor_origem = -999;
    const r = FOS.Invariants.ledgerAppendOnly([v1, v2]);
    assert.notOk(r.ok);
    assert.includes(r.detalhe, 'ORIGEM_ALTERADA');
  });

  it('invariante detecta versão fora de sequência', () => {
    const v1 = linhaBase();
    const v3 = FOS.Core.clone(v1);
    v3.versao_gerencial = 3;
    assert.notOk(FOS.Invariants.ledgerAppendOnly([v1, v3]).ok);
  });
});

describe('Fila de revisão', () => {
  it('cria item aberto com id determinístico', () => {
    const a = FOS.Queue.novoItem({
      origem: C.ORIGEM_FILA.CLASSIFICACAO, referencia: 'fp-1', motivo: 'SEM_REGRA_APLICAVEL', agora: dataset.AGORA
    });
    const b = FOS.Queue.novoItem({
      origem: C.ORIGEM_FILA.CLASSIFICACAO, referencia: 'fp-1', motivo: 'SEM_REGRA_APLICAVEL', agora: dataset.AGORA
    });
    assert.equal(a.item_id, b.item_id, 'itens iguais não podem duplicar');
    assert.equal(a.status, C.STATUS_FILA.ABERTO);
  });

  it('recusa origem inválida', () => {
    assert.throws(() => FOS.Queue.novoItem({ origem: 'CHUTE', referencia: 'x', motivo: 'y' }), 'ORIGEM_FILA_INVALIDA');
  });

  it('resolve apenas item aberto', () => {
    const item = FOS.Queue.novoItem({
      origem: C.ORIGEM_FILA.IMPORTACAO, referencia: 'x', motivo: 'y', agora: dataset.AGORA
    });
    const resolvido = FOS.Queue.resolver(item, 'CLASSIFICADO_MANUALMENTE', dataset.AGORA, 'USUARIO');
    assert.equal(resolvido.status, C.STATUS_FILA.RESOLVIDO);
    assert.throws(() => FOS.Queue.resolver(resolvido, 'x', dataset.AGORA, 'U'), 'ITEM_FILA_NAO_ABERTO');
  });
});
