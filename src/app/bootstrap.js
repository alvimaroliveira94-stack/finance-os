/**
 * Bootstrap do workbook: cria as abas visíveis e internas com os cabeçalhos
 * do schema, aplica formatação e proteção, e semeia a configuração sintética
 * quando a aba 00 está vazia. Idempotente: rodar de novo não duplica nada.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.App = FOS.App || {};
  var C = FOS.Constants;
  var A = C.ABAS_INTERNAS;
  var V = C.ABAS_VISIVEIS;

  var MOEDA = '#,##0.00';
  var NUMERO = '#,##0.00';
  var DATA = 'yyyy-mm-dd';

  /**
   * As quatro superfícies de leitura. O cabeçalho vem de Surfaces.COLUNAS
   * para que aba e construtor nunca saiam de sincronia.
   */
  var ABAS_VISIVEIS = [
    {
      nome: V.HOME,
      colunas: FOS.Surfaces.COLUNAS.HOME,
      nota: 'HOME é gerada pelo Finance OS a partir do último fechamento. '
        + 'Não edite: use o menu Finance OS para atualizar.',
      formato: {
        congelarLinhas: 1,
        congelarColunas: 2,
        larguras: [140, 300, 130, 90, 120, 260, 260],
        formatos: { valor: NUMERO },
        filtro: true
      }
    },
    {
      nome: V.MOVIMENTACOES,
      colunas: FOS.Surfaces.COLUNAS.MOVIMENTACOES,
      nota: 'Visão do ledger canônico. As colunas de origem são imutáveis; '
        + 'categoria e subcategoria mudam apenas pela fila de revisão, '
        + 'e só em competência ainda aberta.',
      formato: {
        congelarLinhas: 1,
        congelarColunas: 2,
        larguras: [100, 130, 340, 120, 70, 180, 150, 120, 140, 80, 100, 190, 120],
        formatos: { valor: MOEDA, data: DATA },
        filtro: true
      },
      protegidas: FOS.Surfaces.COLUNAS_ORIGEM_MOVIMENTACOES,
      validacoes: [{ coluna: 'categoria', valores: C.values(C.CATEGORIA) }]
    },
    {
      nome: V.PLANEJAMENTO,
      colunas: FOS.Surfaces.COLUNAS.PLANEJAMENTO,
      nota: 'Provisões e objetivos versionados. Alterações entram por evento '
        + 'manual na aba 11, nunca digitando aqui.',
      formato: {
        congelarLinhas: 1,
        congelarColunas: 2,
        larguras: [150, 280, 150, 120, 120, 120, 140, 140, 110, 90, 200],
        formatos: {
          alvo: MOEDA, acumulado: MOEDA, faltante: MOEDA,
          ritmo_necessario: MOEDA, ritmo_observado: MOEDA, vencimento: DATA
        },
        filtro: true
      }
    },
    {
      nome: V.PATRIMONIO,
      colunas: FOS.Surfaces.COLUNAS.PATRIMONIO,
      nota: 'Posições e patrimônio. O capital de Trading aparece em bloco '
        + 'próprio e nunca é somado ao patrimônio.',
      formato: {
        congelarLinhas: 1,
        congelarColunas: 2,
        larguras: [170, 260, 80, 150, 150, 170, 130, 110, 120, 200],
        formatos: {
          capital_investido: MOEDA, valor_mercado: MOEDA,
          resultado_nao_realizado: MOEDA, distribuicoes: MOEDA, snapshot: DATA
        },
        filtro: true
      }
    }
  ];

  /**
   * TODA aba interna fica oculta: são motor, não interface.
   *
   * A superfície permanente é só HOME, MOVIMENTAÇÕES, PLANEJAMENTO e
   * PATRIMÔNIO. Ocultar não tira acesso — o Apps Script lê e escreve aba
   * oculta normalmente, e o menu reexibe sob demanda as três de entrada.
   */
  var ABAS_INTERNAS_OCULTAS = [
    A.CONFIG, A.IMPORT_EXTRATO, A.EVENTOS_MANUAIS, A.SALDOS_TRADING,
    A.REGRAS, A.FILA_REVISAO, A.LEDGER, A.PROVISOES, A.OBJETIVOS,
    A.POSICOES, A.FECHAMENTOS, A.RESTATEMENTS, A.LOG
  ];

  /**
   * As três abas que o menu sabe reexibir e ativar ("Abrir entrada").
   *
   * 11 e 12 são as duas únicas abas do workbook que o sistema nunca escreve:
   * entrada humana pura, em lote, e por isso continuam sendo tabela e não
   * formulário. 00 é setup raro (cadastro de conta).
   *
   * 21_FILA_REVISAO NÃO entra aqui de propósito: a fila é abstraída por
   * "Revisar pendências" e o usuário não deve precisar operá-la direto.
   */
  var ABAS_DE_ENTRADA = {
    EVENTOS: A.EVENTOS_MANUAIS,
    SALDOS: A.SALDOS_TRADING,
    CONFIGURACAO: A.CONFIG
  };

  /**
   * Listas fechadas nas abas internas de digitação.
   *
   * O dropdown é conveniência, não fonte de verdade: os valores saem das
   * mesmas constantes que o domínio usa para validar, então a planilha não
   * tem como oferecer algo que `Events.validar` recusaria. E como colar
   * valores por cima substitui a regra da célula no Sheets, a validação
   * rígida continua sendo a do código — o dropdown só reduz a chance do erro.
   */
  var VALIDACOES_OPERACIONAIS = [
    { aba: A.EVENTOS_MANUAIS, coluna: 'tipo_evento', valores: FOS.Events.tiposValidos() },
    { aba: A.EVENTOS_MANUAIS, coluna: 'moeda', valores: C.values(C.MOEDA) },
    { aba: A.EVENTOS_MANUAIS, coluna: 'status', valores: C.values(FOS.Events.STATUS_EVENTO) }
  ];

  function criarEstrutura(planilha) {
    var criadas = [];
    ABAS_VISIVEIS.forEach(function (aba) {
      planilha.criarAba(aba.nome, aba.colunas);
      criadas.push(aba.nome);
    });
    FOS.Schema.nomes().forEach(function (nome) {
      planilha.criarAba(nome, FOS.Schema.get(nome).colunas);
      criadas.push(nome);
    });
    return criadas;
  }

  /** Formatação das quatro superfícies. Cosmética e idempotente. */
  function formatarSuperficies(planilha) {
    if (!planilha.formatarAba) return [];
    return ABAS_VISIVEIS.map(function (aba) {
      planilha.formatarAba(aba.nome, aba.formato);
      if (planilha.notaAba) planilha.notaAba(aba.nome, aba.nota);
      if (aba.protegidas && planilha.protegerColunas) {
        planilha.protegerColunas(aba.nome, aba.protegidas, 'origem imutável do ledger');
      }
      (aba.validacoes || []).forEach(function (v) {
        if (planilha.validarColunaPorLista) planilha.validarColunaPorLista(aba.nome, v.coluna, v.valores);
      });
      return aba.nome;
    });
  }

  /**
   * Marca na planilha os parâmetros que deixaram de ser canônicos.
   *
   * A linha NÃO é apagada: o histórico de que aquele parâmetro existiu fica
   * preservado, e o valor que o usuário porventura tenha digitado continua
   * na célula. Só os metadados mudam (`status`, `reason`, `descricao`), para
   * que quem lê a aba 00 veja o mesmo que o sistema entende — a fonte de
   * verdade é Config.PARAMETROS_DEPRECIADOS, não a célula.
   *
   * Idempotente: rodar de novo não reescreve nada já sincronizado.
   */
  function depreciarParametros(planilha) {
    if (!planilha.atualizarCampos) return [];
    var depreciados = FOS.Config.PARAMETROS_DEPRECIADOS;
    return Object.keys(depreciados).filter(function (chave) {
      return planilha.atualizarCampos(A.CONFIG, function (linha) {
        return String(linha.secao || '').toUpperCase() === 'PARAMETRO'
          && String(linha.chave || '') === chave;
      }, {
        status: C.STATUS_PARAMETRO.DEPRECIADO,
        reason: depreciados[chave],
        descricao: 'Parâmetro descontinuado. O Finance OS não lê mais este valor.'
      }) > 0;
    });
  }

  /**
   * Aplica as listas fechadas nas abas internas de digitação.
   * Idempotente: reaplicar a mesma regra não duplica nada.
   */
  function validarAbasOperacionais(planilha) {
    if (!planilha.validarColunaPorLista) return [];
    return VALIDACOES_OPERACIONAIS.filter(function (v) {
      return planilha.validarColunaPorLista(v.aba, v.coluna, v.valores);
    }).map(function (v) { return v.aba + '.' + v.coluna; });
  }

  /**
   * Restaura a superfície canônica: as quatro visíveis, todo o resto oculto.
   *
   * Idempotente e barata (só visibilidade, sem reordenar). É o que "Atualizar
   * abas" chama para devolver a planilha ao estado limpo depois de o usuário
   * ter aberto uma aba de entrada.
   */
  function restaurarSuperficie(planilha) {
    if (!planilha.ocultarAba) return [];
    ABAS_VISIVEIS.forEach(function (aba) { planilha.ocultarAba(aba.nome, false); });
    ABAS_INTERNAS_OCULTAS.forEach(function (nome) { planilha.ocultarAba(nome, true); });
    return ABAS_INTERNAS_OCULTAS.slice();
  }

  /**
   * Organiza o workbook: superfícies primeiro, motor depois e oculto.
   * Ocultar não impede manutenção — o dono reexibe a aba pelo menu do Sheets,
   * e as três de entrada têm comando próprio no menu Finance OS.
   */
  function organizarAbas(planilha) {
    if (!planilha.ocultarAba) return [];
    var ordem = ABAS_VISIVEIS.map(function (a) { return a.nome; })
      .concat(ABAS_INTERNAS_OCULTAS);
    if (planilha.ordenarAbas) planilha.ordenarAbas(ordem);
    restaurarSuperficie(planilha);
    return ordem;
  }

  /**
   * Reexibe e ativa uma das abas de entrada. Navegação, nunca escrita.
   * Recusa qualquer aba fora da lista: a fila de revisão e o motor não são
   * pontos de entrada.
   */
  function abrirEntrada(planilha, nome) {
    var permitidas = Object.keys(ABAS_DE_ENTRADA).map(function (k) { return ABAS_DE_ENTRADA[k]; });
    if (permitidas.indexOf(nome) === -1) {
      FOS.Core.fail('ABA_NAO_E_ENTRADA',
        'Esta aba não é um ponto de entrada: ' + nome,
        { permitidas: permitidas });
    }
    if (!planilha.ativarAba) FOS.Core.fail('NAVEGACAO_INDISPONIVEL', 'A planilha não sabe ativar abas');
    return planilha.ativarAba(nome);
  }

  /** Semeia 00 e 20 apenas se estiverem vazias (nunca sobrescreve). */
  function semear(repositorio) {
    var resultado = { config: 0, regras: 0 };
    if (!repositorio.configLinhas().length) {
      resultado.config = repositorio.anexar(A.CONFIG, FOS.App.Seed.configRows());
    }
    if (!repositorio.regras().length) {
      resultado.regras = repositorio.anexar(A.REGRAS, FOS.App.Seed.REGRAS);
    }
    return resultado;
  }

  function inicializar(deps) {
    var planilha = deps.planilha;
    var criadas = criarEstrutura(planilha);
    var repositorio = deps.repositorio || FOS.App.criarRepositorio(planilha);
    var semeadas = semear(repositorio);
    var formatadas = formatarSuperficies(planilha);
    var validadas = validarAbasOperacionais(planilha);
    var depreciadas = depreciarParametros(planilha);
    var ordem = deps.organizar === false ? [] : organizarAbas(planilha);

    if (deps.auditoria) {
      deps.auditoria.registrar({
        acao: 'BOOTSTRAP',
        entidade: 'WORKBOOK',
        entidade_id: '',
        antes: null,
        depois: {
          abas: criadas.length,
          config_semeada: semeadas.config,
          regras_semeadas: semeadas.regras,
          superficies_formatadas: formatadas.length,
          colunas_validadas: validadas.length,
          parametros_depreciados: depreciadas
        },
        resultado: 'OK',
        detalhe: 'Estrutura criada/verificada.'
      });
      deps.auditoria.persistir();
    }
    return {
      abas: criadas, semeadas: semeadas, formatadas: formatadas,
      validadas: validadas, depreciadas: depreciadas, ordem: ordem
    };
  }

  FOS.App.Bootstrap = {
    ABAS_VISIVEIS: ABAS_VISIVEIS,
    ABAS_INTERNAS_OCULTAS: ABAS_INTERNAS_OCULTAS,
    ABAS_DE_ENTRADA: ABAS_DE_ENTRADA,
    VALIDACOES_OPERACIONAIS: VALIDACOES_OPERACIONAIS,
    criarEstrutura: criarEstrutura,
    formatarSuperficies: formatarSuperficies,
    validarAbasOperacionais: validarAbasOperacionais,
    depreciarParametros: depreciarParametros,
    organizarAbas: organizarAbas,
    restaurarSuperficie: restaurarSuperficie,
    abrirEntrada: abrirEntrada,
    semear: semear,
    inicializar: inicializar
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
