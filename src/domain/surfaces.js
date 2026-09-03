/**
 * Superfícies visíveis (HOME, MOVIMENTAÇÕES, PLANEJAMENTO, PATRIMÔNIO).
 *
 * Construtores PUROS: recebem o modelo canônico já congelado e devolvem as
 * linhas da aba. As abas visíveis são projeção, nunca fonte de verdade —
 * podem ser apagadas e regeradas sem perda de informação.
 *
 * Regras de apresentação que valem em todas elas:
 *  - valor indisponível aparece vazio com status e motivo, nunca como zero;
 *  - nada é somado entre moedas nem entre universos;
 *  - não existe score: sinais são lidos um a um.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  var COLUNAS = {
    HOME: ['secao', 'indicador', 'valor', 'unidade', 'status', 'motivo', 'detalhe'],
    MOVIMENTACOES: [
      'data', 'conta', 'descricao', 'valor', 'moeda',
      'categoria', 'subcategoria', 'universo',
      'evento_conciliado', 'versao', 'periodo', 'editavel', 'referencia'
    ],
    PLANEJAMENTO: [
      'bloco', 'item', 'status', 'alvo', 'acumulado', 'faltante',
      'ritmo_necessario', 'ritmo_observado', 'vencimento', 'prioridade', 'motivo'
    ],
    PATRIMONIO: [
      'bloco', 'item', 'moeda', 'capital_investido', 'valor_mercado',
      'resultado_nao_realizado', 'distribuicoes', 'snapshot', 'qualidade', 'motivo'
    ]
  };

  /** Colunas de origem: nunca editáveis à mão em MOVIMENTAÇÕES. */
  var COLUNAS_ORIGEM_MOVIMENTACOES = ['data', 'conta', 'descricao', 'valor', 'moeda', 'referencia'];

  var ROTULO_SINAL = {
    REDUCAO_PROTECAO: 'Proteção reduziu no mês',
    GASTO_EXTRAORDINARIO_ANORMAL: 'Gasto extraordinário acima do limite',
    VIDA_PARA_TRADING: 'Dinheiro da Vida foi para o Trading',
    RESERVA_FORA_DA_FINALIDADE: 'Reserva usada fora da finalidade',
    QUEDA_RUNWAY: 'Runway caiu além do limite',
    COMPROMISSO_SEM_PROVISAO: 'Compromisso assumido sem provisão',
    RETIRADA_APOS_MES_FORTE: 'Retirada de patrimônio após mês forte'
  };

  var ROTULO_ACAO = {
    CRIAR_PROVISAO: 'Criar provisão para o compromisso assumido',
    REVISAR_RUNWAY: 'Revisar runway',
    REVISAR_GASTOS_EXTRAORDINARIOS: 'Revisar gastos extraordinários do mês',
    REVISAR_USO_RESERVA: 'Revisar uso da reserva',
    REVISAR_PROTECAO: 'Revisar nível de proteção',
    REVISAR_APORTE_TRADING: 'Revisar aporte da Vida para o Trading',
    REVISAR_RETIRADA_PATRIMONIO: 'Revisar retirada de patrimônio',
    REFORCAR_PROVISAO: 'Reforçar provisão vencida e descoberta',
    AJUSTAR_RITMO_PROVISAO: 'Ajustar ritmo de acumulação da provisão'
  };

  function linhaHome(secao, indicador, managed, unidade, detalhe) {
    var m = managed || {};
    var temValor = m.value !== null && m.value !== undefined;
    return {
      secao: secao,
      indicador: indicador,
      valor: temValor ? m.value : '',
      unidade: unidade || '',
      status: m.status || (temValor ? 'OK' : 'NULL'),
      motivo: m.reason || '',
      detalhe: detalhe || ''
    };
  }

  function linhaTexto(secao, indicador, texto, status, motivo, detalhe) {
    return {
      secao: secao,
      indicador: indicador,
      valor: texto === null || texto === undefined ? '' : texto,
      unidade: '',
      status: status || 'OK',
      motivo: motivo || '',
      detalhe: detalhe || ''
    };
  }

  function estadoVazio(colunas, motivo) {
    var linha = {};
    colunas.forEach(function (c) { linha[c] = ''; });
    if (Object.prototype.hasOwnProperty.call(linha, 'secao')) linha.secao = 'SEM_DADOS';
    if (Object.prototype.hasOwnProperty.call(linha, 'bloco')) linha.bloco = 'SEM_DADOS';
    if (Object.prototype.hasOwnProperty.call(linha, 'indicador')) linha.indicador = 'Nenhum fechamento disponível';
    if (Object.prototype.hasOwnProperty.call(linha, 'item')) linha.item = 'Nenhum fechamento disponível';
    if (Object.prototype.hasOwnProperty.call(linha, 'status')) linha.status = 'NULL';
    if (Object.prototype.hasOwnProperty.call(linha, 'motivo')) linha.motivo = motivo || 'SEM_FECHAMENTO_DISPONIVEL';
    if (Object.prototype.hasOwnProperty.call(linha, 'descricao')) linha.descricao = 'Nenhuma movimentação registrada';
    return [linha];
  }

  /**
   * HOME: o mês em uma tela. Estado, qualidade, dinheiro, trading, sinais,
   * as três ações mais relevantes e os bloqueios.
   */
  function home(painel) {
    if (!painel || !painel.atual || !painel.atual.dados) {
      return estadoVazio(COLUNAS.HOME, painel && painel.atual ? painel.atual.reason : 'SEM_FECHAMENTO_DISPONIVEL');
    }
    var vm = painel.atual;
    var d = vm.dados;
    var linhas = [];

    linhas.push(linhaTexto('ESTADO', 'Competência', d.competencia));
    linhas.push(linhaTexto('ESTADO', 'Estado formal do ciclo', d.estado_ciclo.formal,
      d.estado_ciclo.formal ? 'OK' : 'NULL', d.estado_ciclo.formal ? '' : 'ESTADO_INDISPONIVEL'));
    linhas.push(linhaTexto('ESTADO', 'Estado sugerido', d.estado_ciclo.sugerido,
      d.estado_ciclo.sugerido ? 'OK' : 'DADO_INSUFICIENTE',
      d.estado_ciclo.sugerido ? '' : 'ESTADO_SUGERIDO_INDISPONIVEL', d.estado_ciclo.motivo));
    linhas.push(linhaTexto('ESTADO', 'Movimento no fechamento', d.estado_ciclo.movimento, 'OK', '', d.estado_ciclo.motivo));

    linhas.push(linhaTexto('QUALIDADE', 'Qualidade do fechamento', d.qualidade.nivel,
      d.qualidade.nivel === 'COMPLETO' ? 'OK' : 'ATENCAO'));
    linhas.push(linhaTexto('QUALIDADE', 'Frescor do dado', vm.status, vm.status, vm.reason || ''));
    linhas.push(linhaTexto('QUALIDADE', 'Itens abertos na fila de revisão', d.qualidade.itens_fila_abertos,
      d.qualidade.itens_fila_abertos ? 'ATENCAO' : 'OK'));
    linhas.push(linhaTexto('QUALIDADE', 'Conciliações pendentes', d.qualidade.conciliacoes_pendentes,
      d.qualidade.conciliacoes_pendentes ? 'ATENCAO' : 'OK'));

    linhas.push(linhaHome('DINHEIRO', 'Caixa de vida', d.vida.caixa_vida_brl, 'BRL'));
    linhas.push(linhaHome('DINHEIRO', 'Disponível', d.vida.disponivel_brl, 'BRL'));
    linhas.push(linhaHome('DINHEIRO', 'Runway', d.vida.runway_meses, 'meses'));
    linhas.push(linhaHome('DINHEIRO', 'Custo de vida do mês', d.vida.custo_vida_mes_brl, 'BRL'));
    var funcoes = d.vida.funcoes_do_dinheiro || {};
    linhas.push(linhaTexto('DINHEIRO', 'Função do dinheiro: proteção',
      funcoes.protecao === null || funcoes.protecao === undefined ? '' : funcoes.protecao,
      funcoes.status || 'NULL', funcoes.reason || '', 'BRL'));
    linhas.push(linhaTexto('DINHEIRO', 'Função do dinheiro: objetivos',
      funcoes.objetivos === null || funcoes.objetivos === undefined ? '' : funcoes.objetivos,
      funcoes.status || 'NULL', funcoes.reason || '', 'BRL'));
    linhas.push(linhaTexto('DINHEIRO', 'Função do dinheiro: livre',
      funcoes.livre === null || funcoes.livre === undefined ? '' : funcoes.livre,
      funcoes.status || 'NULL', funcoes.reason || '', 'BRL'));

    var m = (d.trading && d.trading.metricas) || {};
    linhas.push(linhaHome('TRADING', 'Caixa retirado', m.caixa_retirado_brl, 'BRL'));
    linhas.push(linhaHome('TRADING', 'P&L operacional', m.pnl_operacional_gbp, 'GBP'));
    linhas.push(linhaHome('TRADING', 'Resultado da reserva', m.resultado_reserva_brl, 'BRL'));
    linhas.push(linhaHome('TRADING', 'Custo operacional', m.custo_operacional_brl, 'BRL'));
    linhas.push(linhaTexto('TRADING', 'Observação',
      'As quatro métricas são independentes e não somáveis entre si.'));

    (d.sinais || []).forEach(function (s) {
      var texto = s.valor === true ? 'SIM' : (s.valor === false ? 'NAO' : '');
      linhas.push(linhaTexto('SINAIS', ROTULO_SINAL[s.codigo] || s.codigo, texto,
        s.valor === true ? 'ATENCAO' : s.status, s.reason || '', s.codigo));
    });

    var acoes = (d.acoes || []).slice(0, 3);
    if (!acoes.length) {
      linhas.push(linhaTexto('ACOES', 'Nenhuma ação sugerida', 'Nada exige decisão neste fechamento.'));
    } else {
      acoes.forEach(function (a, i) {
        linhas.push(linhaTexto('ACOES', 'Ação ' + (i + 1), ROTULO_ACAO[a.codigo] || a.codigo,
          'ATENCAO', '', a.descricao));
      });
    }

    var bloqueios = (painel.bloqueios || []);
    if (!bloqueios.length) {
      linhas.push(linhaTexto('ALERTAS', 'Bloqueios', 'Nenhum bloqueio ativo.'));
    } else {
      bloqueios.forEach(function (b) {
        linhas.push(linhaTexto('ALERTAS', b.codigo, b.detalhe || 'Bloqueia o fechamento', 'RISCO', b.codigo));
      });
    }
    return linhas;
  }

  /**
   * MOVIMENTAÇÕES: visão mediada do ledger. Origem imutável em colunas
   * protegidas; só categoria e subcategoria mudam, e apenas por ação
   * controlada em competência ainda aberta.
   */
  function movimentacoes(params) {
    var linhas = FOS.Ledger.visaoCorrente(params.linhas || []);
    if (!linhas.length) return estadoVazio(COLUNAS.MOVIMENTACOES, 'SEM_MOVIMENTACAO');
    var fechadas = {};
    (params.competenciasFechadas || []).forEach(function (c) { fechadas[String(c)] = true; });

    return FOS.Core.sortBy(linhas, [
      function (l) { return String(l.data_origem); },
      function (l) { return String(l.fingerprint); }
    ]).map(function (l) {
      var competencia = FOS.Dates.competenciaOf(String(l.data_origem));
      var fechada = !!fechadas[competencia];
      return {
        data: l.data_origem,
        conta: l.conta_id,
        descricao: l.descricao_origem,
        valor: l.valor_origem,
        moeda: l.moeda_origem,
        categoria: l.categoria,
        subcategoria: l.subcategoria || '',
        universo: l.universo,
        evento_conciliado: l.evento_conciliado_id || '',
        versao: l.versao_gerencial,
        periodo: fechada ? 'FECHADO' : 'ABERTO',
        editavel: fechada ? 'NAO (use restatement)' : 'SIM (via fila de revisão)',
        referencia: String(l.fingerprint).slice(0, 12)
      };
    });
  }

  /** PLANEJAMENTO: custo de vida, provisões e objetivos com ritmo e status. */
  function planejamento(painel) {
    if (!painel || !painel.atual || !painel.atual.dados) {
      return estadoVazio(COLUNAS.PLANEJAMENTO, painel && painel.atual ? painel.atual.reason : 'SEM_FECHAMENTO_DISPONIVEL');
    }
    var d = painel.atual.dados;
    var linhas = [];

    function linha(bloco, item, campos) {
      return Object.assign({
        bloco: bloco, item: item, status: '', alvo: '', acumulado: '', faltante: '',
        ritmo_necessario: '', ritmo_observado: '', vencimento: '', prioridade: '', motivo: ''
      }, campos || {});
    }

    linhas.push(linha('CUSTO_DE_VIDA', 'Custo de vida do mês', {
      status: d.vida.custo_vida_mes_brl.status,
      acumulado: d.vida.custo_vida_mes_brl.value === null ? '' : d.vida.custo_vida_mes_brl.value,
      motivo: d.vida.custo_vida_mes_brl.reason || ''
    }));
    linhas.push(linha('CUSTO_DE_VIDA', 'Custo de vida médio', {
      status: d.vida.custo_vida_medio_brl.status,
      acumulado: d.vida.custo_vida_medio_brl.value === null ? '' : d.vida.custo_vida_medio_brl.value,
      motivo: d.vida.custo_vida_medio_brl.reason || ''
    }));
    linhas.push(linha('CUSTO_DE_VIDA', 'Runway', {
      status: d.vida.runway_meses.status,
      acumulado: d.vida.runway_meses.value === null ? '' : d.vida.runway_meses.value,
      motivo: d.vida.runway_meses.reason || ''
    }));

    (d.provisoes || []).forEach(function (p) {
      linhas.push(linha('PROVISAO', p.nome, {
        status: p.status,
        alvo: p.valor_alvo,
        acumulado: p.valor_acumulado,
        faltante: p.valor_faltante,
        ritmo_necessario: p.ritmo_necessario === null ? '' : p.ritmo_necessario,
        ritmo_observado: p.ritmo_observado === null ? '' : p.ritmo_observado,
        vencimento: p.vencimento || '',
        prioridade: p.prioridade === null ? '' : p.prioridade,
        motivo: p.provisao_id
      }));
    });
    if (!(d.provisoes || []).length) {
      linhas.push(linha('PROVISAO', 'Nenhuma provisão registrada', { status: 'NULL', motivo: 'SEM_PROVISOES' }));
    }

    (d.objetivos || []).forEach(function (o) {
      linhas.push(linha('OBJETIVO', o.nome, {
        status: o.status,
        alvo: o.valor_alvo,
        acumulado: o.valor_acumulado,
        faltante: o.valor_faltante,
        vencimento: o.prazo || '',
        motivo: o.objetivo_id
      }));
    });
    if (!(d.objetivos || []).length) {
      linhas.push(linha('OBJETIVO', 'Nenhum objetivo registrado', { status: 'NULL', motivo: 'SEM_OBJETIVOS' }));
    }

    // PASSIVO reusa as mesmas colunas de PROVISAO, espelhadas: alvo é o que
    // foi assumido (valor_devido_original), acumulado é o que já foi
    // amortizado, faltante é o saldo em aberto — a mesma relação
    // alvo = acumulado + faltante que já vale para provisão, só que aqui o
    // "alvo" caminha para trás em vez de para a frente. motivo carrega o
    // credor: é o único dado extra que "credor, saldo aberto, vencimento,
    // status" pede e que as colunas existentes não nomeiam.
    (d.passivos || []).forEach(function (p) {
      linhas.push(linha('PASSIVO', p.nome, {
        status: p.status,
        alvo: p.valor_devido_original,
        acumulado: FOS.Core.round2(p.valor_devido_original - p.valor_aberto),
        faltante: p.valor_aberto,
        vencimento: p.vencimento || '',
        motivo: p.credor || ''
      }));
    });
    if (!(d.passivos || []).length) {
      linhas.push(linha('PASSIVO', 'Nenhum passivo registrado', { status: 'NULL', motivo: 'SEM_PASSIVOS' }));
    }

    linhas.push(linha('FECHAMENTO', 'Competência fechada', {
      status: d.estado, vencimento: d.competencia, motivo: d.qualidade.nivel
    }));
    return linhas;
  }

  /**
   * PATRIMÔNIO: posições, totais por moeda e BRL gerencial.
   * O capital de Trading aparece em bloco próprio e NUNCA é somado ao
   * patrimônio: são universos distintos.
   */
  function patrimonio(painel) {
    if (!painel || !painel.atual || !painel.atual.dados) {
      return estadoVazio(COLUNAS.PATRIMONIO, painel && painel.atual ? painel.atual.reason : 'SEM_FECHAMENTO_DISPONIVEL');
    }
    var d = painel.atual.dados;
    var linhas = [];

    function linha(bloco, item, campos) {
      return Object.assign({
        bloco: bloco, item: item, moeda: '', capital_investido: '', valor_mercado: '',
        resultado_nao_realizado: '', distribuicoes: '', snapshot: '', qualidade: '', motivo: ''
      }, campos || {});
    }

    var posicoes = (d.patrimonio && d.patrimonio.posicoes) || [];
    posicoes.forEach(function (p) {
      linhas.push(linha('POSICAO', p.posicao_id, {
        moeda: p.moeda,
        capital_investido: p.capital_investido,
        valor_mercado: p.valor_mercado === null ? '' : p.valor_mercado,
        resultado_nao_realizado: p.valor_mercado === null ? '' : FOS.Core.round2(p.valor_mercado - p.capital_investido),
        snapshot: p.data_snapshot || '',
        qualidade: p.snapshot_status,
        motivo: p.snapshot_status === 'OK' ? '' : 'SNAPSHOT_' + p.snapshot_status
      }));
    });
    if (!posicoes.length) {
      linhas.push(linha('POSICAO', 'Nenhuma posição registrada', { qualidade: 'NULL', motivo: 'SEM_POSICOES' }));
    }

    var porMoeda = (d.patrimonio && d.patrimonio.por_moeda) || {};
    Object.keys(porMoeda).sort().forEach(function (moeda) {
      linhas.push(linha('TOTAL_POR_MOEDA', 'Total em ' + moeda, {
        moeda: moeda,
        capital_investido: porMoeda[moeda].capital_investido,
        valor_mercado: porMoeda[moeda].incompleto ? '' : porMoeda[moeda].valor_mercado,
        qualidade: porMoeda[moeda].incompleto ? 'INCOMPLETO' : 'OK',
        motivo: porMoeda[moeda].incompleto ? 'POSICAO_SEM_SNAPSHOT' : ''
      }));
    });

    var brl = d.patrimonio && d.patrimonio.brl_gerencial;
    linhas.push(linha('BRL_GERENCIAL', 'Patrimônio convertido (gerencial)', {
      moeda: d.moeda_gerencial,
      valor_mercado: brl && brl.value !== null ? brl.value : '',
      qualidade: brl ? brl.status : 'NULL',
      motivo: brl && brl.reason ? brl.reason : ''
    }));

    var capitalTrading = (d.trading && d.trading.capital_gbp)
      || { value: null, status: 'NULL', reason: 'CAPITAL_TRADING_INDISPONIVEL' };
    linhas.push(linha('TRADING_SEPARADO', 'Capital em trading (não somado ao patrimônio)', {
      moeda: 'GBP',
      capital_investido: capitalTrading.value === null ? '' : capitalTrading.value,
      qualidade: capitalTrading.status,
      motivo: capitalTrading.reason || 'UNIVERSO_SEPARADO'
    }));

    (painel.historico || []).slice(-6).forEach(function (h) {
      linhas.push(linha('HISTORICO', h.competencia, {
        moeda: h.moeda_gerencial || '',
        valor_mercado: h.patrimonio_brl_gerencial === null ? '' : h.patrimonio_brl_gerencial,
        qualidade: h.qualidade,
        motivo: h.restatement ? 'RESTATEMENT_v' + h.versao : 'FECHAMENTO_v' + h.versao
      }));
    });
    return linhas;
  }

  FOS.Surfaces = {
    COLUNAS: COLUNAS,
    COLUNAS_ORIGEM_MOVIMENTACOES: COLUNAS_ORIGEM_MOVIMENTACOES,
    ROTULO_SINAL: ROTULO_SINAL,
    ROTULO_ACAO: ROTULO_ACAO,
    home: home,
    movimentacoes: movimentacoes,
    planejamento: planejamento,
    patrimonio: patrimonio,
    estadoVazio: estadoVazio
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
