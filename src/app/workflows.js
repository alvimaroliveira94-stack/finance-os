/**
 * Workflows: orquestração entre repositório, domínio e log de auditoria.
 * Toda escrita no workbook passa por aqui. Nenhuma regra financeira mora
 * neste arquivo — ele só coordena.
 *
 * Nenhum workflow move dinheiro, conecta conta ou chama serviço financeiro.
 * O sistema lê, classifica, concilia e congela. Ação é sempre do usuário.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.App = FOS.App || {};
  var A = FOS.Constants.ABAS_INTERNAS;
  var C = FOS.Constants;

  /**
   * @param {Object} deps {repositorio, relogio, ator, provedorTaxa}
   */
  function criar(deps) {
    var repo = deps.repositorio;
    var relogio = deps.relogio;
    var ator = deps.ator || 'SISTEMA';
    var auditoria = deps.auditoria || FOS.App.criarAuditoria(repo, relogio, ator);

    function classificarLinhas(linhasStaging, config, regras, agora) {
      var confiancaMinima = config.param('CONFIANCA_MINIMA_CLASSIFICACAO').value;
      if (confiancaMinima === null) confiancaMinima = 0.9;
      var novasLinhasLedger = [];
      var novosItensFila = [];
      linhasStaging.forEach(function (linha) {
        var decisao = FOS.Rules.classificar(linha, regras, confiancaMinima);
        if (decisao.decidido) {
          novasLinhasLedger.push(FOS.Ledger.novaLinha(linha, decisao, agora, ator));
        } else {
          novosItensFila.push(FOS.Queue.novoItem({
            origem: C.ORIGEM_FILA.CLASSIFICACAO,
            referencia: linha.fingerprint,
            motivo: decisao.motivo,
            detalhe: linha.data + ' | ' + linha.conta_id + ' | ' + linha.valor,
            candidatos: decisao.candidatos,
            agora: agora
          }));
        }
      });
      return { linhasLedger: novasLinhasLedger, itensFila: novosItensFila };
    }

    /**
     * Importa um extrato para uma conta elegível.
     * Atômico: ou o arquivo inteiro entra, ou nada entra.
     */
    function importarExtrato(params) {
      var agora = relogio.agora();
      var config = repo.config();
      var ledgerLinhas = repo.ledger();
      var plano = FOS.Import.planejar({
        config: config,
        contaId: params.contaId,
        nomeArquivo: params.nomeArquivo,
        conteudo: params.conteudo,
        fingerprintsConhecidos: FOS.Ledger.fingerprints(ledgerLinhas)
          .concat(repo.staging().map(function (s) { return s.fingerprint; })),
        agora: agora
      });

      if (!plano.ok) {
        auditoria.registrar({
          acao: 'IMPORTAR_EXTRATO',
          entidade: A.IMPORT_EXTRATO,
          entidade_id: plano.import_id,
          antes: { linhas_ledger: ledgerLinhas.length },
          depois: { linhas_ledger: ledgerLinhas.length },
          resultado: 'REJEITADO',
          detalhe: { motivo: plano.motivo, erros: plano.erros }
        });
        auditoria.persistir();
        return { ok: false, plano: plano, escritas: 0 };
      }

      var resultado = { ok: true, plano: plano, escritas: 0, classificadas: 0, emFila: 0 };
      if (plano.novas.length) {
        var classificacao = classificarLinhas(plano.novas, config, repo.regras(), agora);
        repo.anexar(A.IMPORT_EXTRATO, plano.novas);
        repo.anexar(A.LEDGER, classificacao.linhasLedger);
        repo.anexar(A.FILA_REVISAO, classificacao.itensFila);
        resultado.escritas = plano.novas.length;
        resultado.classificadas = classificacao.linhasLedger.length;
        resultado.emFila = classificacao.itensFila.length;
      }

      auditoria.registrar({
        acao: 'IMPORTAR_EXTRATO',
        entidade: A.IMPORT_EXTRATO,
        entidade_id: plano.import_id,
        antes: { linhas_ledger: ledgerLinhas.length },
        depois: { linhas_ledger: ledgerLinhas.length + resultado.classificadas },
        resultado: plano.novas.length ? 'OK' : 'SEM_NOVIDADE',
        detalhe: {
          arquivo: plano.arquivo_nome,
          conta: plano.conta_id,
          novas: plano.novas.length,
          duplicadas: plano.duplicadas.length,
          em_fila: resultado.emFila
        }
      });
      auditoria.persistir();
      return resultado;
    }

    /**
     * Concilia eventos manuais com o ledger.
     * A conciliação vira NOVA VERSÃO da linha do ledger (append-only).
     */
    function conciliarEventos() {
      var agora = relogio.agora();
      var config = repo.config();
      var janela = config.param('JANELA_CONCILIACAO_DIAS').value;
      if (janela === null) janela = 3;
      var todasLinhas = repo.ledger();
      var correntes = FOS.Ledger.visaoCorrente(todasLinhas);
      var eventos = repo.eventos();

      var invalidos = [];
      eventos.forEach(function (e) {
        var v = FOS.Events.validar(e, config);
        if (!v.ok) invalidos.push({ evento_id: e.evento_id, erros: v.erros });
      });

      var naoConciliados = correntes.filter(function (l) { return !l.evento_conciliado_id; });
      var resultado = FOS.Matching.conciliar({
        eventos: eventos.filter(function (e) {
          return invalidos.every(function (i) { return i.evento_id !== e.evento_id; });
        }),
        linhas: naoConciliados,
        janelaDias: Number(janela),
        agora: agora
      });

      var novasVersoes = [];
      resultado.conciliacoes.forEach(function (c) {
        if (c.origem === 'JA_CONCILIADO') return;
        var atual = correntes.filter(function (l) { return l.fingerprint === c.fingerprint; })[0];
        if (!atual) return;
        var alteracoes = { evento_conciliado_id: c.evento_id };
        if (c.categoria_esperada && atual.categoria !== c.categoria_esperada) {
          alteracoes.categoria = c.categoria_esperada;
          alteracoes.universo = FOS.Rules.UNIVERSO_POR_CATEGORIA[c.categoria_esperada];
        }
        novasVersoes.push(FOS.Ledger.reclassificar(atual, alteracoes, agora, ator, 'CONCILIACAO_EVENTO'));
      });

      var filaExistente = {};
      repo.fila().forEach(function (i) { filaExistente[i.item_id] = true; });
      var itensNovos = resultado.itensFila.filter(function (i) { return !filaExistente[i.item_id]; });

      repo.anexar(A.LEDGER, novasVersoes);
      repo.anexar(A.FILA_REVISAO, itensNovos);

      auditoria.registrar({
        acao: 'CONCILIAR_EVENTOS',
        entidade: A.LEDGER,
        entidade_id: '',
        antes: { linhas: todasLinhas.length, conciliadas: correntes.length - naoConciliados.length },
        depois: { linhas: todasLinhas.length + novasVersoes.length },
        resultado: resultado.pendentes.length ? 'PARCIAL' : 'OK',
        detalhe: {
          conciliadas: novasVersoes.length,
          pendentes: resultado.pendentes,
          eventos_invalidos: invalidos
        }
      });
      auditoria.persistir();
      return {
        conciliadas: novasVersoes.length,
        pendentes: resultado.pendentes,
        itensFila: itensNovos,
        eventosInvalidos: invalidos
      };
    }

    /** Reconstrói o contexto histórico a partir dos fechamentos já gravados. */
    function historico(competencia) {
      var fechados = repo.fechamentos().filter(function (f) {
        return String(f.estado) === C.ESTADO_FECHAMENTO.FECHADO
          && String(f.competencia) < String(competencia);
      });
      var porCompetencia = {};
      fechados.forEach(function (f) {
        var atual = porCompetencia[f.competencia];
        if (!atual || Number(f.versao) > Number(atual.versao)) porCompetencia[f.competencia] = f;
      });
      var ordenados = FOS.Core.sortBy(
        Object.keys(porCompetencia).map(function (k) { return porCompetencia[k]; }),
        [function (f) { return String(f.competencia); }]
      );
      var resumos = [];
      var sugeridos = [];
      var historicoProvisoes = {};
      var historicoObjetivos = {};
      ordenados.forEach(function (f) {
        var snapshot;
        try {
          snapshot = JSON.parse(f.snapshot_json);
        } catch (e) {
          return;
        }
        var resumo = FOS.Closing.resumoParaHistorico(snapshot);
        resumos.push(resumo);
        sugeridos.push(snapshot.estado_ciclo.sugerido);
        (snapshot.provisoes || []).forEach(function (p) {
          (historicoProvisoes[p.provisao_id] = historicoProvisoes[p.provisao_id] || [])
            .push({ competencia: snapshot.competencia, valor_acumulado: p.valor_acumulado });
        });
        (snapshot.objetivos || []).forEach(function (o) {
          (historicoObjetivos[o.objetivo_id] = historicoObjetivos[o.objetivo_id] || [])
            .push({ competencia: snapshot.competencia, valor_acumulado: o.valor_acumulado });
        });
      });
      return {
        fechamentos: ordenados,
        resumos: resumos,
        sugeridos: sugeridos,
        estadoFormalAnterior: resumos.length ? resumos[resumos.length - 1].estado_formal : null,
        historicoProvisoes: historicoProvisoes,
        historicoObjetivos: historicoObjetivos,
        ultimoFechamento: ordenados.length ? ordenados[ordenados.length - 1] : null
      };
    }

    function montarContexto(competencia, versao, motivoVersao) {
      var config = repo.config();
      var range = FOS.Dates.competenciaRange(competencia);
      var saldos = repo.saldosTrading();
      var posicoes = FOS.Positions.projetar(repo.posicoes(), { ateData: range.fim });
      var hist = historico(competencia);

      var moedaGerencial = config.param('MOEDA_GERENCIAL').value || C.MOEDA.BRL;
      var exposicao = saldos.some(function (s) {
        var conta = config.conta(s.conta_id);
        return conta && conta.moeda && conta.moeda !== moedaGerencial;
      }) || FOS.Positions.listar(posicoes).some(function (p) {
        return p.moeda && p.moeda !== moedaGerencial;
      });

      var provedor = deps.provedorTaxa || FOS.Adapters.provedorManual(deps.taxas || []);
      var taxa = FOS.Adapters.resolverTaxa(provedor, C.MOEDA.GBP, moedaGerencial, range.fim);
      var taxaAnterior = FOS.Adapters.resolverTaxa(
        provedor, C.MOEDA.GBP, moedaGerencial,
        FOS.Dates.competenciaRange(FOS.Dates.addMonths(competencia, -1)).fim
      );

      return {
        config: config,
        competencia: competencia,
        agora: relogio.agora(),
        ator: ator,
        versao: versao || 1,
        motivoVersao: motivoVersao || 'FECHAMENTO_ORIGINAL',
        linhas: repo.ledger(),
        eventos: repo.eventos(),
        saldos: saldos,
        itensFila: repo.fila(),
        posicoes: posicoes,
        provisoesLinhas: repo.provisoes(),
        objetivosLinhas: repo.objetivos(),
        taxa: taxa,
        taxaAnterior: taxaAnterior,
        exposicaoEstrangeira: exposicao,
        fechamentosAnteriores: hist.resumos,
        sugeridosAnteriores: hist.sugeridos,
        estadoFormalAnterior: hist.estadoFormalAnterior,
        historicoProvisoes: hist.historicoProvisoes,
        historicoObjetivos: hist.historicoObjetivos,
        fechamentoAnterior: hist.ultimoFechamento,
        recalcularChecksum: FOS.Closing.checksumDaLinha
      };
    }

    /** Validação sem escrita: mostra o que impede o fechamento. */
    function revisarCompetencia(competencia) {
      var ctx = montarContexto(competencia);
      var validacao = FOS.Closing.validar(ctx);
      var snapshot = FOS.Closing.montarSnapshot(ctx);
      return { validacao: validacao, snapshot: snapshot, estado: C.ESTADO_FECHAMENTO.EM_REVISAO };
    }

    /** Fecha a competência. Só grava FECHADO se todas as validações passarem. */
    function fecharCompetencia(competencia) {
      var existentes = repo.fechamentos().filter(function (f) {
        return String(f.competencia) === String(competencia);
      });
      var jaFechado = existentes.filter(function (f) {
        return String(f.estado) === C.ESTADO_FECHAMENTO.FECHADO;
      });
      if (jaFechado.length) {
        FOS.Core.fail('COMPETENCIA_JA_FECHADA',
          'Competência já fechada: ' + competencia + '. Use restatement para corrigir.');
      }
      var ctx = montarContexto(competencia, 1, 'FECHAMENTO_ORIGINAL');
      var resultado = FOS.Closing.fechar(ctx);

      if (resultado.validacao.ok) {
        repo.anexar(A.FECHAMENTOS, [resultado.fechamento]);
      }
      auditoria.registrar({
        acao: 'FECHAR_COMPETENCIA',
        entidade: A.FECHAMENTOS,
        entidade_id: resultado.fechamento.fechamento_id,
        antes: { estado: C.ESTADO_FECHAMENTO.ABERTO },
        depois: { estado: resultado.fechamento.estado, checksum: resultado.fechamento.checksum },
        resultado: resultado.validacao.ok ? 'FECHADO' : 'BLOQUEADO',
        detalhe: { violacoes: resultado.validacao.violacoes }
      });
      auditoria.persistir();
      return resultado;
    }

    /** Reapresenta uma competência já fechada, gerando nova versão. */
    function reapresentarCompetencia(competencia, motivo) {
      var fechamentos = repo.fechamentos();
      var origem = FOS.Restatement.versaoVigente(fechamentos, competencia);
      if (!origem) FOS.Core.fail('FECHAMENTO_INEXISTENTE', 'Sem fechamento para ' + competencia);
      var ctx = montarContexto(competencia, Number(origem.versao) + 1, 'RESTATEMENT');
      // O fechamento anterior aqui é a versão que está sendo reapresentada.
      ctx.fechamentoAnterior = origem;
      var resultadoNovo = FOS.Closing.fechar(ctx);
      if (!resultadoNovo.validacao.ok) {
        auditoria.registrar({
          acao: 'RESTATEMENT',
          entidade: A.RESTATEMENTS,
          entidade_id: origem.fechamento_id,
          antes: { versao: origem.versao, checksum: origem.checksum },
          depois: null,
          resultado: 'BLOQUEADO',
          detalhe: { violacoes: resultadoNovo.validacao.violacoes }
        });
        auditoria.persistir();
        return { ok: false, validacao: resultadoNovo.validacao };
      }

      var restatement = FOS.Restatement.criar({
        fechamentoOrigem: origem,
        resultadoNovo: resultadoNovo,
        motivo: motivo,
        agora: relogio.agora(),
        ator: ator
      });

      repo.anexar(A.FECHAMENTOS, [restatement.fechamentoNovo]);
      repo.anexar(A.RESTATEMENTS, [restatement.linhaRestatement]);
      auditoria.registrar({
        acao: 'RESTATEMENT',
        entidade: A.RESTATEMENTS,
        entidade_id: restatement.linhaRestatement.restatement_id,
        antes: { versao: origem.versao, checksum: origem.checksum },
        depois: { versao: restatement.fechamentoNovo.versao, checksum: restatement.fechamentoNovo.checksum },
        resultado: 'OK',
        detalhe: { motivo: motivo, campos_alterados: restatement.campos_alterados }
      });
      auditoria.persistir();
      return { ok: true, restatement: restatement, resultado: resultadoNovo };
    }

    /** View-model somente leitura da competência (para o dashboard da próxima onda). */
    function viewModel(competencia, opcoes) {
      var vigente = FOS.Restatement.versaoVigente(repo.fechamentos(), competencia);
      if (!vigente) return FOS.ViewModel.construir(null, {});
      var snapshot;
      try {
        snapshot = JSON.parse(vigente.snapshot_json);
      } catch (e) {
        return FOS.ViewModel.construir(null, { erro: 'SNAPSHOT_ILEGIVEL' });
      }
      var opts = opcoes || {};
      opts.agora = opts.agora || relogio.hoje();
      if (opts.maxIdadeDias === undefined) {
        var maxIdade = repo.config().param('MAX_IDADE_VIEWMODEL_DIAS').value;
        if (maxIdade !== null) opts.maxIdadeDias = Number(maxIdade);
      }
      return FOS.ViewModel.construir(snapshot, opts);
    }

    return {
      auditoria: auditoria,
      importarExtrato: importarExtrato,
      conciliarEventos: conciliarEventos,
      revisarCompetencia: revisarCompetencia,
      fecharCompetencia: fecharCompetencia,
      reapresentarCompetencia: reapresentarCompetencia,
      viewModel: viewModel,
      montarContexto: montarContexto,
      historico: historico,
      classificarLinhas: classificarLinhas
    };
  }

  FOS.App.criarWorkflows = criar;
})(typeof globalThis !== 'undefined' ? globalThis : this);
