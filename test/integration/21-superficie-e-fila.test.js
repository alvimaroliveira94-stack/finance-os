'use strict';
/**
 * Superfície final e abstração da fila de revisão.
 *
 * Duas coisas que andam juntas:
 *
 * 1. A superfície permanente passa a ser só HOME, MOVIMENTAÇÕES, PLANEJAMENTO
 *    e PATRIMÔNIO. Toda aba interna fica oculta — inclusive as três de
 *    digitação, que o menu reexibe sob demanda.
 *
 * 2. Para isso ser possível, "Revisar pendências" precisou passar a abstrair
 *    a aba 21 por inteiro. O defeito real: o comando mandava sempre
 *    decisao=CLASSIFICAR e usava item.referencia como fingerprint de linha.
 *    Num item de origem CONCILIACAO a referência é um evento_id, então a
 *    resolução falhava com LINHA_INEXISTENTE e o item ficava ABERTO — e item
 *    aberto viola FILA_REVISAO_VAZIA, ou seja, o mês não fecha. Ocultar a aba
 *    nesse estado seria um beco sem saída.
 */
const { describe, it, assert } = globalThis.__fosTest;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');
const { DESTINO } = require('../../tools/build');

const C = FOS.Constants;
const A = C.ABAS_INTERNAS;
const V = C.ABAS_VISIVEIS;
const B = FOS.App.Bootstrap;
const MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');

/** Extrato com duas linhas idênticas: força ambiguidade de conciliação. */
const CSV_AMBIGUO = [
  'data;descricao;valor',
  '10/01/2026;DESPESA MEDICA CLINICA;-1500,00',
  '11/01/2026;DESPESA MEDICA EXAME;-1500,00'
].join('\n');

/** Extrato com uma linha que nenhuma regra classifica. */
const CSV_SEM_REGRA = [
  'data;descricao;valor',
  '05/01/2026;LOJA DESCONHECIDA XPTO;-430,00'
].join('\n');

function producao(ctx) {
  return FOS.App.criarWorkflows({
    repositorio: ctx.repositorio,
    relogio: ctx.relogio,
    ator: 'APPS_SCRIPT',
    auditoria: ctx.auditoria
  });
}

/** Workbook com um item de fila de origem CONCILIACAO (ambiguidade real). */
function comAmbiguidade() {
  const ctx = dataset.montarWorkbook({ comDados: false });
  const workflows = producao(ctx);
  ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
    evento_id: 'EV-AMB',
    tipo_evento: 'GASTO_EXTRAORDINARIO',
    data: '2026-01-10',
    conta_origem: 'INTER_CC',
    valor: 1500,
    moeda: 'BRL',
    descricao: 'consulta particular'
  })]);
  workflows.importarExtrato({ contaId: 'INTER_CC', nomeArquivo: 'jan.csv', conteudo: CSV_AMBIGUO });
  workflows.conciliarEventos();
  return { ctx, workflows };
}

/** Workbook com um item de fila de origem CLASSIFICACAO. */
function semRegra() {
  const ctx = dataset.montarWorkbook({ comDados: false });
  const workflows = producao(ctx);
  workflows.importarExtrato({ contaId: 'INTER_CC', nomeArquivo: 'jan.csv', conteudo: CSV_SEM_REGRA });
  return { ctx, workflows };
}

function contexto(ctx) {
  return {
    linhas: FOS.Ledger.visaoCorrente(ctx.repositorio.ledger()),
    staging: ctx.repositorio.staging(),
    eventos: ctx.repositorio.eventos()
  };
}

function pendenteDe(ctx, origem) {
  const item = FOS.Queue.abertos(ctx.repositorio.fila())
    .filter((i) => i.origem === origem)[0];
  assert.ok(item, 'esperado item de fila de origem ' + origem);
  return FOS.Queue.decisaoPendente(item, contexto(ctx));
}

describe('Fila: item de classificação', () => {
  it('a pergunta é a categoria, com a movimentação legível', { scenario: 'C52' }, () => {
    const { ctx } = semRegra();
    const p = pendenteDe(ctx, 'CLASSIFICACAO');

    assert.equal(p.tipo, 'CATEGORIA');
    assert.equal(p.motivo, 'SEM_REGRA_APLICAVEL');
    assert.ok(p.movimentacao, 'a movimentação precisa ser encontrada no staging');
    assert.equal(p.movimentacao.data, '2026-01-05');
    assert.equal(p.movimentacao.valor, -430);
    assert.includes(p.movimentacao.descricao, 'LOJA DESCONHECIDA');
    assert.equal(p.movimentacao.conta, 'INTER_CC');
    assert.deep(p.opcoes, C.values(C.CATEGORIA));
  });

  it('a resposta vira decisão CLASSIFICAR e resolve o item', { scenario: 'C52' }, () => {
    const { ctx, workflows } = semRegra();
    const p = pendenteDe(ctx, 'CLASSIFICACAO');
    const leitura = FOS.Queue.interpretarResposta(p, 'custo_vida');

    assert.ok(leitura.ok);
    assert.deep(leitura.params, { item_id: p.item_id, decisao: 'CLASSIFICAR', categoria: 'CUSTO_VIDA' });

    workflows.resolverItemFila(Object.assign({ ator: 'USUARIO' }, leitura.params));
    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 0);
    const linha = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())[0];
    assert.equal(linha.categoria, 'CUSTO_VIDA');
  });

  it('categoria fora do catálogo é recusada e nada é resolvido', { scenario: 'C52' }, () => {
    const { ctx } = semRegra();
    const p = pendenteDe(ctx, 'CLASSIFICACAO');
    const leitura = FOS.Queue.interpretarResposta(p, 'CUSTO DE VIDA');
    assert.notOk(leitura.ok);
    assert.includes(leitura.erro, 'CATEGORIA_NAO_CANONICA');
    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 1);
  });
});

describe('Fila: conciliação ambígua', () => {
  it('a pergunta é qual candidata, listada de forma humana', { scenario: 'C52' }, () => {
    const { ctx } = comAmbiguidade();
    const p = pendenteDe(ctx, 'CONCILIACAO');

    assert.equal(p.tipo, 'CANDIDATA');
    assert.equal(p.motivo, 'AMBIGUIDADE_CONCILIACAO');
    assert.equal(p.referencia, 'EV-AMB');
    assert.ok(p.evento, 'o evento precisa ser identificado');
    assert.equal(p.evento.tipo_evento, 'GASTO_EXTRAORDINARIO');
    assert.equal(p.evento.valor, 1500);

    assert.equal(p.candidatos.length, 2);
    p.candidatos.forEach((c, i) => {
      assert.equal(c.indice, i + 1);
      assert.ok(c.fingerprint, 'candidata precisa de fingerprint');
      assert.ok(c.data, 'candidata precisa de data');
      assert.equal(c.valor, -1500);
      assert.ok(c.descricao, 'a descrição vem do ledger: é o que torna a escolha humana');
    });
    assert.notEqual(p.candidatos[0].fingerprint, p.candidatos[1].fingerprint);
  });

  it('escolher pelo número usa o fingerprint da candidata, nunca a referência',
    { scenario: 'C52' }, () => {
      const { ctx } = comAmbiguidade();
      const p = pendenteDe(ctx, 'CONCILIACAO');
      const leitura = FOS.Queue.interpretarResposta(p, '2');

      assert.ok(leitura.ok);
      assert.equal(leitura.params.decisao, 'CONCILIAR');
      assert.equal(leitura.params.fingerprint, p.candidatos[1].fingerprint);
      assert.notEqual(leitura.params.fingerprint, p.referencia,
        'o evento_id jamais pode ser usado como fingerprint de linha');
    });

  it('conciliar de verdade marca a linha escolhida e esvazia a fila', { scenario: 'C52' }, () => {
    const { ctx, workflows } = comAmbiguidade();
    const p = pendenteDe(ctx, 'CONCILIACAO');
    const escolhida = p.candidatos[1];
    const leitura = FOS.Queue.interpretarResposta(p, '2');

    workflows.resolverItemFila(Object.assign({ ator: 'USUARIO' }, leitura.params));

    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 0);
    const conciliadas = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
      .filter((l) => l.evento_conciliado_id === 'EV-AMB');
    assert.equal(conciliadas.length, 1, 'exatamente uma linha conciliada');
    assert.equal(conciliadas[0].fingerprint, escolhida.fingerprint);
  });

  it('também aceita o fingerprint colado', { scenario: 'C52' }, () => {
    const { ctx } = comAmbiguidade();
    const p = pendenteDe(ctx, 'CONCILIACAO');
    assert.equal(
      FOS.Queue.interpretarResposta(p, p.candidatos[0].fingerprint).params.fingerprint,
      p.candidatos[0].fingerprint);
    assert.equal(
      FOS.Queue.interpretarResposta(p, p.candidatos[0].fingerprint.slice(0, 12)).params.fingerprint,
      p.candidatos[0].fingerprint);
  });

  it('número fora da lista é recusado sem resolver', { scenario: 'C52' }, () => {
    const { ctx } = comAmbiguidade();
    const p = pendenteDe(ctx, 'CONCILIACAO');
    ['9', '0', '-1', 'sim', ''].forEach((texto) => {
      const leitura = FOS.Queue.interpretarResposta(p, texto);
      assert.notOk(leitura.ok, 'resposta "' + texto + '" não pode ser aceita');
    });
    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 1);
  });

  it('o caminho antigo produziria o erro que travava o mês', { scenario: 'C52' }, () => {
    // Regressão: era isto que "Revisar pendências" fazia com todo item.
    const { ctx, workflows } = comAmbiguidade();
    const item = FOS.Queue.abertos(ctx.repositorio.fila())[0];
    assert.throws(() => workflows.resolverItemFila({
      item_id: item.item_id, decisao: 'CLASSIFICAR', categoria: 'GASTO_EXTRAORDINARIO', ator: 'USUARIO'
    }), 'LINHA_INEXISTENTE');
    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 1,
      'o item continuava aberto — e item aberto impede fechar o mês');
  });
});

describe('Fila: descartar e cancelar', () => {
  it('DESCARTAR resolve sem tocar no ledger', { scenario: 'C52' }, () => {
    const { ctx, workflows } = semRegra();
    const p = pendenteDe(ctx, 'CLASSIFICACAO');
    const antes = ctx.repositorio.ledger().length;
    const leitura = FOS.Queue.interpretarResposta(p, 'descartar');

    assert.ok(leitura.ok);
    assert.ok(leitura.descartado);
    assert.deep(leitura.params, { item_id: p.item_id, decisao: 'DESCARTAR' });

    workflows.resolverItemFila(Object.assign({ ator: 'USUARIO' }, leitura.params));
    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 0);
    assert.equal(ctx.repositorio.ledger().length, antes, 'descartar não escreve no ledger');
    const resolvido = ctx.repositorio.fila()[0];
    assert.equal(resolvido.resolucao, 'DESCARTAR');
    assert.equal(resolvido.resolvido_por, 'USUARIO');
  });

  it('DESCARTAR também funciona em item de conciliação', { scenario: 'C52' }, () => {
    const { ctx, workflows } = comAmbiguidade();
    const p = pendenteDe(ctx, 'CONCILIACAO');
    workflows.resolverItemFila(Object.assign({ ator: 'USUARIO' },
      FOS.Queue.interpretarResposta(p, 'DESCARTAR').params));
    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 0);
    assert.equal(FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
      .filter((l) => l.evento_conciliado_id).length, 0);
  });

  it('cancelar não produz parâmetros: resposta vazia é recusada', { scenario: 'C52' }, () => {
    // Cancelar no diálogo interrompe o laço antes de interpretar qualquer
    // resposta; resposta em branco no OK também não resolve nada.
    const { ctx } = semRegra();
    const p = pendenteDe(ctx, 'CLASSIFICACAO');
    const leitura = FOS.Queue.interpretarResposta(p, '   ');
    assert.notOk(leitura.ok);
    assert.equal(leitura.erro, 'RESPOSTA_VAZIA');
    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 1);
  });
});

describe('Fila: vários itens e fila vazia', () => {
  it('percorre itens de origens diferentes na mesma revisão', { scenario: 'C52' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const workflows = producao(ctx);
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EV-AMB', tipo_evento: 'GASTO_EXTRAORDINARIO', data: '2026-01-10',
      conta_origem: 'INTER_CC', valor: 1500, moeda: 'BRL', descricao: 'consulta'
    })]);
    workflows.importarExtrato({
      contaId: 'INTER_CC',
      nomeArquivo: 'jan.csv',
      conteudo: CSV_AMBIGUO + '\n05/01/2026;LOJA DESCONHECIDA XPTO;-430,00'
    });
    workflows.conciliarEventos();

    const abertos = FOS.Queue.abertos(ctx.repositorio.fila());
    assert.equal(abertos.length, 2);
    const origens = abertos.map((i) => i.origem).sort();
    assert.deep(origens, ['CLASSIFICACAO', 'CONCILIACAO']);

    // Resolve os dois como o comando faria: cada um com a pergunta certa.
    abertos.forEach((item) => {
      const p = FOS.Queue.decisaoPendente(item, contexto(ctx));
      const resposta = p.tipo === 'CANDIDATA' ? '1' : 'CUSTO_VIDA';
      const leitura = FOS.Queue.interpretarResposta(p, resposta);
      assert.ok(leitura.ok, 'item ' + item.item_id + ': ' + leitura.erro);
      workflows.resolverItemFila(Object.assign({ ator: 'USUARIO' }, leitura.params));
    });
    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 0);
  });

  it('sem pendência não há nada a perguntar', { scenario: 'C52' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 0);
  });

  it('resolver duas vezes o mesmo item é idempotente', { scenario: 'C52' }, () => {
    const { ctx, workflows } = semRegra();
    const p = pendenteDe(ctx, 'CLASSIFICACAO');
    const params = Object.assign({ ator: 'USUARIO' },
      FOS.Queue.interpretarResposta(p, 'CUSTO_VIDA').params);
    workflows.resolverItemFila(params);
    const r = workflows.resolverItemFila(params);
    assert.notOk(r.alterado, 'item já resolvido não é reaberto nem duplicado');
  });
});

describe('Superfície canônica', () => {
  it('só as quatro abas de leitura ficam visíveis', { scenario: 'C52' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    [V.HOME, V.MOVIMENTACOES, V.PLANEJAMENTO, V.PATRIMONIO].forEach((nome) => {
      assert.notOk(ctx.planilha.abaEstaOculta(nome), nome + ' deve estar visível');
    });
    C.values(A).forEach((nome) => {
      assert.ok(ctx.planilha.abaEstaOculta(nome), nome + ' deve estar oculta');
    });
    assert.equal(B.ABAS_INTERNAS_OCULTAS.length, 14, 'todas as internas, incluindo 33_PASSIVOS');
  });

  it('a fila de revisão não é ponto de entrada', { scenario: 'C52' }, () => {
    const entradas = Object.keys(B.ABAS_DE_ENTRADA).map((k) => B.ABAS_DE_ENTRADA[k]);
    assert.deep(entradas, [A.EVENTOS_MANUAIS, A.SALDOS_TRADING, A.CONFIG]);
    assert.equal(entradas.indexOf(A.FILA_REVISAO), -1);

    const ctx = dataset.montarWorkbook({ comDados: false });
    assert.throws(() => B.abrirEntrada(ctx.planilha, A.FILA_REVISAO), 'ABA_NAO_E_ENTRADA');
    assert.throws(() => B.abrirEntrada(ctx.planilha, A.LEDGER), 'ABA_NAO_E_ENTRADA');
    assert.ok(ctx.planilha.abaEstaOculta(A.FILA_REVISAO), 'e continua oculta');
  });

  it('abrir entrada reexibe, ativa e não toca em dado', { scenario: 'C52' }, () => {
    const ctx = dataset.montarWorkbook();
    const entradas = [A.EVENTOS_MANUAIS, A.SALDOS_TRADING, A.CONFIG];
    const antes = entradas.map((n) => ctx.planilha.lerTabela(n).length);

    entradas.forEach((nome, i) => {
      assert.ok(ctx.planilha.abaEstaOculta(nome), nome + ' começa oculta');
      B.abrirEntrada(ctx.planilha, nome);
      assert.notOk(ctx.planilha.abaEstaOculta(nome), nome + ' fica visível');
      assert.equal(ctx.planilha.abaAtiva(), nome, nome + ' fica ativa');
      assert.equal(ctx.planilha.lerTabela(nome).length, antes[i], 'nenhuma linha é tocada');
    });
  });

  it('"Atualizar abas" devolve a superfície canônica', { scenario: 'C52' }, () => {
    const ctx = dataset.workbookComMovimento();
    B.abrirEntrada(ctx.planilha, A.EVENTOS_MANUAIS);
    B.abrirEntrada(ctx.planilha, A.SALDOS_TRADING);
    assert.notOk(ctx.planilha.abaEstaOculta(A.EVENTOS_MANUAIS));

    const linhasAntes = ctx.planilha.lerTabela(A.EVENTOS_MANUAIS).length;
    ctx.workflows.atualizarSuperficies(null);

    assert.ok(ctx.planilha.abaEstaOculta(A.EVENTOS_MANUAIS), 'volta a ficar oculta');
    assert.ok(ctx.planilha.abaEstaOculta(A.SALDOS_TRADING));
    assert.notOk(ctx.planilha.abaEstaOculta(V.HOME));
    assert.equal(ctx.planilha.lerTabela(A.EVENTOS_MANUAIS).length, linhasAntes,
      'ocultar não apaga nem altera dado');
  });

  it('"Preparar planilha" também restaura a superfície', { scenario: 'C52' }, () => {
    const ctx = dataset.montarWorkbook();
    B.abrirEntrada(ctx.planilha, A.CONFIG);
    const configAntes = ctx.repositorio.configLinhas().length;

    B.inicializar({ planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria });

    assert.ok(ctx.planilha.abaEstaOculta(A.CONFIG));
    assert.notOk(ctx.planilha.abaEstaOculta(V.PATRIMONIO));
    assert.equal(ctx.repositorio.configLinhas().length, configAntes);
  });

  it('aba oculta continua legível e gravável pelo Apps Script', { scenario: 'C52' }, () => {
    // Ocultar é cosmético: o motor não pode depender de visibilidade.
    const ctx = dataset.workbookComMovimento();
    assert.ok(ctx.planilha.abaEstaOculta(A.LEDGER));
    assert.ok(ctx.repositorio.ledger().length > 0, 'lê aba oculta');

    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EV-OCULTA', tipo_evento: 'NOVA_OBRIGACAO', data: '2026-03-01',
      valor: 100, moeda: 'BRL', referencia_id: 'PROV-OCULTA'
    })]);
    assert.ok(ctx.repositorio.eventos().some((e) => e.evento_id === 'EV-OCULTA'),
      'escreve em aba oculta');

    const r = ctx.workflows.fecharCompetencia('2026-01');
    assert.ok(r.validacao.ok, JSON.stringify(r.validacao.violacoes));
  });
});

describe('Ponto de entrada: menu final', () => {
  const menu = MAIN.slice(MAIN.indexOf('function onOpen'), MAIN.indexOf('/** Preparar planilha'));

  it('a ordem é exatamente a do fluxo mensal', { scenario: 'C52' }, () => {
    const ordem = [
      'Importar extrato', 'Revisar pendências', 'Registrar evento',
      'Publicar taxa do mês', 'Fechar mês',
      'Abrir painel', 'Atualizar abas',
      'Reclassificar movimentação', 'Abrir entrada', 'Preparar planilha'
    ];
    const posicoes = ordem.map((rotulo) => menu.indexOf(rotulo));
    posicoes.forEach((p, i) => assert.notEqual(p, -1, 'faltou no menu: ' + ordem[i]));
    for (let i = 1; i < posicoes.length; i++) {
      assert.ok(posicoes[i - 1] < posicoes[i],
        '"' + ordem[i - 1] + '" deve vir antes de "' + ordem[i] + '"');
    }
  });

  it('os dois separadores agrupam por ritmo de uso', { scenario: 'C52' }, () => {
    assert.equal(menu.split('addSeparator()').length - 1, 2);
    assert.ok(menu.indexOf('Fechar mês') < menu.indexOf('addSeparator()'));
  });

  it('o submenu tem as três entradas, e só elas', { scenario: 'C52' }, () => {
    assert.includes(menu, "createMenu('Abrir entrada')");
    assert.includes(menu, "addItem('Eventos manuais', 'fosAbrirEventosManuais')");
    assert.includes(menu, "addItem('Saldos de trading', 'fosAbrirSaldosTrading')");
    assert.includes(menu, "addItem('Configuração', 'fosAbrirConfiguracao')");
    assert.equal(menu.indexOf('Fila'), -1, 'a fila não é ponto de entrada do menu');
  });

  it('as funções existem no arquivo empacotado', { scenario: 'C52' }, () => {
    const ctx = vm.createContext({});
    vm.runInContext(fs.readFileSync(DESTINO, 'utf8'), ctx, { filename: 'financeos.gs' });
    ['fosAbrirEventosManuais', 'fosAbrirSaldosTrading', 'fosAbrirConfiguracao',
      'fosRevisarPendencias'].forEach((fn) => {
      assert.equal(typeof ctx[fn], 'function', fn);
    });
    assert.equal(typeof ctx.FOS.Queue.decisaoPendente, 'function');
    assert.equal(typeof ctx.FOS.Bootstrap, 'undefined');
    assert.equal(typeof ctx.FOS.App.Bootstrap.abrirEntrada, 'function');
  });

  it('a navegação não escreve: o comando só chama abrirEntrada', { scenario: 'C52' }, () => {
    const bloco = MAIN.slice(
      MAIN.indexOf('function _fosAbrirEntrada'), MAIN.indexOf('function fosReclassificarMovimentacao'));
    assert.includes(bloco, 'Bootstrap.abrirEntrada');
    ['anexar', 'substituir', 'resolverItemFila', 'fecharCompetencia'].forEach((proibido) => {
      assert.equal(bloco.indexOf(proibido), -1, 'navegação não pode chamar ' + proibido);
    });
  });

  it('"Revisar pendências" percorre todos os itens e usa o domínio', { scenario: 'C52' }, () => {
    const bloco = MAIN.slice(
      MAIN.indexOf('function fosRevisarPendencias'), MAIN.indexOf('function _fosComAtor'));
    assert.includes(bloco, 'FOS.Queue.decisaoPendente');
    assert.includes(bloco, 'FOS.Queue.interpretarResposta');
    assert.includes(bloco, 'for (var i = 0; i < abertos.length; i++)');
    assert.includes(bloco, 'cancelado = true');
    assert.includes(bloco, 'Resolvidos: ');
    assert.includes(bloco, 'Descartados: ');
    assert.includes(bloco, 'Ainda abertos: ');
    assert.equal(bloco.indexOf("decisao: 'CLASSIFICAR'"), -1,
      'a decisão vem da resposta, nunca fixa no comando');
  });
});
