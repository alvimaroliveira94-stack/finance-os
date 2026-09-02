/**
 * Adaptador de planilha. Único ponto do sistema que fala SpreadsheetApp.
 * O domínio nunca importa este arquivo: recebe a interface abaixo por
 * parâmetro, o que permite substituí-la por um fake nos testes.
 *
 * Interface esperada (contrato):
 *   listarAbas()              -> Array<string>
 *   criarAba(nome, headers)   -> void
 *   lerTabela(nome)           -> Array<Object>
 *   cabecalhos(nome)          -> Array<string>
 *   anexarLinhas(nome, objs)  -> number (linhas escritas)
 *   substituirTabela(nome, o) -> void  (uso restrito: abas de projeção)
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.Adapters = FOS.Adapters || {};

  function criar(spreadsheet) {
    function aba(nome) {
      var sheet = spreadsheet.getSheetByName(nome);
      if (!sheet) FOS.Core.fail('ABA_INEXISTENTE', 'Aba não encontrada: ' + nome);
      return sheet;
    }

    return {
      listarAbas: function () {
        return spreadsheet.getSheets().map(function (s) { return s.getName(); });
      },

      criarAba: function (nome, headers) {
        var existente = spreadsheet.getSheetByName(nome);
        var sheet = existente || spreadsheet.insertSheet(nome);
        if (headers && headers.length) {
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          sheet.setFrozenRows(1);
        }
        return sheet.getName();
      },

      cabecalhos: function (nome) {
        var sheet = aba(nome);
        var ultima = sheet.getLastColumn();
        if (!ultima) return [];
        return sheet.getRange(1, 1, 1, ultima).getValues()[0].map(function (h) { return String(h); });
      },

      lerTabela: function (nome) {
        var sheet = aba(nome);
        var linhas = sheet.getLastRow();
        var colunas = sheet.getLastColumn();
        if (linhas < 2 || colunas < 1) return [];
        var headers = sheet.getRange(1, 1, 1, colunas).getValues()[0].map(function (h) { return String(h); });
        return sheet.getRange(2, 1, linhas - 1, colunas).getValues().map(function (row) {
          return FOS.Schema.toObject(headers, row);
        });
      },

      anexarLinhas: function (nome, objetos) {
        if (!objetos || !objetos.length) return 0;
        var sheet = aba(nome);
        var headers = this.cabecalhos(nome);
        var linhas = objetos.map(function (obj) {
          return headers.map(function (h) {
            var v = obj[h];
            return v === undefined || v === null ? '' : v;
          });
        });
        sheet.getRange(sheet.getLastRow() + 1, 1, linhas.length, headers.length).setValues(linhas);
        return linhas.length;
      },

      substituirTabela: function (nome, objetos) {
        var sheet = aba(nome);
        var headers = this.cabecalhos(nome);
        if (sheet.getLastRow() > 1) {
          sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
        }
        return this.anexarLinhas(nome, objetos);
      }
    };
  }

  FOS.Adapters.criarPlanilha = criar;

  /** Fábrica usada dentro do Apps Script (não executa no Node). */
  FOS.Adapters.planilhaAtiva = function () {
    if (typeof SpreadsheetApp === 'undefined') {
      FOS.Core.fail('SPREADSHEET_APP_INDISPONIVEL', 'SpreadsheetApp só existe no Apps Script');
    }
    return criar(SpreadsheetApp.getActiveSpreadsheet());
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
