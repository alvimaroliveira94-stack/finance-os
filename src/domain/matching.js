/**
 * Conciliação entre eventos manuais (11) e o ledger canônico (22).
 * Padrão: valor exato + conta compatível + janela de +/- N dias (parâmetro).
 * Ambiguidade nunca é resolvida por heurística: vai para a fila de revisão.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  function candidatos(expectativa, linhas, janelaDias, usados) {
    return (linhas || []).filter(function (l) {
      if (usados[l.fingerprint]) return false;
      if (String(l.conta_id) !== String(expectativa.conta_id)) return false;
      if (FOS.Core.round2(Number(l.valor_origem)) !== FOS.Core.round2(expectativa.valor_esperado)) return false;
      var dias = Math.abs(FOS.Dates.diffDays(String(l.data_origem), expectativa.data));
      return dias <= janelaDias;
    });
  }

  /**
   * @param {Object} params
   * @param {Array} params.eventos eventos manuais (aba 11)
   * @param {Array} params.linhas visão corrente do ledger
   * @param {number} params.janelaDias
   * @param {string} params.agora
   * @returns {{conciliacoes:Array, pendentes:Array, itensFila:Array}}
   */
  function conciliar(params) {
    var janelaDias = params.janelaDias;
    var agora = params.agora || '';
    var usados = {};
    var conciliacoes = [];
    var pendentes = [];
    var itensFila = [];

    var eventos = FOS.Core.sortBy(params.eventos || [], [
      function (e) { return String(e.data); },
      function (e) { return String(e.evento_id); }
    ]);

    eventos.forEach(function (evento) {
      if (String(evento.status || '') === FOS.Events.STATUS_EVENTO.CANCELADO) return;
      var expectativa = FOS.Events.expectativaConciliacao(evento);
      if (!expectativa) return; // tipos sem contrapartida no extrato
      if (String(evento.status || '') === FOS.Events.STATUS_EVENTO.CONCILIADO && evento.fingerprint_conciliado) {
        usados[evento.fingerprint_conciliado] = true;
        conciliacoes.push({
          evento_id: evento.evento_id,
          fingerprint: evento.fingerprint_conciliado,
          categoria_esperada: expectativa.categoria_esperada,
          origem: 'JA_CONCILIADO'
        });
        return;
      }
      var cands = candidatos(expectativa, params.linhas, janelaDias, usados);
      if (cands.length === 1) {
        usados[cands[0].fingerprint] = true;
        conciliacoes.push({
          evento_id: evento.evento_id,
          fingerprint: cands[0].fingerprint,
          categoria_esperada: expectativa.categoria_esperada,
          origem: 'MATCH_AUTOMATICO'
        });
      } else if (cands.length === 0) {
        pendentes.push({ evento_id: evento.evento_id, motivo: 'CONCILIACAO_SEM_CANDIDATO' });
        itensFila.push(FOS.Queue.novoItem({
          origem: C.ORIGEM_FILA.CONCILIACAO,
          referencia: evento.evento_id,
          motivo: 'CONCILIACAO_SEM_CANDIDATO',
          detalhe: 'Nenhuma linha com valor ' + expectativa.valor_esperado
            + ' na conta ' + expectativa.conta_id + ' dentro de ' + janelaDias + ' dias de ' + expectativa.data,
          agora: agora
        }));
      } else {
        pendentes.push({ evento_id: evento.evento_id, motivo: 'AMBIGUIDADE_CONCILIACAO' });
        itensFila.push(FOS.Queue.novoItem({
          origem: C.ORIGEM_FILA.CONCILIACAO,
          referencia: evento.evento_id,
          motivo: 'AMBIGUIDADE_CONCILIACAO',
          detalhe: cands.length + ' linhas candidatas na janela de ' + janelaDias + ' dias',
          candidatos: cands.map(function (l) {
            return { fingerprint: l.fingerprint, data: l.data_origem, valor: l.valor_origem };
          }),
          agora: agora
        }));
      }
    });

    return { conciliacoes: conciliacoes, pendentes: pendentes, itensFila: itensFila };
  }

  FOS.Matching = { conciliar: conciliar, candidatos: candidatos };
})(typeof globalThis !== 'undefined' ? globalThis : this);
