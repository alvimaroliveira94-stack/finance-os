/**
 * Fila de revisão (aba 21).
 * Toda ambiguidade, baixa confiança ou conciliação incerta vira item aqui.
 * A fila é o único caminho para decisão humana: o sistema nunca chuta.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  function itemId(origem, referencia, motivo) {
    return 'FILA-' + FOS.Hash.hashParts([origem, referencia, motivo]).slice(0, 12);
  }

  function novoItem(params) {
    var origem = params.origem;
    if (!C.isValid(C.ORIGEM_FILA, origem)) {
      FOS.Core.fail('ORIGEM_FILA_INVALIDA', 'Origem de fila inválida: ' + origem);
    }
    return {
      item_id: itemId(origem, params.referencia, params.motivo),
      origem: origem,
      referencia: params.referencia,
      motivo: params.motivo,
      detalhe: params.detalhe || '',
      candidatos: params.candidatos ? FOS.Core.canonicalJson(params.candidatos) : '',
      status: C.STATUS_FILA.ABERTO,
      resolucao: '',
      criado_em: params.agora || '',
      resolvido_em: '',
      resolvido_por: ''
    };
  }

  function abertos(itens) {
    return (itens || []).filter(function (i) { return String(i.status) === C.STATUS_FILA.ABERTO; });
  }

  function resolver(item, resolucao, agora, ator) {
    if (String(item.status) !== C.STATUS_FILA.ABERTO) {
      FOS.Core.fail('ITEM_FILA_NAO_ABERTO', 'Item já resolvido: ' + item.item_id);
    }
    var novo = FOS.Core.clone(item);
    novo.status = C.STATUS_FILA.RESOLVIDO;
    novo.resolucao = resolucao;
    novo.resolvido_em = agora;
    novo.resolvido_por = ator || 'USUARIO';
    return novo;
  }

  var DESCARTAR = 'DESCARTAR';

  function numero(v) {
    var n = FOS.Config.parseNumber(v);
    return n === null ? null : n;
  }

  /** Texto curto de uma linha do ledger ou do staging, para leitura humana. */
  function resumoDeLinha(linha) {
    if (!linha) return null;
    return {
      fingerprint: String(linha.fingerprint || ''),
      data: String(linha.data_origem || linha.data || ''),
      descricao: String(linha.descricao_origem || linha.descricao_original || linha.descricao || ''),
      valor: numero(linha.valor_origem !== undefined ? linha.valor_origem : linha.valor),
      conta: String(linha.conta_id || linha.conta || '')
    };
  }

  function acharPorFingerprint(lista, fingerprint) {
    var alvo = String(fingerprint || '');
    return (lista || []).filter(function (l) {
      return String(l.fingerprint || '') === alvo;
    })[0] || null;
  }

  /**
   * Traduz um item da fila na decisão que precisa ser tomada.
   *
   * Devolve estrutura, nunca texto de interface: quem monta o diálogo é o
   * ponto de entrada. Isso mantém a regra — qual pergunta fazer para cada
   * origem — testável sem simular a planilha.
   *
   * A distinção que importa: em CLASSIFICACAO a `referencia` do item é o
   * fingerprint de uma movimentação; em CONCILIACAO é o id de um EVENTO, e o
   * fingerprint tem de sair da candidata escolhida pelo usuário. Confundir os
   * dois foi exatamente o defeito que este desenho elimina.
   *
   * @param {Object} item linha da aba 21
   * @param {{linhas?:Array, staging?:Array, eventos?:Array}} [contexto]
   */
  function decisaoPendente(item, contexto) {
    var ctx = contexto || {};
    var origem = String(item.origem || '').toUpperCase();
    var base = {
      item_id: String(item.item_id || ''),
      origem: origem,
      motivo: String(item.motivo || ''),
      detalhe: String(item.detalhe || ''),
      referencia: String(item.referencia || '')
    };

    if (origem === C.ORIGEM_FILA.CONCILIACAO) {
      var evento = (ctx.eventos || []).filter(function (e) {
        return String(e.evento_id || '') === base.referencia;
      })[0] || null;
      var brutos = [];
      try {
        brutos = item.candidatos ? JSON.parse(item.candidatos) : [];
      } catch (e) {
        brutos = [];
      }
      var candidatos = (brutos || []).map(function (c, i) {
        // A candidata guardada tem fingerprint, data e valor. A descrição vem
        // do ledger na hora de perguntar — é o que torna a escolha humana.
        var doLedger = resumoDeLinha(acharPorFingerprint(ctx.linhas, c.fingerprint));
        return {
          indice: i + 1,
          fingerprint: String(c.fingerprint || ''),
          data: String(c.data || (doLedger && doLedger.data) || ''),
          valor: numero(c.valor !== undefined ? c.valor : (doLedger && doLedger.valor)),
          descricao: doLedger ? doLedger.descricao : '',
          conta: doLedger ? doLedger.conta : ''
        };
      }).filter(function (c) { return c.fingerprint; });

      return Object.assign(base, {
        tipo: 'CANDIDATA',
        evento: evento ? {
          evento_id: String(evento.evento_id || ''),
          tipo_evento: String(evento.tipo_evento || ''),
          data: String(evento.data || ''),
          valor: numero(evento.valor),
          moeda: String(evento.moeda || ''),
          descricao: String(evento.descricao || '')
        } : null,
        candidatos: candidatos,
        opcoes: candidatos.map(function (c) { return String(c.indice); })
      });
    }

    // CLASSIFICACAO e IMPORTACAO: a referência é a própria movimentação.
    var linha = resumoDeLinha(
      acharPorFingerprint(ctx.staging, base.referencia)
      || acharPorFingerprint(ctx.linhas, base.referencia));
    return Object.assign(base, {
      tipo: 'CATEGORIA',
      movimentacao: linha,
      candidatos: [],
      opcoes: C.values(C.CATEGORIA)
    });
  }

  /**
   * Converte a resposta do usuário nos parâmetros de resolverItemFila.
   *
   * Recusa o que não entende em vez de chutar: resposta inválida devolve
   * {ok:false, erro} e o item continua ABERTO. Nunca devolve a referência do
   * item como se fosse o fingerprint de uma candidata.
   *
   * @returns {{ok:boolean, params?:Object, erro?:string, descartado?:boolean}}
   */
  function interpretarResposta(pendente, texto) {
    var resposta = String(texto === undefined || texto === null ? '' : texto).trim();
    if (!resposta) {
      return { ok: false, erro: 'RESPOSTA_VAZIA' };
    }
    if (resposta.toUpperCase() === DESCARTAR) {
      return {
        ok: true,
        descartado: true,
        params: { item_id: pendente.item_id, decisao: DESCARTAR }
      };
    }

    if (pendente.tipo === 'CANDIDATA') {
      if (!pendente.candidatos.length) {
        return { ok: false, erro: 'SEM_CANDIDATAS' };
      }
      var indice = FOS.Config.parseNumber(resposta);
      var escolhida = null;
      if (indice !== null) {
        escolhida = pendente.candidatos.filter(function (c) { return c.indice === indice; })[0] || null;
      }
      if (!escolhida) {
        // Também aceita colar o fingerprint, inteiro ou abreviado.
        escolhida = pendente.candidatos.filter(function (c) {
          return c.fingerprint === resposta || c.fingerprint.slice(0, 12) === resposta;
        })[0] || null;
      }
      if (!escolhida) {
        return { ok: false, erro: 'CANDIDATA_INVALIDA:' + resposta };
      }
      return {
        ok: true,
        escolhida: escolhida,
        params: {
          item_id: pendente.item_id,
          decisao: 'CONCILIAR',
          fingerprint: escolhida.fingerprint
        }
      };
    }

    var categoria = resposta.toUpperCase();
    if (!C.isValid(C.CATEGORIA, categoria)) {
      return { ok: false, erro: 'CATEGORIA_NAO_CANONICA:' + resposta };
    }
    return {
      ok: true,
      params: { item_id: pendente.item_id, decisao: 'CLASSIFICAR', categoria: categoria }
    };
  }

  FOS.Queue = {
    DESCARTAR: DESCARTAR,
    novoItem: novoItem,
    itemId: itemId,
    abertos: abertos,
    resolver: resolver,
    decisaoPendente: decisaoPendente,
    interpretarResposta: interpretarResposta
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
