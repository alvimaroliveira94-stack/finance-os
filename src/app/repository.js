/**
 * Repositório: acesso tipado às abas internas.
 * Fica entre o adaptador de planilha (linhas cruas) e os workflows.
 * Não contém regra de negócio — apenas leitura, escrita e normalização de tipos.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.App = FOS.App || {};
  var A = FOS.Constants.ABAS_INTERNAS;

  function numerico(obj, campos) {
    campos.forEach(function (c) {
      if (obj[c] === '' || obj[c] === undefined || obj[c] === null) { obj[c] = null; return; }
      var n = FOS.Config.parseNumber(obj[c]);
      obj[c] = n === null ? obj[c] : n;
    });
    return obj;
  }

  function criar(planilha) {
    function ler(aba) {
      return planilha.lerTabela(aba).filter(function (linha) {
        // Ignora linhas totalmente vazias deixadas pela planilha.
        return Object.keys(linha).some(function (k) {
          return linha[k] !== '' && linha[k] !== null && linha[k] !== undefined;
        });
      });
    }

    return {
      planilha: planilha,

      config: function () {
        return FOS.Config.build(ler(A.CONFIG));
      },
      configLinhas: function () { return ler(A.CONFIG); },

      regras: function () {
        return ler(A.REGRAS).map(function (r) {
          return numerico(r, ['prioridade', 'versao', 'confianca']);
        });
      },

      eventos: function () {
        return ler(A.EVENTOS_MANUAIS).map(function (e) {
          return numerico(e, ['valor', 'valor_origem_moeda']);
        });
      },

      saldosTrading: function () {
        return ler(A.SALDOS_TRADING).map(function (s) { return numerico(s, ['saldo']); });
      },

      staging: function () {
        return ler(A.IMPORT_EXTRATO).map(function (l) {
          return numerico(l, ['valor', 'linha_ordinal', 'ordinal_ocorrencia']);
        });
      },

      ledger: function () {
        return ler(A.LEDGER).map(function (l) {
          return numerico(l, ['valor_origem', 'versao_gerencial', 'confianca', 'regra_versao']);
        });
      },

      fila: function () { return ler(A.FILA_REVISAO); },

      provisoes: function () {
        return ler(A.PROVISOES).map(function (p) {
          return numerico(p, ['versao', 'valor_alvo', 'valor_acumulado', 'prioridade']);
        });
      },

      objetivos: function () {
        return ler(A.OBJETIVOS).map(function (o) {
          return numerico(o, ['versao', 'valor_alvo', 'valor_acumulado', 'prioridade']);
        });
      },

      posicoes: function () {
        return ler(A.POSICOES).map(function (e) { return numerico(e, ['valor', 'quantidade']); });
      },

      fechamentos: function () {
        return ler(A.FECHAMENTOS).map(function (f) {
          return numerico(f, ['versao', 'caixa_vida_brl', 'disponivel_brl', 'runway_meses', 'patrimonio_brl_gerencial']);
        });
      },

      restatements: function () { return ler(A.RESTATEMENTS); },

      log: function () { return ler(A.LOG); },

      anexar: function (aba, objetos) {
        return planilha.anexarLinhas(aba, objetos);
      },

      substituir: function (aba, objetos) {
        return planilha.substituirTabela(aba, objetos);
      }
    };
  }

  FOS.App.criarRepositorio = criar;
})(typeof globalThis !== 'undefined' ? globalThis : this);
