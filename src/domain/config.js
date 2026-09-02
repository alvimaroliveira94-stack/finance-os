/**
 * Leitura de 00_CONFIG_PARAMETROS: parâmetros, catálogo de contas e enums.
 * Regra dura: parâmetro BLOQUEADO devolve value=null + reason. Nunca
 * substituir por default silencioso.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  function parseBool(v) {
    if (typeof v === 'boolean') return v;
    var s = String(v === undefined || v === null ? '' : v).trim().toUpperCase();
    if (s === 'TRUE' || s === 'SIM' || s === 'VERDADEIRO' || s === '1') return true;
    if (s === 'FALSE' || s === 'NAO' || s === 'NÃO' || s === 'FALSO' || s === '0' || s === '') return false;
    return null;
  }

  function parseNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    var s = String(v === undefined || v === null ? '' : v).trim();
    if (s === '') return null;
    // Aceita "1.234,56" (pt-BR) e "1234.56".
    if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.indexOf(',') !== -1) s = s.replace(',', '.');
    var n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Parâmetros que já foram canônicos e deixaram de ser.
   *
   * Esta lista é a fonte de verdade da depreciação, não a célula `status` da
   * planilha: um parâmetro descontinuado não pode voltar a existir porque
   * alguém editou a aba 00. A linha continua na planilha (histórico
   * preservado, nada é apagado) e "Preparar planilha" apenas sincroniza o
   * texto dela com esta lista.
   *
   * Ambos foram removidos por auditoria: declarados na semente, sem nenhum
   * consumidor no domínio, sem efeito em fechamento, snapshot, estado do
   * ciclo, planejamento ou dashboard — cobravam uma definição que o sistema
   * não usava para nada.
   */
  var PARAMETROS_DEPRECIADOS = {
    PATRIMONIO_ALVO_BRL:
      'SUBSTITUIDO_POR_OBJETIVOS: meta de patrimônio é objetivo versionado na aba 31, '
      + 'declarado pelo evento NOVO_OBJETIVO.',
    CUSTO_VIDA_ALVO_MENSAL_BRL:
      'SEM_CONSUMIDOR: o custo de vida operacional é derivado do ledger observado '
      + 'e da média de MESES_MEDIA_CUSTO_VIDA.'
  };

  function ehDepreciado(chave) {
    return Object.prototype.hasOwnProperty.call(PARAMETROS_DEPRECIADOS, chave);
  }

  /**
   * Constrói o objeto de configuração a partir das linhas da aba 00.
   * @param {Array<Object>} rows linhas já convertidas em objeto por cabeçalho
   */
  function build(rows) {
    var parametros = {};
    var contas = {};
    var enums = {};

    (rows || []).forEach(function (r) {
      var secao = String(r.secao || '').trim().toUpperCase();
      var chave = String(r.chave || '').trim();
      if (!secao || !chave) return;

      if (secao === 'PARAMETRO') {
        if (ehDepreciado(chave)) {
          parametros[chave] = {
            chave: chave,
            value: null,
            status: C.STATUS_PARAMETRO.DEPRECIADO,
            reason: PARAMETROS_DEPRECIADOS[chave],
            tipo: String(r.tipo || 'TEXTO').trim().toUpperCase(),
            unidade: r.unidade || null,
            versao: parseNumber(r.versao) || 1
          };
          return;
        }
        var bloqueado = String(r.status || '').trim().toUpperCase() === C.STATUS_PARAMETRO.BLOQUEADO;
        var tipo = String(r.tipo || 'TEXTO').trim().toUpperCase();
        var parsed = null;
        if (!bloqueado) {
          if (tipo === 'NUMERO' || tipo === 'PERCENTUAL') parsed = parseNumber(r.valor);
          else if (tipo === 'BOOLEANO') parsed = parseBool(r.valor);
          else parsed = (r.valor === undefined || r.valor === null || r.valor === '') ? null : String(r.valor);
        }
        parametros[chave] = {
          chave: chave,
          value: bloqueado ? null : parsed,
          status: bloqueado ? 'BLOQUEADO' : (parsed === null ? 'NULL' : 'OK'),
          reason: bloqueado
            ? (String(r.reason || '').trim() || 'PARAMETRO_BLOQUEADO')
            : (parsed === null ? 'PARAMETRO_SEM_VALOR' : null),
          tipo: tipo,
          unidade: r.unidade || null,
          versao: parseNumber(r.versao) || 1
        };
      } else if (secao === 'CONTA') {
        contas[chave] = {
          conta_id: chave,
          nome: String(r.valor || chave),
          universo: String(r.universo || '').trim().toUpperCase(),
          modo_ingestao: String(r.modo_ingestao || '').trim().toUpperCase(),
          moeda: String(r.moeda || '').trim().toUpperCase(),
          ativa: parseBool(r.ativa) === true,
          elegivel_importacao: parseBool(r.elegivel_importacao) === true,
          status: String(r.status || C.STATUS_PARAMETRO.ATIVO).trim().toUpperCase()
        };
      } else if (secao === 'ENUM') {
        (enums[chave] = enums[chave] || []).push(String(r.valor));
      }
    });

    return {
      parametros: parametros,
      contas: contas,
      enums: enums,

      /** Parâmetro como valor gerenciado ({value,status,reason}). */
      param: function (chave) {
        var p = parametros[chave];
        if (!p) {
          return { value: null, status: 'NULL', reason: 'PARAMETRO_INEXISTENTE:' + chave };
        }
        return { value: p.value, status: p.status, reason: p.reason };
      },

      /** Parâmetro numérico obrigatório: lança se ausente/bloqueado. */
      requireNumber: function (chave) {
        var p = this.param(chave);
        if (p.value === null || typeof p.value !== 'number') {
          FOS.Core.fail('PARAMETRO_INDISPONIVEL',
            'Parâmetro numérico indisponível: ' + chave + ' (' + (p.reason || p.status) + ')',
            { chave: chave, status: p.status, reason: p.reason });
        }
        return p.value;
      },

      conta: function (contaId) {
        return contas[contaId] || null;
      },

      contasPorUniverso: function (universo) {
        return Object.keys(contas)
          .map(function (k) { return contas[k]; })
          .filter(function (c) { return c.universo === universo; });
      }
    };
  }

  FOS.Config = {
    build: build,
    parseBool: parseBool,
    parseNumber: parseNumber,
    PARAMETROS_DEPRECIADOS: PARAMETROS_DEPRECIADOS,
    ehDepreciado: ehDepreciado
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
