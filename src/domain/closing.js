/**
 * Fechamento mensal (aba 40).
 *
 * ABERTO -> EM_REVISAO -> FECHADO. O fechamento materializa um snapshot
 * COMPLETO e imutável: depois de FECHADO, nada é recalculado — correções
 * viram restatement (aba 41), nunca update.
 *
 * O snapshot congela: saldos e posições de Trading, as quatro métricas,
 * taxa e efeito cambial, custos, disponível e runway, funções do dinheiro,
 * provisões e objetivos, patrimônio por moeda e em BRL gerencial, qualidade,
 * estado do ciclo, os sete sinais, ações sugeridas e metadados.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  var VERSAO_SCHEMA_SNAPSHOT = 1;

  var TRANSICOES = {
    ABERTO: ['EM_REVISAO'],
    EM_REVISAO: ['FECHADO', 'ABERTO'],
    FECHADO: []
  };

  function transicionar(estadoAtual, novoEstado) {
    var permitidos = TRANSICOES[estadoAtual];
    if (!permitidos) {
      FOS.Core.fail('ESTADO_FECHAMENTO_INVALIDO', 'Estado desconhecido: ' + estadoAtual);
    }
    if (permitidos.indexOf(novoEstado) === -1) {
      FOS.Core.fail('TRANSICAO_INVALIDA',
        'Transição não permitida: ' + estadoAtual + ' -> ' + novoEstado,
        { de: estadoAtual, para: novoEstado });
    }
    return novoEstado;
  }

  function fechamentoId(competencia, versao) {
    return 'FEC-' + competencia + '-v' + versao;
  }

  /** Checksum determinístico do snapshot (exclui o próprio checksum). */
  function checksum(snapshot) {
    var copia = FOS.Core.clone(snapshot);
    delete copia.checksum;
    return FOS.Hash.fnv1a64(FOS.Core.canonicalJson(copia));
  }

  function managed(m) {
    if (!m) return { value: null, status: 'NULL', reason: 'INDISPONIVEL' };
    return { value: m.value === undefined ? null : m.value, status: m.status, reason: m.reason || null };
  }

  function saldosTradingCongelados(config, saldos, competencia) {
    var fim = FOS.Dates.competenciaRange(competencia).fim;
    return config.contasPorUniverso(C.UNIVERSO.TRADING)
      .filter(function (c) { return c.ativa; })
      .map(function (conta) {
        var s = FOS.Trading.saldoNaData(saldos, conta.conta_id, fim, true);
        return {
          conta_id: conta.conta_id,
          moeda: conta.moeda,
          saldo: s ? s.saldo : null,
          data_referencia: s ? s.data : null,
          status: s ? 'OK' : 'AUSENTE'
        };
      });
  }

  function patrimonio(posicoes, taxa, moedaGerencial) {
    var lista = FOS.Positions.listar(posicoes);
    var porMoeda = {};
    var capitalInvestido = 0;
    lista.forEach(function (p) {
      var moeda = p.moeda || moedaGerencial;
      porMoeda[moeda] = porMoeda[moeda] || { valor_mercado: 0, capital_investido: 0, posicoes: 0, incompleto: false };
      porMoeda[moeda].capital_investido = FOS.Core.round2(porMoeda[moeda].capital_investido + p.capital_investido);
      porMoeda[moeda].posicoes++;
      if (p.valor_mercado === null) porMoeda[moeda].incompleto = true;
      else porMoeda[moeda].valor_mercado = FOS.Core.round2(porMoeda[moeda].valor_mercado + p.valor_mercado);
      capitalInvestido = FOS.Core.round2(capitalInvestido + p.capital_investido);
    });

    var brlGerencial;
    var moedas = Object.keys(porMoeda);
    var incompleto = moedas.some(function (m) { return porMoeda[m].incompleto; });
    if (incompleto) {
      brlGerencial = FOS.Core.nullValue('POSICAO_SEM_SNAPSHOT');
    } else {
      var total = 0;
      var bloqueio = null;
      moedas.forEach(function (m) {
        if (bloqueio) return;
        if (m === moedaGerencial) {
          total = FOS.Core.round2(total + porMoeda[m].valor_mercado);
          return;
        }
        if (!taxa || taxa.value === null) {
          bloqueio = (taxa && taxa.reason) || 'TAXA_INDISPONIVEL';
          return;
        }
        total = FOS.Core.round2(total + porMoeda[m].valor_mercado * taxa.value);
      });
      brlGerencial = bloqueio ? FOS.Core.nullValue(bloqueio) : FOS.Core.value(total);
    }

    return {
      por_moeda: porMoeda,
      capital_investido_total: capitalInvestido,
      brl_gerencial: managed(brlGerencial),
      posicoes: lista.map(function (p) {
        return {
          posicao_id: p.posicao_id,
          moeda: p.moeda,
          capital_investido: p.capital_investido,
          distribuicoes: p.distribuicoes,
          valor_mercado: p.valor_mercado,
          data_snapshot: p.data_snapshot,
          snapshot_status: p.snapshot_status,
          resultado_nao_realizado: p.resultado_nao_realizado
        };
      })
    };
  }

  function qualidade(ctx, snapshotParcial) {
    var abertos = FOS.Queue.abertos(ctx.itensFila).length;
    var pendentes = FOS.Invariants.conciliacoesCompletas(ctx.eventos, ctx.competencia, FOS.Ledger.visaoCorrente(ctx.linhas));
    var semSnapshot = FOS.Positions.semSnapshot(ctx.posicoes).length;
    var taxaOk = !ctx.exposicaoEstrangeira || (ctx.taxa && ctx.taxa.value !== null);
    var nulos = [];
    ['caixa_vida_brl', 'disponivel_brl', 'runway_meses'].forEach(function (k) {
      var v = snapshotParcial[k];
      if (v && v.value === null) nulos.push(k);
    });
    var nivel = 'COMPLETO';
    if (abertos > 0 || !pendentes.ok || semSnapshot > 0 || !taxaOk) nivel = 'BLOQUEADO';
    else if (nulos.length) nivel = 'PARCIAL';
    return {
      nivel: nivel,
      itens_fila_abertos: abertos,
      conciliacoes_pendentes: pendentes.ok ? 0 : String(pendentes.detalhe || '').split(',').filter(Boolean).length,
      posicoes_sem_snapshot: semSnapshot,
      taxa_cambial_disponivel: !!taxaOk,
      campos_nulos: nulos
    };
  }

  /**
   * Ações sugeridas — leitura, nunca execução.
   * Nenhuma ação financeira é executada pelo sistema: toda ação aqui é um
   * item para o usuário decidir.
   */
  function acoesSugeridas(sinais, provisoes) {
    var acoes = [];
    function add(codigo, descricao, referencia) {
      acoes.push({ codigo: codigo, descricao: descricao, referencia: referencia || null, executa_automaticamente: false });
    }
    var porCodigo = {};
    (sinais || []).forEach(function (s) { porCodigo[s.codigo] = s; });

    if (porCodigo[C.SINAL.COMPROMISSO_SEM_PROVISAO] && porCodigo[C.SINAL.COMPROMISSO_SEM_PROVISAO].valor === true) {
      add('CRIAR_PROVISAO', 'Há obrigação declarada sem provisão correspondente.',
        porCodigo[C.SINAL.COMPROMISSO_SEM_PROVISAO].detalhe);
    }
    if (porCodigo[C.SINAL.QUEDA_RUNWAY] && porCodigo[C.SINAL.QUEDA_RUNWAY].valor === true) {
      add('REVISAR_RUNWAY', 'Runway caiu acima do limite configurado.', null);
    }
    if (porCodigo[C.SINAL.GASTO_EXTRAORDINARIO_ANORMAL]
      && porCodigo[C.SINAL.GASTO_EXTRAORDINARIO_ANORMAL].valor === true) {
      add('REVISAR_GASTOS_EXTRAORDINARIOS', 'Gasto extraordinário acima do limite reversível do mês.', null);
    }
    if (porCodigo[C.SINAL.RESERVA_FORA_DA_FINALIDADE]
      && porCodigo[C.SINAL.RESERVA_FORA_DA_FINALIDADE].valor === true) {
      add('REVISAR_USO_RESERVA', 'Reserva provisionada foi reduzida antes do vencimento.',
        porCodigo[C.SINAL.RESERVA_FORA_DA_FINALIDADE].detalhe);
    }
    if (porCodigo[C.SINAL.REDUCAO_PROTECAO] && porCodigo[C.SINAL.REDUCAO_PROTECAO].valor === true) {
      add('REVISAR_PROTECAO', 'Proteção acumulada caiu em relação ao fechamento anterior.', null);
    }
    if (porCodigo[C.SINAL.VIDA_PARA_TRADING] && porCodigo[C.SINAL.VIDA_PARA_TRADING].valor === true) {
      add('REVISAR_APORTE_TRADING', 'Houve aporte de capital da Vida para o Trading no período.', null);
    }
    if (porCodigo[C.SINAL.RETIRADA_APOS_MES_FORTE]
      && porCodigo[C.SINAL.RETIRADA_APOS_MES_FORTE].valor === true) {
      add('REVISAR_RETIRADA_PATRIMONIO', 'Retirada ou redução alocativa do patrimônio após mês forte.', null);
    }
    (provisoes || []).forEach(function (p) {
      if (p.status === C.STATUS_PROVISAO.EM_RISCO) {
        add('REFORCAR_PROVISAO', 'Provisão vencida e descoberta: ' + p.nome, p.provisao_id);
      } else if (p.status === C.STATUS_PROVISAO.FORA_DE_RITMO) {
        add('AJUSTAR_RITMO_PROVISAO', 'Ritmo de acumulação abaixo do necessário: ' + p.nome, p.provisao_id);
      }
    });
    return acoes;
  }

  /**
   * Monta o snapshot completo da competência. Função pura: recebe tudo o que
   * precisa em ctx e não escreve nada.
   */
  function montarSnapshot(ctx) {
    var competencia = FOS.Dates.assertCompetencia(ctx.competencia);
    var range = FOS.Dates.competenciaRange(competencia);
    var config = ctx.config;
    var moedaGerencial = config.param('MOEDA_GERENCIAL').value || C.MOEDA.BRL;

    var linhasCorrentes = FOS.Ledger.visaoCorrente(ctx.linhas);
    var linhasCompetencia = FOS.Ledger.daCompetencia(ctx.linhas, competencia);

    var caixa = FOS.Life.caixaVida(config, ctx.linhas, competencia);
    var custoMes = FOS.Life.custoVidaMes(ctx.linhas, competencia);
    var custoMedio = FOS.Life.custoVidaMedio(config, ctx.linhas, competencia);

    // Versões vigentes NA competência: reprocessar um mês antigo não enxerga
    // versões criadas depois dele.
    var provisoesCorrentes = FOS.Subledger.correntesEm(ctx.provisoesLinhas, 'provisao_id', competencia);
    var objetivosCorrentes = FOS.Subledger.correntesEm(ctx.objetivosLinhas, 'objetivo_id', competencia);
    var passivosCorrentes = FOS.Subledger.correntesEm(ctx.passivosLinhas, 'passivo_id', competencia);

    var provisoesAvaliadas = provisoesCorrentes.map(function (p) {
      return FOS.Provisions.avaliar(p, {
        dataReferencia: range.fim,
        competencia: competencia,
        historico: (ctx.historicoProvisoes || {})[String(p.provisao_id)] || [],
        fechamentosMinimos: config.param('FECHAMENTOS_MINIMOS_PROVISAO').value || 2
      });
    });
    var objetivosAvaliados = objetivosCorrentes.map(function (o) {
      return FOS.Objectives.avaliar(o, {
        dataReferencia: range.fim,
        competencia: competencia,
        historico: (ctx.historicoObjetivos || {})[String(o.objetivo_id)] || [],
        fechamentosMinimos: config.param('FECHAMENTOS_MINIMOS_PROVISAO').value || 2
      });
    });

    var passivosAvaliados = passivosCorrentes.map(function (p) {
      return FOS.Liabilities.avaliar(p, { dataReferencia: range.fim });
    });
    var passivosAbertoTotal = FOS.Liabilities.totalAberto(passivosAvaliados);

    var funcoes = FOS.Life.funcoesDoDinheiro(caixa, provisoesAvaliadas, objetivosAvaliados, passivosAbertoTotal);
    var disponivel = FOS.Life.disponivel(caixa, funcoes);
    var runway = FOS.Life.runway(disponivel, custoMedio);

    var metricasTrading = FOS.Trading.metricas({
      config: config,
      competencia: competencia,
      linhas: ctx.linhas,
      saldos: ctx.saldos,
      eventos: ctx.eventos,
      contaReserva: config.param('CONTA_RESERVA_TRADING_BRL').value || 'RESERVA_BANCA_BRL'
    });

    var capitalGbp = FOS.Trading.capitalTradingGbp(config, ctx.saldos, competencia);
    var capitalGbpAnterior = FOS.Trading.capitalTradingGbp(config, ctx.saldos, FOS.Dates.addMonths(competencia, -1));
    var efeito = FOS.Fx.efeitoCambial(
      FOS.Core.isOk(capitalGbpAnterior) ? capitalGbpAnterior.value : null,
      ctx.taxaAnterior && ctx.taxaAnterior.value !== null ? ctx.taxaAnterior.value : null,
      ctx.taxa && ctx.taxa.value !== null ? ctx.taxa.value : null
    );

    var pat = patrimonio(ctx.posicoes, ctx.taxa, moedaGerencial);

    var estadoSugerido = FOS.State.sugerir({ config: config, runway: runway, provisoes: provisoesAvaliadas });
    var sugeridosRecentes = (ctx.sugeridosAnteriores || []).concat([estadoSugerido.estado]);
    var estado = FOS.State.aplicar({
      estadoFormalAnterior: ctx.estadoFormalAnterior || null,
      sugeridosRecentes: sugeridosRecentes,
      fechamentosParaAvanco: config.param(FOS.State.PARAM_FECHAMENTOS_AVANCO).value || 2
    });

    var sinais = FOS.Signals.avaliarTodos({
      config: config,
      competencia: competencia,
      dataReferencia: range.fim,
      linhas: ctx.linhas,
      eventos: ctx.eventos,
      provisoes: provisoesAvaliadas,
      caixaVida: caixa,
      runway: runway,
      caixaRetiradoBrl: metricasTrading.caixa_retirado_brl,
      patrimonioCapitalInvestido: pat.capital_investido_total,
      fechamentosAnteriores: ctx.fechamentosAnteriores || []
    });

    var parcial = {
      caixa_vida_brl: managed(caixa),
      disponivel_brl: managed(disponivel),
      runway_meses: managed(runway)
    };

    var snapshot = {
      versao_schema: VERSAO_SCHEMA_SNAPSHOT,
      competencia: competencia,
      periodo: range,
      moeda_gerencial: moedaGerencial,
      gerado_em: ctx.agora,

      trading: {
        saldos_congelados: saldosTradingCongelados(config, ctx.saldos, competencia),
        capital_gbp: managed(capitalGbp),
        metricas: {
          caixa_retirado_brl: managed(metricasTrading.caixa_retirado_brl),
          pnl_operacional_gbp: managed(metricasTrading.pnl_operacional_gbp),
          resultado_reserva_brl: managed(metricasTrading.resultado_reserva_brl),
          custo_operacional_brl: managed(metricasTrading.custo_operacional_brl)
        },
        observacao: 'As quatro métricas são independentes e não somáveis entre si.'
      },

      cambio: {
        par: ctx.taxa && ctx.taxa.par ? ctx.taxa.par : FOS.Fx.par(C.MOEDA.GBP, moedaGerencial),
        provedor: ctx.taxa ? ctx.taxa.provedor : null,
        taxa: ctx.taxa ? ctx.taxa.value : null,
        // data_taxa é a data de REFERÊNCIA da competência; data_cotacao é o dia
        // efetivo da cotação usada. Elas divergem quando não houve PTAX no
        // último dia do mês — o snapshot guarda as duas para que a reapresentação
        // reproduza a decisão original.
        data_taxa: ctx.taxa ? ctx.taxa.data : null,
        data_cotacao: ctx.taxa ? (ctx.taxa.data_cotacao || null) : null,
        versao_taxa: ctx.taxa ? (ctx.taxa.versao || null) : null,
        reason: ctx.taxa ? ctx.taxa.reason : 'TAXA_NAO_INFORMADA',
        efeito_cambial_brl: managed(efeito)
      },

      vida: {
        caixa_vida_brl: managed(caixa),
        custo_vida_mes_brl: managed(custoMes),
        custo_vida_medio_brl: managed(custoMedio),
        disponivel_brl: managed(disponivel),
        runway_meses: managed(runway),
        // Soma de valor_aberto: sempre calculável a partir das linhas de
        // passivo (zero sem nenhuma), nunca depende de caixa nem de taxa —
        // por isso é managed(value(...)), não managed(caixa)-dependente.
        passivos_abertos_brl: managed(FOS.Core.value(passivosAbertoTotal)),
        funcoes_do_dinheiro: funcoes
      },

      provisoes: provisoesAvaliadas,
      objetivos: objetivosAvaliados,
      passivos: passivosAvaliados,
      patrimonio: pat,

      estado_ciclo: {
        sugerido: estadoSugerido.estado,
        sugerido_status: estadoSugerido.status,
        sugerido_reason: estadoSugerido.reason,
        formal: estado.estado_formal,
        movimento: estado.movimento,
        motivo: estado.motivo
      },

      sinais: sinais,

      metadados: {
        linhas_ledger_competencia: linhasCompetencia.length,
        linhas_ledger_total: linhasCorrentes.length,
        eventos_competencia: (ctx.eventos || []).filter(function (e) {
          return FOS.Dates.inCompetencia(String(e.data), competencia);
        }).length,
        registros_saldo_trading: (ctx.saldos || []).length,
        parametros_bloqueados: Object.keys(config.parametros).filter(function (k) {
          return config.parametros[k].status === 'BLOQUEADO';
        })
      }
    };

    snapshot.qualidade = qualidade(ctx, parcial);
    snapshot.acoes = acoesSugeridas(sinais, provisoesAvaliadas);
    return snapshot;
  }

  /** Validações formais do fechamento (fila, conciliações, PTAX, snapshots, invariantes). */
  function validar(ctx) {
    var linhasCompetencia = FOS.Ledger.daCompetencia(ctx.linhas, ctx.competencia);
    return FOS.Invariants.verificarTodas({
      config: ctx.config,
      competencia: ctx.competencia,
      linhas: FOS.Ledger.visaoCorrente(ctx.linhas),
      linhasTodasVersoes: ctx.linhas,
      linhasCompetencia: linhasCompetencia,
      saldos: ctx.saldos,
      eventos: ctx.eventos,
      itensFila: ctx.itensFila,
      posicoes: ctx.posicoes,
      taxa: ctx.taxa,
      exposicaoEstrangeira: ctx.exposicaoEstrangeira,
      provisoesLinhas: ctx.provisoesLinhas,
      objetivosLinhas: ctx.objetivosLinhas,
      passivosLinhas: ctx.passivosLinhas,
      fechamentoAnterior: ctx.fechamentoAnterior,
      recalcularChecksum: ctx.recalcularChecksum
    });
  }

  /**
   * Executa o fechamento. Só produz linha FECHADO se todas as validações
   * passarem; caso contrário devolve o snapshot em EM_REVISAO com bloqueios.
   */
  function fechar(ctx) {
    var validacao = validar(ctx);
    var snapshot = montarSnapshot(ctx);
    var versao = Number(ctx.versao || 1);
    var estado = validacao.ok
      ? C.ESTADO_FECHAMENTO.FECHADO
      : C.ESTADO_FECHAMENTO.EM_REVISAO;

    snapshot.validacao = {
      ok: validacao.ok,
      resultados: validacao.resultados,
      violacoes: validacao.violacoes.map(function (v) { return v.codigo; })
    };
    snapshot.estado = estado;
    snapshot.versao = versao;
    snapshot.fechado_em = validacao.ok ? ctx.agora : null;

    var check = checksum(snapshot);
    var fechamento = {
      fechamento_id: fechamentoId(ctx.competencia, versao),
      competencia: ctx.competencia,
      versao: versao,
      estado: estado,
      gerado_em: ctx.agora,
      fechado_em: validacao.ok ? ctx.agora : '',
      checksum: check,
      motivo_versao: ctx.motivoVersao || 'FECHAMENTO_ORIGINAL',
      gerado_por: ctx.ator || 'SISTEMA',
      caixa_vida_brl: snapshot.vida.caixa_vida_brl.value,
      disponivel_brl: snapshot.vida.disponivel_brl.value,
      runway_meses: snapshot.vida.runway_meses.value,
      patrimonio_brl_gerencial: snapshot.patrimonio.brl_gerencial.value,
      estado_ciclo_sugerido: snapshot.estado_ciclo.sugerido,
      estado_ciclo_formal: snapshot.estado_ciclo.formal,
      qualidade: snapshot.qualidade.nivel,
      snapshot_json: FOS.Core.canonicalJson(snapshot)
    };

    return { fechamento: fechamento, snapshot: snapshot, validacao: validacao };
  }

  /** Recalcula o checksum a partir da linha persistida (para provar imutabilidade). */
  function checksumDaLinha(linhaFechamento) {
    var snapshot = JSON.parse(linhaFechamento.snapshot_json);
    return checksum(snapshot);
  }

  /** Resumo achatado do fechamento, usado como "fechamento anterior" nos sinais. */
  function resumoParaHistorico(snapshot) {
    return {
      competencia: snapshot.competencia,
      runway_meses: snapshot.vida.runway_meses.value,
      caixa_vida_brl: snapshot.vida.caixa_vida_brl.value,
      caixa_retirado_brl: snapshot.trading.metricas.caixa_retirado_brl.value,
      protecao_total: snapshot.vida.funcoes_do_dinheiro.protecao,
      patrimonio_capital_investido: snapshot.patrimonio.capital_investido_total,
      estado_formal: snapshot.estado_ciclo.formal,
      estado_sugerido: snapshot.estado_ciclo.sugerido,
      provisoes: (snapshot.provisoes || []).map(function (p) {
        return {
          provisao_id: p.provisao_id,
          valor_acumulado: p.valor_acumulado,
          vencimento: p.vencimento,
          status: p.status
        };
      })
    };
  }

  FOS.Closing = {
    VERSAO_SCHEMA_SNAPSHOT: VERSAO_SCHEMA_SNAPSHOT,
    TRANSICOES: TRANSICOES,
    transicionar: transicionar,
    fechamentoId: fechamentoId,
    checksum: checksum,
    checksumDaLinha: checksumDaLinha,
    montarSnapshot: montarSnapshot,
    validar: validar,
    fechar: fechar,
    patrimonio: patrimonio,
    acoesSugeridas: acoesSugeridas,
    resumoParaHistorico: resumoParaHistorico
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
