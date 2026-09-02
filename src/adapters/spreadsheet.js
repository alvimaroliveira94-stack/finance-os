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
 *   formatarAba(nome, spec)   -> void  (congelamento, larguras, formatos)
 *   protegerColunas(nome, c)  -> void  (origem imutável)
 *   ocultarAba(nome, oculta)  -> void
 *   notaAba(nome, texto)      -> void
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


      /**
       * Formatação da aba: congelamento, larguras, formatos numéricos,
       * filtro e faixa alternada. Puramente cosmético e idempotente — o
       * domínio nunca depende disto.
       */
      formatarAba: function (nome, spec) {
        var sheet = aba(nome);
        var s = spec || {};
        var colunas = this.cabecalhos(nome);
        if (!colunas.length) return nome;
        sheet.setFrozenRows(s.congelarLinhas === undefined ? 1 : s.congelarLinhas);
        if (s.congelarColunas) sheet.setFrozenColumns(s.congelarColunas);
        (s.larguras || []).forEach(function (largura, i) {
          if (largura) sheet.setColumnWidth(i + 1, largura);
        });
        var ultimaLinha = Math.max(sheet.getMaxRows(), 2);
        Object.keys(s.formatos || {}).forEach(function (coluna) {
          var idx = colunas.indexOf(coluna);
          if (idx === -1) return;
          sheet.getRange(2, idx + 1, ultimaLinha - 1, 1).setNumberFormat(s.formatos[coluna]);
        });
        var cabecalho = sheet.getRange(1, 1, 1, colunas.length);
        cabecalho.setFontWeight('bold');
        if (s.corCabecalho) cabecalho.setBackground(s.corCabecalho);
        if (s.corTexto) cabecalho.setFontColor(s.corTexto);
        if (s.filtro && sheet.getLastRow() > 1 && !sheet.getFilter()) {
          sheet.getRange(1, 1, sheet.getLastRow(), colunas.length).createFilter();
        }
        return nome;
      },

      /** Validação por lista fixa em uma coluna (evita digitação livre). */
      validarColunaPorLista: function (nome, coluna, valores) {
        var sheet = aba(nome);
        var idx = this.cabecalhos(nome).indexOf(coluna);
        if (idx === -1 || !valores || !valores.length) return false;
        var regra = SpreadsheetApp.newDataValidation()
          .requireValueInList(valores, true)
          .setAllowInvalid(false)
          .build();
        sheet.getRange(2, idx + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(regra);
        return true;
      },

      /**
       * Protege colunas de origem contra edição manual, mantendo o dono da
       * planilha como editor autorizado (manutenção continua possível).
       */
      protegerColunas: function (nome, colunasProtegidas, descricao) {
        var sheet = aba(nome);
        var colunas = this.cabecalhos(nome);
        var protecoes = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
        protecoes.forEach(function (p) {
          if (p.getDescription() && p.getDescription().indexOf('FinanceOS') === 0) p.remove();
        });
        (colunasProtegidas || []).forEach(function (coluna) {
          var idx = colunas.indexOf(coluna);
          if (idx === -1) return;
          var protecao = sheet.getRange(1, idx + 1, sheet.getMaxRows(), 1).protect();
          protecao.setDescription('FinanceOS: ' + (descricao || 'origem imutável') + ' [' + coluna + ']');
          protecao.setWarningOnly(true);
        });
        return nome;
      },

      ocultarAba: function (nome, oculta) {
        var sheet = aba(nome);
        if (oculta) sheet.hideSheet();
        else sheet.showSheet();
        return nome;
      },

      /** Nota explicativa na célula A1: contexto sem poluir a interface. */
      notaAba: function (nome, texto) {
        aba(nome).getRange(1, 1).setNote(texto || '');
        return nome;
      },

      ordenarAbas: function (ordem) {
        (ordem || []).forEach(function (nomeAba, i) {
          var sheet = spreadsheet.getSheetByName(nomeAba);
          if (!sheet) return;
          spreadsheet.setActiveSheet(sheet);
          spreadsheet.moveActiveSheet(i + 1);
        });
        return ordem;
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
