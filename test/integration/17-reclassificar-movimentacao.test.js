'use strict';
/**
 * Comando de menu "Reclassificar movimentação".
 *
 * Caso real que motivou o comando: no extrato de setembro havia
 *   +99,90 em 2026-09-01 no INTER_CC  -> resgate da poupança (TRANSFERENCIA_INTERNA)
 *   -99,90 em 2026-09-01 no INTER_CC  -> assinatura pessoal   (CUSTO_VIDA)
 * As duas foram resolvidas pela fila como CUSTO_VIDA; o esclarecimento veio
 * depois. O domínio já sabia corrigir isso (reclassificarLinha, append-only e
 * auditado), mas não havia como chamar isso pela planilha.
 *
 * A correção não pode reabrir, editar nem apagar o item já RESOLVIDO da fila.
 */
const { describe, it, assert } = globalThis.__fosTest;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');
const { DESTINO } = require('../../tools/build');

const C = FOS.Constants;
const MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');

/** Extrato com o par de 99,90 do caso real. */
const OFX_SETEMBRO = [
  '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>',
  '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260901<TRNAMT>99.90<MEMO>RESGATE APLICACAO XPTO</STMTTRN>',
  '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260901<TRNAMT>-99.90<MEMO>ASSINATURA MENSAL XPTO</STMTTRN>',
  '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'
].join('\n');

/** Reproduz o estado da planilha: as duas linhas resolvidas como CUSTO_VIDA. */
function workbookComoEmProducao() {
  const ctx = dataset.montarWorkbook({ datasComoDate: true, agora: '2026-09-20T12:00:00Z' });
  ctx.workflows.importarExtrato({
    contaId: 'INTER_CC', nomeArquivo: 'setembro.ofx', conteudo: OFX_SETEMBRO
  });
  FOS.Queue.abertos(ctx.repositorio.fila()).forEach((item) => {
    ctx.workflows.resolverItemFila({
      item_id: item.item_id, decisao: 'CLASSIFICAR', categoria: 'CUSTO_VIDA', ator: 'USUARIO'
    });
  });
  return ctx;
}

function linhaPorValor(ctx, valor) {
  return FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
    .filter((l) => Number(l.valor_origem) === valor)[0];
}

describe('Ponto de entrada: Reclassificar movimentação', () => {
  it('está no menu, no bloco de correção e navegação', { scenario: 'C46' }, () => {
    assert.includes(MAIN, "addItem('Reclassificar movimentação', 'fosReclassificarMovimentacao')");
    const menu = MAIN.slice(MAIN.indexOf('function onOpen'), MAIN.indexOf('/** Preparar planilha'));
    // Fora do fluxo mensal: é correção posterior, não etapa do ciclo.
    assert.ok(menu.indexOf('Fechar mês') < menu.indexOf('Reclassificar movimentação'));
    assert.ok(menu.indexOf('Reclassificar movimentação') < menu.indexOf('Abrir entrada'));
  });

  it('existe como função global no arquivo empacotado', { scenario: 'C46' }, () => {
    const contexto = vm.createContext({});
    vm.runInContext(fs.readFileSync(DESTINO, 'utf8'), contexto, { filename: 'financeos.gs' });
    assert.equal(typeof contexto.fosReclassificarMovimentacao, 'function');
  });

  it('escreve só por reclassificarLinha e não toca na fila', { scenario: 'C40' }, () => {
    const comando = MAIN.slice(
      MAIN.indexOf('function fosReclassificarMovimentacao'),
      MAIN.indexOf('/** Registrar evento')
    );
    assert.includes(comando, 'amb.workflows.reclassificarLinha(');
    ['resolverItemFila', 'classificarPendente', 'conciliarManualmente', 'substituir', 'anexar']
      .forEach((proibido) => {
        assert.equal(comando.indexOf(proibido), -1,
          'o comando não pode chamar ' + proibido + ': a fila resolvida fica intocada');
      });
    assert.equal((comando.match(/amb\.workflows\.\w+\(/g) || [])
      .filter((c) => c.indexOf('reclassificarLinha') === -1 && c.indexOf('competenciasFechadas') === -1).length,
    0, 'nenhuma outra escrita pode acontecer no comando');
  });

  it('pede referência, categoria e motivo, e exige o motivo', { scenario: 'C40' }, () => {
    const comando = MAIN.slice(
      MAIN.indexOf('function fosReclassificarMovimentacao'),
      MAIN.indexOf('/** Registrar evento')
    );
    assert.includes(comando, '(1 de 3)');
    assert.includes(comando, '(2 de 3)');
    assert.includes(comando, '(3 de 3)');
    assert.includes(comando, 'coluna "referencia" da aba MOVIMENTAÇÕES');
    assert.includes(comando, 'FOS.Constants.values(FOS.Constants.CATEGORIA)');
    assert.includes(comando, 'exige um motivo explícito');
    assert.includes(comando, "ator: 'USUARIO'");
  });

  it('mostra apenas movimentações de competência aberta', { scenario: 'C41' }, () => {
    const comando = MAIN.slice(
      MAIN.indexOf('function fosReclassificarMovimentacao'),
      MAIN.indexOf('/** Registrar evento')
    );
    assert.includes(comando, 'competenciasFechadas()');
    assert.includes(comando, 'Nenhuma movimentação em competência aberta');
    assert.includes(comando, 'restatement');
  });

  it('apresenta a recusa em vez de quebrar', { scenario: 'C40' }, () => {
    const comando = MAIN.slice(
      MAIN.indexOf('function fosReclassificarMovimentacao'),
      MAIN.indexOf('/** Registrar evento')
    );
    assert.includes(comando, 'catch (e)');
    assert.includes(comando, "'Não foi possível reclassificar'");
  });
});

describe('CUSTO_VIDA para TRANSFERENCIA_INTERNA em competência aberta', () => {
  it('cria nova versão e preserva a anterior', { scenario: 'C40' }, () => {
    const ctx = workbookComoEmProducao();
    const antes = linhaPorValor(ctx, 99.9);
    assert.equal(antes.categoria, C.CATEGORIA.CUSTO_VIDA);
    assert.equal(Number(antes.versao_gerencial), 1);

    const r = ctx.workflows.reclassificarLinha({
      referencia: antes.fingerprint,
      categoria: 'TRANSFERENCIA_INTERNA',
      motivo: 'Resgate da poupança, não custo de vida',
      ator: 'USUARIO'
    });

    assert.ok(r.alterado);
    assert.equal(Number(r.linha.versao_gerencial), 2);
    assert.equal(r.linha.categoria, C.CATEGORIA.TRANSFERENCIA_INTERNA);
    assert.equal(r.linha.universo, C.UNIVERSO.VIDA);

    // A versão 1 continua no ledger, intacta.
    const todas = ctx.repositorio.ledger().filter((l) => l.fingerprint === antes.fingerprint);
    assert.equal(todas.length, 2, 'append-only: a versão anterior não pode sumir');
    const v1 = todas.filter((l) => Number(l.versao_gerencial) === 1)[0];
    assert.equal(v1.categoria, C.CATEGORIA.CUSTO_VIDA);
    assert.equal(v1.valor_origem, 99.9);
    assert.equal(v1.data_origem, '2026-09-01');
    assert.ok(FOS.Invariants.ledgerAppendOnly(ctx.repositorio.ledger()).ok);
  });

  it('preserva a origem imutável na nova versão', { scenario: 'C40' }, () => {
    const ctx = workbookComoEmProducao();
    const antes = linhaPorValor(ctx, 99.9);
    const r = ctx.workflows.reclassificarLinha({
      referencia: antes.fingerprint, categoria: 'TRANSFERENCIA_INTERNA', motivo: 'Resgate da poupança'
    });
    FOS.Ledger.CAMPOS_ORIGEM.forEach((campo) => {
      assert.equal(String(r.linha[campo]), String(antes[campo]), 'origem alterada em ' + campo);
    });
  });

  it('não toca no item já resolvido da fila', { scenario: 'C40' }, () => {
    const ctx = workbookComoEmProducao();
    const filaAntes = FOS.Core.canonicalJson(ctx.repositorio.fila());
    const antes = linhaPorValor(ctx, 99.9);

    ctx.workflows.reclassificarLinha({
      referencia: antes.fingerprint, categoria: 'TRANSFERENCIA_INTERNA', motivo: 'Resgate da poupança'
    });

    assert.equal(FOS.Core.canonicalJson(ctx.repositorio.fila()), filaAntes,
      'a fila não pode ser reaberta, editada nem apagada');
    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 0);
    ctx.repositorio.fila().forEach((i) => assert.equal(i.status, C.STATUS_FILA.RESOLVIDO));
  });

  it('a outra linha de 99,90 continua CUSTO_VIDA', { scenario: 'C40' }, () => {
    const ctx = workbookComoEmProducao();
    const credito = linhaPorValor(ctx, 99.9);
    ctx.workflows.reclassificarLinha({
      referencia: credito.fingerprint, categoria: 'TRANSFERENCIA_INTERNA', motivo: 'Resgate da poupança'
    });
    const debito = linhaPorValor(ctx, -99.9);
    assert.equal(debito.categoria, C.CATEGORIA.CUSTO_VIDA, 'a assinatura pessoal continua custo de vida');
    assert.equal(Number(debito.versao_gerencial), 1, 'linha não envolvida não ganha versão');
  });

  it('aceita o prefixo mostrado na aba MOVIMENTAÇÕES', { scenario: 'C40' }, () => {
    const ctx = workbookComoEmProducao();
    const antes = linhaPorValor(ctx, 99.9);
    const prefixo = String(antes.fingerprint).slice(0, 12);
    const r = ctx.workflows.reclassificarLinha({
      referencia: prefixo, categoria: 'TRANSFERENCIA_INTERNA', motivo: 'Resgate da poupança'
    });
    assert.ok(r.alterado);
    assert.equal(r.linha.fingerprint, antes.fingerprint);
  });

  it('registra antes e depois no log de auditoria', { scenario: 'C36' }, () => {
    const ctx = workbookComoEmProducao();
    const antes = linhaPorValor(ctx, 99.9);
    ctx.workflows.reclassificarLinha({
      referencia: antes.fingerprint,
      categoria: 'TRANSFERENCIA_INTERNA',
      motivo: 'Resgate da poupança, não custo de vida',
      ator: 'USUARIO'
    });
    const log = ctx.repositorio.log().filter((l) => l.acao === 'RECLASSIFICAR_LINHA')[0];
    assert.ok(log, 'a reclassificação precisa aparecer na aba 90');
    assert.equal(log.resultado, 'OK');
    assert.equal(log.ator, 'USUARIO');
    assert.includes(log.antes, 'CUSTO_VIDA');
    assert.includes(log.depois, 'TRANSFERENCIA_INTERNA');
    assert.includes(log.detalhe, 'Resgate da poupança');
  });

  it('reclassificar para a mesma categoria é idempotente', { scenario: 'C40' }, () => {
    const ctx = workbookComoEmProducao();
    const antes = linhaPorValor(ctx, 99.9);
    ctx.workflows.reclassificarLinha({
      referencia: antes.fingerprint, categoria: 'TRANSFERENCIA_INTERNA', motivo: 'Resgate'
    });
    const linhasApos = ctx.repositorio.ledger().length;
    const segunda = ctx.workflows.reclassificarLinha({
      referencia: antes.fingerprint, categoria: 'TRANSFERENCIA_INTERNA', motivo: 'Resgate de novo'
    });
    assert.notOk(segunda.alterado);
    assert.equal(ctx.repositorio.ledger().length, linhasApos, 'nenhuma versão nova sem mudança real');
  });
});

describe('Proteções ao reclassificar', () => {
  it('recusa categoria fora do catálogo', { scenario: 'C40' }, () => {
    const ctx = workbookComoEmProducao();
    const antes = linhaPorValor(ctx, 99.9);
    assert.throws(() => ctx.workflows.reclassificarLinha({
      referencia: antes.fingerprint, categoria: 'POUPANCA', motivo: 'x'
    }), 'CATEGORIA_NAO_CANONICA');
  });

  it('recusa referência inexistente', { scenario: 'C40' }, () => {
    const ctx = workbookComoEmProducao();
    assert.throws(() => ctx.workflows.reclassificarLinha({
      referencia: 'naoexiste123', categoria: 'TRANSFERENCIA_INTERNA', motivo: 'x'
    }), 'LINHA_INEXISTENTE');
  });

  it('recusa referência ambígua', { scenario: 'C40' }, () => {
    const ctx = workbookComoEmProducao();
    // Prefixo vazio casaria com mais de uma linha; o workflow recusa em vez
    // de escolher por conta própria.
    const erro = assert.throws(() => ctx.workflows.reclassificarLinha({
      referencia: '   ', categoria: 'TRANSFERENCIA_INTERNA', motivo: 'x'
    }));
    assert.includes(String(erro.code), 'OBRIGATORIA');
  });

  it('recusa competência já fechada', { scenario: 'C41' }, () => {
    const ctx = dataset.workbookComMovimento();
    ctx.workflows.materializarEventos();
    ctx.workflows.fecharCompetencia('2026-01');
    const linha = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
      .filter((l) => String(l.data_origem).indexOf('2026-01') === 0)[0];
    assert.throws(() => ctx.workflows.reclassificarLinha({
      referencia: linha.fingerprint, categoria: 'TRANSFERENCIA_INTERNA', motivo: 'x'
    }), 'PERIODO_FECHADO');
  });
});
