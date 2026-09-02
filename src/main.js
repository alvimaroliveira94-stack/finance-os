/**
 * Pontos de entrada do Apps Script.
 *
 * Este é o único arquivo que o Google chama diretamente. Ele monta os
 * adaptadores reais e delega para os workflows. Nada aqui decide regra.
 *
 * Limites explícitos e permanentes:
 *  - nenhuma função conecta conta bancária, corretora ou casa de apostas;
 *  - nenhuma função move dinheiro ou emite ordem;
 *  - o painel é somente leitura e não expõe nenhuma API que escreva.
 */

/* global SpreadsheetApp, HtmlService, Session, UrlFetchApp */

function _fosAmbiente() {
  var planilha = FOS.Adapters.planilhaAtiva();
  var repositorio = FOS.App.criarRepositorio(planilha);
  var relogio = FOS.Adapters.relogioReal();
  var ator = 'APPS_SCRIPT';
  var auditoria = FOS.App.criarAuditoria(repositorio, relogio, ator);
  return {
    planilha: planilha,
    repositorio: repositorio,
    relogio: relogio,
    ator: ator,
    auditoria: auditoria,
    workflows: FOS.App.criarWorkflows({
      repositorio: repositorio,
      relogio: relogio,
      ator: ator,
      auditoria: auditoria,
      urlFetchApp: typeof UrlFetchApp === 'undefined' ? null : UrlFetchApp
    })
  };
}

function _fosUi() {
  return SpreadsheetApp.getUi();
}

/** Menu curto, em linguagem humana. Toda ação é manual e explícita. */
function onOpen() {
  _fosUi()
    .createMenu('Finance OS')
    .addItem('Preparar planilha', 'fosSetup')
    .addItem('Importar extrato', 'fosImportarExtrato')
    .addItem('Revisar pendências', 'fosRevisarPendencias')
    .addItem('Registrar evento', 'fosRegistrarEvento')
    .addItem('Fechar mês', 'fosFecharMes')
    .addSeparator()
    .addItem('Abrir painel', 'fosAbrirPainel')
    .addItem('Atualizar abas', 'fosAtualizarAbas')
    .addToUi();
}

/** Preparar planilha: cria estrutura, semeia configuração e diagnostica. */
function fosSetup() {
  var amb = _fosAmbiente();
  var r = FOS.App.Bootstrap.inicializar({
    planilha: amb.planilha,
    repositorio: amb.repositorio,
    auditoria: amb.auditoria
  });
  var diag = amb.workflows.diagnosticoSetup();
  var linhas = ['Estrutura verificada: ' + r.abas.length + ' abas.'];
  if (r.semeadas.config) linhas.push('Configuração inicial semeada: ' + r.semeadas.config + ' linhas.');
  linhas.push('');
  if (diag.pronto) {
    linhas.push('Tudo pronto para o primeiro fechamento.');
  } else {
    linhas.push('Falta resolver antes do primeiro fechamento:');
    diag.bloqueios.forEach(function (b) {
      linhas.push('- ' + b.chave + ' (' + b.codigo + '): ' + b.impacto);
    });
  }
  if (diag.avisos.length) {
    linhas.push('');
    linhas.push('Avisos (não impedem o fechamento):');
    diag.avisos.forEach(function (a) {
      linhas.push('- ' + a.chave + ': ' + (a.reason || a.impacto));
    });
  }
  _fosUi().alert('Preparar planilha', linhas.join('\n'), _fosUi().ButtonSet.OK);
}

function fosImportarExtrato() {
  var ui = _fosUi();
  var conta = ui.prompt('Importar extrato', 'De qual conta? (ex.: INTER_CC)', ui.ButtonSet.OK_CANCEL);
  if (conta.getSelectedButton() !== ui.Button.OK) return;
  var arquivo = ui.prompt('Importar extrato', 'Nome do arquivo no Drive (.csv ou .ofx):', ui.ButtonSet.OK_CANCEL);
  if (arquivo.getSelectedButton() !== ui.Button.OK) return;

  var amb = _fosAmbiente();
  var lido = FOS.Adapters.driveAtivo().lerArquivoPorNome(arquivo.getResponseText().trim());
  var resultado = amb.workflows.importarExtrato({
    contaId: conta.getResponseText().trim(),
    nomeArquivo: lido.nome,
    conteudo: lido.conteudo
  });
  if (!resultado.ok) {
    ui.alert('Importação recusada',
      'Nada foi gravado.\nMotivo: ' + resultado.plano.motivo, ui.ButtonSet.OK);
    return;
  }
  amb.workflows.conciliarEventos();
  amb.workflows.materializarEventos();
  ui.alert('Importação concluída',
    'Novas movimentações: ' + resultado.plano.novas.length
    + '\nJá existentes (ignoradas): ' + resultado.plano.duplicadas.length
    + '\nPrecisam da sua revisão: ' + resultado.emFila, ui.ButtonSet.OK);
}

/** Revisar pendências: mostra a fila e explica como resolver. */
function fosRevisarPendencias() {
  var amb = _fosAmbiente();
  var abertos = FOS.Queue.abertos(amb.repositorio.fila());
  var ui = _fosUi();
  if (!abertos.length) {
    ui.alert('Revisar pendências', 'Nada pendente. A fila de revisão está vazia.', ui.ButtonSet.OK);
    return;
  }
  var item = abertos[0];
  var resposta = ui.prompt(
    'Revisar pendências (' + abertos.length + ' item(ns))',
    'Item: ' + item.item_id + '\nMotivo: ' + item.motivo + '\nDetalhe: ' + item.detalhe
      + '\n\nEscreva a categoria escolhida:\n' + FOS.Constants.values(FOS.Constants.CATEGORIA).join(', '),
    ui.ButtonSet.OK_CANCEL
  );
  if (resposta.getSelectedButton() !== ui.Button.OK) return;
  try {
    amb.workflows.resolverItemFila({
      item_id: item.item_id,
      decisao: 'CLASSIFICAR',
      categoria: resposta.getResponseText().trim().toUpperCase(),
      ator: 'USUARIO'
    });
    ui.alert('Pendência resolvida', 'Restam ' + (abertos.length - 1) + ' item(ns).', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Não foi possível resolver', e.message, ui.ButtonSet.OK);
  }
}

/** Registrar evento: materializa o que já foi declarado na aba 11. */
function fosRegistrarEvento() {
  var amb = _fosAmbiente();
  var r = amb.workflows.materializarEventos();
  var conciliacao = amb.workflows.conciliarEventos();
  _fosUi().alert('Registrar evento',
    'Provisões criadas/atualizadas: ' + r.provisoes.length
    + '\nObjetivos criados/atualizados: ' + r.objetivos.length
    + '\nEventos de posição gerados: ' + r.posicoes.length
    + '\nConciliações feitas: ' + conciliacao.conciliadas
    + (r.invalidos.length ? '\n\nEventos com erro: ' + r.invalidos.length : ''),
    _fosUi().ButtonSet.OK);
}

function fosFecharMes() {
  var ui = _fosUi();
  var resposta = ui.prompt('Fechar mês', 'Qual competência? (AAAA-MM)', ui.ButtonSet.OK_CANCEL);
  if (resposta.getSelectedButton() !== ui.Button.OK) return;
  var competencia = resposta.getResponseText().trim();
  var amb = _fosAmbiente();
  try {
    var r = amb.workflows.fecharCompetencia(competencia);
    if (r.validacao.ok) {
      amb.workflows.atualizarSuperficies(competencia);
      ui.alert('Mês fechado',
        competencia + ' está fechado e congelado.\nChecksum: ' + r.fechamento.checksum,
        ui.ButtonSet.OK);
    } else {
      ui.alert('Ainda não dá para fechar',
        'Resolva antes:\n' + r.validacao.violacoes.map(function (v) {
          return '- ' + v.codigo + (v.detalhe ? ': ' + v.detalhe : '');
        }).join('\n'), ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert('Não foi possível fechar', e.message, ui.ButtonSet.OK);
  }
}

function fosAtualizarAbas() {
  var amb = _fosAmbiente();
  var r = amb.workflows.atualizarSuperficies(null);
  _fosUi().alert('Abas atualizadas',
    'HOME, MOVIMENTAÇÕES, PLANEJAMENTO e PATRIMÔNIO foram regeradas a partir do último fechamento.'
    + '\nStatus do dado: ' + r.painel.atual.status, _fosUi().ButtonSet.OK);
}

/**
 * Monta o HTML do painel com o payload já injetado.
 * Nenhuma função do servidor fica exposta ao navegador: os dados chegam
 * embutidos e a página não tem como pedir mais nada.
 */
function _fosHtmlPainel(painel) {
  var json = JSON.stringify(painel)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  var html = HtmlService.createHtmlOutputFromFile('dashboard').getContent();
  return html.replace('/*__PAINEL__*/null', json);
}

/** Abre o painel dentro da própria planilha (sem publicar web app). */
function fosAbrirPainel() {
  var amb = _fosAmbiente();
  var painel = amb.workflows.painel(null, {});
  var saida = HtmlService.createHtmlOutput(_fosHtmlPainel(painel))
    .setTitle('Finance OS')
    .setWidth(1100)
    .setHeight(800);
  SpreadsheetApp.getUi().showModalDialog(saida, 'Finance OS');
}

/**
 * Entrada web opcional, NÃO publicada nesta entrega.
 * Se um dia for implantada, só responde ao dono da planilha: qualquer outro
 * usuário recebe uma página de acesso negado, sem dado nenhum.
 */
function doGet() {
  var autorizado = false;
  var motivo = 'ACESSO_NEGADO';
  try {
    var efetivo = Session.getEffectiveUser().getEmail();
    var ativo = Session.getActiveUser().getEmail();
    autorizado = !!efetivo && !!ativo && efetivo === ativo;
    if (!autorizado) motivo = 'USUARIO_NAO_AUTORIZADO';
  } catch (e) {
    autorizado = false;
    motivo = 'IDENTIDADE_INDISPONIVEL';
  }
  if (!autorizado) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">'
      + '<title>Finance OS</title></head><body>'
      + '<h1>Acesso negado</h1><p>' + motivo + '</p></body></html>'
    ).setTitle('Finance OS');
  }
  var amb = _fosAmbiente();
  return HtmlService.createHtmlOutput(_fosHtmlPainel(amb.workflows.painel(null, {})))
    .setTitle('Finance OS')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}
