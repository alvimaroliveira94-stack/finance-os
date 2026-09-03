/**
 * Invariantes do sistema. São verificadas antes de qualquer fechamento e
 * podem ser rodadas isoladamente como "diagnóstico de integridade".
 * Uma invariante violada bloqueia o fechamento; nenhuma é auto-corrigida.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  function res(codigo, ok, detalhe) {
    return { codigo: codigo, ok: !!ok, detalhe: detalhe || null };
  }

  /** Nenhuma conta de trading pode aparecer no ledger transacional. */
  function firewallLedger(config, linhas) {
    var violacoes = (linhas || []).filter(function (l) {
      var conta = config.conta(l.conta_id);
      return !conta || conta.universo === C.UNIVERSO.TRADING;
    });
    return res('FIREWALL_LEDGER_SEM_CONTA_TRADING', violacoes.length === 0,
      violacoes.map(function (l) { return l.linha_id + '@' + l.conta_id; }).join(',') || null);
  }

  /** A aba 12 só aceita contas do universo Trading. */
  function firewallSaldosSemanais(config, saldos) {
    var violacoes = (saldos || []).filter(function (s) {
      var conta = config.conta(s.conta_id);
      return !conta || conta.universo !== C.UNIVERSO.TRADING;
    });
    return res('FIREWALL_SALDOS_SEMANAIS_APENAS_TRADING', violacoes.length === 0,
      violacoes.map(function (s) { return s.registro_id + '@' + s.conta_id; }).join(',') || null);
  }

  /** Versões do ledger: sequência 1..n por fingerprint e origem idêntica. */
  function ledgerAppendOnly(linhas) {
    var problemas = [];
    var porFp = FOS.Core.groupBy(linhas || [], function (l) { return String(l.fingerprint); });
    Object.keys(porFp).forEach(function (fp) {
      var versoes = FOS.Core.sortBy(porFp[fp], [function (l) { return Number(l.versao_gerencial); }]);
      versoes.forEach(function (l, idx) {
        if (Number(l.versao_gerencial) !== idx + 1) {
          problemas.push('VERSAO_FORA_DE_SEQUENCIA:' + fp + '@' + l.versao_gerencial);
        }
        if (idx > 0) {
          FOS.Ledger.CAMPOS_ORIGEM.forEach(function (campo) {
            if (String(l[campo]) !== String(versoes[0][campo])) {
              problemas.push('ORIGEM_ALTERADA:' + fp + '.' + campo);
            }
          });
        }
      });
    });
    return res('LEDGER_APPEND_ONLY', problemas.length === 0, problemas.join(',') || null);
  }

  /** Fila de revisão vazia (nenhum item aberto). */
  function filaVazia(itensFila) {
    var abertos = FOS.Queue.abertos(itensFila);
    return res('FILA_REVISAO_VAZIA', abertos.length === 0,
      abertos.map(function (i) { return i.item_id + ':' + i.motivo; }).join(',') || null);
  }

  /**
   * Todo evento conciliável da competência precisa estar conciliado.
   * A conciliação é lida do LEDGER (campo evento_conciliado_id), não de um
   * status editável na aba de eventos: a verdade fica no ledger append-only.
   */
  function conciliacoesCompletas(eventos, competencia, linhas) {
    var conciliados = {};
    (linhas || []).forEach(function (l) {
      if (l.evento_conciliado_id) conciliados[String(l.evento_conciliado_id)] = true;
    });
    var pendentes = (eventos || []).filter(function (e) {
      if (String(e.status || '') === FOS.Events.STATUS_EVENTO.CANCELADO) return false;
      if (!FOS.Dates.inCompetencia(String(e.data), competencia)) return false;
      var spec = FOS.Events.spec(String(e.tipo_evento).toUpperCase());
      if (!spec || !spec.concilia) return false;
      if (conciliados[String(e.evento_id)]) return false;
      return String(e.status || '') !== FOS.Events.STATUS_EVENTO.CONCILIADO;
    });
    return res('CONCILIACOES_COMPLETAS', pendentes.length === 0,
      pendentes.map(function (e) { return e.evento_id; }).join(',') || null);
  }

  /** Toda posição com capital investido precisa de snapshot ativo. */
  function snapshotsAtivos(projecaoPosicoes) {
    var sem = FOS.Positions.semSnapshot(projecaoPosicoes || {}).filter(function (p) {
      return p.capital_investido > 0;
    });
    return res('SNAPSHOTS_ATIVOS', sem.length === 0,
      sem.map(function (p) { return p.posicao_id; }).join(',') || null);
  }

  /** Taxa de câmbio disponível quando há exposição em moeda estrangeira. */
  function taxaCambialDisponivel(taxa, exposicaoEstrangeira) {
    if (!exposicaoEstrangeira) return res('TAXA_CAMBIAL_DISPONIVEL', true, 'SEM_EXPOSICAO_ESTRANGEIRA');
    return res('TAXA_CAMBIAL_DISPONIVEL', !!taxa && taxa.value !== null,
      taxa && taxa.reason ? taxa.reason : null);
  }

  /** Subledgers versionados: sem versão duplicada por entidade. */
  function subledgerVersionado(linhas, campoId, codigo) {
    var vistos = {};
    var duplicadas = [];
    (linhas || []).forEach(function (l) {
      var k = String(l[campoId]) + '@v' + String(l.versao);
      if (vistos[k]) duplicadas.push(k);
      vistos[k] = true;
    });
    return res(codigo, duplicadas.length === 0, duplicadas.join(',') || null);
  }

  /** A soma por categoria precisa fechar com a soma total do ledger. */
  function somaCategorias(linhas) {
    var total = FOS.Core.sum(linhas, function (l) { return Number(l.valor_origem); });
    var porCategoria = 0;
    C.values(C.CATEGORIA).forEach(function (cat) {
      porCategoria = FOS.Core.round2(porCategoria + FOS.Ledger.totalCategoria(linhas, cat));
    });
    var semCategoria = (linhas || []).filter(function (l) {
      return !C.isValid(C.CATEGORIA, String(l.categoria));
    });
    return res('SOMA_POR_CATEGORIA_FECHA',
      FOS.Core.round2(total) === FOS.Core.round2(porCategoria) && semCategoria.length === 0,
      'total=' + total + '; por_categoria=' + porCategoria + '; sem_categoria=' + semCategoria.length);
  }

  /**
   * Saldo de cada versão de passivo dentro dos limites: nunca negativo,
   * nunca acima do que foi assumido na origem. É o guardião contra
   * comportamento não suportado (juro capitalizado que faça o saldo crescer
   * sozinho, ou amortização que o leve abaixo de zero) — falha explícita em
   * vez de número silenciosamente errado.
   */
  function passivosSaldoValido(linhas) {
    var problemas = [];
    (linhas || []).forEach(function (p) {
      var aberto = FOS.Config.parseNumber(p.valor_aberto);
      var original = FOS.Config.parseNumber(p.valor_devido_original);
      if (aberto === null || original === null) {
        problemas.push('VALOR_INVALIDO:' + p.passivo_id + '@v' + p.versao);
        return;
      }
      if (aberto < 0 || aberto > original) {
        problemas.push('FORA_DOS_LIMITES:' + p.passivo_id + '@v' + p.versao);
      }
    });
    return res('PASSIVOS_SALDO_VALIDO', problemas.length === 0, problemas.join(',') || null);
  }

  /** O fechamento anterior não pode ter mudado (checksum recalculado). */
  function fechamentoAnteriorImutavel(fechamentoAnterior, recalcularChecksum) {
    if (!fechamentoAnterior) return res('FECHAMENTO_ANTERIOR_IMUTAVEL', true, 'SEM_FECHAMENTO_ANTERIOR');
    var atual = recalcularChecksum(fechamentoAnterior);
    return res('FECHAMENTO_ANTERIOR_IMUTAVEL',
      String(atual) === String(fechamentoAnterior.checksum),
      'esperado=' + fechamentoAnterior.checksum + '; recalculado=' + atual);
  }

  /**
   * Executa todas as invariantes aplicáveis a um fechamento.
   * @returns {{ok:boolean, resultados:Array, violacoes:Array}}
   */
  function verificarTodas(ctx) {
    var resultados = [
      firewallLedger(ctx.config, ctx.linhas),
      firewallSaldosSemanais(ctx.config, ctx.saldos),
      ledgerAppendOnly(ctx.linhasTodasVersoes || ctx.linhas),
      filaVazia(ctx.itensFila),
      conciliacoesCompletas(ctx.eventos, ctx.competencia, ctx.linhas),
      snapshotsAtivos(ctx.posicoes),
      taxaCambialDisponivel(ctx.taxa, ctx.exposicaoEstrangeira),
      subledgerVersionado(ctx.provisoesLinhas, 'provisao_id', 'PROVISOES_VERSIONADAS'),
      subledgerVersionado(ctx.objetivosLinhas, 'objetivo_id', 'OBJETIVOS_VERSIONADOS'),
      subledgerVersionado(ctx.passivosLinhas, 'passivo_id', 'PASSIVOS_VERSIONADOS'),
      passivosSaldoValido(ctx.passivosLinhas),
      somaCategorias(ctx.linhasCompetencia)
    ];
    if (ctx.fechamentoAnterior && ctx.recalcularChecksum) {
      resultados.push(fechamentoAnteriorImutavel(ctx.fechamentoAnterior, ctx.recalcularChecksum));
    }
    var violacoes = resultados.filter(function (r) { return !r.ok; });
    return { ok: violacoes.length === 0, resultados: resultados, violacoes: violacoes };
  }

  FOS.Invariants = {
    firewallLedger: firewallLedger,
    firewallSaldosSemanais: firewallSaldosSemanais,
    ledgerAppendOnly: ledgerAppendOnly,
    filaVazia: filaVazia,
    conciliacoesCompletas: conciliacoesCompletas,
    snapshotsAtivos: snapshotsAtivos,
    taxaCambialDisponivel: taxaCambialDisponivel,
    subledgerVersionado: subledgerVersionado,
    passivosSaldoValido: passivosSaldoValido,
    somaCategorias: somaCategorias,
    fechamentoAnteriorImutavel: fechamentoAnteriorImutavel,
    verificarTodas: verificarTodas
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
