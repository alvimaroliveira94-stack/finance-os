/**
 * Calibração da classificação: transforma decisão humana sobre um grupo de
 * pendências em regra persistente, com escopo exato.
 *
 * A assinatura é o centro deste módulo. Ela é a MESMA função que agrupa a
 * fila e que a regra persiste — divergir entre as duas seria generalizar em
 * silêncio, que é o defeito que este desenho existe para impedir.
 *
 *   assinatura = TIPO_OPERACAO | CONTRAPARTE_LITERAL | DIRECAO
 *
 * Nenhum dígito entra na chave. Identificador numérico do extrato (agência,
 * "Cp", lote) NÃO é identidade de contraparte enquanto sua unicidade não for
 * provada — e na prática não é: um mesmo código pode aparecer com várias
 * contrapartes diferentes.
 *
 * A regra persistida usa IGUAL sobre a assinatura completa, nunca CONTEM
 * sobre a contraparte: "FULANO DE TAL" é substring de "FULANO DE TAL JUNIOR",
 * e uma regra aprovada para o primeiro capturaria o segundo sem que ninguém
 * decidisse isso.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  /** Prefixo canônico das faixas de calibração na aba 20. */
  var PREFIXO_ID = 'CAL-';

  /**
   * Prioridade única de toda regra calibrada.
   *
   * Não é detalhe: `Rules.classificar` só detecta ambiguidade entre regras de
   * MESMA prioridade. Prioridades diferentes fariam uma vencer em silêncio,
   * que é exatamente o que não se quer entre duas decisões humanas.
   * Abaixo de 90 para vencer regras de semente de baixa confiança.
   */
  var PRIORIDADE = 50;

  /**
   * Rótulos de operação que os extratos brasileiros usam.
   *
   * Servem apenas para tornar a assinatura legível. Não são requisito de
   * correção: descrição sem prefixo conhecido vira tipo OUTRO com o texto
   * inteiro como contraparte, e a assinatura continua exata.
   */
  var TIPOS = [
    'PIX RECEBIDO', 'PIX ENVIADO', 'TRANSFERENCIA RECEBIDA', 'TRANSFERENCIA ENVIADA',
    'APLICACAO POUPANCA', 'RESGATE POUPANCA', 'COMPRA NO DEBITO', 'PAGAMENTO EFETUADO'
  ];

  var TIPO_DESCONHECIDO = 'OUTRO';
  var ENTRA = 'ENTRA';
  var SAI = 'SAI';

  /**
   * Ruído estrutural do extrato que não identifica ninguém.
   * Removido por palavra inteira: recortar substring mutilaria nomes que
   * apenas contenham as letras (CPFL, CPTM), inventando contrapartes.
   */
  var RUIDO = [/\bNO ESTABELECIMENTO\b/g, /\bCP\b/g];

  var ESTADO = {
    INEDITO: 'INEDITO',
    COERENTE: 'COERENTE',
    INSTAVEL: 'INSTAVEL'
  };

  var MODO = {
    SO_AGORA: 'SO_AGORA',
    APRENDER: 'APRENDER',
    PULAR: 'PULAR'
  };

  function textoNormalizado(linha) {
    var direto = linha.descricao_normalizada;
    if (direto !== undefined && direto !== null && String(direto) !== '') return String(direto);
    // Linha do ledger guarda a descrição de origem, não a normalizada. A
    // recomputação é determinística, então a assinatura de qualquer linha
    // histórica é derivável sem coluna nova.
    return FOS.Normalize.descricao(
      linha.descricao_origem || linha.descricao_original || linha.descricao || '');
  }

  function valorDaLinha(linha) {
    var v = linha.valor !== undefined && linha.valor !== null && linha.valor !== ''
      ? linha.valor : linha.valor_origem;
    return Number(FOS.Config.parseNumber(v));
  }

  /**
   * Assinatura segura de uma movimentação.
   * @param {Object} linha staging (descricao_normalizada/valor) ou ledger
   *   (descricao_origem/valor_origem)
   * @returns {{tipo:string, contraparte:string, direcao:string, chave:string}}
   */
  function assinatura(linha) {
    var texto = textoNormalizado(linha || {});
    var tipo = TIPO_DESCONHECIDO;
    var resto = texto;
    for (var i = 0; i < TIPOS.length; i++) {
      if (texto.indexOf(TIPOS[i]) === 0) {
        tipo = TIPOS[i];
        resto = texto.slice(TIPOS[i].length);
        break;
      }
    }
    RUIDO.forEach(function (r) {
      resto = resto.replace(r, ' ');
    });
    // Todo bloco numérico sai: nenhum identificador do banco vira identidade.
    var contraparte = resto.replace(/[0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!contraparte) contraparte = tipo;
    var valor = valorDaLinha(linha || {});
    var direcao = Number.isFinite(valor) && valor < 0 ? SAI : ENTRA;
    return {
      tipo: tipo,
      contraparte: contraparte,
      direcao: direcao,
      chave: tipo + ' | ' + contraparte + ' | ' + direcao
    };
  }

  /** O sinal que a regra deve exigir, coerente com a direção da assinatura. */
  function sinalDaDirecao(direcao) {
    return direcao === SAI ? 'DEBITO' : 'CREDITO';
  }

  /**
   * Agrupa itens ABERTOS da fila por assinatura.
   *
   * Só entram itens de origem CLASSIFICACAO — a fila de conciliação pede
   * outra decisão (qual candidata), tratada por "Revisar pendências".
   *
   * @param {Array<Object>} itensAbertos linhas da aba 21 com status ABERTO
   * @param {Array<Object>} staging linhas da aba 10
   * @returns {Array<Object>} grupos ordenados por quantidade decrescente
   */
  function agrupar(itensAbertos, staging) {
    var porFingerprint = {};
    (staging || []).forEach(function (l) { porFingerprint[String(l.fingerprint)] = l; });

    var grupos = {};
    (itensAbertos || []).forEach(function (item) {
      if (String(item.origem || '').toUpperCase() !== C.ORIGEM_FILA.CLASSIFICACAO) return;
      var linha = porFingerprint[String(item.referencia)];
      if (!linha) return;
      var a = assinatura(linha);
      var g = grupos[a.chave];
      if (!g) {
        g = grupos[a.chave] = {
          chave: a.chave, tipo: a.tipo, contraparte: a.contraparte, direcao: a.direcao,
          quantidade: 0, soma: 0, data_min: null,
          itens: [], fingerprints: [], exemplos: [], observado: {}
        };
      }
      g.quantidade++;
      g.soma = FOS.Core.round2(g.soma + valorDaLinha(linha));
      var dataDaLinha = String(linha.data || '');
      if (dataDaLinha && (!g.data_min || dataDaLinha < g.data_min)) g.data_min = dataDaLinha;
      g.itens.push(String(item.item_id));
      g.fingerprints.push(String(linha.fingerprint));
      if (g.exemplos.length < 3) {
        g.exemplos.push({
          data: String(linha.data || ''),
          valor: valorDaLinha(linha),
          descricao: textoNormalizado(linha)
        });
      }
      // Identificadores numéricos observados: contexto para a decisão humana,
      // jamais chave de agrupamento.
      var ids = textoNormalizado(linha).match(/[0-9]{4,}/g) || [];
      ids.forEach(function (n) { g.observado[n] = (g.observado[n] || 0) + 1; });
    });

    return FOS.Core.sortBy(Object.keys(grupos).map(function (k) { return grupos[k]; }), [
      function (g) { return -g.quantidade; },
      function (g) { return g.chave; }
    ]);
  }

  /**
   * Evidência histórica de uma assinatura no ledger.
   *
   * Só leitura: o histórico decide se o padrão merece virar regra, e nunca é
   * alterado por isso. Competência fechada não é tocada em hipótese alguma.
   *
   * @param {string} chave assinatura
   * @param {Array<Object>} linhasCorrentes visão corrente do ledger
   */
  function estabilidade(chave, linhasCorrentes) {
    var categorias = {};
    var ocorrencias = 0;
    (linhasCorrentes || []).forEach(function (l) {
      if (assinatura(l).chave !== chave) return;
      ocorrencias++;
      var cat = String(l.categoria || '');
      categorias[cat] = (categorias[cat] || 0) + 1;
    });
    var nomes = Object.keys(categorias);
    if (!ocorrencias) {
      return { estado: ESTADO.INEDITO, ocorrencias: 0, categorias: {}, categoria: null };
    }
    if (nomes.length === 1) {
      return {
        estado: ESTADO.COERENTE, ocorrencias: ocorrencias,
        categorias: categorias, categoria: nomes[0]
      };
    }
    return {
      estado: ESTADO.INSTAVEL, ocorrencias: ocorrencias,
      categorias: categorias, categoria: null
    };
  }

  /** Regras calibradas ativas para uma assinatura (normalmente zero ou uma). */
  function vigentesDaAssinatura(regras, chave) {
    return (regras || []).filter(function (r) {
      return String(r.campo) === 'assinatura'
        && String(r.operador).toUpperCase() === 'IGUAL'
        && String(r.valor_referencia) === String(chave)
        && FOS.Config.parseBool(r.ativo) === true;
    });
  }

  /** Identidade já atribuída a uma assinatura, ativa ou não. Mantém-se estável. */
  function idDaAssinatura(regras, chave) {
    var todas = (regras || []).filter(function (r) {
      return String(r.campo) === 'assinatura' && String(r.valor_referencia) === String(chave);
    });
    return todas.length ? String(todas[0].regra_id) : null;
  }

  /** Maior versão já gravada de uma identidade (0 se inédita). */
  function versaoDe(regras, regraId) {
    return (regras || []).reduce(function (maior, r) {
      if (String(r.regra_id) !== String(regraId)) return maior;
      var v = Number(r.versao) || 1;
      return v > maior ? v : maior;
    }, 0);
  }

  /** Próxima identidade livre na faixa CAL-NNNN. */
  function proximoId(regras) {
    var maior = 0;
    (regras || []).forEach(function (r) {
      var m = String(r.regra_id || '').match(/^CAL-(\d+)$/);
      if (m) maior = Math.max(maior, Number(m[1]));
    });
    var n = String(maior + 1);
    while (n.length < 4) n = '0' + n;
    return PREFIXO_ID + n;
  }

  /**
   * Os cinco portões da confiança 1,0. Puro: não escreve nada.
   *
   * P1 escolha explícita · P2 escopo exato · P3 estabilidade histórica
   * P4 sem conflito com regra ativa · P5 validações do domínio
   *
   * `casados` é quantas pendências ABERTAS a regra candidata alcançaria.
   * Igual ao tamanho do grupo é o único valor aceitável: maior significa que
   * a regra capturaria item que ninguém aprovou. Linha já classificada não
   * entra nessa conta — ela é histórico, e quem a julga é P3.
   *
   * @returns {{ok:boolean, motivo:?string, correcao:boolean, regraId:?string}}
   */
  function avaliarPersistencia(p) {
    var grupo = p.grupo || {};
    var categoria = String(p.categoria || '').trim().toUpperCase();
    var est = p.estabilidade || { estado: ESTADO.INEDITO };
    var vigentes = p.vigentes || [];
    var regraId = p.regraId || null;

    // P1
    if (p.modo !== MODO.APRENDER) {
      return { ok: false, motivo: 'PERSISTENCIA_NAO_SOLICITADA', correcao: false, regraId: regraId };
    }
    // P5 (barato, primeiro)
    if (!C.isValid(C.CATEGORIA, categoria)) {
      return { ok: false, motivo: 'CATEGORIA_NAO_CANONICA:' + p.categoria, correcao: false, regraId: regraId };
    }
    // P2 — a regra candidata não pode alcançar nada além do grupo aprovado
    if (Number(p.casados) !== Number(grupo.quantidade)) {
      return {
        ok: false,
        motivo: 'ESCOPO_MAIOR_QUE_O_GRUPO:' + p.casados + '>' + grupo.quantidade,
        correcao: false, regraId: regraId
      };
    }

    var conflitante = vigentes.filter(function (r) {
      return String(r.categoria).toUpperCase() !== categoria;
    });
    var jaIgual = vigentes.filter(function (r) {
      return String(r.categoria).toUpperCase() === categoria;
    });

    // Regra idêntica já ativa: nada a fazer, e não é erro.
    if (jaIgual.length) {
      return {
        ok: false, motivo: 'REGRA_JA_VIGENTE', correcao: false,
        regraId: String(jaIgual[0].regra_id), noop: true
      };
    }

    // P3 — histórico instável nunca vira regra automática
    if (est.estado === ESTADO.INSTAVEL) {
      return { ok: false, motivo: 'HISTORICO_INSTAVEL', correcao: false, regraId: regraId };
    }

    // P3 — histórico coerente em outra categoria é evidência de instabilidade
    // semântica. Só há um caminho: corrigir a regra que já existe, com
    // confirmação explícita. Exceção do mês não vira regra.
    if (est.estado === ESTADO.COERENTE
      && String(est.categoria).toUpperCase() !== categoria) {
      if (!conflitante.length) {
        return { ok: false, motivo: 'DIVERGE_DO_HISTORICO:' + est.categoria, correcao: false, regraId: regraId };
      }
      if (p.confirmouCorrecao !== true) {
        return { ok: false, motivo: 'CORRECAO_NAO_CONFIRMADA', correcao: false, regraId: regraId };
      }
      return { ok: true, motivo: null, correcao: true, regraId: String(conflitante[0].regra_id) };
    }

    // P4 — conflito com regra ativa de outra categoria
    if (conflitante.length) {
      if (p.confirmouCorrecao !== true) {
        return { ok: false, motivo: 'CONFLITO_COM_REGRA_VIGENTE', correcao: false, regraId: String(conflitante[0].regra_id) };
      }
      return { ok: true, motivo: null, correcao: true, regraId: String(conflitante[0].regra_id) };
    }

    return { ok: true, motivo: null, correcao: false, regraId: regraId };
  }

  /**
   * Linha de regra calibrada para a aba 20.
   * IGUAL sobre a assinatura completa: não consegue generalizar.
   *
   * `desde` é a data da movimentação mais antiga do grupo aprovado, não o dia
   * da calibração. A regra nasce DESSAS linhas: se a vigência começasse hoje,
   * ela não classificaria as próprias pendências que a originaram, e o mês
   * continuaria aberto depois de o usuário já ter decidido.
   */
  function linhaDeRegra(p) {
    var categoria = String(p.categoria).toUpperCase();
    return {
      regra_id: p.regraId,
      versao: p.versao,
      prioridade: PRIORIDADE,
      ativo: 'TRUE',
      campo: 'assinatura',
      operador: 'IGUAL',
      valor_referencia: p.chave,
      conta_escopo: p.contaEscopo || '',
      sinal_valor: sinalDaDirecao(p.direcao),
      categoria: categoria,
      subcategoria: p.subcategoria || '',
      universo: FOS.Rules.UNIVERSO_POR_CATEGORIA[categoria],
      confianca: 1,
      vigente_desde: String(p.desde || p.agora || '').slice(0, 10),
      vigente_ate: '',
      observacao: p.observacao || ''
    };
  }

  /** Campos que desativam uma versão, preservando a linha. */
  function camposDeDesativacao(motivo, agora) {
    return {
      ativo: 'FALSE',
      vigente_ate: String(agora || '').slice(0, 10),
      observacao: String(motivo || 'DESATIVADA')
    };
  }

  /**
   * Converte a resposta do usuário na decisão sobre um grupo.
   *
   * A gramática torna a persistência a opção mais cara de digitar, de
   * propósito: escrever só a categoria classifica o mês; ensinar exige a
   * palavra APRENDER; corrigir uma regra vigente exige CORRIGIR.
   *
   *   PULAR                  -> não altera nada
   *   CUSTO_VIDA             -> classificar só agora, sem criar regra
   *   CUSTO_VIDA APRENDER    -> classificar e aprender
   *   CUSTO_VIDA CORRIGIR    -> corrigir a regra vigente desta assinatura
   *
   * @returns {{ok:boolean, decisao?:Object, erro?:string}}
   */
  function interpretarResposta(grupo, texto) {
    var bruto = String(texto === undefined || texto === null ? '' : texto).trim();
    if (!bruto) return { ok: false, erro: 'RESPOSTA_VAZIA' };

    var partes = bruto.toUpperCase().split(/\s+/);
    var primeira = partes[0];
    if (primeira === MODO.PULAR) {
      return { ok: true, decisao: { chave: grupo.chave, categoria: null, modo: MODO.PULAR } };
    }

    if (!C.isValid(C.CATEGORIA, primeira)) {
      return { ok: false, erro: 'CATEGORIA_NAO_CANONICA:' + partes[0] };
    }
    var sufixo = partes[1] || '';
    if (!sufixo) {
      return {
        ok: true,
        decisao: { chave: grupo.chave, categoria: primeira, modo: MODO.SO_AGORA }
      };
    }
    if (sufixo === MODO.APRENDER) {
      return {
        ok: true,
        decisao: {
          chave: grupo.chave, categoria: primeira,
          modo: MODO.APRENDER, confirmouCorrecao: false
        }
      };
    }
    if (sufixo === 'CORRIGIR') {
      if (!grupo.regra_vigente) return { ok: false, erro: 'SEM_REGRA_VIGENTE_PARA_CORRIGIR' };
      return {
        ok: true,
        decisao: {
          chave: grupo.chave, categoria: primeira,
          modo: MODO.APRENDER, confirmouCorrecao: true
        }
      };
    }
    return { ok: false, erro: 'MODO_DESCONHECIDO:' + sufixo };
  }

  FOS.Calibration = {
    PREFIXO_ID: PREFIXO_ID,
    PRIORIDADE: PRIORIDADE,
    TIPOS: TIPOS,
    ESTADO: ESTADO,
    MODO: MODO,
    assinatura: assinatura,
    sinalDaDirecao: sinalDaDirecao,
    agrupar: agrupar,
    estabilidade: estabilidade,
    vigentesDaAssinatura: vigentesDaAssinatura,
    idDaAssinatura: idDaAssinatura,
    versaoDe: versaoDe,
    proximoId: proximoId,
    avaliarPersistencia: avaliarPersistencia,
    interpretarResposta: interpretarResposta,
    linhaDeRegra: linhaDeRegra,
    camposDeDesativacao: camposDeDesativacao
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
