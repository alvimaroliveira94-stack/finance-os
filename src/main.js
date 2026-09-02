/**
 * Pontos de entrada do Apps Script.
 *
 * Este é o único arquivo que o Google chama diretamente. Ele monta os
 * adaptadores reais e delega para os workflows. Nada aqui decide regra.
 *
 * Limites explícitos e permanentes:
 *  - nenhuma função conecta conta bancária, corretora ou casa de apostas;
 *  - nenhuma função move dinheiro ou emite ordem;
 *  - nenhuma função publica web app ou expõe dados para fora do workbook.
 */

/* global SpreadsheetApp */

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
      auditoria: auditoria
    })
  };
}

/** Menu do workbook. Toda ação é manual e explícita. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Finance OS')
    .addItem('1. Criar/verificar estrutura', 'fosBootstrap')
    .addItem('2. Importar extrato (arquivo no Drive)', 'fosImportarExtrato')
    .addItem('3. Conciliar eventos', 'fosConciliarEventos')
    .addItem('4. Revisar competência', 'fosRevisarCompetencia')
    .addItem('5. Fechar competência', 'fosFecharCompetencia')
    .addToUi();
}

function fosBootstrap() {
  var amb = _fosAmbiente();
  var r = FOS.App.Bootstrap.inicializar({
    planilha: amb.planilha,
    repositorio: amb.repositorio,
    auditoria: amb.auditoria
  });
  SpreadsheetApp.getUi().alert('Estrutura verificada. Abas: ' + r.abas.length
    + '\nConfiguração semeada: ' + r.semeadas.config + ' linhas.');
}

function fosImportarExtrato() {
  var ui = SpreadsheetApp.getUi();
  var conta = ui.prompt('Importar extrato', 'ID da conta (ex.: INTER_CC):', ui.ButtonSet.OK_CANCEL);
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
  ui.alert(resultado.ok
    ? 'Importação concluída.\nNovas: ' + resultado.plano.novas.length
      + '\nDuplicadas ignoradas: ' + resultado.plano.duplicadas.length
      + '\nEm fila de revisão: ' + resultado.emFila
    : 'Importação rejeitada (nada foi gravado).\nMotivo: ' + resultado.plano.motivo);
}

function fosConciliarEventos() {
  var amb = _fosAmbiente();
  var r = amb.workflows.conciliarEventos();
  SpreadsheetApp.getUi().alert('Conciliadas: ' + r.conciliadas
    + '\nPendentes: ' + r.pendentes.length
    + '\nEventos inválidos: ' + r.eventosInvalidos.length);
}

function fosRevisarCompetencia() {
  var ui = SpreadsheetApp.getUi();
  var resposta = ui.prompt('Revisar competência', 'Competência (AAAA-MM):', ui.ButtonSet.OK_CANCEL);
  if (resposta.getSelectedButton() !== ui.Button.OK) return;
  var amb = _fosAmbiente();
  var r = amb.workflows.revisarCompetencia(resposta.getResponseText().trim());
  ui.alert(r.validacao.ok
    ? 'Competência pronta para fechar.'
    : 'Bloqueios:\n' + r.validacao.violacoes.map(function (v) {
      return '- ' + v.codigo + (v.detalhe ? ': ' + v.detalhe : '');
    }).join('\n'));
}

function fosFecharCompetencia() {
  var ui = SpreadsheetApp.getUi();
  var resposta = ui.prompt('Fechar competência', 'Competência (AAAA-MM):', ui.ButtonSet.OK_CANCEL);
  if (resposta.getSelectedButton() !== ui.Button.OK) return;
  var amb = _fosAmbiente();
  var r = amb.workflows.fecharCompetencia(resposta.getResponseText().trim());
  ui.alert(r.validacao.ok
    ? 'Competência fechada. Checksum: ' + r.fechamento.checksum
    : 'Fechamento bloqueado:\n' + r.validacao.violacoes.map(function (v) { return '- ' + v.codigo; }).join('\n'));
}
