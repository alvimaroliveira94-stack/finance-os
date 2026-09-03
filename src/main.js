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

/**
 * Menu curto, em linguagem humana. Toda ação é manual e explícita.
 *
 * Agrupado por ritmo de uso: o mês inteiro em cima, na ordem em que acontece;
 * a leitura no meio; correção, navegação e manutenção embaixo.
 */
function onOpen() {
  var ui = _fosUi();
  ui.createMenu('Finance OS')
    .addItem('Importar extrato', 'fosImportarExtrato')
    .addItem('Revisar pendências', 'fosRevisarPendencias')
    .addItem('Registrar evento', 'fosRegistrarEvento')
    .addItem('Publicar taxa do mês', 'fosPublicarTaxaCambio')
    .addItem('Fechar mês', 'fosFecharMes')
    .addSeparator()
    .addItem('Abrir painel', 'fosAbrirPainel')
    .addItem('Atualizar abas', 'fosAtualizarAbas')
    .addSeparator()
    .addItem('Reclassificar movimentação', 'fosReclassificarMovimentacao')
    .addItem('Calibrar classificação', 'fosCalibrarClassificacao')
    .addSubMenu(ui.createMenu('Abrir entrada')
      .addItem('Eventos manuais', 'fosAbrirEventosManuais')
      .addItem('Saldos de trading', 'fosAbrirSaldosTrading')
      .addItem('Configuração', 'fosAbrirConfiguracao'))
    .addItem('Preparar planilha', 'fosSetup')
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
/** Valor legível numa linha de diálogo. */
function _fosValor(n) {
  if (n === null || n === undefined || n === '') return '?';
  return Number(n).toFixed(2);
}

/**
 * Texto do diálogo de uma pendência.
 *
 * Recebe a estrutura devolvida por Queue.decisaoPendente e só formata: a
 * regra de qual pergunta fazer vive no domínio, não aqui.
 */
function _fosTextoPendencia(pendente, indice, total) {
  var linhas = ['Item ' + indice + ' de ' + total + '  (' + pendente.motivo + ')', ''];

  if (pendente.tipo === 'CANDIDATA') {
    var e = pendente.evento;
    linhas.push('Este evento casa com mais de uma movimentação:');
    linhas.push(e
      ? '  ' + e.data + '  ' + e.tipo_evento + '  ' + _fosValor(e.valor) + ' ' + e.moeda
        + (e.descricao ? '  ' + e.descricao : '')
      : '  evento ' + pendente.referencia);
    linhas.push('');
    linhas.push('Candidatas:');
    pendente.candidatos.forEach(function (c) {
      linhas.push('  ' + c.indice + ') ' + c.data + '  ' + _fosValor(c.valor)
        + (c.descricao ? '  ' + c.descricao : '')
        + (c.conta ? '  [' + c.conta + ']' : ''));
    });
    linhas.push('');
    linhas.push('Escreva o número da movimentação que corresponde ao evento.');
  } else {
    var m = pendente.movimentacao;
    linhas.push('Movimentação sem classificação definida:');
    linhas.push(m
      ? '  ' + m.data + '  ' + _fosValor(m.valor) + '  ' + (m.descricao || '(sem descrição)')
        + (m.conta ? '  [' + m.conta + ']' : '')
      : '  ' + (pendente.detalhe || pendente.referencia));
    linhas.push('');
    linhas.push('Escreva a categoria:');
    linhas.push('  ' + pendente.opcoes.join(', '));
  }

  linhas.push('');
  linhas.push('Ou escreva DESCARTAR para arquivar este item sem aplicar nada.');
  linhas.push('Cancelar encerra a revisão e mantém o item em aberto.');
  return linhas.join('\n');
}

/**
 * Revisar pendências: única porta para a fila de revisão (aba 21).
 *
 * A aba fica oculta de propósito. Este comando percorre TODOS os itens
 * abertos e faz, para cada um, a pergunta que a origem dele exige:
 *
 *  - CLASSIFICACAO -> qual categoria canônica;
 *  - CONCILIACAO   -> qual das movimentações candidatas casa com o evento.
 *
 * O defeito que isto corrige: antes o comando mandava sempre CLASSIFICAR e
 * usava a referência do item como se fosse fingerprint de linha. Num item de
 * conciliação a referência é um evento_id, então a resolução falhava com
 * LINHA_INEXISTENTE, o item ficava aberto — e item aberto impede fechar o mês.
 *
 * Cancelar nunca resolve nada: encerra a revisão com o item ainda ABERTO.
 * Resposta inválida também não resolve, e aparece no resumo final.
 */
function fosRevisarPendencias() {
  var ui = _fosUi();
  var amb = _fosAmbiente();
  var abertos = FOS.Queue.abertos(amb.repositorio.fila());

  if (!abertos.length) {
    ui.alert('Revisar pendências', 'Nada pendente. A fila de revisão está vazia.', ui.ButtonSet.OK);
    return;
  }

  var contexto = {
    linhas: FOS.Ledger.visaoCorrente(amb.repositorio.ledger()),
    staging: amb.repositorio.staging(),
    eventos: amb.repositorio.eventos()
  };

  var resolvidos = 0;
  var descartados = 0;
  var naoAplicados = [];
  var cancelado = false;

  for (var i = 0; i < abertos.length; i++) {
    var pendente = FOS.Queue.decisaoPendente(abertos[i], contexto);
    var resposta = ui.prompt(
      'Revisar pendências',
      _fosTextoPendencia(pendente, i + 1, abertos.length),
      ui.ButtonSet.OK_CANCEL
    );
    if (resposta.getSelectedButton() !== ui.Button.OK) {
      cancelado = true;
      break;
    }

    var leitura = FOS.Queue.interpretarResposta(pendente, resposta.getResponseText());
    if (!leitura.ok) {
      naoAplicados.push(pendente.item_id + ': ' + leitura.erro);
      continue;
    }
    try {
      amb.workflows.resolverItemFila(
        _fosComAtor(leitura.params)
      );
      if (leitura.descartado) descartados++;
      else resolvidos++;
    } catch (e) {
      naoAplicados.push(pendente.item_id + ': ' + (e.code || 'ERRO') + ' - ' + e.message);
    }
  }

  var restantes = FOS.Queue.abertos(amb.repositorio.fila()).length;
  var resumo = [
    'Resolvidos: ' + resolvidos,
    'Descartados: ' + descartados,
    'Ainda abertos: ' + restantes
  ];
  if (cancelado) {
    resumo.push('');
    resumo.push('Revisão encerrada por você. Nenhum item pendente foi alterado.');
  }
  if (naoAplicados.length) {
    resumo.push('');
    resumo.push('Não aplicados (' + naoAplicados.length + '):');
    naoAplicados.slice(0, 10).forEach(function (t) { resumo.push('- ' + t); });
    if (naoAplicados.length > 10) resumo.push('- ... e mais ' + (naoAplicados.length - 10) + '.');
  }
  if (restantes) {
    resumo.push('');
    resumo.push('Enquanto houver item aberto, o mês não fecha. Rode este comando de novo.');
  }
  ui.alert('Revisar pendências', resumo.join('\n'), ui.ButtonSet.OK);
}

/** Toda resolução de fila é ato do usuário, não do ambiente. */
function _fosComAtor(params) {
  params.ator = 'USUARIO';
  return params;
}

/**
 * Abrir entrada: reexibe e ativa uma das três abas de digitação.
 *
 * Navegação pura — nenhum dado é lido ou escrito. Existe para que a
 * superfície permanente possa ser só as quatro abas de leitura sem obrigar
 * ninguém a caçar aba oculta no menu do Sheets.
 */
function _fosAbrirEntrada(nome) {
  var amb = _fosAmbiente();
  try {
    FOS.App.Bootstrap.abrirEntrada(amb.planilha, nome);
  } catch (e) {
    _fosUi().alert('Abrir entrada', e.message, _fosUi().ButtonSet.OK);
  }
}

function fosAbrirEventosManuais() {
  _fosAbrirEntrada(FOS.App.Bootstrap.ABAS_DE_ENTRADA.EVENTOS);
}

function fosAbrirSaldosTrading() {
  _fosAbrirEntrada(FOS.App.Bootstrap.ABAS_DE_ENTRADA.SALDOS);
}

function fosAbrirConfiguracao() {
  _fosAbrirEntrada(FOS.App.Bootstrap.ABAS_DE_ENTRADA.CONFIGURACAO);
}

/** Uma linha da lista de escopo: número, volume, dinheiro e identidade. */
function _fosLinhaResumo(r) {
  var numero = String(r.numero);
  while (numero.length < 3) numero = ' ' + numero;
  var qtd = String(r.quantidade);
  while (qtd.length < 3) qtd = ' ' + qtd;
  return numero + '.  ' + qtd + ' item(ns)  ' + _fosValor(r.soma)
    + '   ' + r.tipo + ' · ' + r.contraparte + ' · ' + r.direcao;
}

/**
 * Diálogo de escopo: a lista numerada e como escolher.
 *
 * Vem antes de qualquer decisão porque decidir um grupo não pode custar
 * responder a todos os outros. É leitura: nenhuma escrita acontece aqui.
 */
function _fosTextoSelecao(grupos) {
  var linhas = [
    grupos.length + ' grupo(s) de pendências abertas.',
    '',
    'Escolha o que decidir agora:',
    '  7          um grupo',
    '  2,7,11     vários grupos',
    '  TODOS      todos eles',
    '',
    'Cancelar encerra sem gravar nada.',
    ''
  ];
  FOS.Calibration.resumo(grupos).forEach(function (r) { linhas.push(_fosLinhaResumo(r)); });
  return linhas.join('\n');
}

/** Traduz a recusa da seleção para linguagem humana, sem adivinhar intenção. */
function _fosExplicarSelecao(erro, total) {
  var partes = String(erro).split(':');
  if (partes[0] === 'SELECAO_VAZIA') return 'Você não informou nenhum grupo.';
  if (partes[0] === 'GRUPO_INEXISTENTE') {
    return 'Não existe grupo ' + partes[1] + '. Os números vão de 1 a ' + total + '.';
  }
  return 'Não entendi "' + partes[1] + '". Use números separados por vírgula, ou TODOS.';
}

/** Uma linha de exemplo dentro do diálogo de calibração. */
function _fosLinhaExemplo(e) {
  return '  ' + e.data + '  ' + _fosValor(e.valor) + '  ' + String(e.descricao || '').slice(0, 46);
}

/**
 * Texto do diálogo de um grupo de calibração.
 *
 * Mostra a evidência histórica porque é ela que decide se o padrão pode
 * virar regra. Os identificadores numéricos observados aparecem como
 * contexto para a sua decisão — nunca como chave de agrupamento.
 */
function _fosTextoGrupo(grupo, indice, total) {
  var linhas = [
    'Grupo ' + indice + ' de ' + total + ' — ' + grupo.quantidade + ' item(ns), soma ' + _fosValor(grupo.soma),
    grupo.tipo + ' · ' + grupo.contraparte + ' · ' + grupo.direcao,
    ''
  ];
  grupo.exemplos.forEach(function (e) { linhas.push(_fosLinhaExemplo(e)); });

  var observados = Object.keys(grupo.observado || {});
  if (observados.length) {
    linhas.push('  (identificadores observados: '
      + observados.map(function (n) { return n + '×' + grupo.observado[n]; }).join(' ') + ')');
  }
  linhas.push('');

  var est = grupo.estabilidade;
  if (est.estado === 'INEDITO') {
    linhas.push('Histórico: nenhuma ocorrência anterior.');
  } else if (est.estado === 'COERENTE') {
    linhas.push('Histórico: ' + est.ocorrencias + ' ocorrência(s), sempre ' + est.categoria + '.');
  } else {
    linhas.push('Histórico: ' + est.ocorrencias + ' ocorrência(s) com categorias DIVERGENTES ('
      + Object.keys(est.categorias).join(', ') + ').');
    linhas.push('Padrão semanticamente instável: não pode virar regra automática.');
  }
  if (grupo.regra_vigente) {
    linhas.push('Regra vigente: ' + grupo.regra_vigente.regra_id + ' v' + grupo.regra_vigente.versao
      + ' -> ' + grupo.regra_vigente.categoria + '.');
  }

  linhas.push('');
  linhas.push('Escreva a categoria:');
  linhas.push('  ' + FOS.Constants.values(FOS.Constants.CATEGORIA).join(', '));
  linhas.push('');
  linhas.push('  CATEGORIA               classifica só agora, sem criar regra');
  if (grupo.pode_aprender) {
    linhas.push('  CATEGORIA APRENDER      classifica e ensina para os próximos meses');
  }
  if (grupo.regra_vigente) {
    linhas.push('  CATEGORIA CORRIGIR      corrige a regra vigente (vale a partir de agora)');
  }
  linhas.push('  PULAR                   não altera nada');
  linhas.push('');
  linhas.push('Cancelar encerra sem gravar nada.');
  return linhas.join('\n');
}

/**
 * Calibrar classificação: única porta para ensinar o sistema a classificar.
 *
 * Duas etapas. Primeiro o escopo: a lista numerada dos grupos abertos e
 * quais deles você quer decidir agora. Depois a decisão, um diálogo por
 * grupo selecionado — e só por eles. Grupo fora da seleção não é perguntado
 * nem tocado.
 *
 * Tudo é acumulado e só aplicado depois de uma confirmação única. Cancelar
 * em qualquer ponto antes dela não grava nada — nem regra, nem resolução.
 *
 * Classificar não é aprender: escrever só a categoria resolve o mês; ensinar
 * exige a palavra APRENDER. A mesma contraparte pode ter naturezas
 * financeiras diferentes ao longo do tempo, então persistir é decisão à parte.
 *
 * A aba 20_REGRAS_CLASSIFICACAO permanece interna: quem escreve nela é o
 * workflow, nunca a mão.
 */
function fosCalibrarClassificacao() {
  var ui = _fosUi();
  var amb = _fosAmbiente();
  var grupos = amb.workflows.gruposDeCalibracao();

  if (!grupos.length) {
    ui.alert('Calibrar classificação',
      'Nada a calibrar. Não há pendência de classificação em aberto.', ui.ButtonSet.OK);
    return;
  }

  var selecao = ui.prompt('Calibrar classificação — escopo',
    _fosTextoSelecao(grupos), ui.ButtonSet.OK_CANCEL);
  if (selecao.getSelectedButton() !== ui.Button.OK) {
    ui.alert('Calibrar classificação',
      'Encerrado por você. Nada foi gravado: nenhuma regra criada e nenhum item resolvido.',
      ui.ButtonSet.OK);
    return;
  }
  var escolha = FOS.Calibration.interpretarSelecao(grupos, selecao.getResponseText());
  if (!escolha.ok) {
    ui.alert('Seleção não entendida',
      _fosExplicarSelecao(escolha.erro, grupos.length)
      + '\n\nNada foi gravado. Abra o comando de novo para escolher outro escopo.',
      ui.ButtonSet.OK);
    return;
  }
  var selecionados = escolha.grupos;

  var decisoes = [];
  var naoEntendidas = [];
  for (var i = 0; i < selecionados.length; i++) {
    // O número mostrado é o da lista de escopo, para você reconhecer o grupo
    // que acabou de escolher — não a posição dentro da seleção.
    var resposta = ui.prompt('Calibrar classificação',
      _fosTextoGrupo(selecionados[i], escolha.numeros[i], grupos.length), ui.ButtonSet.OK_CANCEL);
    if (resposta.getSelectedButton() !== ui.Button.OK) {
      ui.alert('Calibrar classificação',
        'Encerrado por você. Nada foi gravado: nenhuma regra criada e nenhum item resolvido.',
        ui.ButtonSet.OK);
      return;
    }
    var leitura = FOS.Calibration.interpretarResposta(selecionados[i], resposta.getResponseText());
    if (!leitura.ok) {
      naoEntendidas.push(selecionados[i].contraparte + ': ' + leitura.erro);
      continue;
    }
    if (leitura.decisao.modo !== FOS.Calibration.MODO.PULAR) decisoes.push(leitura.decisao);
  }

  if (!decisoes.length) {
    ui.alert('Calibrar classificação',
      'Nenhuma decisão a aplicar.'
      + (naoEntendidas.length ? '\n\nNão entendidas:\n- ' + naoEntendidas.join('\n- ') : ''),
      ui.ButtonSet.OK);
    return;
  }

  var aprender = decisoes.filter(function (d) { return d.modo === FOS.Calibration.MODO.APRENDER; });
  var agora = decisoes.filter(function (d) { return d.modo === FOS.Calibration.MODO.SO_AGORA; });
  var confirmacao = ui.alert('Confirmar calibração',
    'Classificar só agora: ' + agora.length + ' grupo(s)'
    + '\nClassificar e aprender: ' + aprender.length + ' grupo(s)'
    + (naoEntendidas.length ? '\nNão entendidas (seguem abertas): ' + naoEntendidas.length : '')
    + '\n\nAs regras aprendidas passam a classificar automaticamente os próximos meses.'
    + '\nAplicar?', ui.ButtonSet.YES_NO);
  if (confirmacao !== ui.Button.YES) {
    ui.alert('Calibrar classificação', 'Cancelado. Nada foi gravado.', ui.ButtonSet.OK);
    return;
  }

  try {
    var r = amb.workflows.calibrarClassificacao({ decisoes: decisoes, ator: 'USUARIO' });
    var linhas = [
      'Regras criadas/corrigidas: ' + r.aprendidas.length,
      'Resolvidos por regra: ' + r.resolvidosPorRegra.length,
      'Resolvidos só agora: ' + r.resolvidosSoAgora.length,
      'Ainda abertos: ' + r.aindaAbertos
    ];
    if (r.rebaixadas.length) {
      linhas.push('');
      linhas.push('Não viraram regra (' + r.rebaixadas.length + '), classificados só agora:');
      r.rebaixadas.slice(0, 8).forEach(function (x) {
        linhas.push('- ' + x.chave.split(' | ')[1] + ': ' + x.motivo);
      });
    }
    if (r.erros.length) {
      linhas.push('');
      linhas.push('Erros (' + r.erros.length + '):');
      r.erros.slice(0, 8).forEach(function (e) {
        linhas.push('- ' + e.item_id + ': ' + e.codigo);
      });
    }
    if (naoEntendidas.length) {
      linhas.push('');
      linhas.push('Não entendidas, seguem abertas:');
      naoEntendidas.slice(0, 8).forEach(function (t) { linhas.push('- ' + t); });
    }
    ui.alert('Calibração aplicada', linhas.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Não foi possível calibrar', e.message, ui.ButtonSet.OK);
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

/* ------------------------------------------------------------------ */
/* Migração única — não é workflow permanente                          */
/* ------------------------------------------------------------------ */

/** Uma linha do preview de aposentadoria: id, status, referência, uso. */
function _fosLinhaSemente(r) {
  var status = r.encontrada ? (r.ativo ? 'ATIVA' : 'JA INATIVA') : 'NAO ENCONTRADA';
  return '  ' + r.regra_id + '  ' + status
    + '  ' + (r.categoria || '-')
    + '  "' + (r.valor_referencia || '-') + '"'
    + '  classificações históricas: ' + r.classificacoes;
}

/**
 * Migração única: aposenta as dez regras de semente sintéticas.
 *
 * Deliberadamente NÃO está em onOpen. As regras de semente foram andaime
 * de desenvolvimento, não decisão aprovada nem evidência operacional real —
 * mas desativá-las é uma mutação de regra financeira, e mutação de regra
 * financeira nunca acontece por instalar código. Execução é manual, uma
 * única vez, pelo editor do Apps Script (Executar > fosAposentarRegrasDeSemente),
 * com preview e confirmação textual antes de qualquer escrita.
 *
 * Depois de executada e validada em produção, esta função sai num commit
 * de limpeza — ela não tem lugar permanente na superfície.
 */
function fosAposentarRegrasDeSemente() {
  var ui = _fosUi();
  var amb = _fosAmbiente();
  var preview = amb.workflows.previewAposentadoriaSemente();

  var linhas = [
    'Aposenta as dez regras de semente sintéticas (R001, R010, R011, R020,',
    'R021, R022, R030, R040, R050, R900) — andaime de desenvolvimento, não',
    'decisão aprovada nem evidência operacional real.',
    '',
    'A linha de cada regra é preservada. Só ativo, vigente_ate e observação',
    'mudam. Nenhuma regra CAL-* é afetada: esta migração não a conhece.',
    ''
  ];
  preview.forEach(function (r) { linhas.push(_fosLinhaSemente(r)); });
  linhas.push('');
  linhas.push('Para confirmar, digite exatamente: APOSENTAR');

  var resposta = ui.prompt('Aposentar regras de semente', linhas.join('\n'), ui.ButtonSet.OK_CANCEL);
  if (resposta.getSelectedButton() !== ui.Button.OK) {
    ui.alert('Aposentar regras de semente', 'Cancelado. Nada foi gravado.', ui.ButtonSet.OK);
    return;
  }
  // Comparação exata, sem trim: a diretiva pede a palavra exata, e um
  // espaço perdido não deveria decidir sozinho se uma regra financeira é
  // desativada.
  if (resposta.getResponseText() !== 'APOSENTAR') {
    ui.alert('Aposentar regras de semente',
      'Texto não confere: nada foi gravado. Para executar, digite exatamente APOSENTAR.',
      ui.ButtonSet.OK);
    return;
  }

  var r = amb.workflows.aposentarRegrasDeSemente({ ator: 'USUARIO' });
  if (!r.alterado) {
    ui.alert('Aposentar regras de semente',
      'Nenhuma alteração: as regras de semente já estavam aposentadas.', ui.ButtonSet.OK);
    return;
  }
  ui.alert('Aposentar regras de semente',
    'Regras desativadas: ' + r.desativadas + ' de ' + r.regras.length + '.', ui.ButtonSet.OK);
}
