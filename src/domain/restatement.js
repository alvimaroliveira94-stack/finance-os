/**
 * Restatement (aba 41).
 * Reapresentar um fechamento NUNCA sobrescreve: gera uma nova versão do
 * fechamento (v2, v3, ...) e uma linha de rastreio ligando origem e destino.
 * O fechamento original permanece intacto, com o checksum original.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  function restatementId(competencia, versaoNova) {
    return 'RST-' + competencia + '-v' + versaoNova;
  }

  /** Campos do snapshot que mudaram entre duas versões (comparação canônica). */
  function camposAlterados(snapshotOrigem, snapshotNovo) {
    var alterados = [];
    function comparar(prefixo, a, b) {
      var chaves = {};
      Object.keys(a || {}).forEach(function (k) { chaves[k] = true; });
      Object.keys(b || {}).forEach(function (k) { chaves[k] = true; });
      Object.keys(chaves).sort().forEach(function (k) {
        if (k === 'gerado_em' || k === 'fechado_em' || k === 'versao' || k === 'checksum') return;
        var va = (a || {})[k];
        var vb = (b || {})[k];
        var caminho = prefixo ? prefixo + '.' + k : k;
        var ambosObjetos = va && vb && typeof va === 'object' && typeof vb === 'object'
          && !Array.isArray(va) && !Array.isArray(vb);
        if (ambosObjetos) {
          comparar(caminho, va, vb);
        } else if (FOS.Core.canonicalJson(va) !== FOS.Core.canonicalJson(vb)) {
          alterados.push(caminho);
        }
      });
    }
    comparar('', snapshotOrigem, snapshotNovo);
    return alterados;
  }

  /**
   * Cria a nova versão do fechamento e a linha de restatement.
   * @param {Object} params
   * @param {Object} params.fechamentoOrigem linha da aba 40 (imutável)
   * @param {Object} params.resultadoNovo saída de Closing.fechar() com a versão nova
   * @param {string} params.motivo
   */
  function criar(params) {
    var origem = params.fechamentoOrigem;
    if (!origem) FOS.Core.fail('FECHAMENTO_ORIGEM_AUSENTE', 'Restatement exige fechamento de origem');
    if (String(origem.estado) !== C.ESTADO_FECHAMENTO.FECHADO) {
      FOS.Core.fail('RESTATEMENT_SOBRE_NAO_FECHADO',
        'Só um fechamento FECHADO pode ser reapresentado; estado atual: ' + origem.estado);
    }
    if (!params.motivo || String(params.motivo).trim() === '') {
      FOS.Core.fail('MOTIVO_OBRIGATORIO', 'Restatement exige motivo explícito');
    }

    var novo = params.resultadoNovo.fechamento;
    if (Number(novo.versao) <= Number(origem.versao)) {
      FOS.Core.fail('VERSAO_RESTATEMENT_INVALIDA',
        'A nova versão precisa ser maior que a original: ' + novo.versao + ' <= ' + origem.versao);
    }
    if (String(novo.competencia) !== String(origem.competencia)) {
      FOS.Core.fail('COMPETENCIA_DIVERGENTE', 'Restatement precisa ser da mesma competência');
    }

    var alterados = camposAlterados(
      JSON.parse(origem.snapshot_json),
      params.resultadoNovo.snapshot
    );

    return {
      linhaRestatement: {
        restatement_id: restatementId(origem.competencia, novo.versao),
        competencia: origem.competencia,
        fechamento_id_origem: origem.fechamento_id,
        fechamento_id_novo: novo.fechamento_id,
        versao_origem: origem.versao,
        versao_nova: novo.versao,
        motivo: params.motivo,
        campos_alterados: alterados.join(','),
        checksum_origem: origem.checksum,
        checksum_novo: novo.checksum,
        criado_em: params.agora || '',
        criado_por: params.ator || 'SISTEMA'
      },
      fechamentoNovo: novo,
      campos_alterados: alterados
    };
  }

  /** Versão vigente de uma competência: a de maior número de versão. */
  function versaoVigente(fechamentos, competencia) {
    var daCompetencia = (fechamentos || []).filter(function (f) {
      return String(f.competencia) === String(competencia);
    });
    if (!daCompetencia.length) return null;
    return FOS.Core.sortBy(daCompetencia, [function (f) { return -Number(f.versao); }])[0];
  }

  FOS.Restatement = {
    restatementId: restatementId,
    camposAlterados: camposAlterados,
    criar: criar,
    versaoVigente: versaoVigente
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
