'use strict';
/**
 * Regressões da auditoria adversarial.
 * Cada teste aqui corresponde a uma falha real encontrada ao simular o
 * caminho de produção — não ao caminho conveniente dos outros testes.
 */
const { describe, it, assert } = globalThis.__fosTest;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');
const { urlFetchFake } = require('../fixtures/fakes');
const { DESTINO } = require('../../tools/build');

const A = FOS.Constants.ABAS_INTERNAS;

/** Workflows como main.js os monta: sem provedor de taxa injetado. */
function workflowsDeProducao(ctx, urlFetchApp) {
  return FOS.App.criarWorkflows({
    repositorio: ctx.repositorio,
    relogio: ctx.relogio,
    ator: 'APPS_SCRIPT',
    auditoria: ctx.auditoria,
    urlFetchApp: urlFetchApp || null
  });
}

function comCacheDeTaxa(ctx, pares) {
  ctx.repositorio.anexar(A.CONFIG, pares.map(([data, taxa]) => FOS.Fx.linhaDeCache(
    'GBP', 'BRL', data, taxa, 'PTAX', '2026-02-01T00:00:00Z'
  )));
}

describe('Taxa de câmbio no caminho de produção', () => {
  it('o fechamento lê a taxa materializada na aba 00', { scenario: 'C45' }, () => {
    // Regressão: montarContexto usava um provedor manual vazio quando nenhum
    // provedor era injetado, então em produção nenhum mês fechava — mesmo com
    // a taxa gravada no cache.
    const ctx = dataset.montarWorkbook({ taxas: [] });
    comCacheDeTaxa(ctx, [['2025-12-31', 6.2], ['2026-01-31', 6.3]]);
    const workflows = workflowsDeProducao(ctx);
    workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'janeiro.csv', conteudo: dataset.CSV_JANEIRO
    });
    workflows.conciliarEventos();

    const r = workflows.fecharCompetencia('2026-01');
    assert.ok(r.validacao.ok, JSON.stringify(r.validacao.violacoes));
    assert.equal(r.snapshot.cambio.taxa, 6.3);
    assert.equal(r.snapshot.cambio.efeito_cambial_brl.value, 700);
  });

  it('sem taxa no cache o fechamento continua bloqueado com motivo', { scenario: 'C45' }, () => {
    const ctx = dataset.montarWorkbook({ taxas: [] });
    const workflows = workflowsDeProducao(ctx);
    workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'janeiro.csv', conteudo: dataset.CSV_JANEIRO
    });
    workflows.conciliarEventos();
    const r = workflows.fecharCompetencia('2026-01');
    assert.notOk(r.validacao.ok);
    assert.includes(r.validacao.violacoes.map((v) => v.codigo), 'TAXA_CAMBIAL_DISPONIVEL');
    assert.isNull(r.snapshot.cambio.taxa);
    assert.includes(r.snapshot.cambio.reason, 'TAXA_INDISPONIVEL');
  });

  it('fechar não faz rede, mesmo com política HTTP configurada', { scenario: 'C45' }, () => {
    const ctx = dataset.montarWorkbook({ taxas: [] });
    ctx.repositorio.substituir(A.CONFIG, ctx.repositorio.configLinhas().map((r) => {
      if (r.chave === 'POLITICA_TAXA_CAMBIO') return Object.assign({}, r, { valor: 'HTTP' });
      if (r.chave === 'URL_PROVEDOR_TAXA_CAMBIO') {
        return Object.assign({}, r, { status: 'ATIVO', reason: '', valor: 'https://exemplo.invalido/{data}' });
      }
      return r;
    }));
    comCacheDeTaxa(ctx, [['2025-12-31', 6.2], ['2026-01-31', 6.3]]);

    const fetch = urlFetchFake({});
    const workflows = workflowsDeProducao(ctx, fetch);
    workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'janeiro.csv', conteudo: dataset.CSV_JANEIRO
    });
    workflows.conciliarEventos();
    const r = workflows.fecharCompetencia('2026-01');

    assert.ok(r.validacao.ok);
    assert.equal(fetch.chamadas.length, 0,
      'o fechamento precisa ser offline e determinístico: quem busca cotação é atualizarCacheTaxas');
  });

  it('reprocessar um mês usa a taxa da época, não a mais recente', { scenario: 'C45' }, () => {
    const ctx = dataset.montarWorkbook({ taxas: [] });
    comCacheDeTaxa(ctx, [['2025-12-31', 6.2], ['2026-01-31', 6.3], ['2026-02-28', 9.9]]);
    const workflows = workflowsDeProducao(ctx);
    workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'janeiro.csv', conteudo: dataset.CSV_JANEIRO
    });
    workflows.conciliarEventos();
    workflows.fecharCompetencia('2026-01');
    const vigente = FOS.Restatement.versaoVigente(ctx.repositorio.fechamentos(), '2026-01');
    assert.equal(JSON.parse(vigente.snapshot_json).cambio.taxa, 6.3);
  });
});

describe('Ordem temporal dos fechamentos', () => {
  it('recusa fechar um mês deixando mês anterior com movimento em aberto', { scenario: 'C41' }, () => {
    // Regressão: fechar fora de ordem produzia dois fechamentos com movimento
    // INICIAL, esvaziando o sentido de "fechamentos consecutivos" do estado.
    const ctx = dataset.workbookComMovimento();
    ctx.workflows.materializarEventos();
    const erro = assert.throws(() => ctx.workflows.fecharCompetencia('2026-02'),
      'COMPETENCIA_ANTERIOR_EM_ABERTO');
    assert.includes(erro.message, '2026-01');
    assert.equal(ctx.repositorio.fechamentos().length, 0, 'nada pode ser gravado');
  });

  it('em ordem, o segundo fechamento enxerga o primeiro como histórico', { scenario: 'C41' }, () => {
    const ctx = dataset.workbookComMovimento();
    ctx.workflows.materializarEventos();
    assert.ok(ctx.workflows.fecharCompetencia('2026-01').validacao.ok);
    const fev = ctx.workflows.fecharCompetencia('2026-02');
    assert.ok(fev.validacao.ok, JSON.stringify(fev.validacao.violacoes));
    assert.notEqual(fev.snapshot.estado_ciclo.movimento, 'INICIAL',
      'com histórico, o movimento deixa de ser INICIAL');
  });

  it('histórico anterior ao início configurado não bloqueia para sempre', { scenario: 'C41' }, () => {
    // Extrato antigo importado antes de COMPETENCIA_INICIAL_CAIXA_VIDA não
    // pode travar o primeiro fechamento de quem começou a usar depois.
    const ctx = dataset.montarWorkbook();
    ctx.workflows.importarExtrato({
      contaId: 'INTER_CC',
      nomeArquivo: 'dezembro-2025.csv',
      conteudo: ['data;descricao;valor', '10/12/2025;ALUGUEL DEZEMBRO;-2500,00'].join('\n')
    });
    ctx.workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'janeiro.csv', conteudo: dataset.CSV_JANEIRO
    });
    ctx.workflows.conciliarEventos();
    assert.deep(ctx.workflows.competenciasAnterioresEmAberto('2026-01'), [],
      'dezembro/2025 está antes da competência inicial configurada');
    assert.ok(ctx.workflows.fecharCompetencia('2026-01').validacao.ok);
  });
});

describe('Projeção não corrompe a origem', () => {
  it('regenerar as abas visíveis não altera nenhuma aba interna', { scenario: 'C46' }, () => {
    const ctx = dataset.workbookComMovimento({ agora: '2026-03-05T12:00:00Z' });
    ctx.workflows.materializarEventos();
    ctx.workflows.fecharCompetencia('2026-01');

    const internas = FOS.Schema.nomes().filter((n) => n !== A.LOG);
    const antes = {};
    internas.forEach((aba) => { antes[aba] = FOS.Core.canonicalJson(ctx.planilha.lerTabela(aba)); });

    ctx.workflows.atualizarSuperficies('2026-01', { agora: '2026-02-05' });
    ctx.workflows.atualizarSuperficies('2026-01', { agora: '2026-02-05' });

    internas.forEach((aba) => {
      assert.equal(FOS.Core.canonicalJson(ctx.planilha.lerTabela(aba)), antes[aba],
        'a projeção não pode tocar a aba interna ' + aba);
    });
  });

  it('substituir tabela escreve a partir da linha 2, sem buraco', { scenario: 'C46' }, () => {
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'adapters', 'spreadsheet.js'), 'utf8'
    );
    const trecho = fonte.slice(fonte.indexOf('substituirTabela: function'));
    assert.includes(trecho, 'sheet.getRange(2, 1, linhas.length, headers.length).setValues(linhas)',
      'não pode depender de getLastRow() logo após clearContent()');
    assert.equal(trecho.indexOf('this.anexarLinhas'), -1);
  });
});

describe('Painel: autorização fail-closed', () => {
  function contextoDoBundle(stubs) {
    const contexto = vm.createContext(Object.assign({ console: console }, stubs));
    vm.runInContext(fs.readFileSync(DESTINO, 'utf8'), contexto, { filename: 'financeos.gs' });
    return contexto;
  }

  function stubsBase(emailAtivo, emailEfetivo) {
    const saida = { html: null, titulo: null };
    return {
      saida: saida,
      stubs: {
        Session: {
          getActiveUser: () => ({ getEmail: () => emailAtivo }),
          getEffectiveUser: () => ({ getEmail: () => emailEfetivo })
        },
        HtmlService: {
          createHtmlOutput: (html) => {
            saida.html = html;
            return { setTitle: (t) => { saida.titulo = t; return { setXFrameOptionsMode: () => saida }; } };
          },
          createHtmlOutputFromFile: () => ({ getContent: () => '<!DOCTYPE html>__PAINEL__' }),
          XFrameOptionsMode: { DEFAULT: 'DEFAULT' }
        },
        SpreadsheetApp: {
          getActiveSpreadsheet: () => {
            throw new Error('ACESSO_A_DADOS_NAO_DEVERIA_ACONTECER');
          }
        }
      }
    };
  }

  it('nega quando a identidade não está disponível, sem tocar na planilha', { scenario: 'C48' }, () => {
    const { saida, stubs } = stubsBase('', '');
    const contexto = contextoDoBundle(stubs);
    contexto.doGet();
    assert.includes(saida.html, 'Acesso negado');
    assert.includes(saida.html, 'USUARIO_NAO_AUTORIZADO');
    assert.equal(saida.html.indexOf('__PAINEL__'), -1, 'não pode renderizar o painel');
  });

  it('nega quando o usuário ativo é diferente do dono', { scenario: 'C48' }, () => {
    const { saida, stubs } = stubsBase('outra.pessoa@exemplo.invalido', 'dono@exemplo.invalido');
    const contexto = contextoDoBundle(stubs);
    contexto.doGet();
    assert.includes(saida.html, 'Acesso negado');
    assert.equal(saida.html.indexOf('__PAINEL__'), -1);
  });

  it('nega quando Session lança (escopo ausente)', { scenario: 'C48' }, () => {
    const { saida, stubs } = stubsBase('', '');
    stubs.Session.getEffectiveUser = () => { throw new Error('sem escopo'); };
    const contexto = contextoDoBundle(stubs);
    contexto.doGet();
    assert.includes(saida.html, 'Acesso negado');
    assert.includes(saida.html, 'IDENTIDADE_INDISPONIVEL');
  });

  it('o painel não expõe função que escreva no navegador', { scenario: 'C48' }, () => {
    const contexto = contextoDoBundle(stubsBase('dono@exemplo.invalido', 'dono@exemplo.invalido').stubs);
    const globais = Object.keys(contexto).filter((k) => typeof contexto[k] === 'function');
    const escritoras = globais.filter((nome) => /salvar|gravar|escrever|apagar|deletar|excluir/i.test(nome));
    assert.deep(escritoras, [], 'função com nome de escrita exposta no escopo global');
  });
});
