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
    .addItem('Reclassificar movimentação', 'fosReclassificarMovimentacao')
    .addItem('Registrar evento', 'fosRegistrarEvento')
    .addItem('Publicar taxa do mês', 'fosPublicarTaxaCambio')
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

/**
 * Reclassificar movimentação: muda a categoria gerencial de uma linha do
 * ledger que já foi classificada.
 *
 * É o caminho para corrigir um entendimento posterior ("aquele crédito era
 * resgate de poupança, não custo de vida") sem mexer na fila: o item já
 * resolvido continua RESOLVIDO e nada é reaberto, editado ou apagado.
 *
 * A escrita é feita exclusivamente por workflows.reclassificarLinha, que
 * acrescenta uma nova versão gerencial (append-only), preserva a origem
 * imutável, registra antes/depois na aba 90 e recusa período fechado,
 * referência inexistente ou ambígua e categoria fora do catálogo.
 */
function fosReclassificarMovimentacao() {
  var ui = _fosUi();
  var amb = _fosAmbiente();

  var fechadas = amb.workflows.competenciasFechadas();
  var abertas = FOS.Ledger.visaoCorrente(amb.repositorio.ledger()).filter(function (l) {
    return fechadas.indexOf(FOS.Dates.competenciaOf(String(l.data_origem))) === -1;
  });
  if (!abertas.length) {
    ui.alert('Reclassificar movimentação',
      'Nenhuma movimentação em competência aberta.\n\n'
      + 'Competências já fechadas só mudam por reapresentação (restatement).',
      ui.ButtonSet.OK);
    return;
  }

  var recentes = FOS.Core.sortBy(abertas, [function (l) { return String(l.data_origem); }])
    .reverse()
    .slice(0, 12);
  var lista = recentes.map(function (l) {
    return String(l.fingerprint).slice(0, 12)
      + '  ' + l.data_origem
      + '  ' + l.valor_origem
      + '  ' + l.categoria
      + '  ' + String(l.descricao_origem || '').slice(0, 28);
  }).join('\n');

  var referencia = ui.prompt(
    'Reclassificar movimentação (1 de 3)',
    'Movimentações em competência aberta'
      + (abertas.length > recentes.length ? ' (as ' + recentes.length + ' mais recentes de ' + abertas.length + ')' : '')
      + ':\n\n' + lista
      + '\n\nCole a referência da linha (coluna "referencia" da aba MOVIMENTAÇÕES):',
    ui.ButtonSet.OK_CANCEL
  );
  if (referencia.getSelectedButton() !== ui.Button.OK) return;

  var categoria = ui.prompt(
    'Reclassificar movimentação (2 de 3)',
    'Nova categoria:\n' + FOS.Constants.values(FOS.Constants.CATEGORIA).join('\n'),
    ui.ButtonSet.OK_CANCEL
  );
  if (categoria.getSelectedButton() !== ui.Button.OK) return;

  var motivo = ui.prompt(
    'Reclassificar movimentação (3 de 3)',
    'Por que está mudando? O motivo fica gravado no log de auditoria.',
    ui.ButtonSet.OK_CANCEL
  );
  if (motivo.getSelectedButton() !== ui.Button.OK) return;
  if (!motivo.getResponseText().trim()) {
    ui.alert('Reclassificar movimentação',
      'Nada foi alterado: a reclassificação exige um motivo explícito.', ui.ButtonSet.OK);
    return;
  }

  try {
    var r = amb.workflows.reclassificarLinha({
      referencia: referencia.getResponseText().trim(),
      categoria: categoria.getResponseText().trim().toUpperCase(),
      motivo: motivo.getResponseText().trim(),
      ator: 'USUARIO'
    });
    if (!r.alterado) {
      ui.alert('Reclassificar movimentação',
        'A linha já estava nessa categoria. Nada foi alterado.', ui.ButtonSet.OK);
      return;
    }
    ui.alert('Movimentação reclassificada',
      r.versao_anterior.data_origem + '  ' + r.versao_anterior.valor_origem
      + '\n\nDe: ' + r.versao_anterior.categoria
      + '\nPara: ' + r.linha.categoria
      + '\n\nVersão ' + r.versao_anterior.versao_gerencial + ' preservada; '
      + 'gravada a versão ' + r.linha.versao_gerencial + '.',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Não foi possível reclassificar', e.message, ui.ButtonSet.OK);
  }
}

/**
 * Junta os eventos recusados pelos dois caminhos (materialização e
 * conciliação) numa lista só, sem repetir o mesmo evento_id.
 *
 * Um evento com tipo_evento inválido aparece nas duas listas; um com conta
 * desconhecida, só na de conciliação. Antes, a caixa de diálogo mostrava
 * apenas a primeira, que justamente não continha erro de tipo — e o usuário
 * via "0 provisões criadas" sem saber que o sistema tinha recusado a linha.
 */
function _fosEventosRecusados(listas) {
  var porId = {};
  var ordem = [];
  (listas || []).forEach(function (lista) {
    (lista || []).forEach(function (item) {
      var id = String(item.evento_id || '(sem evento_id)');
      if (!porId[id]) {
        porId[id] = {};
        ordem.push(id);
      }
      (item.erros || []).forEach(function (erro) {
        var texto = erro.codigo + (erro.detalhe ? ' (' + erro.detalhe + ')' : '');
        porId[id][texto] = true;
      });
    });
  });
  return ordem.map(function (id) {
    return { evento_id: id, erros: Object.keys(porId[id]) };
  });
}

/** Registrar evento: materializa o que já foi declarado na aba 11. */
function fosRegistrarEvento() {
  var amb = _fosAmbiente();
  var r = amb.workflows.materializarEventos();
  var conciliacao = amb.workflows.conciliarEventos();
  var recusados = _fosEventosRecusados([r.invalidos, conciliacao.eventosInvalidos]);

  var linhas = [
    'Provisões criadas/atualizadas: ' + r.provisoes.length,
    'Objetivos criados/atualizados: ' + r.objetivos.length,
    'Eventos de posição gerados: ' + r.posicoes.length,
    'Conciliações feitas: ' + conciliacao.conciliadas
  ];
  if (recusados.length) {
    linhas.push('');
    linhas.push('Eventos recusados: ' + recusados.length);
    recusados.slice(0, 10).forEach(function (e) {
      linhas.push('- ' + e.evento_id + ': ' + e.erros.join('; '));
    });
    if (recusados.length > 10) linhas.push('- ... e mais ' + (recusados.length - 10) + '.');
    linhas.push('');
    linhas.push('Corrija as linhas na aba 11_EVENTOS_MANUAIS e rode este comando de novo. '
      + 'Nada foi gravado por essas linhas.');
  }
  _fosUi().alert('Registrar evento', linhas.join('\n'), _fosUi().ButtonSet.OK);
}

/**
 * Publicar taxa do mês: única porta para materializar a cotação GBP→BRL.
 *
 * A política do V1 é MANUAL e offline. O usuário consulta a PTAX oficial,
 * publica aqui, e o fechamento passa a ler essa taxa da planilha. Nenhuma
 * consulta à internet acontece — nem aqui, nem no fechamento.
 *
 * Este comando existe para que ninguém precise editar a aba 00 à mão: a
 * chave, a versão e a data de referência são responsabilidade do sistema.
 */
function fosPublicarTaxaCambio() {
  var ui = _fosUi();
  var amb = _fosAmbiente();

  var sugestao = FOS.Dates.competenciaOf(String(amb.relogio.hoje()));
  var competencia = ui.prompt(
    'Publicar taxa do mês (1 de 3)',
    'Para qual competência? (AAAA-MM)\n\nSugestão: ' + sugestao,
    ui.ButtonSet.OK_CANCEL
  );
  if (competencia.getSelectedButton() !== ui.Button.OK) return;
  var comp = competencia.getResponseText().trim();

  var estado;
  try {
    estado = amb.workflows.taxasPublicadas(comp);
  } catch (e) {
    ui.alert('Publicar taxa do mês', e.message, ui.ButtonSet.OK);
    return;
  }

  var taxa = ui.prompt(
    'Publicar taxa do mês (2 de 3)',
    'Taxa ' + estado.par + ' de ' + comp + '.'
      + '\nQuantos ' + estado.moeda_gerencial + ' por 1 ' + estado.moeda_estrangeira + '?'
      + '\n\nData de referência da competência: ' + estado.atual.data_referencia
      + (estado.atual.publicada
        ? '\nJá publicada: ' + estado.atual.taxa + ' (cotação de ' + estado.atual.data_cotacao
          + ', versão ' + estado.atual.versao + ')'
        : '\nAinda não publicada.'),
    ui.ButtonSet.OK_CANCEL
  );
  if (taxa.getSelectedButton() !== ui.Button.OK) return;

  var cotacao = ui.prompt(
    'Publicar taxa do mês (3 de 3)',
    'De que dia é essa cotação? (AAAA-MM-DD)'
      + '\n\nSe houve PTAX em ' + estado.atual.data_referencia + ', use essa data.'
      + '\nSe não houve (fim de semana ou feriado), informe o último dia útil anterior.'
      + '\n\nO sistema não adivinha dia útil: a data que você informar fica gravada.',
    ui.ButtonSet.OK_CANCEL
  );
  if (cotacao.getSelectedButton() !== ui.Button.OK) return;
  var dataCotacao = cotacao.getResponseText().trim() || estado.atual.data_referencia;

  var pedido = {
    competencia: comp,
    taxa: taxa.getResponseText().trim().replace(',', '.'),
    dataCotacao: dataCotacao,
    ator: 'USUARIO'
  };

  var confirmacao = ui.alert(
    'Confirmar publicação',
    'Competência: ' + comp
      + '\nPar: ' + estado.par
      + '\nTaxa: ' + pedido.taxa
      + '\nData de referência: ' + estado.atual.data_referencia
      + '\nCotação efetiva: ' + dataCotacao
      + '\n\nPublicar?',
    ui.ButtonSet.YES_NO
  );
  if (confirmacao !== ui.Button.YES) return;

  try {
    _fosPublicarTaxaEAvisar(ui, amb, pedido, estado);
  } catch (e) {
    if (e.code !== 'PERIODO_FECHADO') {
      ui.alert('Não foi possível publicar a taxa', e.message, ui.ButtonSet.OK);
      return;
    }
    // Competência fechada: o fechamento já guardou a taxa da época. Corrigir
    // só faz sentido junto de uma reapresentação, e exige motivo registrado.
    var corrigir = ui.alert('Competência já fechada',
      e.message + '\n\nPublicar mesmo assim como correção?'
      + '\nA taxa só passa a valer quando você reapresentar ' + comp + '.',
      ui.ButtonSet.YES_NO);
    if (corrigir !== ui.Button.YES) return;
    var motivo = ui.prompt('Correção de taxa',
      'Por que a taxa de ' + comp + ' está sendo corrigida?\nO motivo fica no log de auditoria.',
      ui.ButtonSet.OK_CANCEL);
    if (motivo.getSelectedButton() !== ui.Button.OK) return;
    if (!motivo.getResponseText().trim()) {
      ui.alert('Publicar taxa do mês',
        'Nada foi gravado: a correção exige um motivo explícito.', ui.ButtonSet.OK);
      return;
    }
    pedido.permitirCompetenciaFechada = true;
    pedido.motivo = motivo.getResponseText().trim();
    try {
      _fosPublicarTaxaEAvisar(ui, amb, pedido, estado);
    } catch (e2) {
      ui.alert('Não foi possível publicar a taxa', e2.message, ui.ButtonSet.OK);
    }
  }
}

/** Executa a publicação e relata o resultado, incluindo a taxa do mês anterior. */
function _fosPublicarTaxaEAvisar(ui, amb, pedido, estado) {
  var r = amb.workflows.publicarTaxaCambio(pedido);
  if (!r.alterado) {
    ui.alert('Publicar taxa do mês',
      'A taxa vigente de ' + r.competencia + ' já era ' + r.taxa
      + ' (cotação de ' + r.data_cotacao + '). Nada foi gravado.',
      ui.ButtonSet.OK);
    return;
  }
  var linhas = ['Taxa ' + r.par + ' de ' + r.competencia + ': ' + r.taxa];
  linhas.push('Data de referência: ' + r.data_referencia);
  linhas.push('Cotação efetiva: ' + r.data_cotacao);
  linhas.push('Versão publicada: ' + r.versao
    + (r.substituiu ? ' (a versão ' + r.substituiu.versao + ' foi preservada no histórico)' : ''));
  if (r.resultado === 'CORRECAO_POS_FECHAMENTO') {
    linhas.push('');
    linhas.push('A competência está fechada: a correção só vale após reapresentar ' + r.competencia + '.');
  }
  if (!estado.anterior.publicada) {
    linhas.push('');
    linhas.push('Falta a taxa de ' + estado.anterior.competencia
      + ' (referência ' + estado.anterior.data_referencia + ').');
    linhas.push('Sem ela o mês fecha, mas o efeito cambial fica indisponível com motivo.');
  }
  ui.alert('Taxa publicada', linhas.join('\n'), ui.ButtonSet.OK);
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
      var faltaTaxa = r.validacao.violacoes.some(function (v) {
        return v.codigo === 'TAXA_CAMBIAL_DISPONIVEL';
      });
      ui.alert('Ainda não dá para fechar',
        'Resolva antes:\n' + r.validacao.violacoes.map(function (v) {
          return '- ' + v.codigo + (v.detalhe ? ': ' + v.detalhe : '');
        }).join('\n')
        + (faltaTaxa
          ? '\n\nA taxa do mês não está publicada. Use "Publicar taxa do mês" no menu '
            + 'Finance OS — não edite a aba 00 à mão.'
          : ''),
        ui.ButtonSet.OK);
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
