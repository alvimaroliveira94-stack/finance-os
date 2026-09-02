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

    /**
     * Provedor usado para LER taxa (fechamento, painel, diagnóstico).
     * Ordem: override de teste -> tabela injetada -> cache da aba 00.
     * Nunca é o provedor externo: leitura não faz rede.
     */
    function provedorDeLeitura(config) {
      if (deps.provedorTaxa) return deps.provedorTaxa;
      if (deps.taxas) return FOS.Adapters.provedorManual(deps.taxas);
      return FOS.Adapters.provedorCache(repo.configLinhas());
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

      // O fechamento NUNCA chama a rede: ele lê a taxa já materializada na
      // aba 00 (cache). Buscar cotação é trabalho de atualizarCacheTaxas, que
      // é uma ação separada e explícita. Assim reprocessar um mês antigo usa
      // exatamente a taxa da época, e o fechamento é determinístico e offline.
      var provedor = provedorDeLeitura(config);
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

    /**
     * Competências com movimento no ledger, anteriores à informada, que ainda
     * não foram fechadas. Só conta a partir de COMPETENCIA_INICIAL_CAIXA_VIDA,
     * para que histórico importado de antes do início do sistema não bloqueie
     * nada para sempre.
     */
    function competenciasAnterioresEmAberto(competencia) {
      var config = repo.config();
      var inicial = config.param(FOS.Life.PARAM_COMPETENCIA_INICIAL).value;
      var fechadas = {};
      competenciasFechadas().forEach(function (c) { fechadas[c] = true; });

      var comMovimento = {};
      FOS.Ledger.visaoCorrente(repo.ledger()).forEach(function (l) {
        var comp = FOS.Dates.competenciaOf(String(l.data_origem));
        if (comp >= String(competencia)) return;
        if (inicial && comp < String(inicial)) return;
        if (fechadas[comp]) return;
        comMovimento[comp] = true;
      });
      return Object.keys(comMovimento).sort();
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

      // Fechar fora de ordem quebra o significado de "fechamentos
      // consecutivos" do estado do ciclo: o mês mais novo não enxergaria o
      // mais antigo como histórico, e o mais antigo, fechado depois, também
      // não corrigiria o que já foi congelado.
      var pendentesAnteriores = competenciasAnterioresEmAberto(competencia);
      if (pendentesAnteriores.length) {
        FOS.Core.fail('COMPETENCIA_ANTERIOR_EM_ABERTO',
          'Feche primeiro, em ordem: ' + pendentesAnteriores.join(', ')
            + '. O estado do ciclo depende de fechamentos consecutivos.',
          { competencia: competencia, pendentes: pendentesAnteriores });
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


    /* ---------------------------------------------------------------- */
    /* Onda 2: fluxos operacionais que fechavam o ciclo pela metade      */
    /* ---------------------------------------------------------------- */

    /** Competências já fechadas: usadas para proteger período fechado. */
    function competenciasFechadas() {
      var fechadas = {};
      repo.fechamentos().forEach(function (f) {
        if (String(f.estado) === C.ESTADO_FECHAMENTO.FECHADO) fechadas[String(f.competencia)] = true;
      });
      return Object.keys(fechadas).sort();
    }

    /**
     * Reclassificação manual de uma linha do ledger.
     * A origem é imutável (Ledger.reclassificar recusa), a competência
     * precisa estar aberta e a decisão vem SEMPRE do usuário: não existe
     * caminho aqui que escolha categoria sozinho.
     */
    function reclassificarLinha(params) {
      var agora = relogio.agora();
      var referencia = String(params.referencia || '').trim();
      var categoria = String(params.categoria || '').trim().toUpperCase();
      if (!referencia) FOS.Core.fail('REFERENCIA_OBRIGATORIA', 'Informe a referência da linha do ledger');
      if (!C.isValid(C.CATEGORIA, categoria)) {
        FOS.Core.fail('CATEGORIA_NAO_CANONICA',
          'Categoria fora do catálogo canônico: ' + params.categoria,
          { categorias: C.values(C.CATEGORIA) });
      }

      var correntes = FOS.Ledger.visaoCorrente(repo.ledger());
      var alvos = correntes.filter(function (l) {
        return String(l.fingerprint) === referencia
          || String(l.fingerprint).slice(0, 12) === referencia;
      });
      if (!alvos.length) FOS.Core.fail('LINHA_INEXISTENTE', 'Nenhuma linha do ledger com referência ' + referencia);
      if (alvos.length > 1) FOS.Core.fail('REFERENCIA_AMBIGUA', 'Mais de uma linha com a referência ' + referencia);
      var atual = alvos[0];

      var competencia = FOS.Dates.competenciaOf(String(atual.data_origem));
      if (competenciasFechadas().indexOf(competencia) !== -1) {
        FOS.Core.fail('PERIODO_FECHADO',
          'A competência ' + competencia + ' já está fechada. Use restatement para corrigi-la.',
          { competencia: competencia });
      }

      if (atual.categoria === categoria
        && String(atual.subcategoria || '') === String(params.subcategoria || '')) {
        auditoria.registrar({
          acao: 'RECLASSIFICAR_LINHA',
          ator: params.ator || ator,
          entidade: A.LEDGER,
          entidade_id: atual.linha_id,
          antes: { categoria: atual.categoria, subcategoria: atual.subcategoria },
          depois: { categoria: categoria, subcategoria: params.subcategoria || '' },
          resultado: 'SEM_MUDANCA',
          detalhe: 'Reclassificação idempotente: categoria já era essa.'
        });
        auditoria.persistir();
        return { ok: true, alterado: false, linha: atual };
      }

      var nova = FOS.Ledger.reclassificar(atual, {
        categoria: categoria,
        subcategoria: params.subcategoria || '',
        universo: FOS.Rules.UNIVERSO_POR_CATEGORIA[categoria],
        regra_id: 'MANUAL',
        regra_versao: '',
        confianca: 1
      }, agora, params.ator || ator, params.motivo || 'RECLASSIFICACAO_MANUAL');

      repo.anexar(A.LEDGER, [nova]);
      auditoria.registrar({
        acao: 'RECLASSIFICAR_LINHA',
        ator: params.ator || ator,
        entidade: A.LEDGER,
        entidade_id: nova.linha_id,
        antes: {
          categoria: atual.categoria, subcategoria: atual.subcategoria,
          universo: atual.universo, versao: atual.versao_gerencial
        },
        depois: {
          categoria: nova.categoria, subcategoria: nova.subcategoria,
          universo: nova.universo, versao: nova.versao_gerencial
        },
        resultado: 'OK',
        detalhe: { motivo: params.motivo || 'RECLASSIFICACAO_MANUAL', competencia: competencia }
      });
      auditoria.persistir();
      return { ok: true, alterado: true, linha: nova, versao_anterior: atual };
    }

    /**
     * Resolve um item da fila de revisão.
     * Exige escolha explícita do usuário: sem `categoria` (para item de
     * classificação) ou sem `fingerprint` (para item de conciliação) o
     * workflow recusa. Nunca deduz a resposta.
     * Idempotente: item já resolvido devolve SEM_MUDANCA sem escrever nada.
     */
    function resolverItemFila(params) {
      var agora = relogio.agora();
      var itemId = String(params.item_id || '').trim();
      var itens = repo.fila();
      var item = itens.filter(function (i) { return String(i.item_id) === itemId; })[0];
      if (!item) FOS.Core.fail('ITEM_FILA_INEXISTENTE', 'Item não encontrado na fila: ' + itemId);

      if (String(item.status) !== C.STATUS_FILA.ABERTO) {
        auditoria.registrar({
          acao: 'RESOLVER_ITEM_FILA',
          entidade: A.FILA_REVISAO,
          entidade_id: itemId,
          antes: { status: item.status },
          depois: { status: item.status },
          resultado: 'SEM_MUDANCA',
          detalhe: 'Item já estava resolvido.'
        });
        auditoria.persistir();
        return { ok: true, alterado: false, item: item };
      }

      var decisao = String(params.decisao || '').trim().toUpperCase();
      if (['CLASSIFICAR', 'CONCILIAR', 'DESCARTAR'].indexOf(decisao) === -1) {
        FOS.Core.fail('DECISAO_OBRIGATORIA',
          'Informe a decisão: CLASSIFICAR, CONCILIAR ou DESCARTAR',
          { item_id: itemId, motivo: item.motivo });
      }

      var resultadoLedger = null;
      if (decisao === 'CLASSIFICAR') {
        if (!params.categoria) {
          FOS.Core.fail('CATEGORIA_OBRIGATORIA',
            'Resolver por classificação exige a categoria escolhida pelo usuário',
            { item_id: itemId, categorias: C.values(C.CATEGORIA) });
        }
        // A linha pode nunca ter entrado no ledger (não havia regra que a
        // classificasse). Nesse caso ela entra agora, como versão 1, com a
        // categoria que o usuário escolheu.
        var jaNoLedger = FOS.Ledger.visaoCorrente(repo.ledger()).some(function (l) {
          return String(l.fingerprint) === String(item.referencia);
        });
        resultadoLedger = jaNoLedger
          ? reclassificarLinha({
            referencia: item.referencia,
            categoria: params.categoria,
            subcategoria: params.subcategoria,
            motivo: 'RESOLUCAO_FILA:' + itemId,
            ator: params.ator
          })
          : classificarPendente({
            fingerprint: item.referencia,
            categoria: params.categoria,
            subcategoria: params.subcategoria,
            motivo: 'RESOLUCAO_FILA:' + itemId,
            ator: params.ator
          });
      } else if (decisao === 'CONCILIAR') {
        if (!params.fingerprint) {
          FOS.Core.fail('FINGERPRINT_OBRIGATORIO',
            'Resolver conciliação exige a linha escolhida pelo usuário',
            { item_id: itemId, candidatos: item.candidatos });
        }
        resultadoLedger = conciliarManualmente({
          evento_id: item.referencia,
          fingerprint: params.fingerprint,
          motivo: 'RESOLUCAO_FILA:' + itemId,
          ator: params.ator
        });
      }

      var resolvido = FOS.Queue.resolver(
        item,
        decisao + (params.categoria ? ':' + params.categoria : '')
          + (params.fingerprint ? ':' + String(params.fingerprint).slice(0, 12) : ''),
        agora,
        params.ator || 'USUARIO'
      );
      // A fila é uma projeção de trabalho pendente: reescrevê-la inteira
      // mantém um item por linha, sem duplicar histórico (que vive na aba 90).
      repo.substituir(A.FILA_REVISAO, itens.map(function (i) {
        return String(i.item_id) === itemId ? resolvido : i;
      }));

      auditoria.registrar({
        acao: 'RESOLVER_ITEM_FILA',
        ator: params.ator || 'USUARIO',
        entidade: A.FILA_REVISAO,
        entidade_id: itemId,
        antes: { status: item.status, motivo: item.motivo, referencia: item.referencia },
        depois: { status: resolvido.status, resolucao: resolvido.resolucao },
        resultado: 'OK',
        detalhe: {
          decisao: decisao,
          ledger_alterado: resultadoLedger ? resultadoLedger.alterado : false
        }
      });
      auditoria.persistir();
      return { ok: true, alterado: true, item: resolvido, ledger: resultadoLedger };
    }

    /**
     * Classifica uma linha que está no staging (aba 10) e ainda não entrou no
     * ledger, porque nenhuma regra a cobria. A categoria vem do usuário.
     */
    function classificarPendente(params) {
      var agora = relogio.agora();
      var categoria = String(params.categoria || '').trim().toUpperCase();
      if (!C.isValid(C.CATEGORIA, categoria)) {
        FOS.Core.fail('CATEGORIA_NAO_CANONICA',
          'Categoria fora do catálogo canônico: ' + params.categoria,
          { categorias: C.values(C.CATEGORIA) });
      }
      var staging = repo.staging().filter(function (l) {
        return String(l.fingerprint) === String(params.fingerprint);
      })[0];
      if (!staging) {
        FOS.Core.fail('LINHA_INEXISTENTE',
          'Nenhuma linha em staging com fingerprint ' + params.fingerprint);
      }
      var competencia = FOS.Dates.competenciaOf(String(staging.data));
      if (competenciasFechadas().indexOf(competencia) !== -1) {
        FOS.Core.fail('PERIODO_FECHADO', 'Competência já fechada: ' + competencia);
      }

      var nova = FOS.Ledger.novaLinha(staging, {
        categoria: categoria,
        subcategoria: params.subcategoria || '',
        universo: FOS.Rules.UNIVERSO_POR_CATEGORIA[categoria],
        regra_id: 'MANUAL',
        regra_versao: '',
        confianca: 1
      }, agora, params.ator || 'USUARIO');
      nova.motivo_versao = params.motivo || 'CLASSIFICACAO_MANUAL';

      repo.anexar(A.LEDGER, [nova]);
      auditoria.registrar({
        acao: 'CLASSIFICAR_PENDENTE',
        ator: params.ator || 'USUARIO',
        entidade: A.LEDGER,
        entidade_id: nova.linha_id,
        antes: { categoria: null, origem: 'STAGING', fingerprint: staging.fingerprint },
        depois: { categoria: nova.categoria, universo: nova.universo, versao: 1 },
        resultado: 'OK',
        detalhe: { motivo: params.motivo || 'CLASSIFICACAO_MANUAL', competencia: competencia }
      });
      return { ok: true, alterado: true, linha: nova };
    }

    /** Conciliação escolhida à mão (sai da fila de ambiguidade). */
    function conciliarManualmente(params) {
      var agora = relogio.agora();
      var eventos = repo.eventos();
      var evento = eventos.filter(function (e) { return String(e.evento_id) === String(params.evento_id); })[0];
      if (!evento) FOS.Core.fail('EVENTO_INEXISTENTE', 'Evento não encontrado: ' + params.evento_id);

      var correntes = FOS.Ledger.visaoCorrente(repo.ledger());
      var alvos = correntes.filter(function (l) {
        return String(l.fingerprint) === String(params.fingerprint)
          || String(l.fingerprint).slice(0, 12) === String(params.fingerprint);
      });
      if (!alvos.length) FOS.Core.fail('LINHA_INEXISTENTE', 'Linha não encontrada: ' + params.fingerprint);
      var atual = alvos[0];

      if (String(atual.evento_conciliado_id || '') === String(evento.evento_id)) {
        return { ok: true, alterado: false, linha: atual };
      }
      if (atual.evento_conciliado_id) {
        FOS.Core.fail('LINHA_JA_CONCILIADA',
          'Linha já conciliada com o evento ' + atual.evento_conciliado_id);
      }
      var competencia = FOS.Dates.competenciaOf(String(atual.data_origem));
      if (competenciasFechadas().indexOf(competencia) !== -1) {
        FOS.Core.fail('PERIODO_FECHADO', 'Competência já fechada: ' + competencia);
      }

      var expectativa = FOS.Events.expectativaConciliacao(evento);
      var alteracoes = { evento_conciliado_id: evento.evento_id };
      if (expectativa && expectativa.categoria_esperada && atual.categoria !== expectativa.categoria_esperada) {
        alteracoes.categoria = expectativa.categoria_esperada;
        alteracoes.universo = FOS.Rules.UNIVERSO_POR_CATEGORIA[expectativa.categoria_esperada];
      }
      var nova = FOS.Ledger.reclassificar(atual, alteracoes, agora,
        params.ator || ator, params.motivo || 'CONCILIACAO_MANUAL');
      repo.anexar(A.LEDGER, [nova]);
      auditoria.registrar({
        acao: 'CONCILIAR_MANUALMENTE',
        ator: params.ator || 'USUARIO',
        entidade: A.LEDGER,
        entidade_id: nova.linha_id,
        antes: { evento_conciliado_id: atual.evento_conciliado_id || '', categoria: atual.categoria },
        depois: { evento_conciliado_id: nova.evento_conciliado_id, categoria: nova.categoria },
        resultado: 'OK',
        detalhe: { evento_id: evento.evento_id, motivo: params.motivo || 'CONCILIACAO_MANUAL' }
      });
      return { ok: true, alterado: true, linha: nova };
    }

    /**
     * Materializa eventos declarativos nos subledgers.
     *  NOVA_OBRIGACAO  -> nova versão em 30_PROVISOES
     *  NOVO_OBJETIVO   -> nova versão em 31_OBJETIVOS
     *  APORTE_POSICAO  -> evento APORTE em 32_LEDGER_POSICOES
     *  RETIRADA_POSICAO-> evento RETIRADA em 32_LEDGER_POSICOES
     * Idempotente: cada evento manual materializa no máximo uma vez, e a
     * origem do registro fica gravada em origem_evento_id / evento_id.
     */
    function materializarEventos() {
      var agora = relogio.agora();
      var config = repo.config();
      var eventos = repo.eventos();
      var provisoesLinhas = repo.provisoes();
      var objetivosLinhas = repo.objetivos();
      var posicoesLinhas = repo.posicoes();

      var provisoesNovas = [];
      var objetivosNovos = [];
      var posicoesNovas = [];
      var ignorados = [];
      var invalidos = [];

      function jaMaterializado(linhas, campo, eventoId) {
        return (linhas || []).some(function (l) { return String(l[campo] || '') === String(eventoId); });
      }

      FOS.Core.sortBy(eventos, [
        function (e) { return String(e.data); },
        function (e) { return String(e.evento_id); }
      ]).forEach(function (evento) {
        var tipo = String(evento.tipo_evento || '').toUpperCase();
        if (String(evento.status || '') === FOS.Events.STATUS_EVENTO.CANCELADO) return;
        // Tipo desconhecido nunca é "não é para materializar": é erro de
        // declaração e precisa aparecer. Sem esta separação, um tipo_evento
        // com acento ou espaço caía no mesmo `return` silencioso dos três
        // tipos que legitimamente não materializam nada.
        if (!FOS.Events.tipoConhecido(tipo)) {
          invalidos.push({
            evento_id: evento.evento_id,
            erros: [{ codigo: 'TIPO_EVENTO_INVALIDO', detalhe: String(evento.tipo_evento) }]
          });
          return;
        }
        if ([C.TIPO_EVENTO.NOVA_OBRIGACAO, C.TIPO_EVENTO.NOVO_OBJETIVO,
          C.TIPO_EVENTO.APORTE_POSICAO, C.TIPO_EVENTO.RETIRADA_POSICAO].indexOf(tipo) === -1) return;

        var validacao = FOS.Events.validar(evento, config);
        if (!validacao.ok) {
          invalidos.push({ evento_id: evento.evento_id, erros: validacao.erros });
          return;
        }
        var valor = FOS.Normalize.valor(evento.valor);
        var referencia = String(evento.referencia_id).trim();

        if (tipo === C.TIPO_EVENTO.NOVA_OBRIGACAO) {
          if (jaMaterializado(provisoesLinhas.concat(provisoesNovas), 'origem_evento_id', evento.evento_id)) {
            ignorados.push({ evento_id: evento.evento_id, motivo: 'JA_MATERIALIZADO' });
            return;
          }
          var provisaoAtual = FOS.Subledger.correntes(
            provisoesLinhas.concat(provisoesNovas), 'provisao_id'
          ).filter(function (p) { return String(p.provisao_id) === referencia; })[0];
          var novaProvisao = provisaoAtual
            ? FOS.Subledger.novaVersao(provisaoAtual, {
              valor_alvo: valor,
              vencimento: evento.data,
              origem_evento_id: evento.evento_id
            }, agora, 'NOVA_OBRIGACAO:' + evento.evento_id)
            : {
              provisao_id: referencia,
              versao: 1,
              nome: evento.descricao || referencia,
              valor_alvo: valor,
              valor_acumulado: 0,
              vencimento: evento.data,
              prioridade: FOS.Config.parseNumber(evento.observacao) || 5,
              moeda: String(evento.moeda || C.MOEDA.BRL).toUpperCase(),
              origem_evento_id: evento.evento_id,
              vigente_desde: String(evento.data),
              vigente_ate: '',
              criado_em: agora,
              motivo_versao: 'CRIADA_POR_EVENTO:' + evento.evento_id,
              observacao: ''
            };
          provisoesNovas.push(novaProvisao);
          return;
        }

        if (tipo === C.TIPO_EVENTO.NOVO_OBJETIVO) {
          if (jaMaterializado(objetivosLinhas.concat(objetivosNovos), 'origem_evento_id', evento.evento_id)) {
            ignorados.push({ evento_id: evento.evento_id, motivo: 'JA_MATERIALIZADO' });
            return;
          }
          var objetivoAtual = FOS.Subledger.correntes(
            objetivosLinhas.concat(objetivosNovos), 'objetivo_id'
          ).filter(function (o) { return String(o.objetivo_id) === referencia; })[0];
          var novoObjetivo = objetivoAtual
            ? FOS.Subledger.novaVersao(objetivoAtual, {
              valor_alvo: valor,
              prazo: evento.data,
              origem_evento_id: evento.evento_id
            }, agora, 'NOVO_OBJETIVO:' + evento.evento_id)
            : {
              objetivo_id: referencia,
              versao: 1,
              nome: evento.descricao || referencia,
              valor_alvo: valor,
              valor_acumulado: 0,
              prazo: evento.data,
              prioridade: 5,
              moeda: String(evento.moeda || C.MOEDA.BRL).toUpperCase(),
              origem_evento_id: evento.evento_id,
              vigente_desde: String(evento.data),
              vigente_ate: '',
              criado_em: agora,
              motivo_versao: 'CRIADO_POR_EVENTO:' + evento.evento_id,
              observacao: ''
            };
          objetivosNovos.push(novoObjetivo);
          return;
        }

        // APORTE_POSICAO / RETIRADA_POSICAO
        var eventoIdPosicao = 'PE-' + FOS.Hash.hashParts([evento.evento_id, tipo]).slice(0, 12);
        if (jaMaterializado(posicoesLinhas.concat(posicoesNovas), 'origem', evento.evento_id)
          || jaMaterializado(posicoesLinhas.concat(posicoesNovas), 'evento_id', eventoIdPosicao)) {
          ignorados.push({ evento_id: evento.evento_id, motivo: 'JA_MATERIALIZADO' });
          return;
        }
        posicoesNovas.push({
          evento_id: eventoIdPosicao,
          posicao_id: referencia,
          tipo_evento: tipo === C.TIPO_EVENTO.APORTE_POSICAO
            ? C.EVENTO_POSICAO.APORTE : C.EVENTO_POSICAO.RETIRADA,
          data: evento.data,
          valor: valor,
          moeda: String(evento.moeda || C.MOEDA.BRL).toUpperCase(),
          quantidade: '',
          compensa_evento_id: '',
          origem: evento.evento_id,
          criado_em: agora,
          observacao: evento.descricao || ''
        });
      });

      repo.anexar(A.PROVISOES, provisoesNovas);
      repo.anexar(A.OBJETIVOS, objetivosNovos);
      repo.anexar(A.POSICOES, posicoesNovas);

      if (provisoesNovas.length || objetivosNovos.length || posicoesNovas.length || invalidos.length) {
        auditoria.registrar({
          acao: 'MATERIALIZAR_EVENTOS',
          entidade: 'SUBLEDGERS',
          entidade_id: '',
          antes: {
            provisoes: provisoesLinhas.length,
            objetivos: objetivosLinhas.length,
            posicoes: posicoesLinhas.length
          },
          depois: {
            provisoes: provisoesLinhas.length + provisoesNovas.length,
            objetivos: objetivosLinhas.length + objetivosNovos.length,
            posicoes: posicoesLinhas.length + posicoesNovas.length
          },
          resultado: invalidos.length ? 'PARCIAL' : 'OK',
          detalhe: { ignorados: ignorados, invalidos: invalidos }
        });
        auditoria.persistir();
      }

      return {
        provisoes: provisoesNovas,
        objetivos: objetivosNovos,
        posicoes: posicoesNovas,
        ignorados: ignorados,
        invalidos: invalidos
      };
    }

    /**
     * Registro manual de evento de posição.
     * Cobre DISTRIBUICAO e SNAPSHOT_VALOR_MERCADO, que não vêm de evento
     * declarativo. Append-only: correção é sempre evento compensatório.
     */
    function registrarEventoPosicao(params) {
      var agora = relogio.agora();
      var existentes = repo.posicoes();
      var evento = {
        evento_id: String(params.evento_id || ('PM-' + FOS.Hash.hashParts([
          params.posicao_id, params.tipo_evento, params.data, params.valor
        ]).slice(0, 12))),
        posicao_id: String(params.posicao_id || ''),
        tipo_evento: String(params.tipo_evento || '').toUpperCase(),
        data: String(params.data || ''),
        valor: FOS.Normalize.valor(params.valor),
        moeda: String(params.moeda || C.MOEDA.BRL).toUpperCase(),
        quantidade: params.quantidade === undefined || params.quantidade === null ? '' : params.quantidade,
        compensa_evento_id: String(params.compensa_evento_id || ''),
        origem: params.origem || 'MANUAL',
        criado_em: agora,
        observacao: params.observacao || ''
      };

      if (existentes.some(function (e) { return String(e.evento_id) === evento.evento_id; })) {
        auditoria.registrar({
          acao: 'REGISTRAR_EVENTO_POSICAO',
          entidade: A.POSICOES,
          entidade_id: evento.evento_id,
          antes: { eventos: existentes.length },
          depois: { eventos: existentes.length },
          resultado: 'SEM_MUDANCA',
          detalhe: 'Evento de posição já registrado.'
        });
        auditoria.persistir();
        return { ok: true, alterado: false, evento: evento };
      }

      var validacao = FOS.Positions.validarEvento(evento, existentes);
      if (!validacao.ok) {
        auditoria.registrar({
          acao: 'REGISTRAR_EVENTO_POSICAO',
          entidade: A.POSICOES,
          entidade_id: evento.evento_id,
          antes: { eventos: existentes.length },
          depois: { eventos: existentes.length },
          resultado: 'REJEITADO',
          detalhe: { erros: validacao.erros }
        });
        auditoria.persistir();
        return { ok: false, alterado: false, erros: validacao.erros };
      }

      repo.anexar(A.POSICOES, [evento]);
      auditoria.registrar({
        acao: 'REGISTRAR_EVENTO_POSICAO',
        entidade: A.POSICOES,
        entidade_id: evento.evento_id,
        antes: { eventos: existentes.length },
        depois: { eventos: existentes.length + 1, tipo: evento.tipo_evento, valor: evento.valor },
        resultado: 'OK',
        detalhe: { posicao_id: evento.posicao_id, compensa: evento.compensa_evento_id || null }
      });
      auditoria.persistir();
      return { ok: true, alterado: true, evento: evento };
    }

    /** Correção de evento de posição: só por evento compensatório. */
    function compensarEventoPosicao(params) {
      var existentes = repo.posicoes();
      var original = existentes.filter(function (e) {
        return String(e.evento_id) === String(params.evento_id);
      })[0];
      if (!original) FOS.Core.fail('EVENTO_POSICAO_INEXISTENTE', 'Evento não encontrado: ' + params.evento_id);
      if (!params.motivo) FOS.Core.fail('MOTIVO_OBRIGATORIO', 'Compensação exige motivo explícito');

      var tipo = String(original.tipo_evento).toUpperCase();
      if (tipo === C.EVENTO_POSICAO.SNAPSHOT_VALOR_MERCADO) {
        if (params.valor === undefined || params.valor === null) {
          FOS.Core.fail('VALOR_OBRIGATORIO', 'Corrigir snapshot exige o novo valor de mercado');
        }
        return registrarEventoPosicao({
          posicao_id: original.posicao_id,
          tipo_evento: C.EVENTO_POSICAO.SNAPSHOT_VALOR_MERCADO,
          data: params.data || original.data,
          valor: params.valor,
          moeda: original.moeda,
          compensa_evento_id: original.evento_id,
          origem: 'COMPENSACAO',
          observacao: params.motivo
        });
      }
      var compensatorio = FOS.Positions.eventoCompensatorio(
        original,
        'PC-' + FOS.Hash.hashParts([original.evento_id, 'COMPENSA']).slice(0, 12),
        relogio.agora(),
        params.motivo
      );
      return registrarEventoPosicao(compensatorio);
    }

    /**
     * Diagnóstico de setup: o que exatamente impede o primeiro fechamento.
     * Não corrige nada — explica.
     */
    function diagnosticoSetup(competencia) {
      var config = repo.config();
      var bloqueios = [];
      var avisos = [];

      var parametrosCriticos = [
        { chave: FOS.Life.PARAM_SALDO_INICIAL, porque: 'Sem saldo inicial não há caixa de vida, disponível nem runway.' },
        { chave: FOS.Life.PARAM_COMPETENCIA_INICIAL, porque: 'Define a partir de quando o ledger conta para o caixa.' },
        { chave: 'MOEDA_GERENCIAL', porque: 'Define a moeda de consolidação do patrimônio.' },
        { chave: FOS.State.PARAM_RUNWAY_ESTABILIZANDO, porque: 'Sem limiar não há estado do ciclo.' },
        { chave: FOS.State.PARAM_RUNWAY_ESTAVEL, porque: 'Sem limiar não há estado do ciclo.' },
        { chave: FOS.State.PARAM_RUNWAY_EXPANSAO, porque: 'Sem limiar não há estado do ciclo.' },
        { chave: FOS.Signals.PARAM_LIMITE_GASTO_EXTRA, porque: 'Sem limite não há sinal de gasto extraordinário anormal.' },
        { chave: FOS.Signals.PARAM_QUEDA_RUNWAY, porque: 'Sem percentual não há sinal de queda de runway.' },
        { chave: FOS.Signals.PARAM_MES_FORTE, porque: 'Sem percentual não há leitura de mês forte.' }
      ];
      parametrosCriticos.forEach(function (p) {
        var valor = config.param(p.chave);
        if (valor.value === null) {
          bloqueios.push({
            codigo: 'PARAMETRO_INDISPONIVEL',
            chave: p.chave,
            status: valor.status,
            reason: valor.reason,
            impacto: p.porque
          });
        }
      });

      // A URL do provedor de taxa só é pendência sob política HTTP. Sob
      // MANUAL — o padrão do V1 — a ausência dela é decisão tomada, e cobrá-la
      // seria pedir uma ação que não existe. O parâmetro continua no catálogo
      // para quando a política mudar; ver Adapters.exigeUrlDoProvedor.
      var exigeUrlTaxa = FOS.Adapters.exigeUrlDoProvedor(config);
      if (exigeUrlTaxa && config.param(FOS.Adapters.PARAM_URL_PROVEDOR_TAXA).value === null) {
        avisos.push({
          codigo: 'URL_PROVEDOR_TAXA_AUSENTE',
          chave: FOS.Adapters.PARAM_URL_PROVEDOR_TAXA,
          reason: config.param(FOS.Adapters.PARAM_URL_PROVEDOR_TAXA).reason,
          impacto: 'Não impede o fechamento. A política de câmbio está em HTTP, mas sem URL '
            + 'nenhuma cotação é consultada: publique a taxa pelo menu Finance OS > '
            + 'Publicar taxa do mês, ou volte a política para MANUAL.'
        });
      }

      // Parâmetro DEPRECIADO não entra aqui: a decisão sobre ele já foi
      // tomada, e cobrá-lo de novo seria pedir algo que o sistema não usa.
      Object.keys(config.parametros).forEach(function (chave) {
        var p = config.parametros[chave];
        if (chave === FOS.Adapters.PARAM_URL_PROVEDOR_TAXA) return;
        if (p.status === C.STATUS_PARAMETRO.BLOQUEADO
          && !parametrosCriticos.some(function (c) { return c.chave === chave; })) {
          avisos.push({
            codigo: 'PARAMETRO_BLOQUEADO',
            chave: chave,
            reason: p.reason,
            // Sem afirmar que existem cálculos dependentes: se e quando algum
            // passar a usá-lo, o resultado é null com motivo, nunca um zero.
            impacto: 'Não impede o fechamento. Enquanto estiver bloqueado, '
              + 'qualquer cálculo que venha a usá-lo devolve null com motivo.'
          });
        }
      });

      // Um evento declarado com campo inválido não materializa nada e não
      // conciliaria: antes ele sumia em silêncio, agora aparece aqui.
      var eventosInvalidos = [];
      repo.eventos().forEach(function (e) {
        if (String(e.status || '') === FOS.Events.STATUS_EVENTO.CANCELADO) return;
        var v = FOS.Events.validar(e, config);
        if (!v.ok) {
          eventosInvalidos.push({
            evento_id: String(e.evento_id || '(sem evento_id)'),
            erros: v.erros
          });
        }
      });
      if (eventosInvalidos.length) {
        avisos.push({
          codigo: 'EVENTOS_MANUAIS_INVALIDOS',
          chave: A.EVENTOS_MANUAIS,
          reason: eventosInvalidos.map(function (i) {
            return i.evento_id + ': ' + i.erros.map(function (e) { return e.codigo; }).join(', ');
          }).join(' | '),
          impacto: eventosInvalidos.length + ' evento(s) da aba ' + A.EVENTOS_MANUAIS
            + ' não serão materializados nem conciliados enquanto tiverem esses erros.',
          eventos: eventosInvalidos
        });
      }

      var contas = Object.keys(config.contas).map(function (k) { return config.contas[k]; });
      if (!contas.filter(function (c) { return FOS.Accounts.elegibilidadeImportacao(c).elegivel; }).length) {
        bloqueios.push({
          codigo: 'SEM_CONTA_ELEGIVEL',
          chave: 'CONTA',
          impacto: 'Nenhuma conta de vida ativa e elegível: não há como importar extrato.'
        });
      }
      if (!contas.filter(function (c) { return c.universo === C.UNIVERSO.TRADING && c.ativa; }).length) {
        avisos.push({
          codigo: 'SEM_CONTA_TRADING',
          chave: 'CONTA',
          impacto: 'Sem conta de trading ativa as métricas de trading ficam indisponíveis.'
        });
      }
      if (!repo.regras().length) {
        bloqueios.push({
          codigo: 'SEM_REGRAS_CLASSIFICACAO',
          chave: A.REGRAS,
          impacto: 'Sem regra nenhuma linha é classificada: tudo cairia na fila de revisão.'
        });
      }

      var validacao = null;
      if (competencia) {
        try {
          var estadoTaxas = taxasPublicadas(competencia);
          validacao = FOS.Closing.validar(montarContexto(competencia));
          validacao.violacoes.forEach(function (v) {
            // A falta de taxa é o bloqueio mais comum e o mais fácil de
            // resolver: vale dizer o que fazer, não só qual invariante falhou.
            if (v.codigo === 'TAXA_CAMBIAL_DISPONIVEL') {
              bloqueios.push({
                codigo: 'TAXA_CAMBIO_NAO_PUBLICADA',
                chave: competencia,
                reason: v.detalhe,
                impacto: 'Publique a taxa ' + estadoTaxas.par + ' de ' + competencia
                  + ' (data de referência ' + estadoTaxas.atual.data_referencia + ') pelo menu '
                  + 'Finance OS > Publicar taxa do mês.'
              });
              return;
            }
            bloqueios.push({
              codigo: v.codigo,
              chave: competencia,
              reason: v.detalhe,
              impacto: 'Invariante do fechamento não satisfeita.'
            });
          });
          if (estadoTaxas.atual.publicada && !estadoTaxas.anterior.publicada) {
            avisos.push({
              codigo: 'TAXA_CAMBIO_ANTERIOR_NAO_PUBLICADA',
              chave: estadoTaxas.anterior.competencia,
              reason: estadoTaxas.anterior.reason,
              impacto: 'O mês fecha, mas o efeito cambial fica null com motivo: '
                + 'ele compara a taxa de ' + competencia + ' com a de '
                + estadoTaxas.anterior.competencia + '.'
            });
          }
        } catch (e) {
          bloqueios.push({
            codigo: e.code || 'ERRO_DE_VALIDACAO',
            chave: competencia,
            reason: e.message,
            impacto: 'Não foi possível avaliar a competência.'
          });
        }
      }

      return {
        pronto: bloqueios.length === 0,
        competencia: competencia || null,
        bloqueios: bloqueios,
        avisos: avisos,
        validacao: validacao
      };
    }

    /**
     * Estado das taxas relevantes para uma competência.
     *
     * Reporta DUAS taxas de propósito: o fechamento precisa da taxa da
     * competência (para converter o patrimônio em moeda estrangeira) e da
     * taxa da competência anterior (para separar o efeito cambial do
     * resultado operacional). Sem a segunda o mês fecha, mas o efeito
     * cambial fica null com motivo.
     */
    function taxasPublicadas(competencia) {
      FOS.Dates.assertCompetencia(competencia);
      var config = repo.config();
      var configRows = repo.configLinhas();
      var moedaGerencial = String(config.param('MOEDA_GERENCIAL').value || C.MOEDA.BRL).toUpperCase();
      var moedaEstrangeira = C.MOEDA.GBP;
      var parNome = FOS.Fx.par(moedaEstrangeira, moedaGerencial);
      var anterior = FOS.Dates.addMonths(competencia, -1);

      function estado(comp) {
        var referencia = FOS.Dates.competenciaRange(comp).fim;
        var vigente = FOS.Fx.vigenteDeCache(configRows, FOS.Fx.chaveCache(parNome, referencia));
        var publicada = !!(vigente && vigente.status === 'ATIVO' && vigente.valor !== null);
        return {
          competencia: comp,
          data_referencia: referencia,
          publicada: publicada,
          taxa: publicada ? vigente.valor : null,
          data_cotacao: publicada ? vigente.data_cotacao : null,
          versao: vigente ? vigente.versao : 0,
          provedor: vigente ? vigente.modo_ingestao : null,
          reason: publicada ? null : (vigente ? (vigente.reason || 'TAXA_BLOQUEADA') : 'TAXA_NAO_PUBLICADA')
        };
      }

      return {
        par: parNome,
        moeda_estrangeira: moedaEstrangeira,
        moeda_gerencial: moedaGerencial,
        atual: estado(competencia),
        anterior: estado(anterior)
      };
    }

    /**
     * Publica manualmente a taxa da competência (política MANUAL do V1).
     *
     * Contrato:
     *  - a taxa PERTENCE à competência, não ao dia em que se fecha o mês: a
     *    chave de cache é sempre o último dia calendário da competência;
     *  - quem publica informa também o dia efetivo da cotação, que pode ser
     *    anterior à data de referência quando não houve PTAX naquele dia. As
     *    duas datas ficam gravadas — o sistema não adivinha dia útil;
     *  - nada de rede: esta função não conhece UrlFetchApp;
     *  - idempotente: republicar o mesmo valor e a mesma cotação não grava
     *    linha nova;
     *  - append-only: corrigir publica uma versão maior, sem apagar a
     *    anterior. tabelaDeCache passa a enxergar a de maior versão;
     *  - competência já fechada é recusada, salvo correção explícita
     *    (permitirCompetenciaFechada + motivo), que só produz efeito quando
     *    a competência for reapresentada.
     */
    function publicarTaxaCambio(params) {
      var p = params || {};
      var agora = relogio.agora();
      var competencia = FOS.Dates.assertCompetencia(String(p.competencia || '').trim());
      var config = repo.config();
      var moedaGerencial = String(config.param('MOEDA_GERENCIAL').value || C.MOEDA.BRL).toUpperCase();
      var moedaEstrangeira = String(p.moeda || C.MOEDA.GBP).toUpperCase();
      if (moedaEstrangeira === moedaGerencial) {
        FOS.Core.fail('TAXA_DESNECESSARIA',
          'A moeda ' + moedaEstrangeira + ' é a própria moeda gerencial: a taxa é sempre 1.');
      }

      // A estrutura precisa expor data_cotacao, senão a data efetiva da PTAX
      // se perderia silenciosamente na gravação.
      if (repo.planilha && repo.planilha.cabecalhos) {
        var colunas = repo.planilha.cabecalhos(A.CONFIG);
        if (colunas.length && colunas.indexOf('data_cotacao') === -1) {
          FOS.Core.fail('ESTRUTURA_DESATUALIZADA',
            'A aba ' + A.CONFIG + ' ainda não tem a coluna data_cotacao. '
            + 'Rode "Preparar planilha" no menu Finance OS e tente de novo.');
        }
      }

      var dataReferencia = FOS.Dates.competenciaRange(competencia).fim;
      var taxa = Number(p.taxa);
      if (p.taxa === '' || p.taxa === null || p.taxa === undefined || !Number.isFinite(taxa) || taxa <= 0) {
        FOS.Core.fail('TAXA_INVALIDA',
          'Taxa inválida: ' + p.taxa + '. Informe um número positivo em '
          + moedaGerencial + ' por 1 ' + moedaEstrangeira + '.');
      }

      var dataCotacao = String(p.dataCotacao || dataReferencia).trim();
      FOS.Dates.assertIso(dataCotacao, 'data da cotação');
      if (FOS.Dates.toDayNumber(dataCotacao) > FOS.Dates.toDayNumber(dataReferencia)) {
        FOS.Core.fail('DATA_COTACAO_POSTERIOR',
          'A cotação de ' + dataCotacao + ' é posterior à data de referência ' + dataReferencia
          + ': a taxa de uma competência não pode vir do futuro.',
          { competencia: competencia, data_referencia: dataReferencia });
      }
      if (FOS.Dates.competenciaOf(dataCotacao) !== competencia) {
        FOS.Core.fail('DATA_COTACAO_FORA_DA_COMPETENCIA',
          'A cotação de ' + dataCotacao + ' não pertence à competência ' + competencia
          + '. O último dia útil anterior a ' + dataReferencia + ' está sempre dentro do mês.',
          { competencia: competencia, data_referencia: dataReferencia });
      }

      var fechada = competenciasFechadas().indexOf(competencia) !== -1;
      if (fechada && p.permitirCompetenciaFechada !== true) {
        FOS.Core.fail('PERIODO_FECHADO',
          'A competência ' + competencia + ' já está fechada e o fechamento guardou a taxa da época. '
          + 'Corrigir a taxa exige reapresentação (restatement) explícita.',
          { competencia: competencia });
      }
      var motivo = String(p.motivo || '').trim();
      if (fechada && !motivo) {
        FOS.Core.fail('MOTIVO_OBRIGATORIO',
          'Corrigir a taxa de uma competência fechada exige um motivo registrado.');
      }

      var parNome = FOS.Fx.par(moedaEstrangeira, moedaGerencial);
      var chave = FOS.Fx.chaveCache(parNome, dataReferencia);
      var configRows = repo.configLinhas();
      var vigente = FOS.Fx.vigenteDeCache(configRows, chave);
      var provedor = String(config.param('PROVEDOR_TAXA_CAMBIO').value || 'PTAX').toUpperCase();

      var antes = vigente
        ? { taxa: vigente.valor, data_cotacao: vigente.data_cotacao, versao: vigente.versao, status: vigente.status }
        : null;

      if (vigente && vigente.status === 'ATIVO'
        && vigente.valor === taxa && vigente.data_cotacao === dataCotacao) {
        auditoria.registrar({
          acao: 'PUBLICAR_TAXA_CAMBIO',
          ator: p.ator || ator,
          entidade: A.CONFIG,
          entidade_id: chave,
          antes: antes,
          depois: antes,
          resultado: 'SEM_MUDANCA',
          detalhe: {
            competencia: competencia, data_referencia: dataReferencia,
            data_cotacao: dataCotacao, taxa: taxa,
            observacao: 'Publicação idempotente: a taxa vigente já era essa.'
          }
        });
        auditoria.persistir();
        return {
          ok: true, alterado: false, resultado: 'SEM_MUDANCA',
          competencia: competencia, chave: chave, par: parNome,
          data_referencia: dataReferencia, data_cotacao: dataCotacao,
          taxa: taxa, versao: vigente.versao, provedor: provedor
        };
      }

      var versao = FOS.Fx.versaoDeCache(configRows, chave) + 1;
      var linha = FOS.Fx.linhaDeCache(moedaEstrangeira, moedaGerencial, dataReferencia,
        taxa, provedor, agora, null, { versao: versao, dataCotacao: dataCotacao });
      repo.anexar(A.CONFIG, [linha]);

      var resultado = fechada ? 'CORRECAO_POS_FECHAMENTO' : (vigente ? 'CORRIGIDA' : 'OK');
      auditoria.registrar({
        acao: 'PUBLICAR_TAXA_CAMBIO',
        ator: p.ator || ator,
        entidade: A.CONFIG,
        entidade_id: chave,
        antes: antes,
        depois: { taxa: taxa, data_cotacao: dataCotacao, versao: versao, status: 'ATIVO' },
        resultado: resultado,
        detalhe: {
          competencia: competencia,
          data_referencia: dataReferencia,
          data_cotacao: dataCotacao,
          provedor: provedor,
          politica: String(config.param('POLITICA_TAXA_CAMBIO').value || 'MANUAL').toUpperCase(),
          motivo: motivo || null,
          competencia_fechada: fechada
        }
      });
      auditoria.persistir();

      return {
        ok: true, alterado: true, resultado: resultado,
        competencia: competencia, chave: chave, par: parNome,
        data_referencia: dataReferencia, data_cotacao: dataCotacao,
        taxa: taxa, versao: versao, provedor: provedor,
        substituiu: antes
      };
    }

    /**
     * Atualiza (ou cria) o cache de taxas na aba 00.
     * Com política MANUAL nada é consultado: apenas relata o que falta.
     * Nenhuma taxa é inventada em nenhuma hipótese.
     */
    function atualizarCacheTaxas(params) {
      var p = params || {};
      var agora = relogio.agora();
      var config = repo.config();
      var configRows = repo.configLinhas();
      var moedaGerencial = config.param('MOEDA_GERENCIAL').value || C.MOEDA.BRL;
      var moedaEstrangeira = p.moeda || C.MOEDA.GBP;
      var datas = p.datas || [];
      var provedor = FOS.Adapters.provedorConfigurado(config, configRows, {
        urlFetchApp: deps.urlFetchApp,
        relogio: relogio,
        extrair: deps.extrairTaxa
      });

      var novas = [];
      var faltando = [];
      datas.forEach(function (data) {
        var doCache = FOS.Adapters.resolverTaxa(provedor.primario, moedaEstrangeira, moedaGerencial, data);
        if (doCache.value !== null) return;
        if (!provedor.externo) {
          faltando.push({ data: data, reason: 'POLITICA_' + provedor.politica + '_SEM_PROVEDOR_EXTERNO' });
          return;
        }
        var externo = provedor.externo.obter(moedaEstrangeira, moedaGerencial, data);
        // Mesmo versionamento da publicação manual: uma tentativa que falhou
        // antes deixou uma linha BLOQUEADA, e a nova precisa de versão maior
        // para prevalecer sobre ela sem depender da ordem das linhas.
        var chaveData = FOS.Fx.chaveCache(FOS.Fx.par(moedaEstrangeira, moedaGerencial), data);
        novas.push(FOS.Fx.linhaDeCache(moedaEstrangeira, moedaGerencial, data,
          externo.value, provedor.externo.nome, agora, externo.reason,
          { versao: FOS.Fx.versaoDeCache(configRows.concat(novas), chaveData) + 1 }));
        if (externo.value === null) faltando.push({ data: data, reason: externo.reason });
      });

      if (novas.length) repo.anexar(A.CONFIG, novas);
      auditoria.registrar({
        acao: 'ATUALIZAR_CACHE_TAXAS',
        entidade: A.CONFIG,
        entidade_id: FOS.Fx.SECAO_TAXA,
        antes: { linhas_taxa: configRows.filter(function (r) { return r.secao === FOS.Fx.SECAO_TAXA; }).length },
        depois: { linhas_taxa: configRows.filter(function (r) { return r.secao === FOS.Fx.SECAO_TAXA; }).length + novas.length },
        resultado: faltando.length ? 'PARCIAL' : 'OK',
        detalhe: { politica: provedor.politica, datas: datas, faltando: faltando }
      });
      auditoria.persistir();
      return { politica: provedor.politica, gravadas: novas.length, faltando: faltando };
    }

    /**
     * Payload completo do painel de leitura (dashboard e abas visíveis).
     * Tudo que sai daqui passou pela allowlist do view-model.
     */
    function painel(competencia, opcoes) {
      var opts = opcoes || {};
      var fechamentos = repo.fechamentos();
      var fechados = fechamentos.filter(function (f) {
        return String(f.estado) === C.ESTADO_FECHAMENTO.FECHADO;
      });
      var alvo = competencia
        || (fechados.length
          ? FOS.Core.sortBy(fechados, [function (f) { return String(f.competencia); }])[fechados.length - 1].competencia
          : null);

      var vigente = alvo ? FOS.Restatement.versaoVigente(fechamentos, alvo) : null;
      var snapshot = null;
      var erro = null;
      if (vigente) {
        try {
          snapshot = JSON.parse(vigente.snapshot_json);
        } catch (e) {
          erro = 'SNAPSHOT_ILEGIVEL';
        }
      }

      var restatements = repo.restatements();
      var porCompetencia = {};
      restatements.forEach(function (r) { porCompetencia[String(r.competencia)] = true; });

      var historico = FOS.Core.sortBy(fechados, [
        function (f) { return String(f.competencia); },
        function (f) { return Number(f.versao); }
      ]).map(function (f) {
        return {
          competencia: f.competencia,
          versao: Number(f.versao),
          estado: f.estado,
          qualidade: f.qualidade,
          fechado_em: f.fechado_em,
          moeda_gerencial: C.MOEDA.BRL,
          caixa_vida_brl: f.caixa_vida_brl === '' ? null : f.caixa_vida_brl,
          disponivel_brl: f.disponivel_brl === '' ? null : f.disponivel_brl,
          runway_meses: f.runway_meses === '' ? null : f.runway_meses,
          patrimonio_brl_gerencial: f.patrimonio_brl_gerencial === '' ? null : f.patrimonio_brl_gerencial,
          estado_ciclo_formal: f.estado_ciclo_formal,
          estado_ciclo_sugerido: f.estado_ciclo_sugerido,
          restatement: Number(f.versao) > 1,
          motivo_versao: f.motivo_versao,
          checksum_curto: String(f.checksum || '').slice(0, 8)
        };
      });

      var bloqueios = [];
      if (opts.incluirBloqueios !== false && alvo) {
        try {
          bloqueios = diagnosticoSetup(vigente ? null : alvo).bloqueios;
        } catch (e) {
          bloqueios = [{ codigo: 'DIAGNOSTICO_INDISPONIVEL', detalhe: e.message }];
        }
      }

      var maxIdade = repo.config().param('MAX_IDADE_VIEWMODEL_DIAS').value;
      return FOS.ViewModel.construirPainel({
        snapshot: snapshot,
        erro: erro,
        agora: opts.agora || relogio.hoje(),
        maxIdadeDias: opts.maxIdadeDias === undefined
          ? (maxIdade === null ? undefined : Number(maxIdade))
          : opts.maxIdadeDias,
        historico: historico,
        restatements: restatements,
        bloqueios: bloqueios.map(function (b) {
          return { codigo: b.codigo, detalhe: b.impacto || b.reason || b.detalhe || null };
        })
      });
    }

    /**
     * Regenera as quatro abas visíveis a partir do modelo canônico.
     * Idempotente e destrutivo apenas na projeção: as abas visíveis podem
     * ser apagadas sem perda, porque a verdade está nas abas internas.
     */
    function atualizarSuperficies(competencia, opcoes) {
      var opts = opcoes || {};
      var dadosPainel = painel(competencia, opts);
      var fechadas = competenciasFechadas();

      var linhas = {
        HOME: FOS.Surfaces.home(dadosPainel),
        MOVIMENTACOES: FOS.Surfaces.movimentacoes({
          linhas: repo.ledger(),
          competenciasFechadas: fechadas
        }),
        PLANEJAMENTO: FOS.Surfaces.planejamento(dadosPainel),
        PATRIMONIO: FOS.Surfaces.patrimonio(dadosPainel)
      };

      repo.substituir(C.ABAS_VISIVEIS.HOME, linhas.HOME);
      repo.substituir(C.ABAS_VISIVEIS.MOVIMENTACOES, linhas.MOVIMENTACOES);
      repo.substituir(C.ABAS_VISIVEIS.PLANEJAMENTO, linhas.PLANEJAMENTO);
      repo.substituir(C.ABAS_VISIVEIS.PATRIMONIO, linhas.PATRIMONIO);

      if (opts.formatar !== false && repo.planilha.formatarAba) {
        FOS.App.Bootstrap.formatarSuperficies(repo.planilha);
      }

      auditoria.registrar({
        acao: 'ATUALIZAR_SUPERFICIES',
        entidade: 'ABAS_VISIVEIS',
        entidade_id: dadosPainel.atual.dados ? dadosPainel.atual.dados.competencia : '',
        antes: null,
        depois: {
          home: linhas.HOME.length,
          movimentacoes: linhas.MOVIMENTACOES.length,
          planejamento: linhas.PLANEJAMENTO.length,
          patrimonio: linhas.PATRIMONIO.length,
          status: dadosPainel.atual.status
        },
        resultado: 'OK',
        detalhe: { competencia: competencia || 'ULTIMO_FECHAMENTO' }
      });
      auditoria.persistir();
      return { painel: dadosPainel, linhas: linhas };
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
      classificarLinhas: classificarLinhas,
      // Onda 2
      competenciasFechadas: competenciasFechadas,
      competenciasAnterioresEmAberto: competenciasAnterioresEmAberto,
      provedorDeLeitura: provedorDeLeitura,
      reclassificarLinha: reclassificarLinha,
      classificarPendente: classificarPendente,
      resolverItemFila: resolverItemFila,
      conciliarManualmente: conciliarManualmente,
      materializarEventos: materializarEventos,
      registrarEventoPosicao: registrarEventoPosicao,
      compensarEventoPosicao: compensarEventoPosicao,
      diagnosticoSetup: diagnosticoSetup,
      atualizarCacheTaxas: atualizarCacheTaxas,
      publicarTaxaCambio: publicarTaxaCambio,
      taxasPublicadas: taxasPublicadas,
      painel: painel,
      atualizarSuperficies: atualizarSuperficies
    };
  }

  FOS.App.criarWorkflows = criar;
})(typeof globalThis !== 'undefined' ? globalThis : this);
