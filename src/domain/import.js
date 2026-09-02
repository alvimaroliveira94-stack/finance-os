/**
 * Staging atômico de extrato (aba 10).
 *
 * Atomicidade: o plano só é comitável se NENHUMA linha do arquivo tiver erro
 * estrutural e a conta for elegível. Meio arquivo nunca entra.
 * Idempotência: linhas cujo fingerprint já existe não geram linha nova em
 * lugar nenhum — reimportar o mesmo arquivo resulta em zero linhas novas.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  /**
   * @param {Object} params
   * @param {Object} params.config configuração construída de 00
   * @param {string} params.contaId
   * @param {string} params.nomeArquivo
   * @param {string} params.conteudo texto bruto do arquivo
   * @param {Array<string>} params.fingerprintsConhecidos do ledger 22
   * @param {string} params.agora timestamp ISO do relógio (adaptador)
   * @returns {Object} plano de importação (não escreve nada)
   */
  function planejar(params) {
    var config = params.config;
    var contaId = params.contaId;
    var nomeArquivo = params.nomeArquivo;
    var conteudo = params.conteudo;
    var conhecidos = {};
    (params.fingerprintsConhecidos || []).forEach(function (fp) { conhecidos[fp] = true; });

    var arquivoHash = FOS.Hash.fnv1a64(String(conteudo || ''));
    var importId = 'IMP-' + FOS.Hash.hashParts([contaId, arquivoHash]).slice(0, 12);
    var plano = {
      ok: false,
      import_id: importId,
      arquivo_nome: nomeArquivo,
      arquivo_hash: arquivoHash,
      conta_id: contaId,
      moeda: null,
      novas: [],
      duplicadas: [],
      erros: [],
      total_lidas: 0,
      motivo: null,
      importado_em: params.agora || null
    };

    var conta = config.conta(contaId);
    var elegibilidade = FOS.Accounts.elegibilidadeImportacao(conta);
    if (!elegibilidade.elegivel) {
      plano.motivo = elegibilidade.motivo;
      plano.erros.push({ linha: 0, codigo: elegibilidade.motivo, detalhe: 'conta ' + contaId });
      return plano;
    }
    plano.moeda = conta.moeda;

    var parsed;
    try {
      parsed = FOS.Parsers.parse(nomeArquivo, conteudo);
    } catch (e) {
      plano.motivo = e.code || 'ERRO_PARSER';
      plano.erros.push({ linha: 0, codigo: plano.motivo, detalhe: e.message });
      return plano;
    }

    plano.total_lidas = parsed.transacoes.length + parsed.erros.length;
    if (parsed.erros.length) {
      // Erro estrutural do arquivo inteiro mantém o próprio código; erro em
      // parte das linhas reprova o arquivo todo (atomicidade).
      plano.motivo = parsed.transacoes.length
        ? 'ARQUIVO_COM_LINHAS_INVALIDAS'
        : parsed.erros[0].codigo;
      plano.erros = parsed.erros;
      return plano;
    }
    if (!parsed.transacoes.length) {
      plano.motivo = 'ARQUIVO_SEM_TRANSACOES';
      plano.erros.push({ linha: 0, codigo: 'ARQUIVO_SEM_TRANSACOES', detalhe: nomeArquivo });
      return plano;
    }

    var comConta = parsed.transacoes.map(function (tx) {
      var out = FOS.Core.clone(tx);
      out.conta_id = contaId;
      out.moeda = conta.moeda;
      return out;
    });

    var comFingerprint = FOS.Fingerprint.aplicar(comConta);

    comFingerprint.forEach(function (tx, idx) {
      var linha = {
        import_id: importId,
        arquivo_nome: nomeArquivo,
        arquivo_hash: arquivoHash,
        conta_id: contaId,
        linha_ordinal: idx + 1,
        data: tx.data,
        descricao_original: tx.descricao_original,
        descricao_normalizada: tx.descricao_normalizada,
        valor: tx.valor,
        moeda: tx.moeda,
        ordinal_ocorrencia: tx.ordinal_ocorrencia,
        fingerprint: tx.fingerprint,
        status_linha: conhecidos[tx.fingerprint] ? C.STATUS_IMPORT.DUPLICADA : C.STATUS_IMPORT.NOVA,
        motivo: conhecidos[tx.fingerprint] ? 'FINGERPRINT_JA_IMPORTADO' : '',
        importado_em: params.agora || ''
      };
      if (linha.status_linha === C.STATUS_IMPORT.NOVA) plano.novas.push(linha);
      else plano.duplicadas.push(linha);
    });

    plano.ok = true;
    plano.motivo = plano.novas.length ? 'IMPORTACAO_COM_NOVAS_LINHAS' : 'REIMPORTACAO_SEM_NOVIDADE';
    return plano;
  }

  FOS.Import = { planejar: planejar };
})(typeof globalThis !== 'undefined' ? globalThis : this);
