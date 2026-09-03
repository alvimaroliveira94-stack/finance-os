'use strict';
/**
 * Ligação entre o modelo canônico e as superfícies de leitura.
 * Os testes estruturais do HTML ficam em test/ui/; aqui verificamos que o
 * caminho completo (workflows -> painel -> abas visíveis) entrega dado real,
 * e que os pontos de entrada do Apps Script não expõem nada mutável.
 */
const { describe, it, assert } = globalThis.__fosTest;
const fs = require('fs');
const path = require('path');
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');

const C = FOS.Constants;
const V = C.ABAS_VISIVEIS;
const MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');

function workbookCompleto() {
  const ctx = dataset.workbookComMovimento({ agora: '2026-03-05T12:00:00Z' });
  ctx.workflows.materializarEventos();
  ctx.workflows.fecharCompetencia('2026-01');
  ctx.workflows.fecharCompetencia('2026-02');
  return ctx;
}

describe('Do fechamento às superfícies', () => {
  it('o painel entrega o contrato estável que o dashboard consome', { scenario: 'C34' }, () => {
    const ctx = workbookCompleto();
    const painel = ctx.workflows.painel('2026-02', { agora: '2026-03-05' });
    assert.equal(painel.atual.status, 'OK');
    assert.deep(Object.keys(painel.atual.dados).sort(), [
      'acoes', 'cambio', 'competencia', 'estado', 'estado_ciclo', 'fechado_em',
      'gerado_em', 'moeda_gerencial', 'objetivos', 'passivos', 'patrimonio', 'provisoes',
      'qualidade', 'sinais', 'somente_leitura', 'trading', 'vida'
    ]);
  });

  it('as quatro abas refletem o mesmo fechamento do painel', { scenario: 'C46' }, () => {
    const ctx = workbookCompleto();
    const r = ctx.workflows.atualizarSuperficies('2026-02', { agora: '2026-03-05' });
    const home = ctx.repositorio.planilha.lerTabela(V.HOME);
    const competencia = home.filter((l) => l.indicador === 'Competência')[0];
    assert.equal(competencia.valor, '2026-02');

    const caixaHome = home.filter((l) => l.indicador === 'Caixa de vida')[0];
    assert.equal(Number(caixaHome.valor), r.painel.atual.dados.vida.caixa_vida_brl.value);

    const planejamento = ctx.repositorio.planilha.lerTabela(V.PLANEJAMENTO);
    assert.ok(planejamento.filter((l) => l.bloco === 'PROVISAO').length >= 1);
    const patrimonio = ctx.repositorio.planilha.lerTabela(V.PATRIMONIO);
    assert.ok(patrimonio.filter((l) => l.bloco === 'POSICAO').length >= 1);
  });

  it('as quatro métricas de trading chegam separadas por moeda na HOME', { scenario: 'C13' }, () => {
    const ctx = workbookCompleto();
    ctx.workflows.atualizarSuperficies('2026-02', { agora: '2026-03-05' });
    const trading = ctx.repositorio.planilha.lerTabela(V.HOME)
      .filter((l) => l.secao === 'TRADING');
    const porUnidade = {};
    trading.forEach((l) => { if (l.unidade) porUnidade[l.indicador] = l.unidade; });
    assert.equal(porUnidade['P&L operacional'], 'GBP');
    assert.equal(porUnidade['Caixa retirado'], 'BRL');
    assert.equal(porUnidade['Custo operacional'], 'BRL');
    assert.ok(trading.some((l) => String(l.valor).indexOf('não somáveis') !== -1));
  });

  it('pendência resolvida entra no caixa e libera o fechamento', { scenario: 'C40' }, () => {
    const ctx = dataset.montarWorkbook();
    ctx.workflows.importarExtrato({
      contaId: 'INTER_CC',
      nomeArquivo: 'janeiro.csv',
      conteudo: [
        'data;descricao;valor',
        '05/01/2026;ALUGUEL JANEIRO;-2500,00',
        '12/01/2026;LOJA DESCONHECIDA XPTO;-430,00',
        '15/01/2026;TRANSFERENCIA RECEBIDA WISE;6000,00'
      ].join('\n')
    });
    ctx.workflows.conciliarEventos();

    const bloqueado = ctx.workflows.revisarCompetencia('2026-01');
    assert.notOk(bloqueado.validacao.ok);
    assert.includes(bloqueado.validacao.violacoes.map((v) => v.codigo), 'FILA_REVISAO_VAZIA');

    const item = FOS.Queue.abertos(ctx.repositorio.fila())[0];
    ctx.workflows.resolverItemFila({
      item_id: item.item_id, decisao: 'CLASSIFICAR', categoria: 'CUSTO_VIDA', ator: 'USUARIO'
    });

    const fechado = ctx.workflows.fecharCompetencia('2026-01');
    assert.ok(fechado.validacao.ok, JSON.stringify(fechado.validacao.violacoes));
    // 10000 inicial + 6000 - 2500 - 430
    assert.equal(fechado.snapshot.vida.caixa_vida_brl.value, 13070);
  });
});

describe('Pontos de entrada do Apps Script', () => {
  it('o menu usa linguagem humana e ações explícitas', { scenario: 'C46' }, () => {
    ['Preparar planilha', 'Importar extrato', 'Revisar pendências',
      'Registrar evento', 'Fechar mês', 'Abrir painel'].forEach((item) => {
      assert.includes(MAIN, "addItem('" + item + "'", 'menu sem item: ' + item);
    });
  });

  it('o painel abre dentro da planilha, sem publicar web app', { scenario: 'C48' }, () => {
    assert.includes(MAIN, 'showModalDialog');
    assert.equal(MAIN.indexOf('setSandboxMode'), -1);
    const manifesto = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'appsscript.json'), 'utf8'
    ));
    assert.notOk(Object.prototype.hasOwnProperty.call(manifesto, 'webapp'),
      'o manifesto não pode declarar web app nesta entrega');
  });

  it('doGet só responde ao dono e nega o resto sem vazar dado', { scenario: 'C48' }, () => {
    const doGet = MAIN.slice(MAIN.indexOf('function doGet'));
    assert.includes(doGet, 'Session.getEffectiveUser');
    assert.includes(doGet, 'Session.getActiveUser');
    assert.includes(doGet, 'efetivo === ativo');
    const negado = doGet.slice(0, doGet.indexOf('_fosAmbiente()'));
    assert.includes(negado, 'Acesso negado');
    assert.ok(doGet.indexOf('Acesso negado') < doGet.indexOf('_fosAmbiente()'),
      'a verificação precisa vir antes de qualquer leitura de dado');
  });

  it('nenhuma função exposta escreve a partir do navegador', { scenario: 'C48' }, () => {
    const globais = (MAIN.match(/^function (\w+)/gm) || []).map((f) => f.replace('function ', ''));
    const publicas = globais.filter((g) => g.indexOf('_') !== 0);
    // Tudo o que é público é acionado pelo menu da planilha ou é o doGet.
    publicas.forEach((nome) => {
      assert.ok(nome === 'onOpen' || nome === 'doGet' || nome.indexOf('fos') === 0,
        'função global inesperada: ' + nome);
    });
    assert.equal(MAIN.indexOf('google.script.run'), -1);
  });

  it('o payload é injetado no HTML, sem endpoint de leitura exposto', { scenario: 'C47' }, () => {
    assert.includes(MAIN, "html.replace('/*__PAINEL__*/null', json)");
    assert.includes(MAIN, ".replace(/</g, '\\\\u003c')");
  });
});
