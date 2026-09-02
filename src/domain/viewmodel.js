/**
 * View-model do dashboard (somente leitura).
 *
 * Allowlist explícita: apenas os campos listados aqui saem do fechamento
 * para qualquer superfície de leitura. Nada de linha de extrato, descrição
 * de transação, fingerprint, identificador de importação ou log.
 * O dashboard não tem regra própria: ele exibe o que o fechamento congelou.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  /** Campos proibidos em qualquer saída de view-model (defesa em profundidade). */
  var CAMPOS_PROIBIDOS = [
    'fingerprint', 'descricao_origem', 'descricao_normalizada', 'descricao_original',
    'import_id', 'arquivo_hash', 'arquivo_nome', 'linha_id', 'snapshot_json',
    'conta_id', 'valor_origem'
  ];

  var ALLOWLIST = [
    'competencia',
    'estado',
    'gerado_em',
    'fechado_em',
    'moeda_gerencial',
    'qualidade.nivel',
    'qualidade.itens_fila_abertos',
    'qualidade.conciliacoes_pendentes',
    'qualidade.posicoes_sem_snapshot',
    'qualidade.taxa_cambial_disponivel',
    'vida.caixa_vida_brl',
    'vida.custo_vida_mes_brl',
    'vida.custo_vida_medio_brl',
    'vida.disponivel_brl',
    'vida.runway_meses',
    'vida.funcoes_do_dinheiro',
    'trading.capital_gbp',
    'trading.metricas.caixa_retirado_brl',
    'trading.metricas.pnl_operacional_gbp',
    'trading.metricas.resultado_reserva_brl',
    'trading.metricas.custo_operacional_brl',
    'cambio.par',
    'cambio.provedor',
    'cambio.taxa',
    'cambio.data_taxa',
    'cambio.efeito_cambial_brl',
    'patrimonio.brl_gerencial',
    'patrimonio.por_moeda',
    'patrimonio.capital_investido_total',
    'estado_ciclo.sugerido',
    'estado_ciclo.formal',
    'estado_ciclo.movimento',
    'estado_ciclo.motivo'
  ];

  function get(obj, caminho) {
    var partes = caminho.split('.');
    var atual = obj;
    for (var i = 0; i < partes.length; i++) {
      if (atual === null || atual === undefined) return undefined;
      atual = atual[partes[i]];
    }
    return atual;
  }

  function set(obj, caminho, valor) {
    var partes = caminho.split('.');
    var atual = obj;
    for (var i = 0; i < partes.length - 1; i++) {
      atual[partes[i]] = atual[partes[i]] || {};
      atual = atual[partes[i]];
    }
    atual[partes[partes.length - 1]] = valor;
  }

  /** Posições: só identificador, moeda, valores e status do snapshot. */
  function posicoesPermitidas(snapshot) {
    return ((snapshot.patrimonio || {}).posicoes || []).map(function (p) {
      return {
        posicao_id: p.posicao_id,
        moeda: p.moeda,
        valor_mercado: p.valor_mercado,
        capital_investido: p.capital_investido,
        snapshot_status: p.snapshot_status,
        data_snapshot: p.data_snapshot
      };
    });
  }

  function provisoesPermitidas(snapshot) {
    return (snapshot.provisoes || []).map(function (p) {
      return {
        provisao_id: p.provisao_id,
        nome: p.nome,
        status: p.status,
        valor_alvo: p.valor_alvo,
        valor_acumulado: p.valor_acumulado,
        valor_faltante: p.valor_faltante,
        vencimento: p.vencimento,
        ritmo_observado: p.ritmo_observado,
        ritmo_necessario: p.ritmo_necessario
      };
    });
  }

  function objetivosPermitidos(snapshot) {
    return (snapshot.objetivos || []).map(function (o) {
      return {
        objetivo_id: o.objetivo_id,
        nome: o.nome,
        status: o.status,
        valor_alvo: o.valor_alvo,
        valor_acumulado: o.valor_acumulado,
        valor_faltante: o.valor_faltante,
        prazo: o.prazo
      };
    });
  }

  function sinaisPermitidos(snapshot) {
    return (snapshot.sinais || []).map(function (s) {
      return { codigo: s.codigo, valor: s.valor, status: s.status, reason: s.reason };
    });
  }

  function acoesPermitidas(snapshot) {
    return (snapshot.acoes || []).map(function (a) {
      return { codigo: a.codigo, descricao: a.descricao, executa_automaticamente: false };
    });
  }

  /**
   * @param {?Object} snapshot snapshot congelado do fechamento
   * @param {{agora?:string, maxIdadeDias?:number, erro?:string}} [opcoes]
   */
  function construir(snapshot, opcoes) {
    var opts = opcoes || {};
    if (opts.erro) {
      return { status: 'ERROR', reason: opts.erro, dados: null };
    }
    if (!snapshot) {
      return { status: 'NULL', reason: 'SEM_FECHAMENTO_DISPONIVEL', dados: null };
    }

    var dados = {};
    ALLOWLIST.forEach(function (caminho) {
      var v = get(snapshot, caminho);
      if (v !== undefined) set(dados, caminho, FOS.Core.clone(v));
    });
    dados.patrimonio = dados.patrimonio || {};
    dados.patrimonio.posicoes = posicoesPermitidas(snapshot);
    dados.provisoes = provisoesPermitidas(snapshot);
    dados.objetivos = objetivosPermitidos(snapshot);
    dados.sinais = sinaisPermitidos(snapshot);
    dados.acoes = acoesPermitidas(snapshot);
    dados.somente_leitura = true;

    var status = 'OK';
    var reason = null;
    if (opts.agora && opts.maxIdadeDias && snapshot.competencia) {
      var fim = FOS.Dates.competenciaRange(snapshot.competencia).fim;
      var idade = FOS.Dates.diffDays(String(opts.agora).slice(0, 10), fim);
      if (idade > Number(opts.maxIdadeDias)) {
        status = 'STALE';
        reason = 'FECHAMENTO_DESATUALIZADO_HA_' + idade + '_DIAS';
      }
    }
    if (String(snapshot.estado) !== 'FECHADO' && status === 'OK') {
      status = 'STALE';
      reason = 'FECHAMENTO_NAO_FINALIZADO:' + snapshot.estado;
    }

    return { status: status, reason: reason, dados: dados };
  }

  /** Verifica que nenhum campo proibido vazou (usado em teste e em runtime). */
  function auditarVazamento(viewModel) {
    var texto = FOS.Core.canonicalJson(viewModel);
    return CAMPOS_PROIBIDOS.filter(function (campo) {
      return texto.indexOf('"' + campo + '"') !== -1;
    });
  }

  FOS.ViewModel = {
    ALLOWLIST: ALLOWLIST,
    CAMPOS_PROIBIDOS: CAMPOS_PROIBIDOS,
    construir: construir,
    auditarVazamento: auditarVazamento
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
