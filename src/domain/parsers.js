/**
 * Parsers puros de extrato: CSV e OFX.
 * Recebem texto (o adaptador de Drive é quem lê o arquivo) e devolvem
 * transações cruas + erros estruturais. Nenhum parser escreve nada.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  var CABECALHOS = {
    data: ['data', 'date', 'data_lancamento', 'data lancamento', 'dtposted'],
    descricao: ['descricao', 'description', 'historico', 'memo', 'lancamento'],
    valor: ['valor', 'amount', 'trnamt', 'value']
  };

  function splitCsvLine(line, sep) {
    var out = [];
    var buf = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { buf += '"'; i++; } else { inQuotes = false; }
        } else buf += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === sep) {
        out.push(buf); buf = '';
      } else buf += ch;
    }
    out.push(buf);
    return out.map(function (s) { return s.trim(); });
  }

  function detectarSeparador(headerLine) {
    var candidatos = [';', ',', '\t'];
    var melhor = ',';
    var max = -1;
    candidatos.forEach(function (sep) {
      var n = headerLine.split(sep).length;
      if (n > max) { max = n; melhor = sep; }
    });
    return melhor;
  }

  function indiceDe(headers, aliases) {
    for (var i = 0; i < headers.length; i++) {
      var h = FOS.Normalize.descricao(headers[i]).toLowerCase();
      for (var j = 0; j < aliases.length; j++) {
        if (h === FOS.Normalize.descricao(aliases[j]).toLowerCase()) return i;
      }
    }
    return -1;
  }

  /**
   * @returns {{transacoes:Array, erros:Array}} transações cruas (sem conta)
   */
  function parseCsv(texto) {
    var erros = [];
    var linhas = String(texto || '').split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (linhas.length < 2) {
      return { transacoes: [], erros: [{ linha: 0, codigo: 'ARQUIVO_VAZIO', detalhe: 'CSV sem linhas de dados' }] };
    }
    var sep = detectarSeparador(linhas[0]);
    var headers = splitCsvLine(linhas[0], sep);
    var iData = indiceDe(headers, CABECALHOS.data);
    var iDesc = indiceDe(headers, CABECALHOS.descricao);
    var iValor = indiceDe(headers, CABECALHOS.valor);
    if (iData === -1 || iDesc === -1 || iValor === -1) {
      return {
        transacoes: [],
        erros: [{
          linha: 1,
          codigo: 'CABECALHO_INVALIDO',
          detalhe: 'CSV precisa de colunas de data, descrição e valor. Encontrado: ' + headers.join('|')
        }]
      };
    }
    var transacoes = [];
    for (var i = 1; i < linhas.length; i++) {
      var campos = splitCsvLine(linhas[i], sep);
      var data = FOS.Normalize.data(campos[iData]);
      var valor = FOS.Normalize.valor(campos[iValor]);
      var descricao = String(campos[iDesc] === undefined ? '' : campos[iDesc]);
      if (data === null) {
        erros.push({ linha: i + 1, codigo: 'DATA_INVALIDA', detalhe: String(campos[iData]) });
        continue;
      }
      if (valor === null) {
        erros.push({ linha: i + 1, codigo: 'VALOR_INVALIDO', detalhe: String(campos[iValor]) });
        continue;
      }
      if (descricao.trim() === '') {
        erros.push({ linha: i + 1, codigo: 'DESCRICAO_VAZIA', detalhe: '' });
        continue;
      }
      transacoes.push({
        linha_arquivo: i + 1,
        data: data,
        descricao_original: descricao,
        descricao_normalizada: FOS.Normalize.descricao(descricao),
        valor: valor
      });
    }
    return { transacoes: transacoes, erros: erros };
  }

  function tagValue(bloco, tag) {
    var re = new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i');
    var m = bloco.match(re);
    return m ? m[1].trim() : null;
  }

  function parseOfx(texto) {
    var erros = [];
    var conteudo = String(texto || '');
    var blocos = conteudo.split(/<STMTTRN>/i).slice(1);
    if (!blocos.length) {
      return { transacoes: [], erros: [{ linha: 0, codigo: 'ARQUIVO_VAZIO', detalhe: 'OFX sem STMTTRN' }] };
    }
    var transacoes = [];
    blocos.forEach(function (bloco, idx) {
      var corpo = bloco.split(/<\/STMTTRN>/i)[0];
      var data = FOS.Normalize.data(tagValue(corpo, 'DTPOSTED'));
      var valor = FOS.Normalize.valor(tagValue(corpo, 'TRNAMT'));
      var memo = tagValue(corpo, 'MEMO') || tagValue(corpo, 'NAME') || '';
      if (data === null) {
        erros.push({ linha: idx + 1, codigo: 'DATA_INVALIDA', detalhe: String(tagValue(corpo, 'DTPOSTED')) });
        return;
      }
      if (valor === null) {
        erros.push({ linha: idx + 1, codigo: 'VALOR_INVALIDO', detalhe: String(tagValue(corpo, 'TRNAMT')) });
        return;
      }
      if (String(memo).trim() === '') {
        erros.push({ linha: idx + 1, codigo: 'DESCRICAO_VAZIA', detalhe: '' });
        return;
      }
      transacoes.push({
        linha_arquivo: idx + 1,
        data: data,
        descricao_original: memo,
        descricao_normalizada: FOS.Normalize.descricao(memo),
        valor: valor
      });
    });
    return { transacoes: transacoes, erros: erros };
  }

  function parse(nomeArquivo, texto) {
    var nome = String(nomeArquivo || '').toLowerCase();
    if (nome.indexOf('.ofx') !== -1) return parseOfx(texto);
    if (nome.indexOf('.csv') !== -1) return parseCsv(texto);
    FOS.Core.fail('FORMATO_NAO_SUPORTADO', 'Formato não suportado: ' + nomeArquivo);
  }

  FOS.Parsers = { parse: parse, parseCsv: parseCsv, parseOfx: parseOfx, splitCsvLine: splitCsvLine };
})(typeof globalThis !== 'undefined' ? globalThis : this);
