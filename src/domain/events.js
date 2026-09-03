/**
 * Eventos manuais (aba 11): exatamente sete tipos.
 * O evento é a declaração de intenção do usuário; a conciliação com o extrato
 * é feita depois, por valor + conta + janela de dias.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;
  var T = C.TIPO_EVENTO;

  var STATUS_EVENTO = {
    PENDENTE: 'PENDENTE',
    CONCILIADO: 'CONCILIADO',
    NAO_APLICAVEL: 'NAO_APLICAVEL',
    CANCELADO: 'CANCELADO'
  };

  /**
   * Especificação por tipo:
   *  concilia          — precisa casar com linha do extrato
   *  sinalEsperado     — DEBITO (saída da conta de vida) ou CREDITO (entrada)
   *  contaConciliacao  — de qual campo sai a conta que aparece no extrato
   *  exigeReferencia   — precisa de referencia_id (provisão/objetivo/posição/passivo)
   *  categoriaEsperada — categoria canônica correspondente no ledger
   *  exigeVencimento   — precisa de `vencimento` ISO, distinto de `data`
   *  usaValorDevido    — `valor_devido`, quando informado, é a obrigação
   *                       total (pode divergir de `valor`, o caixa recebido)
   */
  var SPEC = {};
  SPEC[T.SAQUE_TRADING] = {
    concilia: true, sinalEsperado: 'CREDITO', contaConciliacao: 'conta_destino',
    exigeReferencia: false, categoriaEsperada: C.CATEGORIA.SAQUE_TRADING,
    universoOrigem: C.UNIVERSO.TRADING, universoDestino: C.UNIVERSO.VIDA
  };
  SPEC[T.GASTO_EXTRAORDINARIO] = {
    concilia: true, sinalEsperado: 'DEBITO', contaConciliacao: 'conta_origem',
    exigeReferencia: false, categoriaEsperada: C.CATEGORIA.GASTO_EXTRAORDINARIO,
    universoOrigem: C.UNIVERSO.VIDA, universoDestino: null
  };
  SPEC[T.APORTE_EXTRAORDINARIO] = {
    concilia: true, sinalEsperado: 'DEBITO', contaConciliacao: 'conta_origem',
    exigeReferencia: false, categoriaEsperada: C.CATEGORIA.APORTE_EXTRAORDINARIO,
    universoOrigem: C.UNIVERSO.VIDA, universoDestino: C.UNIVERSO.TRADING
  };
  SPEC[T.NOVA_OBRIGACAO] = {
    concilia: false, sinalEsperado: null, contaConciliacao: null,
    exigeReferencia: true, categoriaEsperada: null,
    universoOrigem: null, universoDestino: null
  };
  SPEC[T.NOVO_OBJETIVO] = {
    concilia: false, sinalEsperado: null, contaConciliacao: null,
    exigeReferencia: true, categoriaEsperada: null,
    universoOrigem: null, universoDestino: null
  };
  SPEC[T.APORTE_POSICAO] = {
    concilia: true, sinalEsperado: 'DEBITO', contaConciliacao: 'conta_origem',
    exigeReferencia: true, categoriaEsperada: C.CATEGORIA.PATRIMONIO_OBJETIVOS,
    universoOrigem: C.UNIVERSO.VIDA, universoDestino: C.UNIVERSO.PATRIMONIO
  };
  SPEC[T.RETIRADA_POSICAO] = {
    concilia: true, sinalEsperado: 'CREDITO', contaConciliacao: 'conta_destino',
    exigeReferencia: true, categoriaEsperada: C.CATEGORIA.PATRIMONIO_OBJETIVOS,
    universoOrigem: C.UNIVERSO.PATRIMONIO, universoDestino: C.UNIVERSO.VIDA
  };
  // Nasce do dinheiro que entra no banco (valor), mas a obrigação que nasce
  // junto pode valer mais (valor_devido) — juro descontado na origem, por
  // exemplo. Sem conta_origem: a contraparte é externa (o credor), não uma
  // conta do próprio catálogo.
  SPEC[T.NOVO_PASSIVO] = {
    concilia: true, sinalEsperado: 'CREDITO', contaConciliacao: 'conta_destino',
    exigeReferencia: true, categoriaEsperada: C.CATEGORIA.MOVIMENTACAO_COM_TERCEIRO,
    universoOrigem: null, universoDestino: C.UNIVERSO.VIDA,
    exigeVencimento: true, usaValorDevido: true
  };
  // Quitação/amortização: reduz o saldo devedor pelo próprio `valor` pago.
  // Não tem vencimento próprio — é o passivo referenciado que já o carrega.
  SPEC[T.AMORTIZACAO_PASSIVO] = {
    concilia: true, sinalEsperado: 'DEBITO', contaConciliacao: 'conta_origem',
    exigeReferencia: true, categoriaEsperada: C.CATEGORIA.MOVIMENTACAO_COM_TERCEIRO,
    universoOrigem: C.UNIVERSO.VIDA, universoDestino: null,
    exigeVencimento: false, usaValorDevido: false
  };

  function spec(tipo) {
    return SPEC[tipo] || null;
  }

  /**
   * Os tipos que o domínio aceita, na ordem do catálogo.
   *
   * É esta lista — e não uma cópia dela — que alimenta o dropdown da aba 11.
   * Assim a conveniência da planilha não tem como divergir do que `validar`
   * realmente aceita: se um tipo entrar ou sair do SPEC, a lista acompanha.
   */
  function tiposValidos() {
    return C.values(T).filter(function (tipo) { return !!SPEC[tipo]; });
  }

  /** O tipo existe no catálogo? Usado para separar erro de digitação de tipo
   *  válido que simplesmente não pertence a um fluxo. */
  function tipoConhecido(tipo) {
    return !!SPEC[String(tipo || '').toUpperCase()];
  }

  /**
   * Valida um evento manual contra o catálogo de contas.
   * @returns {{ok:boolean, erros:Array<{codigo:string,detalhe:string}>}}
   */
  function validar(evento, config) {
    var erros = [];
    var tipo = String(evento.tipo_evento || '').toUpperCase();
    var s = spec(tipo);
    if (!s) {
      return { ok: false, erros: [{ codigo: 'TIPO_EVENTO_INVALIDO', detalhe: String(evento.tipo_evento) }] };
    }
    if (!FOS.Dates.isIso(String(evento.data))) {
      erros.push({ codigo: 'DATA_INVALIDA', detalhe: String(evento.data) });
    }
    var valor = FOS.Normalize.valor(evento.valor);
    if (valor === null || valor <= 0) {
      erros.push({ codigo: 'VALOR_INVALIDO', detalhe: 'valor deve ser positivo (o sinal vem do tipo do evento)' });
    }
    if (!C.isValid(C.MOEDA, String(evento.moeda || '').toUpperCase())) {
      erros.push({ codigo: 'MOEDA_INVALIDA', detalhe: String(evento.moeda) });
    }
    if (s.exigeReferencia && String(evento.referencia_id || '').trim() === '') {
      erros.push({ codigo: 'REFERENCIA_OBRIGATORIA', detalhe: tipo + ' exige referencia_id' });
    }
    // vencimento é estruturalmente distinto de `data`: `data` é a movimentação
    // bancária (usada na conciliação), `vencimento` é quando a obrigação
    // precisa estar quitada. Nunca extraído de texto livre.
    if (s.exigeVencimento && !FOS.Dates.isIso(String(evento.vencimento || ''))) {
      erros.push({ codigo: 'VENCIMENTO_INVALIDO', detalhe: String(evento.vencimento) });
    }
    if (s.usaValorDevido && String(evento.valor_devido || '').trim() !== '') {
      var valorDevido = FOS.Normalize.valor(evento.valor_devido);
      if (valorDevido === null || valorDevido <= 0) {
        erros.push({ codigo: 'VALOR_DEVIDO_INVALIDO', detalhe: 'valor_devido deve ser positivo quando informado' });
      } else if (valor !== null && valorDevido < valor) {
        erros.push({
          codigo: 'VALOR_DEVIDO_MENOR_QUE_RECEBIDO',
          detalhe: 'valor_devido (' + valorDevido + ') não pode ser menor que o valor recebido (' + valor + ')'
        });
      }
    }
    // Universo PATRIMONIO não é conta: a contraparte é a posição (referencia_id).
    if (s.universoOrigem && s.universoOrigem !== C.UNIVERSO.PATRIMONIO) {
      var origem = config.conta(evento.conta_origem);
      if (!origem) {
        erros.push({ codigo: 'CONTA_ORIGEM_DESCONHECIDA', detalhe: String(evento.conta_origem) });
      } else if (origem.universo !== s.universoOrigem) {
        erros.push({
          codigo: 'UNIVERSO_ORIGEM_INCOMPATIVEL',
          detalhe: tipo + ' exige conta de origem no universo ' + s.universoOrigem + ', recebido ' + origem.universo
        });
      }
    }
    if (s.universoDestino && s.universoDestino !== C.UNIVERSO.PATRIMONIO) {
      var destino = config.conta(evento.conta_destino);
      if (!destino) {
        erros.push({ codigo: 'CONTA_DESTINO_DESCONHECIDA', detalhe: String(evento.conta_destino) });
      } else if (destino.universo !== s.universoDestino) {
        erros.push({
          codigo: 'UNIVERSO_DESTINO_INCOMPATIVEL',
          detalhe: tipo + ' exige conta de destino no universo ' + s.universoDestino + ', recebido ' + destino.universo
        });
      }
    }
    if (tipo === T.SAQUE_TRADING && evento.conta_origem && evento.conta_destino) {
      if (!FOS.Accounts.isFronteiraReconhecida(evento.conta_origem, evento.conta_destino)) {
        erros.push({
          codigo: 'FRONTEIRA_NAO_RECONHECIDA',
          detalhe: 'A única travessia controlada é '
            + C.FRONTEIRA_RECONHECIDA.origem + ' para ' + C.FRONTEIRA_RECONHECIDA.destino
        });
      }
    }
    return { ok: erros.length === 0, erros: erros };
  }

  /** O que o extrato deve conter para este evento ser considerado conciliado. */
  function expectativaConciliacao(evento) {
    var s = spec(String(evento.tipo_evento || '').toUpperCase());
    if (!s || !s.concilia) return null;
    var valor = FOS.Normalize.valor(evento.valor);
    return {
      evento_id: evento.evento_id,
      conta_id: evento[s.contaConciliacao],
      data: evento.data,
      valor_esperado: s.sinalEsperado === 'DEBITO' ? -Math.abs(valor) : Math.abs(valor),
      categoria_esperada: s.categoriaEsperada
    };
  }

  FOS.Events = {
    STATUS_EVENTO: STATUS_EVENTO,
    SPEC: SPEC,
    spec: spec,
    tiposValidos: tiposValidos,
    tipoConhecido: tipoConhecido,
    validar: validar,
    expectativaConciliacao: expectativaConciliacao
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
