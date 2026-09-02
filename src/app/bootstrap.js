/**
 * Bootstrap do workbook: cria as abas visíveis e internas com os cabeçalhos
 * do schema e semeia a configuração sintética quando a aba 00 está vazia.
 * Idempotente: rodar de novo não duplica nada.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.App = FOS.App || {};
  var C = FOS.Constants;
  var A = C.ABAS_INTERNAS;

  /** Cabeçalhos das abas visíveis (superfícies de leitura da próxima onda). */
  var ABAS_VISIVEIS = [
    { nome: C.ABAS_VISIVEIS.HOME, headers: ['Indicador', 'Valor', 'Status', 'Motivo', 'Competência'] },
    { nome: C.ABAS_VISIVEIS.MOVIMENTACOES, headers: ['Data', 'Conta', 'Valor', 'Categoria', 'Universo', 'Origem', 'Status'] },
    { nome: C.ABAS_VISIVEIS.PLANEJAMENTO, headers: ['Item', 'Tipo', 'Alvo', 'Acumulado', 'Faltante', 'Prazo', 'Status'] },
    { nome: C.ABAS_VISIVEIS.PATRIMONIO, headers: ['Posição', 'Moeda', 'Capital investido', 'Valor de mercado', 'Snapshot', 'Status'] }
  ];

  function criarEstrutura(planilha) {
    var criadas = [];
    ABAS_VISIVEIS.forEach(function (aba) {
      planilha.criarAba(aba.nome, aba.headers);
      criadas.push(aba.nome);
    });
    FOS.Schema.nomes().forEach(function (nome) {
      planilha.criarAba(nome, FOS.Schema.get(nome).colunas);
      criadas.push(nome);
    });
    return criadas;
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
    if (deps.auditoria) {
      deps.auditoria.registrar({
        acao: 'BOOTSTRAP',
        entidade: 'WORKBOOK',
        entidade_id: '',
        antes: null,
        depois: { abas: criadas.length, config_semeada: semeadas.config, regras_semeadas: semeadas.regras },
        resultado: 'OK',
        detalhe: 'Estrutura criada/verificada.'
      });
      deps.auditoria.persistir();
    }
    return { abas: criadas, semeadas: semeadas };
  }

  FOS.App.Bootstrap = {
    ABAS_VISIVEIS: ABAS_VISIVEIS,
    criarEstrutura: criarEstrutura,
    semear: semear,
    inicializar: inicializar
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
