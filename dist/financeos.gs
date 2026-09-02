/**
 * Finance OS — arquivo único para Google Apps Script.
 *
 * GERADO por `npm run build` a partir de src/. Não edite aqui: edite os
 * arquivos de src/ e gere de novo, senão a próxima geração desfaz a edição.
 *
 * Além deste arquivo, o projeto do Apps Script precisa de:
 *   - um arquivo HTML chamado `dashboard` com o conteúdo de src/ui/dashboard.html;
 *   - o manifesto de src/appsscript.json.
 *
 * A ordem de concatenação abaixo é a ordem canônica de carga (tools/ordem.js).
 */

/* ===== src/domain/core.js ===== */
/**
 * Núcleo compartilhado do domínio Finance OS.
 * Domínio puro: nenhuma referência a SpreadsheetApp, DriveApp ou UrlFetchApp.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  /** Erro de domínio com código estável, usado em testes e no log de auditoria. */
  function DomainError(code, message, details) {
    var err = new Error(code + ': ' + message);
    err.name = 'DomainError';
    err.code = code;
    err.details = details || null;
    return err;
  }

  function fail(code, message, details) {
    throw DomainError(code, message, details);
  }

  /**
   * Valor gerenciado: todo campo exposto ao dashboard carrega status e motivo.
   * Valor bloqueado/indisponível é sempre null + reason, nunca zero ou chute.
   */
  function value(v) {
    return { value: v, status: 'OK', reason: null };
  }
  function nullValue(reason, status) {
    return { value: null, status: status || 'NULL', reason: reason || 'VALOR_INDISPONIVEL' };
  }
  function errorValue(reason) {
    return { value: null, status: 'ERROR', reason: reason || 'ERRO_DE_CALCULO' };
  }
  function staleValue(v, reason) {
    return { value: v === undefined ? null : v, status: 'STALE', reason: reason || 'DADO_DESATUALIZADO' };
  }
  function insufficient(reason) {
    return { value: null, status: 'DADO_INSUFICIENTE', reason: reason || 'HISTORICO_INSUFICIENTE' };
  }
  function isOk(managed) {
    return !!managed && managed.status === 'OK' && managed.value !== null;
  }

  /** Cópia profunda determinística de estruturas simples (sem Date/Map/Set). */
  function clone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(clone);
    var out = {};
    Object.keys(obj).forEach(function (k) { out[k] = clone(obj[k]); });
    return out;
  }

  /** Arredondamento monetário estável (evita ruído de ponto flutuante). */
  function round2(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return n;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /** Serialização canônica: chaves ordenadas, saída estável para checksum. */
  function canonicalJson(obj) {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj === 'number') return Number.isFinite(obj) ? String(round2(obj)) : 'null';
    if (typeof obj === 'boolean' || typeof obj === 'string') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
    var keys = Object.keys(obj).sort();
    return '{' + keys.map(function (k) {
      return JSON.stringify(k) + ':' + canonicalJson(obj[k]);
    }).join(',') + '}';
  }

  function sum(list, pick) {
    return round2((list || []).reduce(function (acc, item) {
      var v = pick ? pick(item) : item;
      return acc + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }, 0));
  }

  function groupBy(list, pick) {
    var out = {};
    (list || []).forEach(function (item) {
      var key = pick(item);
      (out[key] = out[key] || []).push(item);
    });
    return out;
  }

  function sortBy(list, pickers) {
    var picks = Array.isArray(pickers) ? pickers : [pickers];
    return (list || []).slice().sort(function (a, b) {
      for (var i = 0; i < picks.length; i++) {
        var va = picks[i](a);
        var vb = picks[i](b);
        if (va < vb) return -1;
        if (va > vb) return 1;
      }
      return 0;
    });
  }

  FOS.Core = {
    DomainError: DomainError,
    fail: fail,
    value: value,
    nullValue: nullValue,
    errorValue: errorValue,
    staleValue: staleValue,
    insufficient: insufficient,
    isOk: isOk,
    clone: clone,
    canonicalJson: canonicalJson,
    round2: round2,
    sum: sum,
    groupBy: groupBy,
    sortBy: sortBy
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/hash.js ===== */
/**
 * Hash determinístico puro: FNV-1a de 64 bits sobre os bytes UTF-8 da entrada.
 *
 * Duas restrições moldaram esta implementação:
 *  - roda igual no Apps Script V8 e no Node, sem depender de
 *    Utilities.computeDigest (que é adaptador de plataforma);
 *  - não usa BigInt: o suporte a BigInt no Apps Script não é garantido, e uma
 *    divergência aqui mudaria todo fingerprint e todo checksum. A aritmética é
 *    feita em quatro limbs de 16 bits, exata dentro de Number.
 *
 * O resultado bate com os vetores oficiais do FNV-1a 64 (ver teste de hash),
 * o que torna a implementação verificável contra uma referência externa.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  /** Bytes UTF-8 de uma string, incluindo pares substitutos. */
  function bytesUtf8(str) {
    var texto = String(str === undefined || str === null ? '' : str);
    var bytes = [];
    for (var i = 0; i < texto.length; i++) {
      var codigo = texto.charCodeAt(i);
      if (codigo >= 0xd800 && codigo <= 0xdbff && i + 1 < texto.length) {
        var proximo = texto.charCodeAt(i + 1);
        if (proximo >= 0xdc00 && proximo <= 0xdfff) {
          codigo = ((codigo - 0xd800) << 10) + (proximo - 0xdc00) + 0x10000;
          i++;
        }
      }
      if (codigo < 0x80) {
        bytes.push(codigo);
      } else if (codigo < 0x800) {
        bytes.push(0xc0 | (codigo >> 6), 0x80 | (codigo & 0x3f));
      } else if (codigo < 0x10000) {
        bytes.push(0xe0 | (codigo >> 12), 0x80 | ((codigo >> 6) & 0x3f), 0x80 | (codigo & 0x3f));
      } else {
        bytes.push(
          0xf0 | (codigo >> 18),
          0x80 | ((codigo >> 12) & 0x3f),
          0x80 | ((codigo >> 6) & 0x3f),
          0x80 | (codigo & 0x3f)
        );
      }
    }
    return bytes;
  }

  function hex4(n) {
    var s = n.toString(16);
    while (s.length < 4) s = '0' + s;
    return s;
  }

  /**
   * FNV-1a 64 bits.
   * offset basis = 0xcbf29ce484222325, primo = 0x100000001b3.
   * O primo é 2^40 + 0x1b3, então na base 2^16 ele só contribui em dois
   * lugares: 0x1b3 no limb 0 e 0x100 no limb 2.
   */
  function fnv1a64(input) {
    var bytes = bytesUtf8(input);
    var v0 = 0x2325;
    var v1 = 0x8422;
    var v2 = 0x9ce4;
    var v3 = 0xcbf2;

    for (var i = 0; i < bytes.length; i++) {
      v0 = (v0 ^ bytes[i]) & 0xffff;

      var r0 = v0 * 0x1b3;
      var r1 = v1 * 0x1b3;
      var r2 = v2 * 0x1b3 + v0 * 0x100;
      var r3 = v3 * 0x1b3 + v1 * 0x100;

      var carrega = r0 >>> 16;
      v0 = r0 & 0xffff;
      r1 += carrega;
      carrega = r1 >>> 16;
      v1 = r1 & 0xffff;
      r2 += carrega;
      carrega = r2 >>> 16;
      v2 = r2 & 0xffff;
      r3 += carrega;
      v3 = r3 & 0xffff;
    }
    return hex4(v3) + hex4(v2) + hex4(v1) + hex4(v0);
  }

  /**
   * Hash de partes com separador de unidade (0x1f), que não ocorre em campos
   * de planilha; evita colisão por concatenação ambígua.
   */
  function hashParts(partes) {
    return fnv1a64((partes || []).map(function (p) {
      return p === null || p === undefined ? '' : String(p);
    }).join(String.fromCharCode(31)));
  }

  function pad8(hex) {
    var s = String(hex);
    while (s.length < 8) s = '0' + s;
    return s.slice(-8);
  }

  FOS.Hash = { fnv1a64: fnv1a64, hashParts: hashParts, bytesUtf8: bytesUtf8, pad8: pad8 };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/dates.js ===== */
/**
 * Datas como string ISO (YYYY-MM-DD) e competências como YYYY-MM.
 * O domínio não usa Date do runtime para não depender do timezone da
 * planilha nem do servidor: toda comparação é textual/numérica pura.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  var ISO = /^\d{4}-\d{2}-\d{2}$/;
  var COMPETENCIA = /^\d{4}-\d{2}$/;

  function daysInMonth(year, month) {
    var lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) return 29;
    return lengths[month - 1];
  }

  function isRealDate(iso) {
    var y = Number(iso.slice(0, 4));
    var m = Number(iso.slice(5, 7));
    var d = Number(iso.slice(8, 10));
    if (m < 1 || m > 12 || d < 1) return false;
    return d <= daysInMonth(y, m);
  }

  function isIso(v) {
    return typeof v === 'string' && ISO.test(v) && isRealDate(v);
  }

  function assertIso(date, field) {
    if (!isIso(date)) {
      FOS.Core.fail('DATA_INVALIDA', 'Data inválida em ' + (field || 'campo') + ': ' + date);
    }
    return date;
  }

  /** Número de dia contínuo (dia juliano) para diferenças e comparações. */
  function toDayNumber(iso) {
    assertIso(iso);
    var y = Number(iso.slice(0, 4));
    var m = Number(iso.slice(5, 7));
    var d = Number(iso.slice(8, 10));
    var a = Math.floor((14 - m) / 12);
    var y2 = y + 4800 - a;
    var m2 = m + 12 * a - 3;
    return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2
      + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
  }

  function diffDays(a, b) {
    return toDayNumber(a) - toDayNumber(b);
  }

  function competenciaOf(iso) {
    assertIso(iso);
    return iso.slice(0, 7);
  }

  function assertCompetencia(comp) {
    if (typeof comp !== 'string' || !COMPETENCIA.test(comp) || Number(comp.slice(5, 7)) < 1 || Number(comp.slice(5, 7)) > 12) {
      FOS.Core.fail('COMPETENCIA_INVALIDA', 'Competência inválida: ' + comp);
    }
    return comp;
  }

  function competenciaRange(comp) {
    assertCompetencia(comp);
    var y = Number(comp.slice(0, 4));
    var m = Number(comp.slice(5, 7));
    var last = daysInMonth(y, m);
    return { inicio: comp + '-01', fim: comp + '-' + (last < 10 ? '0' + last : String(last)) };
  }

  function addMonths(comp, delta) {
    assertCompetencia(comp);
    var y = Number(comp.slice(0, 4));
    var m = Number(comp.slice(5, 7)) + delta;
    y += Math.floor((m - 1) / 12);
    m = ((m - 1) % 12 + 12) % 12 + 1;
    return String(y) + '-' + (m < 10 ? '0' + m : String(m));
  }

  function monthsBetween(compA, compB) {
    assertCompetencia(compA);
    assertCompetencia(compB);
    return (Number(compB.slice(0, 4)) - Number(compA.slice(0, 4))) * 12
      + (Number(compB.slice(5, 7)) - Number(compA.slice(5, 7)));
  }

  function inRange(iso, inicio, fim) {
    return toDayNumber(iso) >= toDayNumber(inicio) && toDayNumber(iso) <= toDayNumber(fim);
  }

  function inCompetencia(iso, comp) {
    var r = competenciaRange(comp);
    return inRange(iso, r.inicio, r.fim);
  }

  FOS.Dates = {
    isIso: isIso,
    assertIso: assertIso,
    daysInMonth: daysInMonth,
    toDayNumber: toDayNumber,
    diffDays: diffDays,
    competenciaOf: competenciaOf,
    assertCompetencia: assertCompetencia,
    competenciaRange: competenciaRange,
    addMonths: addMonths,
    monthsBetween: monthsBetween,
    inRange: inRange,
    inCompetencia: inCompetencia
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/constants.js ===== */
/**
 * Enums canônicos do Finance OS.
 * Estes valores são decisões financeiras canônicas: não alterar sem
 * decisão explícita do usuário. Parâmetros numéricos ficam em
 * 00_CONFIG_PARAMETROS (configuráveis), não aqui.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  /** Abas visíveis (superfícies de leitura/entrada humana). */
  var ABAS_VISIVEIS = {
    HOME: 'HOME',
    MOVIMENTACOES: 'MOVIMENTAÇÕES',
    PLANEJAMENTO: 'PLANEJAMENTO',
    PATRIMONIO: 'PATRIMÔNIO'
  };

  /** Estruturas internas (motor). Ordem = ordem de criação no workbook. */
  var ABAS_INTERNAS = {
    CONFIG: '00_CONFIG_PARAMETROS',
    IMPORT_EXTRATO: '10_IMPORT_EXTRATO',
    EVENTOS_MANUAIS: '11_EVENTOS_MANUAIS',
    SALDOS_TRADING: '12_SALDOS_TRADING_SEMANAL',
    REGRAS: '20_REGRAS_CLASSIFICACAO',
    FILA_REVISAO: '21_FILA_REVISAO',
    LEDGER: '22_LEDGER_CANONICO_MOVIMENTACOES',
    PROVISOES: '30_PROVISOES',
    OBJETIVOS: '31_OBJETIVOS',
    POSICOES: '32_LEDGER_POSICOES',
    FECHAMENTOS: '40_FECHAMENTOS',
    RESTATEMENTS: '41_RESTATEMENTS',
    LOG: '90_LOG_AUDITORIA'
  };

  /** Universos separados por firewall. */
  var UNIVERSO = {
    VIDA: 'VIDA',
    TRADING: 'TRADING',
    PATRIMONIO: 'PATRIMONIO'
  };

  /** Modo de ingestão por conta. Firewall depende disto. */
  var MODO_INGESTAO = {
    IMPORTACAO_MENSAL: 'IMPORTACAO_MENSAL',
    SALDO_SEMANAL: 'SALDO_SEMANAL'
  };

  /** Categorias canônicas de classificação. */
  var CATEGORIA = {
    CUSTO_VIDA: 'CUSTO_VIDA',
    CUSTO_TRADING: 'CUSTO_TRADING',
    SAQUE_TRADING: 'SAQUE_TRADING',
    GASTO_EXTRAORDINARIO: 'GASTO_EXTRAORDINARIO',
    APORTE_EXTRAORDINARIO: 'APORTE_EXTRAORDINARIO',
    TRANSFERENCIA_INTERNA: 'TRANSFERENCIA_INTERNA',
    PATRIMONIO_OBJETIVOS: 'PATRIMONIO_OBJETIVOS'
  };

  /** Tipos de evento manual (aba 11). Exatamente sete. */
  var TIPO_EVENTO = {
    SAQUE_TRADING: 'SAQUE_TRADING',
    GASTO_EXTRAORDINARIO: 'GASTO_EXTRAORDINARIO',
    APORTE_EXTRAORDINARIO: 'APORTE_EXTRAORDINARIO',
    NOVA_OBRIGACAO: 'NOVA_OBRIGACAO',
    NOVO_OBJETIVO: 'NOVO_OBJETIVO',
    APORTE_POSICAO: 'APORTE_POSICAO',
    RETIRADA_POSICAO: 'RETIRADA_POSICAO'
  };

  /** Tipos de evento do ledger de posições (aba 32). */
  var EVENTO_POSICAO = {
    APORTE: 'APORTE',
    RETIRADA: 'RETIRADA',
    DISTRIBUICAO: 'DISTRIBUICAO',
    SNAPSHOT_VALOR_MERCADO: 'SNAPSHOT_VALOR_MERCADO'
  };

  /** Estados do fechamento mensal. */
  var ESTADO_FECHAMENTO = {
    ABERTO: 'ABERTO',
    EM_REVISAO: 'EM_REVISAO',
    FECHADO: 'FECHADO'
  };

  /** Estados do ciclo financeiro, do mais frágil ao mais expansivo. */
  var ESTADO_CICLO = {
    FRAGIL: 'FRAGIL',
    ESTABILIZANDO: 'ESTABILIZANDO',
    ESTAVEL: 'ESTAVEL',
    EXPANSAO: 'EXPANSAO'
  };

  var ORDEM_ESTADO_CICLO = [
    ESTADO_CICLO.FRAGIL,
    ESTADO_CICLO.ESTABILIZANDO,
    ESTADO_CICLO.ESTAVEL,
    ESTADO_CICLO.EXPANSAO
  ];

  /** Status de provisão/objetivo. */
  var STATUS_PROVISAO = {
    COBERTA: 'COBERTA',
    EM_RITMO: 'EM_RITMO',
    FORA_DE_RITMO: 'FORA_DE_RITMO',
    EM_RISCO: 'EM_RISCO',
    DADO_INSUFICIENTE: 'DADO_INSUFICIENTE'
  };

  /** Os sete sinais binários independentes do ciclo de 90 dias. */
  var SINAL = {
    REDUCAO_PROTECAO: 'REDUCAO_PROTECAO',
    GASTO_EXTRAORDINARIO_ANORMAL: 'GASTO_EXTRAORDINARIO_ANORMAL',
    VIDA_PARA_TRADING: 'VIDA_PARA_TRADING',
    RESERVA_FORA_DA_FINALIDADE: 'RESERVA_FORA_DA_FINALIDADE',
    QUEDA_RUNWAY: 'QUEDA_RUNWAY',
    COMPROMISSO_SEM_PROVISAO: 'COMPROMISSO_SEM_PROVISAO',
    RETIRADA_APOS_MES_FORTE: 'RETIRADA_APOS_MES_FORTE'
  };

  /** Status de linha de staging de importação. */
  var STATUS_IMPORT = {
    NOVA: 'NOVA',
    DUPLICADA: 'DUPLICADA',
    REJEITADA: 'REJEITADA'
  };

  /** Status de item da fila de revisão. */
  var STATUS_FILA = {
    ABERTO: 'ABERTO',
    RESOLVIDO: 'RESOLVIDO',
    DESCARTADO: 'DESCARTADO'
  };

  /** Origem do item de fila. */
  var ORIGEM_FILA = {
    CLASSIFICACAO: 'CLASSIFICACAO',
    CONCILIACAO: 'CONCILIACAO',
    IMPORTACAO: 'IMPORTACAO'
  };

  /** Status de um parâmetro em 00_CONFIG_PARAMETROS. */
  var STATUS_PARAMETRO = {
    ATIVO: 'ATIVO',
    BLOQUEADO: 'BLOQUEADO'
  };

  /** Status de valor exposto ao dashboard (leitura). */
  var STATUS_VALOR = {
    OK: 'OK',
    NULL: 'NULL',
    STALE: 'STALE',
    ERROR: 'ERROR',
    DADO_INSUFICIENTE: 'DADO_INSUFICIENTE'
  };

  /** Moedas suportadas no V1. */
  var MOEDA = { BRL: 'BRL', GBP: 'GBP' };

  /**
   * Fronteira reconhecida entre universos: única travessia controlada.
   * Movimentos internos entre Betfair/Neteller/Wise não são controlados.
   */
  var FRONTEIRA_RECONHECIDA = { origem: 'WISE', destino: 'INTER_CC' };

  function values(enumObj) {
    return Object.keys(enumObj).map(function (k) { return enumObj[k]; });
  }

  function isValid(enumObj, v) {
    return values(enumObj).indexOf(v) !== -1;
  }

  FOS.Constants = {
    ABAS_VISIVEIS: ABAS_VISIVEIS,
    ABAS_INTERNAS: ABAS_INTERNAS,
    UNIVERSO: UNIVERSO,
    MODO_INGESTAO: MODO_INGESTAO,
    CATEGORIA: CATEGORIA,
    TIPO_EVENTO: TIPO_EVENTO,
    EVENTO_POSICAO: EVENTO_POSICAO,
    ESTADO_FECHAMENTO: ESTADO_FECHAMENTO,
    ESTADO_CICLO: ESTADO_CICLO,
    ORDEM_ESTADO_CICLO: ORDEM_ESTADO_CICLO,
    STATUS_PROVISAO: STATUS_PROVISAO,
    SINAL: SINAL,
    STATUS_IMPORT: STATUS_IMPORT,
    STATUS_FILA: STATUS_FILA,
    ORIGEM_FILA: ORIGEM_FILA,
    STATUS_PARAMETRO: STATUS_PARAMETRO,
    STATUS_VALOR: STATUS_VALOR,
    MOEDA: MOEDA,
    FRONTEIRA_RECONHECIDA: FRONTEIRA_RECONHECIDA,
    values: values,
    isValid: isValid
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/schema.js ===== */
/**
 * Schema tabular das abas internas.
 * É a fonte única dos cabeçalhos: bootstrap cria, repositório lê/escreve e
 * os testes validam contra esta definição. Nenhuma coluna é posicional no
 * código de domínio — sempre acessada por nome.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var A = FOS.Constants.ABAS_INTERNAS;

  var SCHEMA = {};

  SCHEMA[A.CONFIG] = {
    nome: A.CONFIG,
    descricao: 'Parâmetros, catálogo de contas e enums. Parâmetro bloqueado devolve null + reason.',
    chave: ['secao', 'chave'],
    colunas: [
      'secao',                  // PARAMETRO | CONTA | ENUM
      'chave',
      'valor',
      'tipo',                   // NUMERO | TEXTO | BOOLEANO | PERCENTUAL
      'unidade',
      'universo',               // usado por secao=CONTA
      'modo_ingestao',          // usado por secao=CONTA
      'moeda',
      'ativa',                  // usado por secao=CONTA
      'elegivel_importacao',    // usado por secao=CONTA
      'status',                 // ATIVO | BLOQUEADO
      'reason',
      'versao',
      'atualizado_em',
      'descricao'
    ]
  };

  SCHEMA[A.IMPORT_EXTRATO] = {
    nome: A.IMPORT_EXTRATO,
    descricao: 'Staging atômico de CSV/OFX para contas pessoais elegíveis.',
    chave: ['import_id', 'linha_ordinal'],
    colunas: [
      'import_id', 'arquivo_nome', 'arquivo_hash', 'conta_id', 'linha_ordinal',
      'data', 'descricao_original', 'descricao_normalizada', 'valor', 'moeda',
      'ordinal_ocorrencia', 'fingerprint', 'status_linha', 'motivo', 'importado_em'
    ]
  };

  SCHEMA[A.EVENTOS_MANUAIS] = {
    nome: A.EVENTOS_MANUAIS,
    descricao: 'Os sete tipos de evento manual declarados pelo usuário.',
    chave: ['evento_id'],
    colunas: [
      'evento_id', 'tipo_evento', 'data', 'conta_origem', 'conta_destino',
      'valor', 'moeda', 'valor_origem_moeda', 'moeda_origem',
      'descricao', 'referencia_id', 'status',
      'fingerprint_conciliado', 'criado_em', 'criado_por', 'observacao'
    ]
  };

  SCHEMA[A.SALDOS_TRADING] = {
    nome: A.SALDOS_TRADING,
    descricao: 'Somente saldos semanais do ecossistema de trading. Nunca transações.',
    chave: ['registro_id'],
    colunas: [
      'registro_id', 'data_referencia', 'conta_id', 'saldo', 'moeda',
      'origem', 'registrado_em', 'observacao'
    ]
  };

  SCHEMA[A.REGRAS] = {
    nome: A.REGRAS,
    descricao: 'Regras determinísticas versionadas de classificação.',
    chave: ['regra_id', 'versao'],
    colunas: [
      'regra_id', 'versao', 'prioridade', 'ativo', 'campo', 'operador',
      'valor_referencia', 'conta_escopo', 'sinal_valor', 'categoria',
      'subcategoria', 'universo', 'confianca', 'vigente_desde', 'vigente_ate', 'observacao'
    ]
  };

  SCHEMA[A.FILA_REVISAO] = {
    nome: A.FILA_REVISAO,
    descricao: 'Toda ambiguidade ou baixa confiança. Nunca classificar por adivinhação.',
    chave: ['item_id'],
    colunas: [
      'item_id', 'origem', 'referencia', 'motivo', 'detalhe', 'candidatos',
      'status', 'resolucao', 'criado_em', 'resolvido_em', 'resolvido_por'
    ]
  };

  SCHEMA[A.LEDGER] = {
    nome: A.LEDGER,
    descricao: 'Ledger canônico append-only. Origem imutável, campos gerenciais versionados.',
    chave: ['linha_id'],
    colunas: [
      'linha_id', 'fingerprint', 'versao_gerencial',
      // Origem imutável
      'data_origem', 'descricao_origem', 'valor_origem', 'moeda_origem',
      'conta_id', 'import_id', 'arquivo_hash',
      // Campos gerenciais auditáveis
      'categoria', 'subcategoria', 'universo', 'regra_id', 'regra_versao',
      'confianca', 'evento_conciliado_id', 'motivo_versao',
      'classificado_em', 'classificado_por', 'criado_em'
    ]
  };

  SCHEMA[A.PROVISOES] = {
    nome: A.PROVISOES,
    descricao: 'Subledger versionado de provisões (obrigações futuras).',
    chave: ['provisao_id', 'versao'],
    colunas: [
      'provisao_id', 'versao', 'nome', 'valor_alvo', 'valor_acumulado',
      'vencimento', 'prioridade', 'moeda', 'origem_evento_id',
      'vigente_desde', 'vigente_ate', 'criado_em', 'motivo_versao', 'observacao'
    ]
  };

  SCHEMA[A.OBJETIVOS] = {
    nome: A.OBJETIVOS,
    descricao: 'Subledger versionado de objetivos de patrimônio.',
    chave: ['objetivo_id', 'versao'],
    colunas: [
      'objetivo_id', 'versao', 'nome', 'valor_alvo', 'valor_acumulado',
      'prazo', 'prioridade', 'moeda', 'origem_evento_id',
      'vigente_desde', 'vigente_ate', 'criado_em', 'motivo_versao', 'observacao'
    ]
  };

  SCHEMA[A.POSICOES] = {
    nome: A.POSICOES,
    descricao: 'Event sourcing append-only de posições. Correção por evento compensatório.',
    chave: ['evento_id'],
    colunas: [
      'evento_id', 'posicao_id', 'tipo_evento', 'data', 'valor', 'moeda',
      'quantidade', 'compensa_evento_id', 'origem', 'criado_em', 'observacao'
    ]
  };

  SCHEMA[A.FECHAMENTOS] = {
    nome: A.FECHAMENTOS,
    descricao: 'Fechamento mensal materializado e imutável, com snapshot completo.',
    chave: ['fechamento_id'],
    colunas: [
      'fechamento_id', 'competencia', 'versao', 'estado', 'gerado_em', 'fechado_em',
      'checksum', 'motivo_versao', 'gerado_por',
      // Colunas espelho para leitura humana (a verdade completa está no snapshot).
      'caixa_vida_brl', 'disponivel_brl', 'runway_meses', 'patrimonio_brl_gerencial',
      'estado_ciclo_sugerido', 'estado_ciclo_formal', 'qualidade', 'snapshot_json'
    ]
  };

  SCHEMA[A.RESTATEMENTS] = {
    nome: A.RESTATEMENTS,
    descricao: 'Reapresentações. Geram nova versão de fechamento, nunca sobrescrevem.',
    chave: ['restatement_id'],
    colunas: [
      'restatement_id', 'competencia', 'fechamento_id_origem', 'fechamento_id_novo',
      'versao_origem', 'versao_nova', 'motivo', 'campos_alterados',
      'checksum_origem', 'checksum_novo', 'criado_em', 'criado_por'
    ]
  };

  SCHEMA[A.LOG] = {
    nome: A.LOG,
    descricao: 'Log de auditoria: antes e depois de toda ação relevante.',
    chave: ['log_id'],
    colunas: [
      'log_id', 'timestamp', 'ator', 'acao', 'entidade', 'entidade_id',
      'antes', 'depois', 'resultado', 'detalhe'
    ]
  };

  function get(nomeAba) {
    var s = SCHEMA[nomeAba];
    if (!s) FOS.Core.fail('ABA_DESCONHECIDA', 'Aba sem schema definido: ' + nomeAba);
    return s;
  }

  function nomes() {
    return Object.keys(SCHEMA);
  }

  /** Converte objeto de domínio para linha (array) na ordem do schema. */
  function toRow(nomeAba, obj) {
    return get(nomeAba).colunas.map(function (col) {
      var v = obj[col];
      return v === undefined ? '' : v;
    });
  }

  /** Converte linha (array) + cabeçalhos em objeto. */
  function toObject(headers, row) {
    var out = {};
    headers.forEach(function (h, i) { out[h] = row[i]; });
    return out;
  }

  FOS.Schema = { SCHEMA: SCHEMA, get: get, nomes: nomes, toRow: toRow, toObject: toObject };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/normalize.js ===== */
/**
 * Normalização determinística de descrições e valores.
 * Determinismo é requisito do fingerprint: a mesma linha de arquivo precisa
 * produzir sempre a mesma descrição normalizada, hoje e daqui a um ano.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  var ACENTOS = {
    'á': 'a', 'à': 'a', 'ã': 'a', 'â': 'a', 'ä': 'a',
    'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
    'ó': 'o', 'ò': 'o', 'õ': 'o', 'ô': 'o', 'ö': 'o',
    'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
    'ç': 'c', 'ñ': 'n'
  };

  function removeAcentos(str) {
    var s = String(str);
    if (typeof s.normalize === "function") {
      return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    return s.replace(/[\u00c0-\u017f]/g, function (ch) {
      var lower = ch.toLowerCase();
      var repl = ACENTOS[lower];
      return repl ? (ch === lower ? repl : repl.toUpperCase()) : ch;
    });
  }

  /**
   * Descrição normalizada:
   * maiúsculas, sem acentos, sem pontuação, espaços colapsados.
   * Não remove números: eles carregam informação de classificação.
   */
  function descricao(texto) {
    var s = String(texto === undefined || texto === null ? '' : texto);
    s = removeAcentos(s).toUpperCase();
    s = s.replace(/[^A-Z0-9 ]+/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  /**
   * Valor monetário: número com 2 casas. Aceita formatos pt-BR e en-US e
   * parênteses como negativo (comum em exportações de extrato).
   */
  function valor(v) {
    if (typeof v === 'number') {
      return Number.isFinite(v) ? FOS.Core.round2(v) : null;
    }
    var s = String(v === undefined || v === null ? '' : v).trim();
    if (s === '') return null;
    var negativo = false;
    if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
    s = s.replace(/[R$\s £]/gi, '');
    if (s.indexOf('-') === 0) { negativo = true; s = s.slice(1); }
    if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else if (s.indexOf(',') !== -1) {
      s = s.replace(',', '.');
    }
    var n = Number(s);
    if (!Number.isFinite(n)) return null;
    return FOS.Core.round2(negativo ? -n : n);
  }

  /** Data: aceita ISO, DD/MM/AAAA e AAAAMMDD (OFX). Devolve ISO ou null. */
  function data(v) {
    var s = String(v === undefined || v === null ? '' : v).trim();
    if (s === '') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return FOS.Dates.isIso(s) ? s : null;
    var br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) {
      var iso = br[3] + '-' + br[2] + '-' + br[1];
      return FOS.Dates.isIso(iso) ? iso : null;
    }
    var ofx = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (ofx) {
      var iso2 = ofx[1] + '-' + ofx[2] + '-' + ofx[3];
      return FOS.Dates.isIso(iso2) ? iso2 : null;
    }
    return null;
  }

  FOS.Normalize = { descricao: descricao, valor: valor, data: data, removeAcentos: removeAcentos };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/config.js ===== */
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

  FOS.Config = { build: build, parseBool: parseBool, parseNumber: parseNumber };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/accounts.js ===== */
/**
 * Firewall de contas entre universos.
 * Trading, Vida e Patrimônio são separados. Contas de trading nunca entram
 * em importação transacional; delas só entram saldos semanais (aba 12).
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  /**
   * Uma conta é elegível para importação de extrato se, e somente se:
   * universo VIDA, modo IMPORTACAO_MENSAL, ativa e marcada como elegível.
   */
  function elegibilidadeImportacao(conta) {
    if (!conta) {
      return { elegivel: false, motivo: 'CONTA_DESCONHECIDA' };
    }
    if (conta.universo === C.UNIVERSO.TRADING) {
      return { elegivel: false, motivo: 'FIREWALL_TRADING_SEM_IMPORTACAO_TRANSACIONAL' };
    }
    if (conta.universo !== C.UNIVERSO.VIDA) {
      return { elegivel: false, motivo: 'UNIVERSO_NAO_IMPORTAVEL:' + conta.universo };
    }
    if (conta.modo_ingestao !== C.MODO_INGESTAO.IMPORTACAO_MENSAL) {
      return { elegivel: false, motivo: 'MODO_INGESTAO_INCOMPATIVEL:' + conta.modo_ingestao };
    }
    if (!conta.ativa) {
      return { elegivel: false, motivo: 'CONTA_INATIVA' };
    }
    if (!conta.elegivel_importacao) {
      return { elegivel: false, motivo: 'CONTA_NAO_ELEGIVEL' };
    }
    return { elegivel: true, motivo: null };
  }

  /** Contas cujo saldo semanal é aceito na aba 12. */
  function aceitaSaldoSemanal(conta) {
    if (!conta) return { aceita: false, motivo: 'CONTA_DESCONHECIDA' };
    if (conta.universo !== C.UNIVERSO.TRADING) {
      return { aceita: false, motivo: 'SALDO_SEMANAL_APENAS_TRADING' };
    }
    if (!conta.ativa) return { aceita: false, motivo: 'CONTA_INATIVA' };
    return { aceita: true, motivo: null };
  }

  /**
   * Travessia de fronteira reconhecida (Wise -> Inter).
   * Movimentos internos entre Betfair/Neteller/Wise não são controlados.
   */
  function isFronteiraReconhecida(contaOrigem, contaDestino) {
    return contaOrigem === C.FRONTEIRA_RECONHECIDA.origem
      && contaDestino === C.FRONTEIRA_RECONHECIDA.destino;
  }

  function isMovimentoInternoTradingNaoControlado(config, contaOrigem, contaDestino) {
    var o = config.conta(contaOrigem);
    var d = config.conta(contaDestino);
    if (!o || !d) return false;
    return o.universo === C.UNIVERSO.TRADING && d.universo === C.UNIVERSO.TRADING;
  }

  FOS.Accounts = {
    elegibilidadeImportacao: elegibilidadeImportacao,
    aceitaSaldoSemanal: aceitaSaldoSemanal,
    isFronteiraReconhecida: isFronteiraReconhecida,
    isMovimentoInternoTradingNaoControlado: isMovimentoInternoTradingNaoControlado
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/fingerprint.js ===== */
/**
 * Fingerprint determinístico de transação importada.
 *
 * hash(data + valor + descricao_normalizada + conta + ordinal_ocorrencia)
 *
 * O ordinal de ocorrência é a posição da linha dentro do grupo de linhas
 * idênticas do MESMO arquivo. Consequências desejadas:
 *  - reimportar o mesmo arquivo produz os mesmos fingerprints (zero linhas novas);
 *  - duas transações legítimas idênticas no mesmo arquivo recebem ordinais
 *    diferentes e permanecem distintas.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  function chaveOcorrencia(tx) {
    return [tx.data, FOS.Core.round2(tx.valor).toFixed(2), tx.descricao_normalizada, tx.conta_id].join('|');
  }

  /**
   * Atribui ordinal_ocorrencia (1-based) a cada linha do arquivo.
   * A ordem de leitura do arquivo é a ordem canônica: linhas idênticas são
   * numeradas na sequência em que aparecem.
   */
  function atribuirOrdinais(transacoes) {
    var contador = {};
    return (transacoes || []).map(function (tx) {
      var k = chaveOcorrencia(tx);
      contador[k] = (contador[k] || 0) + 1;
      var out = FOS.Core.clone(tx);
      out.ordinal_ocorrencia = contador[k];
      return out;
    });
  }

  function calcular(tx) {
    if (typeof tx.ordinal_ocorrencia !== 'number' || tx.ordinal_ocorrencia < 1) {
      FOS.Core.fail('ORDINAL_AUSENTE', 'ordinal_ocorrencia é obrigatório para o fingerprint');
    }
    return FOS.Hash.hashParts([
      tx.data,
      FOS.Core.round2(tx.valor).toFixed(2),
      tx.descricao_normalizada,
      tx.conta_id,
      tx.ordinal_ocorrencia
    ]);
  }

  /** Aplica ordinais e fingerprints a um arquivo inteiro, em uma passada. */
  function aplicar(transacoes) {
    return atribuirOrdinais(transacoes).map(function (tx) {
      tx.fingerprint = calcular(tx);
      return tx;
    });
  }

  FOS.Fingerprint = {
    calcular: calcular,
    atribuirOrdinais: atribuirOrdinais,
    aplicar: aplicar,
    chaveOcorrencia: chaveOcorrencia
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/parsers.js ===== */
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

/* ===== src/domain/import.js ===== */
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

/* ===== src/domain/rules.js ===== */
/**
 * Regras determinísticas versionadas (aba 20) e motor de classificação.
 * Nunca há classificação por adivinhação: sem regra, com ambiguidade ou com
 * confiança abaixo do mínimo, a linha vai para a fila de revisão (aba 21).
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  /** Universo derivado da categoria canônica. */
  var UNIVERSO_POR_CATEGORIA = {
    CUSTO_VIDA: C.UNIVERSO.VIDA,
    CUSTO_TRADING: C.UNIVERSO.TRADING,
    SAQUE_TRADING: C.UNIVERSO.TRADING,
    GASTO_EXTRAORDINARIO: C.UNIVERSO.VIDA,
    APORTE_EXTRAORDINARIO: C.UNIVERSO.TRADING,
    TRANSFERENCIA_INTERNA: C.UNIVERSO.VIDA,
    PATRIMONIO_OBJETIVOS: C.UNIVERSO.PATRIMONIO
  };

  var OPERADORES = {
    CONTEM: function (campo, ref) { return String(campo).indexOf(String(ref).toUpperCase()) !== -1; },
    NAO_CONTEM: function (campo, ref) { return String(campo).indexOf(String(ref).toUpperCase()) === -1; },
    IGUAL: function (campo, ref) { return String(campo) === String(ref).toUpperCase(); },
    PREFIXO: function (campo, ref) { return String(campo).indexOf(String(ref).toUpperCase()) === 0; },
    REGEX: function (campo, ref) { return new RegExp(String(ref), 'i').test(String(campo)); },
    MAIOR_QUE: function (campo, ref) { return Number(campo) > Number(ref); },
    MENOR_QUE: function (campo, ref) { return Number(campo) < Number(ref); }
  };

  function valorDoCampo(tx, campo) {
    switch (String(campo)) {
      case 'descricao_normalizada': return tx.descricao_normalizada;
      case 'valor': return tx.valor;
      case 'valor_absoluto': return Math.abs(Number(tx.valor));
      case 'conta_id': return tx.conta_id;
      default: return null;
    }
  }

  function sinalCompativel(regra, tx) {
    var sinal = String(regra.sinal_valor || 'QUALQUER').toUpperCase();
    if (sinal === 'QUALQUER' || sinal === '') return true;
    if (sinal === 'DEBITO') return Number(tx.valor) < 0;
    if (sinal === 'CREDITO') return Number(tx.valor) > 0;
    return true;
  }

  function vigente(regra, dataIso) {
    var desde = regra.vigente_desde;
    var ate = regra.vigente_ate;
    if (desde && FOS.Dates.isIso(String(desde)) && FOS.Dates.diffDays(dataIso, String(desde)) < 0) return false;
    if (ate && FOS.Dates.isIso(String(ate)) && FOS.Dates.diffDays(dataIso, String(ate)) > 0) return false;
    return true;
  }

  /** Regras ativas e vigentes para a transação, ordenadas de forma estável. */
  function aplicaveis(regras, tx) {
    return FOS.Core.sortBy((regras || []).filter(function (r) {
      if (FOS.Config.parseBool(r.ativo) !== true) return false;
      if (!vigente(r, tx.data)) return false;
      if (r.conta_escopo && String(r.conta_escopo).trim() !== '' && String(r.conta_escopo) !== tx.conta_id) return false;
      if (!sinalCompativel(r, tx)) return false;
      var op = OPERADORES[String(r.operador || '').toUpperCase()];
      if (!op) return false;
      var campo = valorDoCampo(tx, r.campo);
      if (campo === null) return false;
      try {
        return op(campo, r.valor_referencia);
      } catch (e) {
        return false;
      }
    }), [
      function (r) { return Number(r.prioridade) || 9999; },
      function (r) { return String(r.regra_id); },
      function (r) { return -(Number(r.versao) || 1); }
    ]);
  }

  /**
   * Classifica uma transação.
   * @returns {{decidido:boolean, categoria:?string, universo:?string,
   *            regra_id:?string, regra_versao:?number, confianca:?number,
   *            motivo:?string, candidatos:Array}}
   */
  function classificar(tx, regras, confiancaMinima) {
    var matches = aplicaveis(regras, tx);
    if (!matches.length) {
      return {
        decidido: false, categoria: null, universo: null, regra_id: null, regra_versao: null,
        confianca: null, motivo: 'SEM_REGRA_APLICAVEL', candidatos: []
      };
    }
    var melhorPrioridade = Number(matches[0].prioridade) || 9999;
    var empatadas = matches.filter(function (r) { return (Number(r.prioridade) || 9999) === melhorPrioridade; });
    var categorias = {};
    empatadas.forEach(function (r) { categorias[String(r.categoria)] = true; });
    if (Object.keys(categorias).length > 1) {
      return {
        decidido: false, categoria: null, universo: null, regra_id: null, regra_versao: null,
        confianca: null, motivo: 'AMBIGUIDADE_REGRAS',
        candidatos: empatadas.map(function (r) {
          return { regra_id: r.regra_id, versao: Number(r.versao) || 1, categoria: r.categoria };
        })
      };
    }
    var escolhida = matches[0];
    var confianca = FOS.Config.parseNumber(escolhida.confianca);
    if (confianca === null) confianca = 0;
    if (confianca < confiancaMinima) {
      return {
        decidido: false, categoria: null, universo: null,
        regra_id: escolhida.regra_id, regra_versao: Number(escolhida.versao) || 1,
        confianca: confianca, motivo: 'CONFIANCA_ABAIXO_DO_MINIMO',
        candidatos: [{ regra_id: escolhida.regra_id, versao: Number(escolhida.versao) || 1, categoria: escolhida.categoria }]
      };
    }
    var categoria = String(escolhida.categoria);
    if (!C.isValid(C.CATEGORIA, categoria)) {
      return {
        decidido: false, categoria: null, universo: null,
        regra_id: escolhida.regra_id, regra_versao: Number(escolhida.versao) || 1,
        confianca: confianca, motivo: 'CATEGORIA_NAO_CANONICA', candidatos: []
      };
    }
    return {
      decidido: true,
      categoria: categoria,
      universo: String(escolhida.universo || '').toUpperCase() || UNIVERSO_POR_CATEGORIA[categoria],
      regra_id: escolhida.regra_id,
      regra_versao: Number(escolhida.versao) || 1,
      confianca: confianca,
      motivo: null,
      candidatos: []
    };
  }

  FOS.Rules = {
    classificar: classificar,
    aplicaveis: aplicaveis,
    OPERADORES: OPERADORES,
    UNIVERSO_POR_CATEGORIA: UNIVERSO_POR_CATEGORIA
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/queue.js ===== */
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

  FOS.Queue = { novoItem: novoItem, itemId: itemId, abertos: abertos, resolver: resolver };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/ledger.js ===== */
/**
 * Ledger canônico de movimentações (aba 22).
 * Append-only: a origem (data, descrição, valor, conta, arquivo) é imutável
 * e reclassificações geram uma NOVA linha com versao_gerencial incrementada.
 * A visão corrente é derivada (maior versão por fingerprint), nunca um UPDATE.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  var CAMPOS_ORIGEM = [
    'fingerprint', 'data_origem', 'descricao_origem', 'valor_origem',
    'moeda_origem', 'conta_id', 'import_id', 'arquivo_hash'
  ];

  function linhaId(fingerprint, versao) {
    return 'LED-' + String(fingerprint).slice(0, 12) + '-v' + versao;
  }

  /** Cria a linha versão 1 a partir de uma linha de staging classificada. */
  function novaLinha(staging, classificacao, agora, ator) {
    return {
      linha_id: linhaId(staging.fingerprint, 1),
      fingerprint: staging.fingerprint,
      versao_gerencial: 1,
      data_origem: staging.data,
      descricao_origem: staging.descricao_original,
      valor_origem: FOS.Core.round2(staging.valor),
      moeda_origem: staging.moeda,
      conta_id: staging.conta_id,
      import_id: staging.import_id,
      arquivo_hash: staging.arquivo_hash,
      categoria: classificacao.categoria,
      subcategoria: classificacao.subcategoria || '',
      universo: classificacao.universo,
      regra_id: classificacao.regra_id || '',
      regra_versao: classificacao.regra_versao || '',
      confianca: classificacao.confianca === null || classificacao.confianca === undefined ? '' : classificacao.confianca,
      evento_conciliado_id: '',
      motivo_versao: 'CLASSIFICACAO_INICIAL',
      classificado_em: agora,
      classificado_por: ator || 'SISTEMA',
      criado_em: agora
    };
  }

  /**
   * Reclassificação: nova versão com a MESMA origem.
   * Lança se alguém tentar alterar um campo de origem.
   */
  function reclassificar(linhaAtual, alteracoes, agora, ator, motivo) {
    CAMPOS_ORIGEM.forEach(function (campo) {
      if (Object.prototype.hasOwnProperty.call(alteracoes, campo)
        && String(alteracoes[campo]) !== String(linhaAtual[campo])) {
        FOS.Core.fail('ORIGEM_IMUTAVEL',
          'Campo de origem não pode ser alterado: ' + campo,
          { campo: campo, fingerprint: linhaAtual.fingerprint });
      }
    });
    var versao = Number(linhaAtual.versao_gerencial) + 1;
    var nova = FOS.Core.clone(linhaAtual);
    ['categoria', 'subcategoria', 'universo', 'regra_id', 'regra_versao', 'confianca', 'evento_conciliado_id']
      .forEach(function (campo) {
        if (Object.prototype.hasOwnProperty.call(alteracoes, campo)) nova[campo] = alteracoes[campo];
      });
    nova.versao_gerencial = versao;
    nova.linha_id = linhaId(linhaAtual.fingerprint, versao);
    nova.motivo_versao = motivo || 'RECLASSIFICACAO';
    nova.classificado_em = agora;
    nova.classificado_por = ator || 'SISTEMA';
    return nova;
  }

  /** Visão corrente: maior versao_gerencial por fingerprint. */
  function visaoCorrente(linhas) {
    var porFingerprint = {};
    (linhas || []).forEach(function (l) {
      var fp = l.fingerprint;
      var atual = porFingerprint[fp];
      if (!atual || Number(l.versao_gerencial) > Number(atual.versao_gerencial)) {
        porFingerprint[fp] = l;
      }
    });
    return FOS.Core.sortBy(Object.keys(porFingerprint).map(function (fp) { return porFingerprint[fp]; }), [
      function (l) { return String(l.data_origem); },
      function (l) { return String(l.fingerprint); }
    ]);
  }

  function fingerprints(linhas) {
    var vistos = {};
    (linhas || []).forEach(function (l) { vistos[l.fingerprint] = true; });
    return Object.keys(vistos);
  }

  function daCompetencia(linhas, competencia) {
    return visaoCorrente(linhas).filter(function (l) {
      return FOS.Dates.inCompetencia(String(l.data_origem), competencia);
    });
  }

  function porCategoria(linhas, categoria) {
    return (linhas || []).filter(function (l) { return l.categoria === categoria; });
  }

  function totalCategoria(linhas, categoria) {
    return FOS.Core.sum(porCategoria(linhas, categoria), function (l) { return Number(l.valor_origem); });
  }

  FOS.Ledger = {
    CAMPOS_ORIGEM: CAMPOS_ORIGEM,
    linhaId: linhaId,
    novaLinha: novaLinha,
    reclassificar: reclassificar,
    visaoCorrente: visaoCorrente,
    fingerprints: fingerprints,
    daCompetencia: daCompetencia,
    porCategoria: porCategoria,
    totalCategoria: totalCategoria
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/events.js ===== */
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
   *  exigeReferencia   — precisa de referencia_id (provisão/objetivo/posição)
   *  categoriaEsperada — categoria canônica correspondente no ledger
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

  function spec(tipo) {
    return SPEC[tipo] || null;
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
    validar: validar,
    expectativaConciliacao: expectativaConciliacao
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/matching.js ===== */
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
        // Sem candidato não é ambiguidade: normalmente o extrato do mês do
        // evento ainda não foi importado. Fica como pendência reportada, não
        // como item de fila — quem cobra isso é a invariante do fechamento,
        // que é escopada por competência e não trava os outros meses.
        pendentes.push({
          evento_id: evento.evento_id,
          motivo: 'CONCILIACAO_SEM_CANDIDATO',
          detalhe: 'Nenhuma linha com valor ' + expectativa.valor_esperado
            + ' na conta ' + expectativa.conta_id + ' dentro de ' + janelaDias
            + ' dias de ' + expectativa.data
        });
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

/* ===== src/domain/subledger.js ===== */
/**
 * Base comum dos subledgers versionados (30_PROVISOES e 31_OBJETIVOS).
 * Versionamento: cada alteração acrescenta uma linha com versao+1 e
 * vigente_desde; a linha anterior recebe vigente_ate apenas na projeção
 * (a planilha permanece append-only).
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  /** Versão corrente de cada entidade (maior versao por id). */
  function correntes(linhas, campoId) {
    var porId = {};
    (linhas || []).forEach(function (l) {
      var id = String(l[campoId]);
      var atual = porId[id];
      if (!atual || Number(l.versao) > Number(atual.versao)) porId[id] = l;
    });
    return FOS.Core.sortBy(Object.keys(porId).map(function (id) { return porId[id]; }),
      [function (l) { return String(l[campoId]); }]);
  }

  /** Estado de uma entidade em uma competência (versão vigente naquele mês). */
  function vigenteEm(linhas, campoId, id, competencia) {
    var fim = FOS.Dates.competenciaRange(competencia).fim;
    var candidatas = (linhas || []).filter(function (l) {
      if (String(l[campoId]) !== String(id)) return false;
      var desde = String(l.vigente_desde || '');
      if (!FOS.Dates.isIso(desde)) return true;
      return FOS.Dates.diffDays(desde, fim) <= 0;
    });
    if (!candidatas.length) return null;
    return FOS.Core.sortBy(candidatas, [function (l) { return -Number(l.versao); }])[0];
  }

  /**
   * Versões vigentes de todas as entidades numa competência.
   * É o que o fechamento usa: reprocessar um mês antigo não pode enxergar
   * versões criadas depois dele.
   */
  function correntesEm(linhas, campoId, competencia) {
    var ids = {};
    (linhas || []).forEach(function (l) { ids[String(l[campoId])] = true; });
    return Object.keys(ids).sort().map(function (id) {
      return vigenteEm(linhas, campoId, id, competencia);
    }).filter(function (l) { return !!l; });
  }

  /** Nova versão de uma entidade, preservando identidade e histórico. */
  function novaVersao(atual, alteracoes, agora, motivo) {
    var nova = FOS.Core.clone(atual);
    Object.keys(alteracoes || {}).forEach(function (k) {
      if (k === 'versao' || k === 'criado_em') return;
      nova[k] = alteracoes[k];
    });
    nova.versao = Number(atual.versao) + 1;
    nova.vigente_desde = agora ? String(agora).slice(0, 10) : atual.vigente_desde;
    nova.motivo_versao = motivo || 'ATUALIZACAO';
    return nova;
  }

  FOS.Subledger = {
    correntes: correntes,
    correntesEm: correntesEm,
    vigenteEm: vigenteEm,
    novaVersao: novaVersao
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/provisions.js ===== */
/**
 * Provisões (aba 30) — status e alocação.
 *
 * Regras canônicas de status:
 *  1. valor_faltante <= 0                          -> COBERTA
 *  2. vencida e ainda descoberta                   -> EM_RISCO
 *  3. menos de 2 fechamentos de histórico          -> DADO_INSUFICIENTE
 *  4. caso contrário, ritmo observado nos 2 últimos fechamentos
 *     comparado ao ritmo necessário                -> EM_RITMO | FORA_DE_RITMO
 *
 * Desempate de alocação: vencimento mais próximo, depois prioridade
 * explícita, depois rateio proporcional ao valor faltante.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var S = FOS.Constants.STATUS_PROVISAO;

  function faltante(provisao) {
    var alvo = Number(FOS.Config.parseNumber(provisao.valor_alvo) || 0);
    var acumulado = Number(FOS.Config.parseNumber(provisao.valor_acumulado) || 0);
    return FOS.Core.round2(alvo - acumulado);
  }

  /**
   * @param {Object} provisao versão corrente
   * @param {Object} contexto
   * @param {string} contexto.dataReferencia data do fechamento (ISO)
   * @param {string} contexto.competencia competência do fechamento
   * @param {Array<{competencia:string, valor_acumulado:number}>} contexto.historico
   *        acumulados nos fechamentos anteriores, do mais antigo ao mais recente
   * @param {number} contexto.fechamentosMinimos parâmetro (padrão 2)
   */
  function avaliar(provisao, contexto) {
    var minimo = contexto.fechamentosMinimos === undefined ? 2 : contexto.fechamentosMinimos;
    var falta = faltante(provisao);
    var base = {
      provisao_id: provisao.provisao_id,
      nome: provisao.nome,
      valor_alvo: Number(FOS.Config.parseNumber(provisao.valor_alvo) || 0),
      valor_acumulado: Number(FOS.Config.parseNumber(provisao.valor_acumulado) || 0),
      valor_faltante: falta,
      vencimento: provisao.vencimento || null,
      prioridade: FOS.Config.parseNumber(provisao.prioridade),
      moeda: provisao.moeda || null,
      ritmo_observado: null,
      ritmo_necessario: null,
      meses_restantes: null,
      motivo: null
    };

    if (falta <= 0) {
      base.status = S.COBERTA;
      base.motivo = 'VALOR_FALTANTE_NAO_POSITIVO';
      return base;
    }

    var venceu = provisao.vencimento && FOS.Dates.isIso(String(provisao.vencimento))
      && FOS.Dates.diffDays(String(provisao.vencimento), contexto.dataReferencia) < 0;
    if (venceu) {
      base.status = S.EM_RISCO;
      base.motivo = 'VENCIDA_E_DESCOBERTA';
      return base;
    }

    var historico = (contexto.historico || []).filter(function (h) {
      return FOS.Config.parseNumber(h.valor_acumulado) !== null;
    });
    if (historico.length < minimo) {
      base.status = S.DADO_INSUFICIENTE;
      base.motivo = 'HISTORICO_MENOR_QUE_' + minimo + '_FECHAMENTOS';
      return base;
    }

    var ultimos = historico.slice(-minimo);
    var acumuladoInicial = Number(FOS.Config.parseNumber(ultimos[0].valor_acumulado));
    var ritmoObservado = FOS.Core.round2((base.valor_acumulado - acumuladoInicial) / minimo);

    var mesesRestantes = null;
    if (provisao.vencimento && FOS.Dates.isIso(String(provisao.vencimento))) {
      mesesRestantes = FOS.Dates.monthsBetween(
        contexto.competencia,
        FOS.Dates.competenciaOf(String(provisao.vencimento))
      );
    }
    if (mesesRestantes === null || mesesRestantes < 1) mesesRestantes = 1;
    var ritmoNecessario = FOS.Core.round2(falta / mesesRestantes);

    base.ritmo_observado = ritmoObservado;
    base.ritmo_necessario = ritmoNecessario;
    base.meses_restantes = mesesRestantes;
    base.status = ritmoObservado >= ritmoNecessario ? S.EM_RITMO : S.FORA_DE_RITMO;
    base.motivo = base.status === S.EM_RITMO ? 'RITMO_SUFICIENTE' : 'RITMO_INSUFICIENTE';
    return base;
  }

  function chaveDesempate(p) {
    var venc = p.vencimento && FOS.Dates.isIso(String(p.vencimento)) ? String(p.vencimento) : '9999-12-31';
    var prio = p.prioridade === null || p.prioridade === undefined ? 9999 : Number(p.prioridade);
    // Prioridade zero-padded: a chave é comparada como texto e "10" não pode
    // vir antes de "2".
    var prioTexto = String(Math.max(0, Math.min(99999, Math.round(prio))));
    while (prioTexto.length < 5) prioTexto = '0' + prioTexto;
    return venc + '|' + prioTexto;
  }

  /**
   * Aloca uma capacidade limitada entre provisões descobertas.
   * Ordem: vencimento mais próximo -> prioridade explícita -> proporcional.
   * @param {Array} avaliacoes saída de avaliar()
   * @param {number} capacidade
   */
  function alocar(avaliacoes, capacidade) {
    var restante = FOS.Core.round2(Number(capacidade) || 0);
    var alvos = (avaliacoes || []).filter(function (p) { return p.valor_faltante > 0; });
    var ordenadas = FOS.Core.sortBy(alvos, [
      function (p) { return chaveDesempate(p); },
      function (p) { return String(p.provisao_id); }
    ]);

    var grupos = [];
    var indicePorChave = {};
    ordenadas.forEach(function (p) {
      var k = chaveDesempate(p);
      if (indicePorChave[k] === undefined) {
        indicePorChave[k] = grupos.length;
        grupos.push({ chave: k, itens: [] });
      }
      grupos[indicePorChave[k]].itens.push(p);
    });

    var resultado = [];
    grupos.forEach(function (g) {
      var totalGrupo = FOS.Core.sum(g.itens, function (p) { return p.valor_faltante; });
      if (restante <= 0) {
        g.itens.forEach(function (p) {
          resultado.push({ provisao_id: p.provisao_id, alocado: 0, criterio: 'SEM_CAPACIDADE' });
        });
        return;
      }
      if (restante >= totalGrupo) {
        g.itens.forEach(function (p) {
          resultado.push({ provisao_id: p.provisao_id, alocado: p.valor_faltante, criterio: 'INTEGRAL' });
        });
        restante = FOS.Core.round2(restante - totalGrupo);
        return;
      }
      if (g.itens.length === 1) {
        resultado.push({ provisao_id: g.itens[0].provisao_id, alocado: restante, criterio: 'PARCIAL' });
        restante = 0;
        return;
      }
      // Empate real em vencimento e prioridade: rateio proporcional ao faltante.
      var capacidadeGrupo = restante;
      var distribuido = 0;
      g.itens.forEach(function (p, idx) {
        var parcela;
        if (idx === g.itens.length - 1) {
          parcela = FOS.Core.round2(capacidadeGrupo - distribuido);
        } else {
          parcela = FOS.Core.round2(capacidadeGrupo * (p.valor_faltante / totalGrupo));
          distribuido = FOS.Core.round2(distribuido + parcela);
        }
        resultado.push({ provisao_id: p.provisao_id, alocado: parcela, criterio: 'PROPORCIONAL' });
      });
      restante = 0;
    });

    return { alocacoes: resultado, capacidade_restante: restante };
  }

  FOS.Provisions = { faltante: faltante, avaliar: avaliar, alocar: alocar, chaveDesempate: chaveDesempate };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/objectives.js ===== */
/**
 * Objetivos (aba 31) — subledger versionado de metas de patrimônio.
 * Compartilha a lógica de ritmo das provisões, mas objetivo vencido não é
 * risco de inadimplência: é objetivo NAO_ATINGIDO (prazo estourado).
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var S = FOS.Constants.STATUS_PROVISAO;

  var STATUS_OBJETIVO = {
    ATINGIDO: 'ATINGIDO',
    EM_RITMO: S.EM_RITMO,
    FORA_DE_RITMO: S.FORA_DE_RITMO,
    PRAZO_EXPIRADO: 'PRAZO_EXPIRADO',
    DADO_INSUFICIENTE: S.DADO_INSUFICIENTE
  };

  function avaliar(objetivo, contexto) {
    var provisaoLike = {
      provisao_id: objetivo.objetivo_id,
      nome: objetivo.nome,
      valor_alvo: objetivo.valor_alvo,
      valor_acumulado: objetivo.valor_acumulado,
      vencimento: objetivo.prazo,
      prioridade: objetivo.prioridade,
      moeda: objetivo.moeda
    };
    var aval = FOS.Provisions.avaliar(provisaoLike, contexto);
    var out = {
      objetivo_id: objetivo.objetivo_id,
      nome: objetivo.nome,
      valor_alvo: aval.valor_alvo,
      valor_acumulado: aval.valor_acumulado,
      valor_faltante: aval.valor_faltante,
      prazo: objetivo.prazo || null,
      prioridade: aval.prioridade,
      moeda: aval.moeda,
      ritmo_observado: aval.ritmo_observado,
      ritmo_necessario: aval.ritmo_necessario,
      meses_restantes: aval.meses_restantes,
      motivo: aval.motivo,
      status: null
    };
    if (aval.status === S.COBERTA) out.status = STATUS_OBJETIVO.ATINGIDO;
    else if (aval.status === S.EM_RISCO) out.status = STATUS_OBJETIVO.PRAZO_EXPIRADO;
    else out.status = aval.status;
    return out;
  }

  FOS.Objectives = { STATUS_OBJETIVO: STATUS_OBJETIVO, avaliar: avaliar };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/positions.js ===== */
/**
 * Ledger de posições (aba 32) — event sourcing append-only.
 *
 * Quatro eventos: APORTE, RETIRADA, DISTRIBUICAO e SNAPSHOT_VALOR_MERCADO.
 * Correção NUNCA é update: é evento compensatório.
 *  - eventos aditivos (APORTE/RETIRADA/DISTRIBUICAO): o compensatório tem o
 *    mesmo tipo e valor exatamente inverso, e ambos permanecem no ledger;
 *  - SNAPSHOT: o compensatório substitui o snapshot referenciado, que passa
 *    a ser ignorado na projeção (mas continua no histórico).
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;
  var E = C.EVENTO_POSICAO;

  var ADITIVOS = [E.APORTE, E.RETIRADA, E.DISTRIBUICAO];

  function validarEvento(evento, eventosExistentes) {
    var erros = [];
    var tipo = String(evento.tipo_evento || '').toUpperCase();
    if (!C.isValid(E, tipo)) {
      erros.push({ codigo: 'TIPO_EVENTO_POSICAO_INVALIDO', detalhe: String(evento.tipo_evento) });
      return { ok: false, erros: erros };
    }
    if (!FOS.Dates.isIso(String(evento.data))) {
      erros.push({ codigo: 'DATA_INVALIDA', detalhe: String(evento.data) });
    }
    if (String(evento.posicao_id || '').trim() === '') {
      erros.push({ codigo: 'POSICAO_OBRIGATORIA', detalhe: '' });
    }
    var valor = FOS.Normalize.valor(evento.valor);
    if (valor === null) {
      erros.push({ codigo: 'VALOR_INVALIDO', detalhe: String(evento.valor) });
    }
    var compensa = String(evento.compensa_evento_id || '').trim();
    if (compensa === '') {
      if (valor !== null && valor <= 0) {
        erros.push({
          codigo: 'VALOR_NAO_POSITIVO',
          detalhe: 'Evento não compensatório exige valor positivo; use evento compensatório para corrigir'
        });
      }
    } else {
      var original = (eventosExistentes || []).filter(function (e) {
        return String(e.evento_id) === compensa;
      })[0];
      if (!original) {
        erros.push({ codigo: 'EVENTO_COMPENSADO_INEXISTENTE', detalhe: compensa });
      } else {
        if (String(original.posicao_id) !== String(evento.posicao_id)) {
          erros.push({ codigo: 'COMPENSACAO_POSICAO_DIFERENTE', detalhe: compensa });
        }
        if (String(original.tipo_evento).toUpperCase() !== tipo) {
          erros.push({ codigo: 'COMPENSACAO_TIPO_DIFERENTE', detalhe: compensa });
        }
        if (ADITIVOS.indexOf(tipo) !== -1) {
          var esperado = FOS.Core.round2(-Number(FOS.Normalize.valor(original.valor)));
          if (valor !== esperado) {
            erros.push({
              codigo: 'COMPENSACAO_VALOR_INVALIDO',
              detalhe: 'esperado ' + esperado + ' para compensar ' + compensa + ', recebido ' + valor
            });
          }
        }
      }
    }
    return { ok: erros.length === 0, erros: erros };
  }

  function snapshotsSuperseded(eventos) {
    var superseded = {};
    (eventos || []).forEach(function (e) {
      var compensa = String(e.compensa_evento_id || '').trim();
      if (compensa && String(e.tipo_evento).toUpperCase() === E.SNAPSHOT_VALOR_MERCADO) {
        superseded[compensa] = true;
      }
    });
    return superseded;
  }

  /**
   * Projeta o estado de cada posição a partir dos eventos.
   * @param {Array} eventos
   * @param {{ateData?:string, maxDiasSnapshot?:number}} [opcoes]
   */
  function projetar(eventos, opcoes) {
    var opts = opcoes || {};
    var superseded = snapshotsSuperseded(eventos);
    var lista = FOS.Core.sortBy((eventos || []).filter(function (e) {
      if (opts.ateData && FOS.Dates.diffDays(String(e.data), opts.ateData) > 0) return false;
      return true;
    }), [
      function (e) { return String(e.data); },
      function (e) { return String(e.evento_id); }
    ]);

    var posicoes = {};
    lista.forEach(function (e) {
      var id = String(e.posicao_id);
      var p = posicoes[id] = posicoes[id] || {
        posicao_id: id,
        moeda: String(e.moeda || '').toUpperCase(),
        capital_investido: 0,
        distribuicoes: 0,
        quantidade: 0,
        valor_mercado: null,
        data_snapshot: null,
        snapshot_status: 'AUSENTE',
        eventos_aplicados: 0,
        moedas_conflitantes: false
      };
      if (p.moeda && String(e.moeda || '').toUpperCase() && p.moeda !== String(e.moeda).toUpperCase()) {
        p.moedas_conflitantes = true;
      }
      var tipo = String(e.tipo_evento).toUpperCase();
      var valor = Number(FOS.Normalize.valor(e.valor));
      var qtd = FOS.Config.parseNumber(e.quantidade);
      p.eventos_aplicados++;
      if (tipo === E.APORTE) {
        p.capital_investido = FOS.Core.round2(p.capital_investido + valor);
        if (qtd !== null) p.quantidade = FOS.Core.round2(p.quantidade + qtd);
      } else if (tipo === E.RETIRADA) {
        p.capital_investido = FOS.Core.round2(p.capital_investido - valor);
        if (qtd !== null) p.quantidade = FOS.Core.round2(p.quantidade - qtd);
      } else if (tipo === E.DISTRIBUICAO) {
        p.distribuicoes = FOS.Core.round2(p.distribuicoes + valor);
      } else if (tipo === E.SNAPSHOT_VALOR_MERCADO) {
        if (!superseded[String(e.evento_id)]) {
          p.valor_mercado = FOS.Core.round2(valor);
          p.data_snapshot = String(e.data);
          p.snapshot_status = 'OK';
        }
      }
    });

    Object.keys(posicoes).forEach(function (id) {
      var p = posicoes[id];
      if (p.valor_mercado === null) {
        p.snapshot_status = 'AUSENTE';
        p.resultado_nao_realizado = null;
      } else {
        if (opts.maxDiasSnapshot && opts.ateData
          && FOS.Dates.diffDays(opts.ateData, p.data_snapshot) > opts.maxDiasSnapshot) {
          p.snapshot_status = 'STALE';
        }
        p.resultado_nao_realizado = FOS.Core.round2(p.valor_mercado - p.capital_investido);
      }
    });

    return posicoes;
  }

  function listar(projecao) {
    return FOS.Core.sortBy(Object.keys(projecao).map(function (k) { return projecao[k]; }),
      [function (p) { return p.posicao_id; }]);
  }

  /** Posições sem snapshot ativo — bloqueiam o fechamento. */
  function semSnapshot(projecao) {
    return listar(projecao).filter(function (p) { return p.snapshot_status === 'AUSENTE'; });
  }

  /** Cria o evento compensatório correto para um evento aditivo existente. */
  function eventoCompensatorio(original, novoId, agora, motivo) {
    var tipo = String(original.tipo_evento).toUpperCase();
    if (ADITIVOS.indexOf(tipo) === -1) {
      FOS.Core.fail('COMPENSACAO_NAO_SUPORTADA',
        'Snapshot é corrigido por novo snapshot compensatório, não por inversão de valor');
    }
    return {
      evento_id: novoId,
      posicao_id: original.posicao_id,
      tipo_evento: tipo,
      data: original.data,
      valor: FOS.Core.round2(-Number(FOS.Normalize.valor(original.valor))),
      moeda: original.moeda,
      quantidade: FOS.Config.parseNumber(original.quantidade) === null
        ? '' : FOS.Core.round2(-Number(original.quantidade)),
      compensa_evento_id: original.evento_id,
      origem: 'COMPENSACAO',
      criado_em: agora,
      observacao: motivo || 'Evento compensatório'
    };
  }

  FOS.Positions = {
    ADITIVOS: ADITIVOS,
    validarEvento: validarEvento,
    projetar: projetar,
    listar: listar,
    semSnapshot: semSnapshot,
    eventoCompensatorio: eventoCompensatorio
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/fx.js ===== */
/**
 * Conversão gerencial de moeda.
 *
 * O provedor de taxa é abstrato (PTAX é a implementação prevista, mas o
 * domínio só conhece uma tabela data->taxa). Regras duras:
 *  - não existe fallback silencioso: taxa ausente devolve null + reason e
 *    BLOQUEIA o fechamento;
 *  - o efeito cambial é sempre reportado separadamente do resultado
 *    operacional, nunca somado a ele.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  /**
   * Tabela de taxas: { 'BRL/GBP': { '2026-01-31': 6.42, ... } }
   * Sempre "quantas unidades da moeda gerencial por 1 unidade da moeda estrangeira".
   */
  function par(moedaEstrangeira, moedaGerencial) {
    return String(moedaGerencial).toUpperCase() + '/' + String(moedaEstrangeira).toUpperCase();
  }

  /**
   * Resolve a taxa para uma data exata. Sem taxa exata, sem chute.
   * @returns {{value:?number, status:string, reason:?string, provedor:?string, data:?string}}
   */
  function resolver(tabela, moedaEstrangeira, moedaGerencial, dataIso, provedor) {
    if (String(moedaEstrangeira).toUpperCase() === String(moedaGerencial).toUpperCase()) {
      return { value: 1, status: 'OK', reason: null, provedor: 'IDENTIDADE', data: dataIso };
    }
    var chave = par(moedaEstrangeira, moedaGerencial);
    var serie = (tabela || {})[chave];
    if (!serie) {
      return {
        value: null, status: 'NULL', provedor: provedor || null, data: null,
        reason: 'TAXA_INDISPONIVEL_PAR:' + chave
      };
    }
    var taxa = serie[dataIso];
    if (taxa === undefined || taxa === null || !Number.isFinite(Number(taxa))) {
      return {
        value: null, status: 'NULL', provedor: provedor || null, data: null,
        reason: 'TAXA_INDISPONIVEL_DATA:' + chave + '@' + dataIso
      };
    }
    return { value: Number(taxa), status: 'OK', reason: null, provedor: provedor || 'PTAX', data: dataIso };
  }

  /** Converte um valor para a moeda gerencial. Taxa ausente => null + reason. */
  function converter(valor, taxaResolvida) {
    if (!taxaResolvida || taxaResolvida.value === null) {
      return FOS.Core.nullValue(taxaResolvida ? taxaResolvida.reason : 'TAXA_INDISPONIVEL');
    }
    if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) {
      return FOS.Core.nullValue('VALOR_INDISPONIVEL_PARA_CONVERSAO');
    }
    return FOS.Core.value(FOS.Core.round2(Number(valor) * taxaResolvida.value));
  }

  /**
   * Efeito cambial isolado sobre um saldo em moeda estrangeira.
   * efeito = saldo_inicial_moeda * (taxa_final - taxa_inicial)
   * Ou seja: a parte da variação em BRL que não veio de operação.
   */
  function efeitoCambial(saldoInicialMoeda, taxaInicial, taxaFinal) {
    if (taxaInicial === null || taxaFinal === null
      || !Number.isFinite(Number(taxaInicial)) || !Number.isFinite(Number(taxaFinal))) {
      return FOS.Core.nullValue('TAXA_INDISPONIVEL_PARA_EFEITO_CAMBIAL');
    }
    if (saldoInicialMoeda === null || !Number.isFinite(Number(saldoInicialMoeda))) {
      return FOS.Core.nullValue('SALDO_INICIAL_INDISPONIVEL');
    }
    return FOS.Core.value(FOS.Core.round2(Number(saldoInicialMoeda) * (Number(taxaFinal) - Number(taxaInicial))));
  }

  /** Converte a lista de registros da aba de taxas em tabela indexada. */
  function tabelaDeRegistros(registros) {
    var tabela = {};
    (registros || []).forEach(function (r) {
      var chave = par(r.moeda_estrangeira, r.moeda_gerencial);
      tabela[chave] = tabela[chave] || {};
      tabela[chave][String(r.data)] = Number(r.taxa);
    });
    return tabela;
  }

  /** Prefixo da chave de taxa materializada em 00_CONFIG_PARAMETROS. */
  var SECAO_TAXA = 'TAXA';

  function chaveCache(parNome, dataIso) {
    return parNome + '@' + dataIso;
  }

  /**
   * Linha de cache de taxa para a aba 00. Materializar na planilha é o que
   * permite reprocessar um fechamento antigo com a MESMA taxa usada na época,
   * sem depender do provedor estar no ar.
   */
  function linhaDeCache(moedaEstrangeira, moedaGerencial, dataIso, taxa, provedor, agora, reason) {
    var bloqueada = taxa === null || taxa === undefined || !Number.isFinite(Number(taxa));
    return {
      secao: SECAO_TAXA,
      chave: chaveCache(par(moedaEstrangeira, moedaGerencial), dataIso),
      valor: bloqueada ? '' : Number(taxa),
      tipo: 'NUMERO',
      unidade: moedaGerencial + ' por ' + moedaEstrangeira,
      universo: '',
      modo_ingestao: '',
      moeda: moedaEstrangeira,
      ativa: '',
      elegivel_importacao: '',
      status: bloqueada ? 'BLOQUEADO' : 'ATIVO',
      reason: bloqueada ? (reason || 'TAXA_NAO_PUBLICADA') : '',
      versao: 1,
      atualizado_em: agora || '',
      descricao: 'Cache de taxa (' + (provedor || 'DESCONHECIDO') + '). Não editar à mão.'
    };
  }

  /** Tabela de taxas a partir das linhas de cache da aba 00. */
  function tabelaDeCache(configRows) {
    var tabela = {};
    (configRows || []).forEach(function (r) {
      if (String(r.secao || '').toUpperCase() !== SECAO_TAXA) return;
      if (String(r.status || '').toUpperCase() === 'BLOQUEADO') return;
      var partes = String(r.chave || '').split('@');
      if (partes.length !== 2) return;
      var valor = Number(r.valor);
      if (!Number.isFinite(valor)) return;
      tabela[partes[0]] = tabela[partes[0]] || {};
      tabela[partes[0]][partes[1]] = valor;
    });
    return tabela;
  }

  FOS.Fx = {
    SECAO_TAXA: SECAO_TAXA,
    par: par,
    chaveCache: chaveCache,
    linhaDeCache: linhaDeCache,
    tabelaDeCache: tabelaDeCache,
    resolver: resolver,
    converter: converter,
    efeitoCambial: efeitoCambial,
    tabelaDeRegistros: tabelaDeRegistros
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/trading.js ===== */
/**
 * Métricas de trading — QUATRO números independentes.
 *
 * Decisão canônica: não existe "resultado líquido de trading" misturando
 * moedas. As quatro métricas são reportadas lado a lado, cada uma com sua
 * moeda e seu próprio status:
 *   1. caixa retirado (BRL)          — o que efetivamente chegou na vida
 *   2. P&L operacional (GBP)         — final - inicial + saques - aportes
 *   3. resultado da reserva (BRL)    — final - inicial + retiradas - aportes
 *   4. custo operacional (BRL)       — custo de trading pago pela conta de vida
 *
 * Custo operacional pago pelo Inter é categoria CUSTO_TRADING: é custo,
 * nunca aporte de capital.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  function saldoNaData(saldos, contaId, dataLimite, incluirLimite) {
    var candidatos = (saldos || []).filter(function (s) {
      if (String(s.conta_id) !== String(contaId)) return false;
      var d = FOS.Dates.diffDays(String(s.data_referencia), dataLimite);
      return incluirLimite ? d <= 0 : d < 0;
    });
    if (!candidatos.length) return null;
    var ordenados = FOS.Core.sortBy(candidatos, [
      function (s) { return String(s.data_referencia); },
      function (s) { return String(s.registro_id); }
    ]);
    var ultimo = ordenados[ordenados.length - 1];
    return {
      saldo: FOS.Core.round2(Number(FOS.Normalize.valor(ultimo.saldo))),
      data: String(ultimo.data_referencia),
      registro_id: ultimo.registro_id
    };
  }

  function contasTrading(config, moeda) {
    return config.contasPorUniverso(C.UNIVERSO.TRADING).filter(function (c) {
      return c.ativa && (!moeda || c.moeda === moeda);
    });
  }

  function eventosDaCompetencia(eventos, competencia, tipo) {
    return (eventos || []).filter(function (e) {
      if (String(e.tipo_evento).toUpperCase() !== tipo) return false;
      if (String(e.status || '') === FOS.Events.STATUS_EVENTO.CANCELADO) return false;
      return FOS.Dates.inCompetencia(String(e.data), competencia);
    });
  }

  /** 1. Caixa retirado em BRL: créditos SAQUE_TRADING no ledger da competência. */
  function caixaRetiradoBrl(linhasLedger, competencia) {
    var linhas = FOS.Ledger.daCompetencia(linhasLedger, competencia)
      .filter(function (l) { return l.categoria === C.CATEGORIA.SAQUE_TRADING; });
    return FOS.Core.value(FOS.Core.sum(linhas, function (l) { return Number(l.valor_origem); }));
  }

  /**
   * 2. P&L operacional em GBP.
   * Exige capital inicial e final medidos por saldos semanais e o valor em
   * GBP dos saques/aportes do período (campo valor_origem_moeda do evento).
   */
  function pnlOperacionalGbp(params) {
    var config = params.config;
    var saldos = params.saldos;
    var eventos = params.eventos;
    var competencia = params.competencia;
    var range = FOS.Dates.competenciaRange(competencia);
    var contas = contasTrading(config, C.MOEDA.GBP);
    if (!contas.length) {
      return FOS.Core.nullValue('SEM_CONTAS_TRADING_GBP');
    }

    var inicial = 0;
    var final = 0;
    var faltando = [];
    contas.forEach(function (conta) {
      var ini = saldoNaData(saldos, conta.conta_id, range.inicio, false);
      var fim = saldoNaData(saldos, conta.conta_id, range.fim, true);
      if (!ini) faltando.push('SALDO_INICIAL_AUSENTE:' + conta.conta_id);
      if (!fim) faltando.push('SALDO_FINAL_AUSENTE:' + conta.conta_id);
      if (ini) inicial = FOS.Core.round2(inicial + ini.saldo);
      if (fim) final = FOS.Core.round2(final + fim.saldo);
    });
    if (faltando.length) {
      return FOS.Core.insufficient(faltando.join(';'));
    }

    var saques = eventosDaCompetencia(eventos, competencia, C.TIPO_EVENTO.SAQUE_TRADING);
    var aportes = eventosDaCompetencia(eventos, competencia, C.TIPO_EVENTO.APORTE_EXTRAORDINARIO);
    var semGbp = saques.concat(aportes).filter(function (e) {
      return String(e.moeda_origem || '').toUpperCase() !== C.MOEDA.GBP
        || FOS.Normalize.valor(e.valor_origem_moeda) === null;
    });
    if (semGbp.length) {
      return FOS.Core.nullValue('EVENTO_SEM_VALOR_EM_GBP:' + semGbp.map(function (e) {
        return e.evento_id;
      }).join(','));
    }

    var saquesGbp = FOS.Core.sum(saques, function (e) { return Math.abs(FOS.Normalize.valor(e.valor_origem_moeda)); });
    var aportesGbp = FOS.Core.sum(aportes, function (e) { return Math.abs(FOS.Normalize.valor(e.valor_origem_moeda)); });

    var pnl = FOS.Core.round2(final - inicial + saquesGbp - aportesGbp);
    var out = FOS.Core.value(pnl);
    out.componentes = {
      capital_inicial_gbp: inicial,
      capital_final_gbp: final,
      saques_gbp: saquesGbp,
      aportes_extraordinarios_gbp: aportesGbp
    };
    return out;
  }

  /** 3. Resultado da reserva BRL: final - inicial + retiradas - aportes. */
  function resultadoReservaBrl(params) {
    var config = params.config;
    var contaId = params.contaReserva;
    var competencia = params.competencia;
    var range = FOS.Dates.competenciaRange(competencia);
    var conta = config.conta(contaId);
    if (!conta) return FOS.Core.nullValue('CONTA_RESERVA_DESCONHECIDA:' + contaId);

    var ini = saldoNaData(params.saldos, contaId, range.inicio, false);
    var fim = saldoNaData(params.saldos, contaId, range.fim, true);
    if (!ini || !fim) {
      return FOS.Core.insufficient(!ini ? 'SALDO_INICIAL_AUSENTE:' + contaId : 'SALDO_FINAL_AUSENTE:' + contaId);
    }

    var retiradas = FOS.Core.sum(
      eventosDaCompetencia(params.eventos, competencia, C.TIPO_EVENTO.SAQUE_TRADING)
        .filter(function (e) { return String(e.conta_origem) === contaId; }),
      function (e) { return Math.abs(FOS.Normalize.valor(e.valor)); }
    );
    var aportes = FOS.Core.sum(
      eventosDaCompetencia(params.eventos, competencia, C.TIPO_EVENTO.APORTE_EXTRAORDINARIO)
        .filter(function (e) { return String(e.conta_destino) === contaId; }),
      function (e) { return Math.abs(FOS.Normalize.valor(e.valor)); }
    );

    var resultado = FOS.Core.round2(fim.saldo - ini.saldo + retiradas - aportes);
    var out = FOS.Core.value(resultado);
    out.componentes = {
      saldo_inicial: ini.saldo,
      saldo_final: fim.saldo,
      retiradas: retiradas,
      aportes: aportes
    };
    return out;
  }

  /** 4. Custo operacional de trading em BRL (pago pela conta de vida). */
  function custoOperacionalBrl(linhasLedger, competencia) {
    var linhas = FOS.Ledger.daCompetencia(linhasLedger, competencia)
      .filter(function (l) { return l.categoria === C.CATEGORIA.CUSTO_TRADING; });
    return FOS.Core.value(Math.abs(FOS.Core.sum(linhas, function (l) { return Number(l.valor_origem); })));
  }

  /**
   * As quatro métricas juntas. Deliberadamente sem campo "total": qualquer
   * soma entre elas misturaria moedas e naturezas diferentes.
   */
  function metricas(params) {
    return {
      competencia: params.competencia,
      caixa_retirado_brl: caixaRetiradoBrl(params.linhas, params.competencia),
      pnl_operacional_gbp: pnlOperacionalGbp(params),
      resultado_reserva_brl: resultadoReservaBrl(params),
      custo_operacional_brl: custoOperacionalBrl(params.linhas, params.competencia)
    };
  }

  /** Capital de trading em GBP no fim da competência (para patrimônio/efeito cambial). */
  function capitalTradingGbp(config, saldos, competencia) {
    var range = FOS.Dates.competenciaRange(competencia);
    var contas = contasTrading(config, C.MOEDA.GBP);
    var total = 0;
    var faltando = [];
    contas.forEach(function (conta) {
      var s = saldoNaData(saldos, conta.conta_id, range.fim, true);
      if (!s) faltando.push(conta.conta_id);
      else total = FOS.Core.round2(total + s.saldo);
    });
    if (faltando.length) return FOS.Core.insufficient('SALDO_AUSENTE:' + faltando.join(','));
    return FOS.Core.value(total);
  }

  FOS.Trading = {
    saldoNaData: saldoNaData,
    contasTrading: contasTrading,
    caixaRetiradoBrl: caixaRetiradoBrl,
    pnlOperacionalGbp: pnlOperacionalGbp,
    resultadoReservaBrl: resultadoReservaBrl,
    custoOperacionalBrl: custoOperacionalBrl,
    capitalTradingGbp: capitalTradingGbp,
    metricas: metricas
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/life.js ===== */
/**
 * Universo Vida: caixa, custo de vida, disponível, runway e funções do dinheiro.
 *
 * O caixa de vida é derivado: saldo inicial declarado em 00 (parâmetro
 * configurável) mais o ledger canônico até a data de referência. Se o
 * parâmetro estiver bloqueado, o caixa é null + reason — nunca zero.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  var PARAM_SALDO_INICIAL = 'SALDO_INICIAL_CAIXA_VIDA_BRL';
  var PARAM_COMPETENCIA_INICIAL = 'COMPETENCIA_INICIAL_CAIXA_VIDA';
  var PARAM_MESES_MEDIA_CUSTO = 'MESES_MEDIA_CUSTO_VIDA';

  function linhasAte(linhas, competencia) {
    var fim = FOS.Dates.competenciaRange(competencia).fim;
    return FOS.Ledger.visaoCorrente(linhas).filter(function (l) {
      return FOS.Dates.diffDays(String(l.data_origem), fim) <= 0;
    });
  }

  /** Caixa de vida ao fim da competência. */
  function caixaVida(config, linhas, competencia) {
    var saldoInicial = config.param(PARAM_SALDO_INICIAL);
    if (saldoInicial.value === null) {
      return FOS.Core.nullValue(saldoInicial.reason || 'SALDO_INICIAL_INDISPONIVEL');
    }
    var compInicial = config.param(PARAM_COMPETENCIA_INICIAL);
    var relevantes = linhasAte(linhas, competencia).filter(function (l) {
      if (compInicial.value && FOS.Dates.competenciaOf(String(l.data_origem)) < String(compInicial.value)) {
        return false;
      }
      var conta = config.conta(l.conta_id);
      return conta && conta.universo === C.UNIVERSO.VIDA;
    });
    var movimento = FOS.Core.sum(relevantes, function (l) { return Number(l.valor_origem); });
    return FOS.Core.value(FOS.Core.round2(Number(saldoInicial.value) + movimento));
  }

  /** Custo de vida da competência (valor positivo). */
  function custoVidaMes(linhas, competencia) {
    var doMes = FOS.Ledger.daCompetencia(linhas, competencia)
      .filter(function (l) { return l.categoria === C.CATEGORIA.CUSTO_VIDA; });
    return FOS.Core.value(Math.abs(FOS.Core.sum(doMes, function (l) { return Number(l.valor_origem); })));
  }

  /** Média de custo de vida nos últimos N meses com movimento observado. */
  function custoVidaMedio(config, linhas, competencia) {
    var meses = config.param(PARAM_MESES_MEDIA_CUSTO).value;
    if (meses === null || !Number.isFinite(Number(meses)) || Number(meses) < 1) meses = 3;
    var soma = 0;
    var observados = 0;
    for (var i = 0; i < Number(meses); i++) {
      var comp = FOS.Dates.addMonths(competencia, -i);
      var doMes = FOS.Ledger.daCompetencia(linhas, comp)
        .filter(function (l) { return l.categoria === C.CATEGORIA.CUSTO_VIDA; });
      if (!doMes.length) continue;
      soma += Math.abs(FOS.Core.sum(doMes, function (l) { return Number(l.valor_origem); }));
      observados++;
    }
    if (!observados) return FOS.Core.insufficient('SEM_CUSTO_VIDA_OBSERVADO');
    var media = FOS.Core.value(FOS.Core.round2(soma / observados));
    media.meses_observados = observados;
    return media;
  }

  /**
   * Funções do dinheiro: para que serve cada real do caixa de vida.
   * PROTECAO = provisões acumuladas; OBJETIVOS = objetivos acumulados;
   * LIVRE = o que sobra (pode ser negativo, e isso é informação, não erro).
   */
  function funcoesDoDinheiro(caixa, provisoes, objetivos) {
    if (!FOS.Core.isOk(caixa)) {
      return { status: caixa.status, reason: caixa.reason, protecao: null, objetivos: null, livre: null, total: null };
    }
    var protecao = FOS.Core.sum(provisoes, function (p) { return Number(p.valor_acumulado) || 0; });
    var objetivo = FOS.Core.sum(objetivos, function (o) { return Number(o.valor_acumulado) || 0; });
    return {
      status: 'OK',
      reason: null,
      protecao: protecao,
      objetivos: objetivo,
      livre: FOS.Core.round2(caixa.value - protecao - objetivo),
      total: caixa.value
    };
  }

  /** Disponível = caixa de vida menos o que já tem função definida. */
  function disponivel(caixa, funcoes) {
    if (!FOS.Core.isOk(caixa)) return FOS.Core.nullValue(caixa.reason || 'CAIXA_INDISPONIVEL');
    if (funcoes.status !== 'OK') return FOS.Core.nullValue(funcoes.reason || 'FUNCOES_INDISPONIVEIS');
    return FOS.Core.value(funcoes.livre);
  }

  /** Runway em meses: disponível dividido pelo custo de vida médio. */
  function runway(disponivelManaged, custoMedio) {
    if (!FOS.Core.isOk(disponivelManaged)) {
      return FOS.Core.nullValue(disponivelManaged.reason || 'DISPONIVEL_INDISPONIVEL');
    }
    if (!FOS.Core.isOk(custoMedio)) {
      return FOS.Core.insufficient(custoMedio.reason || 'CUSTO_MEDIO_INDISPONIVEL');
    }
    if (custoMedio.value <= 0) {
      return FOS.Core.nullValue('CUSTO_VIDA_MEDIO_NAO_POSITIVO');
    }
    return FOS.Core.value(FOS.Core.round2(disponivelManaged.value / custoMedio.value));
  }

  FOS.Life = {
    PARAM_SALDO_INICIAL: PARAM_SALDO_INICIAL,
    PARAM_COMPETENCIA_INICIAL: PARAM_COMPETENCIA_INICIAL,
    PARAM_MESES_MEDIA_CUSTO: PARAM_MESES_MEDIA_CUSTO,
    caixaVida: caixaVida,
    custoVidaMes: custoVidaMes,
    custoVidaMedio: custoVidaMedio,
    funcoesDoDinheiro: funcoesDoDinheiro,
    disponivel: disponivel,
    runway: runway
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/signals.js ===== */
/**
 * Ciclo de 90 dias — SETE sinais binários independentes.
 *
 * Decisão canônica: não existe score, nota ou índice composto. Cada sinal é
 * verdadeiro, falso ou DADO_INSUFICIENTE, e é lido isoladamente.
 * Nenhum sinal dispara ação automática: sinal é leitura, não execução.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;
  var S = C.SINAL;

  var PARAM_LIMITE_GASTO_EXTRA = 'LIMITE_GASTO_EXTRAORDINARIO_PCT_CAIXA_VIDA';
  var PARAM_QUEDA_RUNWAY = 'QUEDA_RUNWAY_PCT_SINAL';
  var PARAM_MES_FORTE = 'MES_FORTE_PCT_ACIMA_MEDIA';
  var PARAM_FECHAMENTOS_MES_FORTE = 'FECHAMENTOS_MINIMOS_MES_FORTE';

  function sinal(codigo, valor, detalhe) {
    return { codigo: codigo, valor: valor, status: 'OK', reason: null, detalhe: detalhe || null };
  }
  function sinalInsuficiente(codigo, reason) {
    return { codigo: codigo, valor: null, status: 'DADO_INSUFICIENTE', reason: reason, detalhe: null };
  }
  function sinalNulo(codigo, reason) {
    return { codigo: codigo, valor: null, status: 'NULL', reason: reason, detalhe: null };
  }

  function anterior(ctx) {
    var lista = ctx.fechamentosAnteriores || [];
    return lista.length ? lista[lista.length - 1] : null;
  }

  /** 1. Redução de proteção: provisões acumuladas caíram em relação ao mês anterior. */
  function reducaoProtecao(ctx) {
    var ant = anterior(ctx);
    if (!ant) return sinalInsuficiente(S.REDUCAO_PROTECAO, 'SEM_FECHAMENTO_ANTERIOR');
    var atualTotal = FOS.Core.sum(ctx.provisoes, function (p) { return Number(p.valor_acumulado) || 0; });
    var antTotal = Number(ant.protecao_total);
    if (!Number.isFinite(antTotal)) return sinalNulo(S.REDUCAO_PROTECAO, 'PROTECAO_ANTERIOR_INDISPONIVEL');
    return sinal(S.REDUCAO_PROTECAO, atualTotal < antTotal,
      'protecao_anterior=' + antTotal + '; protecao_atual=' + atualTotal);
  }

  /** 2. Gasto extraordinário anormal: acima do limite reversível sobre o caixa de vida. */
  function gastoExtraordinarioAnormal(ctx) {
    var limite = ctx.config.param(PARAM_LIMITE_GASTO_EXTRA);
    if (limite.value === null) return sinalNulo(S.GASTO_EXTRAORDINARIO_ANORMAL, limite.reason || 'LIMITE_INDISPONIVEL');
    if (!FOS.Core.isOk(ctx.caixaVida)) {
      return sinalNulo(S.GASTO_EXTRAORDINARIO_ANORMAL, ctx.caixaVida.reason || 'CAIXA_VIDA_INDISPONIVEL');
    }
    var gastos = Math.abs(FOS.Core.sum(
      FOS.Ledger.daCompetencia(ctx.linhas, ctx.competencia).filter(function (l) {
        return l.categoria === C.CATEGORIA.GASTO_EXTRAORDINARIO;
      }),
      function (l) { return Number(l.valor_origem); }
    ));
    var teto = FOS.Core.round2(ctx.caixaVida.value * Number(limite.value));
    return sinal(S.GASTO_EXTRAORDINARIO_ANORMAL, gastos > teto,
      'gastos=' + gastos + '; teto=' + teto + ' (' + limite.value + ' do caixa de vida)');
  }

  /** 3. Vida para Trading: houve aporte extraordinário saindo do caixa de vida. */
  function vidaParaTrading(ctx) {
    var aportes = (ctx.eventos || []).filter(function (e) {
      return String(e.tipo_evento).toUpperCase() === C.TIPO_EVENTO.APORTE_EXTRAORDINARIO
        && String(e.status || '') !== FOS.Events.STATUS_EVENTO.CANCELADO
        && FOS.Dates.inCompetencia(String(e.data), ctx.competencia);
    });
    return sinal(S.VIDA_PARA_TRADING, aportes.length > 0, 'eventos=' + aportes.length);
  }

  /** 4. Reserva fora da finalidade: provisão aberta teve acumulado reduzido. */
  function reservaForaDaFinalidade(ctx) {
    var ant = anterior(ctx);
    if (!ant) return sinalInsuficiente(S.RESERVA_FORA_DA_FINALIDADE, 'SEM_FECHAMENTO_ANTERIOR');
    var anteriores = {};
    (ant.provisoes || []).forEach(function (p) { anteriores[String(p.provisao_id)] = p; });
    var desviadas = (ctx.provisoes || []).filter(function (p) {
      var a = anteriores[String(p.provisao_id)];
      if (!a) return false;
      var caiu = Number(p.valor_acumulado) < Number(a.valor_acumulado);
      if (!caiu) return false;
      var venceu = p.vencimento && FOS.Dates.isIso(String(p.vencimento))
        && FOS.Dates.diffDays(String(p.vencimento), ctx.dataReferencia) <= 0;
      return !venceu; // queda antes do vencimento = uso fora da finalidade
    });
    return sinal(S.RESERVA_FORA_DA_FINALIDADE, desviadas.length > 0,
      desviadas.map(function (p) { return p.provisao_id; }).join(',') || null);
  }

  /** 5. Queda de runway acima do percentual configurado. */
  function quedaRunway(ctx) {
    var pct = ctx.config.param(PARAM_QUEDA_RUNWAY);
    if (pct.value === null) return sinalNulo(S.QUEDA_RUNWAY, pct.reason || 'PARAMETRO_INDISPONIVEL');
    var ant = anterior(ctx);
    if (!ant) return sinalInsuficiente(S.QUEDA_RUNWAY, 'SEM_FECHAMENTO_ANTERIOR');
    if (!FOS.Core.isOk(ctx.runway)) return sinalNulo(S.QUEDA_RUNWAY, ctx.runway.reason || 'RUNWAY_INDISPONIVEL');
    var antRunway = Number(ant.runway_meses);
    if (!Number.isFinite(antRunway)) return sinalInsuficiente(S.QUEDA_RUNWAY, 'RUNWAY_ANTERIOR_INDISPONIVEL');
    if (antRunway <= 0) return sinalNulo(S.QUEDA_RUNWAY, 'RUNWAY_ANTERIOR_NAO_POSITIVO');
    var queda = FOS.Core.round2((antRunway - ctx.runway.value) / antRunway);
    return sinal(S.QUEDA_RUNWAY, queda > Number(pct.value),
      'queda=' + queda + '; limite=' + pct.value);
  }

  /** 6. Compromisso sem provisão: obrigação declarada sem provisão correspondente. */
  function compromissoSemProvisao(ctx) {
    var idsProvisoes = {};
    (ctx.provisoes || []).forEach(function (p) { idsProvisoes[String(p.provisao_id)] = true; });
    var obrigacoes = (ctx.eventos || []).filter(function (e) {
      return String(e.tipo_evento).toUpperCase() === C.TIPO_EVENTO.NOVA_OBRIGACAO
        && String(e.status || '') !== FOS.Events.STATUS_EVENTO.CANCELADO
        && FOS.Dates.inCompetencia(String(e.data), ctx.competencia);
    });
    var descobertas = obrigacoes.filter(function (e) { return !idsProvisoes[String(e.referencia_id)]; });
    return sinal(S.COMPROMISSO_SEM_PROVISAO, descobertas.length > 0,
      descobertas.map(function (e) { return e.evento_id; }).join(',') || null);
  }

  /**
   * 7. Retirada ou redução alocativa do patrimônio após mês forte.
   * Exige o mínimo de fechamentos anteriores (parâmetro, padrão 3) para que
   * exista base de comparação de "mês forte".
   */
  function retiradaAposMesForte(ctx) {
    var minimo = ctx.config.param(PARAM_FECHAMENTOS_MES_FORTE).value;
    if (minimo === null) minimo = 3;
    var anteriores = ctx.fechamentosAnteriores || [];
    if (anteriores.length < Number(minimo)) {
      return sinalInsuficiente(S.RETIRADA_APOS_MES_FORTE,
        'HISTORICO_MENOR_QUE_' + minimo + '_FECHAMENTOS');
    }
    var pct = ctx.config.param(PARAM_MES_FORTE);
    if (pct.value === null) return sinalNulo(S.RETIRADA_APOS_MES_FORTE, pct.reason || 'PARAMETRO_INDISPONIVEL');

    var base = anteriores.slice(-Number(minimo));
    var valores = base.map(function (f) { return Number(f.caixa_retirado_brl); })
      .filter(function (v) { return Number.isFinite(v); });
    if (valores.length < Number(minimo)) {
      return sinalInsuficiente(S.RETIRADA_APOS_MES_FORTE, 'CAIXA_RETIRADO_ANTERIOR_INDISPONIVEL');
    }
    var media = FOS.Core.round2(FOS.Core.sum(valores) / valores.length);
    var atual = FOS.Core.isOk(ctx.caixaRetiradoBrl) ? ctx.caixaRetiradoBrl.value : null;
    if (atual === null) return sinalNulo(S.RETIRADA_APOS_MES_FORTE, 'CAIXA_RETIRADO_ATUAL_INDISPONIVEL');
    var mesForte = atual > FOS.Core.round2(media * (1 + Number(pct.value)));

    var houveRetirada = (ctx.eventos || []).some(function (e) {
      return String(e.tipo_evento).toUpperCase() === C.TIPO_EVENTO.RETIRADA_POSICAO
        && String(e.status || '') !== FOS.Events.STATUS_EVENTO.CANCELADO
        && FOS.Dates.inCompetencia(String(e.data), ctx.competencia);
    });
    var reducaoAlocativa = false;
    var ant = anterior(ctx);
    if (ant && Number.isFinite(Number(ant.patrimonio_capital_investido))) {
      reducaoAlocativa = Number(ctx.patrimonioCapitalInvestido) < Number(ant.patrimonio_capital_investido);
    }
    return sinal(S.RETIRADA_APOS_MES_FORTE, mesForte && (houveRetirada || reducaoAlocativa),
      'mes_forte=' + mesForte + '; retirada=' + houveRetirada + '; reducao_alocativa=' + reducaoAlocativa);
  }

  /** Os sete sinais, sempre na mesma ordem, sempre independentes. */
  function avaliarTodos(ctx) {
    return [
      reducaoProtecao(ctx),
      gastoExtraordinarioAnormal(ctx),
      vidaParaTrading(ctx),
      reservaForaDaFinalidade(ctx),
      quedaRunway(ctx),
      compromissoSemProvisao(ctx),
      retiradaAposMesForte(ctx)
    ];
  }

  FOS.Signals = {
    PARAM_LIMITE_GASTO_EXTRA: PARAM_LIMITE_GASTO_EXTRA,
    PARAM_QUEDA_RUNWAY: PARAM_QUEDA_RUNWAY,
    PARAM_MES_FORTE: PARAM_MES_FORTE,
    avaliarTodos: avaliarTodos,
    reducaoProtecao: reducaoProtecao,
    gastoExtraordinarioAnormal: gastoExtraordinarioAnormal,
    vidaParaTrading: vidaParaTrading,
    reservaForaDaFinalidade: reservaForaDaFinalidade,
    quedaRunway: quedaRunway,
    compromissoSemProvisao: compromissoSemProvisao,
    retiradaAposMesForte: retiradaAposMesForte
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/state.js ===== */
/**
 * Estado do ciclo financeiro.
 *
 * Regras canônicas:
 *  - o estado SUGERIDO é contínuo (recalculado a cada fechamento);
 *  - o avanço FORMAL só ocorre após 2 fechamentos consecutivos sustentando
 *    o estado superior;
 *  - a regressão ocorre no PRIMEIRO fechamento que confirma a deterioração.
 * Assimetria proposital: subir exige confirmação, descer exige apenas o fato.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;
  var E = C.ESTADO_CICLO;
  var ORDEM = C.ORDEM_ESTADO_CICLO;

  var PARAM_RUNWAY_ESTABILIZANDO = 'RUNWAY_MINIMO_ESTABILIZANDO_MESES';
  var PARAM_RUNWAY_ESTAVEL = 'RUNWAY_MINIMO_ESTAVEL_MESES';
  var PARAM_RUNWAY_EXPANSAO = 'RUNWAY_MINIMO_EXPANSAO_MESES';
  var PARAM_FECHAMENTOS_AVANCO = 'FECHAMENTOS_PARA_AVANCO_ESTADO';

  function indice(estado) {
    return ORDEM.indexOf(estado);
  }

  /**
   * Estado sugerido a partir de runway e saúde das provisões.
   * @param {Object} params {config, runway (managed), provisoes (avaliações)}
   */
  function sugerir(params) {
    var runway = params.runway;
    if (!FOS.Core.isOk(runway)) {
      return {
        estado: null,
        status: runway && runway.status === 'DADO_INSUFICIENTE' ? 'DADO_INSUFICIENTE' : 'NULL',
        reason: (runway && runway.reason) || 'RUNWAY_INDISPONIVEL'
      };
    }
    var config = params.config;
    var lim1 = config.param(PARAM_RUNWAY_ESTABILIZANDO).value;
    var lim2 = config.param(PARAM_RUNWAY_ESTAVEL).value;
    var lim3 = config.param(PARAM_RUNWAY_EXPANSAO).value;
    if (lim1 === null || lim2 === null || lim3 === null) {
      return { estado: null, status: 'NULL', reason: 'LIMIARES_DE_ESTADO_INDISPONIVEIS' };
    }

    var estado;
    if (runway.value < Number(lim1)) estado = E.FRAGIL;
    else if (runway.value < Number(lim2)) estado = E.ESTABILIZANDO;
    else if (runway.value < Number(lim3)) estado = E.ESTAVEL;
    else estado = E.EXPANSAO;

    var provisoes = params.provisoes || [];
    var emRisco = provisoes.filter(function (p) { return p.status === C.STATUS_PROVISAO.EM_RISCO; });
    var foraDeRitmo = provisoes.filter(function (p) { return p.status === C.STATUS_PROVISAO.FORA_DE_RITMO; });
    var motivos = [];
    if (emRisco.length && indice(estado) > indice(E.ESTABILIZANDO)) {
      estado = E.ESTABILIZANDO;
      motivos.push('PROVISAO_EM_RISCO_LIMITA_ESTADO');
    }
    if (foraDeRitmo.length && indice(estado) > indice(E.ESTAVEL)) {
      estado = E.ESTAVEL;
      motivos.push('PROVISAO_FORA_DE_RITMO_LIMITA_EXPANSAO');
    }
    return {
      estado: estado,
      status: 'OK',
      reason: motivos.length ? motivos.join(';') : null,
      runway_meses: runway.value
    };
  }

  /**
   * Aplica avanço/regressão formal.
   * @param {Object} params
   * @param {?string} params.estadoFormalAnterior
   * @param {Array<?string>} params.sugeridosRecentes do mais antigo ao mais
   *        recente, INCLUINDO o estado sugerido do fechamento atual
   * @param {number} params.fechamentosParaAvanco
   */
  function aplicar(params) {
    var sugeridos = (params.sugeridosRecentes || []).slice();
    var atual = sugeridos.length ? sugeridos[sugeridos.length - 1] : null;
    var formalAnterior = params.estadoFormalAnterior || null;
    var minimo = Number(params.fechamentosParaAvanco || 2);

    if (!atual) {
      return {
        estado_formal: formalAnterior,
        estado_sugerido: null,
        movimento: 'DADO_INSUFICIENTE',
        motivo: 'ESTADO_SUGERIDO_INDISPONIVEL'
      };
    }
    if (!formalAnterior) {
      return {
        estado_formal: atual,
        estado_sugerido: atual,
        movimento: 'INICIAL',
        motivo: 'PRIMEIRO_FECHAMENTO_DEFINE_ESTADO_FORMAL'
      };
    }
    if (indice(atual) < indice(formalAnterior)) {
      return {
        estado_formal: atual,
        estado_sugerido: atual,
        movimento: 'REGRESSAO',
        motivo: 'DETERIORACAO_CONFIRMADA_NO_PRIMEIRO_FECHAMENTO'
      };
    }
    if (indice(atual) > indice(formalAnterior)) {
      var janela = sugeridos.slice(-minimo);
      if (janela.length < minimo || janela.some(function (s) { return !s; })) {
        return {
          estado_formal: formalAnterior,
          estado_sugerido: atual,
          movimento: 'MANUTENCAO',
          motivo: 'AGUARDANDO_' + minimo + '_FECHAMENTOS_CONSECUTIVOS'
        };
      }
      var candidato = janela.reduce(function (menor, s) {
        return indice(s) < indice(menor) ? s : menor;
      }, janela[0]);
      if (indice(candidato) > indice(formalAnterior)) {
        return {
          estado_formal: candidato,
          estado_sugerido: atual,
          movimento: 'AVANCO',
          motivo: minimo + '_FECHAMENTOS_CONSECUTIVOS_SUSTENTANDO_' + candidato
        };
      }
      return {
        estado_formal: formalAnterior,
        estado_sugerido: atual,
        movimento: 'MANUTENCAO',
        motivo: 'AGUARDANDO_' + minimo + '_FECHAMENTOS_CONSECUTIVOS'
      };
    }
    return {
      estado_formal: formalAnterior,
      estado_sugerido: atual,
      movimento: 'MANUTENCAO',
      motivo: 'ESTADO_SUGERIDO_IGUAL_AO_FORMAL'
    };
  }

  FOS.State = {
    PARAM_RUNWAY_ESTABILIZANDO: PARAM_RUNWAY_ESTABILIZANDO,
    PARAM_RUNWAY_ESTAVEL: PARAM_RUNWAY_ESTAVEL,
    PARAM_RUNWAY_EXPANSAO: PARAM_RUNWAY_EXPANSAO,
    PARAM_FECHAMENTOS_AVANCO: PARAM_FECHAMENTOS_AVANCO,
    indice: indice,
    sugerir: sugerir,
    aplicar: aplicar
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/invariants.js ===== */
/**
 * Invariantes do sistema. São verificadas antes de qualquer fechamento e
 * podem ser rodadas isoladamente como "diagnóstico de integridade".
 * Uma invariante violada bloqueia o fechamento; nenhuma é auto-corrigida.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  function res(codigo, ok, detalhe) {
    return { codigo: codigo, ok: !!ok, detalhe: detalhe || null };
  }

  /** Nenhuma conta de trading pode aparecer no ledger transacional. */
  function firewallLedger(config, linhas) {
    var violacoes = (linhas || []).filter(function (l) {
      var conta = config.conta(l.conta_id);
      return !conta || conta.universo === C.UNIVERSO.TRADING;
    });
    return res('FIREWALL_LEDGER_SEM_CONTA_TRADING', violacoes.length === 0,
      violacoes.map(function (l) { return l.linha_id + '@' + l.conta_id; }).join(',') || null);
  }

  /** A aba 12 só aceita contas do universo Trading. */
  function firewallSaldosSemanais(config, saldos) {
    var violacoes = (saldos || []).filter(function (s) {
      var conta = config.conta(s.conta_id);
      return !conta || conta.universo !== C.UNIVERSO.TRADING;
    });
    return res('FIREWALL_SALDOS_SEMANAIS_APENAS_TRADING', violacoes.length === 0,
      violacoes.map(function (s) { return s.registro_id + '@' + s.conta_id; }).join(',') || null);
  }

  /** Versões do ledger: sequência 1..n por fingerprint e origem idêntica. */
  function ledgerAppendOnly(linhas) {
    var problemas = [];
    var porFp = FOS.Core.groupBy(linhas || [], function (l) { return String(l.fingerprint); });
    Object.keys(porFp).forEach(function (fp) {
      var versoes = FOS.Core.sortBy(porFp[fp], [function (l) { return Number(l.versao_gerencial); }]);
      versoes.forEach(function (l, idx) {
        if (Number(l.versao_gerencial) !== idx + 1) {
          problemas.push('VERSAO_FORA_DE_SEQUENCIA:' + fp + '@' + l.versao_gerencial);
        }
        if (idx > 0) {
          FOS.Ledger.CAMPOS_ORIGEM.forEach(function (campo) {
            if (String(l[campo]) !== String(versoes[0][campo])) {
              problemas.push('ORIGEM_ALTERADA:' + fp + '.' + campo);
            }
          });
        }
      });
    });
    return res('LEDGER_APPEND_ONLY', problemas.length === 0, problemas.join(',') || null);
  }

  /** Fila de revisão vazia (nenhum item aberto). */
  function filaVazia(itensFila) {
    var abertos = FOS.Queue.abertos(itensFila);
    return res('FILA_REVISAO_VAZIA', abertos.length === 0,
      abertos.map(function (i) { return i.item_id + ':' + i.motivo; }).join(',') || null);
  }

  /**
   * Todo evento conciliável da competência precisa estar conciliado.
   * A conciliação é lida do LEDGER (campo evento_conciliado_id), não de um
   * status editável na aba de eventos: a verdade fica no ledger append-only.
   */
  function conciliacoesCompletas(eventos, competencia, linhas) {
    var conciliados = {};
    (linhas || []).forEach(function (l) {
      if (l.evento_conciliado_id) conciliados[String(l.evento_conciliado_id)] = true;
    });
    var pendentes = (eventos || []).filter(function (e) {
      if (String(e.status || '') === FOS.Events.STATUS_EVENTO.CANCELADO) return false;
      if (!FOS.Dates.inCompetencia(String(e.data), competencia)) return false;
      var spec = FOS.Events.spec(String(e.tipo_evento).toUpperCase());
      if (!spec || !spec.concilia) return false;
      if (conciliados[String(e.evento_id)]) return false;
      return String(e.status || '') !== FOS.Events.STATUS_EVENTO.CONCILIADO;
    });
    return res('CONCILIACOES_COMPLETAS', pendentes.length === 0,
      pendentes.map(function (e) { return e.evento_id; }).join(',') || null);
  }

  /** Toda posição com capital investido precisa de snapshot ativo. */
  function snapshotsAtivos(projecaoPosicoes) {
    var sem = FOS.Positions.semSnapshot(projecaoPosicoes || {}).filter(function (p) {
      return p.capital_investido > 0;
    });
    return res('SNAPSHOTS_ATIVOS', sem.length === 0,
      sem.map(function (p) { return p.posicao_id; }).join(',') || null);
  }

  /** Taxa de câmbio disponível quando há exposição em moeda estrangeira. */
  function taxaCambialDisponivel(taxa, exposicaoEstrangeira) {
    if (!exposicaoEstrangeira) return res('TAXA_CAMBIAL_DISPONIVEL', true, 'SEM_EXPOSICAO_ESTRANGEIRA');
    return res('TAXA_CAMBIAL_DISPONIVEL', !!taxa && taxa.value !== null,
      taxa && taxa.reason ? taxa.reason : null);
  }

  /** Subledgers versionados: sem versão duplicada por entidade. */
  function subledgerVersionado(linhas, campoId, codigo) {
    var vistos = {};
    var duplicadas = [];
    (linhas || []).forEach(function (l) {
      var k = String(l[campoId]) + '@v' + String(l.versao);
      if (vistos[k]) duplicadas.push(k);
      vistos[k] = true;
    });
    return res(codigo, duplicadas.length === 0, duplicadas.join(',') || null);
  }

  /** A soma por categoria precisa fechar com a soma total do ledger. */
  function somaCategorias(linhas) {
    var total = FOS.Core.sum(linhas, function (l) { return Number(l.valor_origem); });
    var porCategoria = 0;
    C.values(C.CATEGORIA).forEach(function (cat) {
      porCategoria = FOS.Core.round2(porCategoria + FOS.Ledger.totalCategoria(linhas, cat));
    });
    var semCategoria = (linhas || []).filter(function (l) {
      return !C.isValid(C.CATEGORIA, String(l.categoria));
    });
    return res('SOMA_POR_CATEGORIA_FECHA',
      FOS.Core.round2(total) === FOS.Core.round2(porCategoria) && semCategoria.length === 0,
      'total=' + total + '; por_categoria=' + porCategoria + '; sem_categoria=' + semCategoria.length);
  }

  /** O fechamento anterior não pode ter mudado (checksum recalculado). */
  function fechamentoAnteriorImutavel(fechamentoAnterior, recalcularChecksum) {
    if (!fechamentoAnterior) return res('FECHAMENTO_ANTERIOR_IMUTAVEL', true, 'SEM_FECHAMENTO_ANTERIOR');
    var atual = recalcularChecksum(fechamentoAnterior);
    return res('FECHAMENTO_ANTERIOR_IMUTAVEL',
      String(atual) === String(fechamentoAnterior.checksum),
      'esperado=' + fechamentoAnterior.checksum + '; recalculado=' + atual);
  }

  /**
   * Executa todas as invariantes aplicáveis a um fechamento.
   * @returns {{ok:boolean, resultados:Array, violacoes:Array}}
   */
  function verificarTodas(ctx) {
    var resultados = [
      firewallLedger(ctx.config, ctx.linhas),
      firewallSaldosSemanais(ctx.config, ctx.saldos),
      ledgerAppendOnly(ctx.linhasTodasVersoes || ctx.linhas),
      filaVazia(ctx.itensFila),
      conciliacoesCompletas(ctx.eventos, ctx.competencia, ctx.linhas),
      snapshotsAtivos(ctx.posicoes),
      taxaCambialDisponivel(ctx.taxa, ctx.exposicaoEstrangeira),
      subledgerVersionado(ctx.provisoesLinhas, 'provisao_id', 'PROVISOES_VERSIONADAS'),
      subledgerVersionado(ctx.objetivosLinhas, 'objetivo_id', 'OBJETIVOS_VERSIONADOS'),
      somaCategorias(ctx.linhasCompetencia)
    ];
    if (ctx.fechamentoAnterior && ctx.recalcularChecksum) {
      resultados.push(fechamentoAnteriorImutavel(ctx.fechamentoAnterior, ctx.recalcularChecksum));
    }
    var violacoes = resultados.filter(function (r) { return !r.ok; });
    return { ok: violacoes.length === 0, resultados: resultados, violacoes: violacoes };
  }

  FOS.Invariants = {
    firewallLedger: firewallLedger,
    firewallSaldosSemanais: firewallSaldosSemanais,
    ledgerAppendOnly: ledgerAppendOnly,
    filaVazia: filaVazia,
    conciliacoesCompletas: conciliacoesCompletas,
    snapshotsAtivos: snapshotsAtivos,
    taxaCambialDisponivel: taxaCambialDisponivel,
    subledgerVersionado: subledgerVersionado,
    somaCategorias: somaCategorias,
    fechamentoAnteriorImutavel: fechamentoAnteriorImutavel,
    verificarTodas: verificarTodas
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/closing.js ===== */
/**
 * Fechamento mensal (aba 40).
 *
 * ABERTO -> EM_REVISAO -> FECHADO. O fechamento materializa um snapshot
 * COMPLETO e imutável: depois de FECHADO, nada é recalculado — correções
 * viram restatement (aba 41), nunca update.
 *
 * O snapshot congela: saldos e posições de Trading, as quatro métricas,
 * taxa e efeito cambial, custos, disponível e runway, funções do dinheiro,
 * provisões e objetivos, patrimônio por moeda e em BRL gerencial, qualidade,
 * estado do ciclo, os sete sinais, ações sugeridas e metadados.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  var VERSAO_SCHEMA_SNAPSHOT = 1;

  var TRANSICOES = {
    ABERTO: ['EM_REVISAO'],
    EM_REVISAO: ['FECHADO', 'ABERTO'],
    FECHADO: []
  };

  function transicionar(estadoAtual, novoEstado) {
    var permitidos = TRANSICOES[estadoAtual];
    if (!permitidos) {
      FOS.Core.fail('ESTADO_FECHAMENTO_INVALIDO', 'Estado desconhecido: ' + estadoAtual);
    }
    if (permitidos.indexOf(novoEstado) === -1) {
      FOS.Core.fail('TRANSICAO_INVALIDA',
        'Transição não permitida: ' + estadoAtual + ' -> ' + novoEstado,
        { de: estadoAtual, para: novoEstado });
    }
    return novoEstado;
  }

  function fechamentoId(competencia, versao) {
    return 'FEC-' + competencia + '-v' + versao;
  }

  /** Checksum determinístico do snapshot (exclui o próprio checksum). */
  function checksum(snapshot) {
    var copia = FOS.Core.clone(snapshot);
    delete copia.checksum;
    return FOS.Hash.fnv1a64(FOS.Core.canonicalJson(copia));
  }

  function managed(m) {
    if (!m) return { value: null, status: 'NULL', reason: 'INDISPONIVEL' };
    return { value: m.value === undefined ? null : m.value, status: m.status, reason: m.reason || null };
  }

  function saldosTradingCongelados(config, saldos, competencia) {
    var fim = FOS.Dates.competenciaRange(competencia).fim;
    return config.contasPorUniverso(C.UNIVERSO.TRADING)
      .filter(function (c) { return c.ativa; })
      .map(function (conta) {
        var s = FOS.Trading.saldoNaData(saldos, conta.conta_id, fim, true);
        return {
          conta_id: conta.conta_id,
          moeda: conta.moeda,
          saldo: s ? s.saldo : null,
          data_referencia: s ? s.data : null,
          status: s ? 'OK' : 'AUSENTE'
        };
      });
  }

  function patrimonio(posicoes, taxa, moedaGerencial) {
    var lista = FOS.Positions.listar(posicoes);
    var porMoeda = {};
    var capitalInvestido = 0;
    lista.forEach(function (p) {
      var moeda = p.moeda || moedaGerencial;
      porMoeda[moeda] = porMoeda[moeda] || { valor_mercado: 0, capital_investido: 0, posicoes: 0, incompleto: false };
      porMoeda[moeda].capital_investido = FOS.Core.round2(porMoeda[moeda].capital_investido + p.capital_investido);
      porMoeda[moeda].posicoes++;
      if (p.valor_mercado === null) porMoeda[moeda].incompleto = true;
      else porMoeda[moeda].valor_mercado = FOS.Core.round2(porMoeda[moeda].valor_mercado + p.valor_mercado);
      capitalInvestido = FOS.Core.round2(capitalInvestido + p.capital_investido);
    });

    var brlGerencial;
    var moedas = Object.keys(porMoeda);
    var incompleto = moedas.some(function (m) { return porMoeda[m].incompleto; });
    if (incompleto) {
      brlGerencial = FOS.Core.nullValue('POSICAO_SEM_SNAPSHOT');
    } else {
      var total = 0;
      var bloqueio = null;
      moedas.forEach(function (m) {
        if (bloqueio) return;
        if (m === moedaGerencial) {
          total = FOS.Core.round2(total + porMoeda[m].valor_mercado);
          return;
        }
        if (!taxa || taxa.value === null) {
          bloqueio = (taxa && taxa.reason) || 'TAXA_INDISPONIVEL';
          return;
        }
        total = FOS.Core.round2(total + porMoeda[m].valor_mercado * taxa.value);
      });
      brlGerencial = bloqueio ? FOS.Core.nullValue(bloqueio) : FOS.Core.value(total);
    }

    return {
      por_moeda: porMoeda,
      capital_investido_total: capitalInvestido,
      brl_gerencial: managed(brlGerencial),
      posicoes: lista.map(function (p) {
        return {
          posicao_id: p.posicao_id,
          moeda: p.moeda,
          capital_investido: p.capital_investido,
          distribuicoes: p.distribuicoes,
          valor_mercado: p.valor_mercado,
          data_snapshot: p.data_snapshot,
          snapshot_status: p.snapshot_status,
          resultado_nao_realizado: p.resultado_nao_realizado
        };
      })
    };
  }

  function qualidade(ctx, snapshotParcial) {
    var abertos = FOS.Queue.abertos(ctx.itensFila).length;
    var pendentes = FOS.Invariants.conciliacoesCompletas(ctx.eventos, ctx.competencia, FOS.Ledger.visaoCorrente(ctx.linhas));
    var semSnapshot = FOS.Positions.semSnapshot(ctx.posicoes).length;
    var taxaOk = !ctx.exposicaoEstrangeira || (ctx.taxa && ctx.taxa.value !== null);
    var nulos = [];
    ['caixa_vida_brl', 'disponivel_brl', 'runway_meses'].forEach(function (k) {
      var v = snapshotParcial[k];
      if (v && v.value === null) nulos.push(k);
    });
    var nivel = 'COMPLETO';
    if (abertos > 0 || !pendentes.ok || semSnapshot > 0 || !taxaOk) nivel = 'BLOQUEADO';
    else if (nulos.length) nivel = 'PARCIAL';
    return {
      nivel: nivel,
      itens_fila_abertos: abertos,
      conciliacoes_pendentes: pendentes.ok ? 0 : String(pendentes.detalhe || '').split(',').filter(Boolean).length,
      posicoes_sem_snapshot: semSnapshot,
      taxa_cambial_disponivel: !!taxaOk,
      campos_nulos: nulos
    };
  }

  /**
   * Ações sugeridas — leitura, nunca execução.
   * Nenhuma ação financeira é executada pelo sistema: toda ação aqui é um
   * item para o usuário decidir.
   */
  function acoesSugeridas(sinais, provisoes) {
    var acoes = [];
    function add(codigo, descricao, referencia) {
      acoes.push({ codigo: codigo, descricao: descricao, referencia: referencia || null, executa_automaticamente: false });
    }
    var porCodigo = {};
    (sinais || []).forEach(function (s) { porCodigo[s.codigo] = s; });

    if (porCodigo[C.SINAL.COMPROMISSO_SEM_PROVISAO] && porCodigo[C.SINAL.COMPROMISSO_SEM_PROVISAO].valor === true) {
      add('CRIAR_PROVISAO', 'Há obrigação declarada sem provisão correspondente.',
        porCodigo[C.SINAL.COMPROMISSO_SEM_PROVISAO].detalhe);
    }
    if (porCodigo[C.SINAL.QUEDA_RUNWAY] && porCodigo[C.SINAL.QUEDA_RUNWAY].valor === true) {
      add('REVISAR_RUNWAY', 'Runway caiu acima do limite configurado.', null);
    }
    if (porCodigo[C.SINAL.GASTO_EXTRAORDINARIO_ANORMAL]
      && porCodigo[C.SINAL.GASTO_EXTRAORDINARIO_ANORMAL].valor === true) {
      add('REVISAR_GASTOS_EXTRAORDINARIOS', 'Gasto extraordinário acima do limite reversível do mês.', null);
    }
    if (porCodigo[C.SINAL.RESERVA_FORA_DA_FINALIDADE]
      && porCodigo[C.SINAL.RESERVA_FORA_DA_FINALIDADE].valor === true) {
      add('REVISAR_USO_RESERVA', 'Reserva provisionada foi reduzida antes do vencimento.',
        porCodigo[C.SINAL.RESERVA_FORA_DA_FINALIDADE].detalhe);
    }
    if (porCodigo[C.SINAL.REDUCAO_PROTECAO] && porCodigo[C.SINAL.REDUCAO_PROTECAO].valor === true) {
      add('REVISAR_PROTECAO', 'Proteção acumulada caiu em relação ao fechamento anterior.', null);
    }
    if (porCodigo[C.SINAL.VIDA_PARA_TRADING] && porCodigo[C.SINAL.VIDA_PARA_TRADING].valor === true) {
      add('REVISAR_APORTE_TRADING', 'Houve aporte de capital da Vida para o Trading no período.', null);
    }
    if (porCodigo[C.SINAL.RETIRADA_APOS_MES_FORTE]
      && porCodigo[C.SINAL.RETIRADA_APOS_MES_FORTE].valor === true) {
      add('REVISAR_RETIRADA_PATRIMONIO', 'Retirada ou redução alocativa do patrimônio após mês forte.', null);
    }
    (provisoes || []).forEach(function (p) {
      if (p.status === C.STATUS_PROVISAO.EM_RISCO) {
        add('REFORCAR_PROVISAO', 'Provisão vencida e descoberta: ' + p.nome, p.provisao_id);
      } else if (p.status === C.STATUS_PROVISAO.FORA_DE_RITMO) {
        add('AJUSTAR_RITMO_PROVISAO', 'Ritmo de acumulação abaixo do necessário: ' + p.nome, p.provisao_id);
      }
    });
    return acoes;
  }

  /**
   * Monta o snapshot completo da competência. Função pura: recebe tudo o que
   * precisa em ctx e não escreve nada.
   */
  function montarSnapshot(ctx) {
    var competencia = FOS.Dates.assertCompetencia(ctx.competencia);
    var range = FOS.Dates.competenciaRange(competencia);
    var config = ctx.config;
    var moedaGerencial = config.param('MOEDA_GERENCIAL').value || C.MOEDA.BRL;

    var linhasCorrentes = FOS.Ledger.visaoCorrente(ctx.linhas);
    var linhasCompetencia = FOS.Ledger.daCompetencia(ctx.linhas, competencia);

    var caixa = FOS.Life.caixaVida(config, ctx.linhas, competencia);
    var custoMes = FOS.Life.custoVidaMes(ctx.linhas, competencia);
    var custoMedio = FOS.Life.custoVidaMedio(config, ctx.linhas, competencia);

    // Versões vigentes NA competência: reprocessar um mês antigo não enxerga
    // versões criadas depois dele.
    var provisoesCorrentes = FOS.Subledger.correntesEm(ctx.provisoesLinhas, 'provisao_id', competencia);
    var objetivosCorrentes = FOS.Subledger.correntesEm(ctx.objetivosLinhas, 'objetivo_id', competencia);

    var provisoesAvaliadas = provisoesCorrentes.map(function (p) {
      return FOS.Provisions.avaliar(p, {
        dataReferencia: range.fim,
        competencia: competencia,
        historico: (ctx.historicoProvisoes || {})[String(p.provisao_id)] || [],
        fechamentosMinimos: config.param('FECHAMENTOS_MINIMOS_PROVISAO').value || 2
      });
    });
    var objetivosAvaliados = objetivosCorrentes.map(function (o) {
      return FOS.Objectives.avaliar(o, {
        dataReferencia: range.fim,
        competencia: competencia,
        historico: (ctx.historicoObjetivos || {})[String(o.objetivo_id)] || [],
        fechamentosMinimos: config.param('FECHAMENTOS_MINIMOS_PROVISAO').value || 2
      });
    });

    var funcoes = FOS.Life.funcoesDoDinheiro(caixa, provisoesAvaliadas, objetivosAvaliados);
    var disponivel = FOS.Life.disponivel(caixa, funcoes);
    var runway = FOS.Life.runway(disponivel, custoMedio);

    var metricasTrading = FOS.Trading.metricas({
      config: config,
      competencia: competencia,
      linhas: ctx.linhas,
      saldos: ctx.saldos,
      eventos: ctx.eventos,
      contaReserva: config.param('CONTA_RESERVA_TRADING_BRL').value || 'RESERVA_BANCA_BRL'
    });

    var capitalGbp = FOS.Trading.capitalTradingGbp(config, ctx.saldos, competencia);
    var capitalGbpAnterior = FOS.Trading.capitalTradingGbp(config, ctx.saldos, FOS.Dates.addMonths(competencia, -1));
    var efeito = FOS.Fx.efeitoCambial(
      FOS.Core.isOk(capitalGbpAnterior) ? capitalGbpAnterior.value : null,
      ctx.taxaAnterior && ctx.taxaAnterior.value !== null ? ctx.taxaAnterior.value : null,
      ctx.taxa && ctx.taxa.value !== null ? ctx.taxa.value : null
    );

    var pat = patrimonio(ctx.posicoes, ctx.taxa, moedaGerencial);

    var estadoSugerido = FOS.State.sugerir({ config: config, runway: runway, provisoes: provisoesAvaliadas });
    var sugeridosRecentes = (ctx.sugeridosAnteriores || []).concat([estadoSugerido.estado]);
    var estado = FOS.State.aplicar({
      estadoFormalAnterior: ctx.estadoFormalAnterior || null,
      sugeridosRecentes: sugeridosRecentes,
      fechamentosParaAvanco: config.param(FOS.State.PARAM_FECHAMENTOS_AVANCO).value || 2
    });

    var sinais = FOS.Signals.avaliarTodos({
      config: config,
      competencia: competencia,
      dataReferencia: range.fim,
      linhas: ctx.linhas,
      eventos: ctx.eventos,
      provisoes: provisoesAvaliadas,
      caixaVida: caixa,
      runway: runway,
      caixaRetiradoBrl: metricasTrading.caixa_retirado_brl,
      patrimonioCapitalInvestido: pat.capital_investido_total,
      fechamentosAnteriores: ctx.fechamentosAnteriores || []
    });

    var parcial = {
      caixa_vida_brl: managed(caixa),
      disponivel_brl: managed(disponivel),
      runway_meses: managed(runway)
    };

    var snapshot = {
      versao_schema: VERSAO_SCHEMA_SNAPSHOT,
      competencia: competencia,
      periodo: range,
      moeda_gerencial: moedaGerencial,
      gerado_em: ctx.agora,

      trading: {
        saldos_congelados: saldosTradingCongelados(config, ctx.saldos, competencia),
        capital_gbp: managed(capitalGbp),
        metricas: {
          caixa_retirado_brl: managed(metricasTrading.caixa_retirado_brl),
          pnl_operacional_gbp: managed(metricasTrading.pnl_operacional_gbp),
          resultado_reserva_brl: managed(metricasTrading.resultado_reserva_brl),
          custo_operacional_brl: managed(metricasTrading.custo_operacional_brl)
        },
        observacao: 'As quatro métricas são independentes e não somáveis entre si.'
      },

      cambio: {
        par: ctx.taxa && ctx.taxa.par ? ctx.taxa.par : FOS.Fx.par(C.MOEDA.GBP, moedaGerencial),
        provedor: ctx.taxa ? ctx.taxa.provedor : null,
        taxa: ctx.taxa ? ctx.taxa.value : null,
        data_taxa: ctx.taxa ? ctx.taxa.data : null,
        reason: ctx.taxa ? ctx.taxa.reason : 'TAXA_NAO_INFORMADA',
        efeito_cambial_brl: managed(efeito)
      },

      vida: {
        caixa_vida_brl: managed(caixa),
        custo_vida_mes_brl: managed(custoMes),
        custo_vida_medio_brl: managed(custoMedio),
        disponivel_brl: managed(disponivel),
        runway_meses: managed(runway),
        funcoes_do_dinheiro: funcoes
      },

      provisoes: provisoesAvaliadas,
      objetivos: objetivosAvaliados,
      patrimonio: pat,

      estado_ciclo: {
        sugerido: estadoSugerido.estado,
        sugerido_status: estadoSugerido.status,
        sugerido_reason: estadoSugerido.reason,
        formal: estado.estado_formal,
        movimento: estado.movimento,
        motivo: estado.motivo
      },

      sinais: sinais,

      metadados: {
        linhas_ledger_competencia: linhasCompetencia.length,
        linhas_ledger_total: linhasCorrentes.length,
        eventos_competencia: (ctx.eventos || []).filter(function (e) {
          return FOS.Dates.inCompetencia(String(e.data), competencia);
        }).length,
        registros_saldo_trading: (ctx.saldos || []).length,
        parametros_bloqueados: Object.keys(config.parametros).filter(function (k) {
          return config.parametros[k].status === 'BLOQUEADO';
        })
      }
    };

    snapshot.qualidade = qualidade(ctx, parcial);
    snapshot.acoes = acoesSugeridas(sinais, provisoesAvaliadas);
    return snapshot;
  }

  /** Validações formais do fechamento (fila, conciliações, PTAX, snapshots, invariantes). */
  function validar(ctx) {
    var linhasCompetencia = FOS.Ledger.daCompetencia(ctx.linhas, ctx.competencia);
    return FOS.Invariants.verificarTodas({
      config: ctx.config,
      competencia: ctx.competencia,
      linhas: FOS.Ledger.visaoCorrente(ctx.linhas),
      linhasTodasVersoes: ctx.linhas,
      linhasCompetencia: linhasCompetencia,
      saldos: ctx.saldos,
      eventos: ctx.eventos,
      itensFila: ctx.itensFila,
      posicoes: ctx.posicoes,
      taxa: ctx.taxa,
      exposicaoEstrangeira: ctx.exposicaoEstrangeira,
      provisoesLinhas: ctx.provisoesLinhas,
      objetivosLinhas: ctx.objetivosLinhas,
      fechamentoAnterior: ctx.fechamentoAnterior,
      recalcularChecksum: ctx.recalcularChecksum
    });
  }

  /**
   * Executa o fechamento. Só produz linha FECHADO se todas as validações
   * passarem; caso contrário devolve o snapshot em EM_REVISAO com bloqueios.
   */
  function fechar(ctx) {
    var validacao = validar(ctx);
    var snapshot = montarSnapshot(ctx);
    var versao = Number(ctx.versao || 1);
    var estado = validacao.ok
      ? C.ESTADO_FECHAMENTO.FECHADO
      : C.ESTADO_FECHAMENTO.EM_REVISAO;

    snapshot.validacao = {
      ok: validacao.ok,
      resultados: validacao.resultados,
      violacoes: validacao.violacoes.map(function (v) { return v.codigo; })
    };
    snapshot.estado = estado;
    snapshot.versao = versao;
    snapshot.fechado_em = validacao.ok ? ctx.agora : null;

    var check = checksum(snapshot);
    var fechamento = {
      fechamento_id: fechamentoId(ctx.competencia, versao),
      competencia: ctx.competencia,
      versao: versao,
      estado: estado,
      gerado_em: ctx.agora,
      fechado_em: validacao.ok ? ctx.agora : '',
      checksum: check,
      motivo_versao: ctx.motivoVersao || 'FECHAMENTO_ORIGINAL',
      gerado_por: ctx.ator || 'SISTEMA',
      caixa_vida_brl: snapshot.vida.caixa_vida_brl.value,
      disponivel_brl: snapshot.vida.disponivel_brl.value,
      runway_meses: snapshot.vida.runway_meses.value,
      patrimonio_brl_gerencial: snapshot.patrimonio.brl_gerencial.value,
      estado_ciclo_sugerido: snapshot.estado_ciclo.sugerido,
      estado_ciclo_formal: snapshot.estado_ciclo.formal,
      qualidade: snapshot.qualidade.nivel,
      snapshot_json: FOS.Core.canonicalJson(snapshot)
    };

    return { fechamento: fechamento, snapshot: snapshot, validacao: validacao };
  }

  /** Recalcula o checksum a partir da linha persistida (para provar imutabilidade). */
  function checksumDaLinha(linhaFechamento) {
    var snapshot = JSON.parse(linhaFechamento.snapshot_json);
    return checksum(snapshot);
  }

  /** Resumo achatado do fechamento, usado como "fechamento anterior" nos sinais. */
  function resumoParaHistorico(snapshot) {
    return {
      competencia: snapshot.competencia,
      runway_meses: snapshot.vida.runway_meses.value,
      caixa_vida_brl: snapshot.vida.caixa_vida_brl.value,
      caixa_retirado_brl: snapshot.trading.metricas.caixa_retirado_brl.value,
      protecao_total: snapshot.vida.funcoes_do_dinheiro.protecao,
      patrimonio_capital_investido: snapshot.patrimonio.capital_investido_total,
      estado_formal: snapshot.estado_ciclo.formal,
      estado_sugerido: snapshot.estado_ciclo.sugerido,
      provisoes: (snapshot.provisoes || []).map(function (p) {
        return {
          provisao_id: p.provisao_id,
          valor_acumulado: p.valor_acumulado,
          vencimento: p.vencimento,
          status: p.status
        };
      })
    };
  }

  FOS.Closing = {
    VERSAO_SCHEMA_SNAPSHOT: VERSAO_SCHEMA_SNAPSHOT,
    TRANSICOES: TRANSICOES,
    transicionar: transicionar,
    fechamentoId: fechamentoId,
    checksum: checksum,
    checksumDaLinha: checksumDaLinha,
    montarSnapshot: montarSnapshot,
    validar: validar,
    fechar: fechar,
    patrimonio: patrimonio,
    acoesSugeridas: acoesSugeridas,
    resumoParaHistorico: resumoParaHistorico
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/restatement.js ===== */
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

/* ===== src/domain/viewmodel.js ===== */
/**
 * View-model do dashboard (somente leitura).
 *
 * Allowlist explícita: apenas os campos listados aqui saem do fechamento
 * para qualquer superfície de leitura. Nada de linha de extrato, descrição
 * de transação, fingerprint, identificador de importação ou log.
 * O dashboard não tem regra própria: ele exibe o que o fechamento congelou.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};

  /** Campos proibidos em qualquer saída de view-model (defesa em profundidade). */
  var CAMPOS_PROIBIDOS = [
    'fingerprint', 'descricao_origem', 'descricao_normalizada', 'descricao_original',
    'import_id', 'arquivo_hash', 'arquivo_nome', 'linha_id', 'snapshot_json',
    'conta_id', 'valor_origem'
  ];

  var ALLOWLIST = [
    'competencia',
    'estado',
    'gerado_em',
    'fechado_em',
    'moeda_gerencial',
    'qualidade.nivel',
    'qualidade.itens_fila_abertos',
    'qualidade.conciliacoes_pendentes',
    'qualidade.posicoes_sem_snapshot',
    'qualidade.taxa_cambial_disponivel',
    'vida.caixa_vida_brl',
    'vida.custo_vida_mes_brl',
    'vida.custo_vida_medio_brl',
    'vida.disponivel_brl',
    'vida.runway_meses',
    'vida.funcoes_do_dinheiro',
    'trading.capital_gbp',
    'trading.metricas.caixa_retirado_brl',
    'trading.metricas.pnl_operacional_gbp',
    'trading.metricas.resultado_reserva_brl',
    'trading.metricas.custo_operacional_brl',
    'cambio.par',
    'cambio.provedor',
    'cambio.taxa',
    'cambio.data_taxa',
    'cambio.efeito_cambial_brl',
    'patrimonio.brl_gerencial',
    'patrimonio.por_moeda',
    'patrimonio.capital_investido_total',
    'estado_ciclo.sugerido',
    'estado_ciclo.formal',
    'estado_ciclo.movimento',
    'estado_ciclo.motivo'
  ];

  function get(obj, caminho) {
    var partes = caminho.split('.');
    var atual = obj;
    for (var i = 0; i < partes.length; i++) {
      if (atual === null || atual === undefined) return undefined;
      atual = atual[partes[i]];
    }
    return atual;
  }

  function set(obj, caminho, valor) {
    var partes = caminho.split('.');
    var atual = obj;
    for (var i = 0; i < partes.length - 1; i++) {
      atual[partes[i]] = atual[partes[i]] || {};
      atual = atual[partes[i]];
    }
    atual[partes[partes.length - 1]] = valor;
  }

  /** Posições: só identificador, moeda, valores e status do snapshot. */
  function posicoesPermitidas(snapshot) {
    return ((snapshot.patrimonio || {}).posicoes || []).map(function (p) {
      return {
        posicao_id: p.posicao_id,
        moeda: p.moeda,
        valor_mercado: p.valor_mercado,
        capital_investido: p.capital_investido,
        snapshot_status: p.snapshot_status,
        data_snapshot: p.data_snapshot
      };
    });
  }

  function provisoesPermitidas(snapshot) {
    return (snapshot.provisoes || []).map(function (p) {
      return {
        provisao_id: p.provisao_id,
        nome: p.nome,
        status: p.status,
        valor_alvo: p.valor_alvo,
        valor_acumulado: p.valor_acumulado,
        valor_faltante: p.valor_faltante,
        vencimento: p.vencimento,
        ritmo_observado: p.ritmo_observado,
        ritmo_necessario: p.ritmo_necessario
      };
    });
  }

  function objetivosPermitidos(snapshot) {
    return (snapshot.objetivos || []).map(function (o) {
      return {
        objetivo_id: o.objetivo_id,
        nome: o.nome,
        status: o.status,
        valor_alvo: o.valor_alvo,
        valor_acumulado: o.valor_acumulado,
        valor_faltante: o.valor_faltante,
        prazo: o.prazo
      };
    });
  }

  function sinaisPermitidos(snapshot) {
    return (snapshot.sinais || []).map(function (s) {
      return { codigo: s.codigo, valor: s.valor, status: s.status, reason: s.reason };
    });
  }

  function acoesPermitidas(snapshot) {
    return (snapshot.acoes || []).map(function (a) {
      return { codigo: a.codigo, descricao: a.descricao, executa_automaticamente: false };
    });
  }

  /**
   * @param {?Object} snapshot snapshot congelado do fechamento
   * @param {{agora?:string, maxIdadeDias?:number, erro?:string}} [opcoes]
   */
  function construir(snapshot, opcoes) {
    var opts = opcoes || {};
    if (opts.erro) {
      return { status: 'ERROR', reason: opts.erro, dados: null };
    }
    if (!snapshot) {
      return { status: 'NULL', reason: 'SEM_FECHAMENTO_DISPONIVEL', dados: null };
    }

    var dados = {};
    ALLOWLIST.forEach(function (caminho) {
      var v = get(snapshot, caminho);
      if (v !== undefined) set(dados, caminho, FOS.Core.clone(v));
    });
    dados.patrimonio = dados.patrimonio || {};
    dados.patrimonio.posicoes = posicoesPermitidas(snapshot);
    dados.provisoes = provisoesPermitidas(snapshot);
    dados.objetivos = objetivosPermitidos(snapshot);
    dados.sinais = sinaisPermitidos(snapshot);
    dados.acoes = acoesPermitidas(snapshot);
    dados.somente_leitura = true;

    var status = 'OK';
    var reason = null;
    if (opts.agora && opts.maxIdadeDias && snapshot.competencia) {
      var fim = FOS.Dates.competenciaRange(snapshot.competencia).fim;
      var idade = FOS.Dates.diffDays(String(opts.agora).slice(0, 10), fim);
      if (idade > Number(opts.maxIdadeDias)) {
        status = 'STALE';
        reason = 'FECHAMENTO_DESATUALIZADO_HA_' + idade + '_DIAS';
      }
    }
    if (String(snapshot.estado) !== 'FECHADO' && status === 'OK') {
      status = 'STALE';
      reason = 'FECHAMENTO_NAO_FINALIZADO:' + snapshot.estado;
    }

    return { status: status, reason: reason, dados: dados };
  }

  /** Campos permitidos de um fechamento no histórico (lista curta e fechada). */
  var ALLOWLIST_HISTORICO = [
    'competencia', 'versao', 'estado', 'qualidade', 'fechado_em', 'moeda_gerencial',
    'caixa_vida_brl', 'disponivel_brl', 'runway_meses', 'patrimonio_brl_gerencial',
    'estado_ciclo_formal', 'estado_ciclo_sugerido', 'restatement', 'motivo_versao', 'checksum_curto'
  ];

  function historicoPermitido(fechamentos) {
    return (fechamentos || []).map(function (f) {
      var out = {};
      ALLOWLIST_HISTORICO.forEach(function (campo) {
        if (f[campo] !== undefined) out[campo] = f[campo];
      });
      return out;
    });
  }

  function restatementsPermitidos(restatements) {
    return (restatements || []).map(function (r) {
      return {
        restatement_id: r.restatement_id,
        competencia: r.competencia,
        versao_origem: r.versao_origem,
        versao_nova: r.versao_nova,
        motivo: r.motivo,
        campos_alterados: String(r.campos_alterados || '').split(',').filter(Boolean).length,
        criado_em: r.criado_em
      };
    });
  }

  /**
   * Payload completo do painel de leitura: fechamento vigente, histórico
   * imutável, restatements e bloqueios. É o ÚNICO objeto que o dashboard
   * recebe — ele não tem acesso a mais nada.
   */
  function construirPainel(params) {
    var p = params || {};
    var atual = construir(p.snapshot, {
      agora: p.agora,
      maxIdadeDias: p.maxIdadeDias,
      erro: p.erro
    });
    return {
      gerado_em: p.agora || null,
      somente_leitura: true,
      atual: atual,
      historico: historicoPermitido(p.historico),
      restatements: restatementsPermitidos(p.restatements),
      bloqueios: (p.bloqueios || []).map(function (b) {
        return { codigo: b.codigo, detalhe: b.detalhe || null };
      })
    };
  }

  /** Verifica que nenhum campo proibido vazou (usado em teste e em runtime). */
  function auditarVazamento(viewModel) {
    var texto = FOS.Core.canonicalJson(viewModel);
    return CAMPOS_PROIBIDOS.filter(function (campo) {
      return texto.indexOf('"' + campo + '"') !== -1;
    });
  }

  FOS.ViewModel = {
    ALLOWLIST: ALLOWLIST,
    ALLOWLIST_HISTORICO: ALLOWLIST_HISTORICO,
    CAMPOS_PROIBIDOS: CAMPOS_PROIBIDOS,
    construir: construir,
    construirPainel: construirPainel,
    auditarVazamento: auditarVazamento
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/domain/surfaces.js ===== */
/**
 * Superfícies visíveis (HOME, MOVIMENTAÇÕES, PLANEJAMENTO, PATRIMÔNIO).
 *
 * Construtores PUROS: recebem o modelo canônico já congelado e devolvem as
 * linhas da aba. As abas visíveis são projeção, nunca fonte de verdade —
 * podem ser apagadas e regeradas sem perda de informação.
 *
 * Regras de apresentação que valem em todas elas:
 *  - valor indisponível aparece vazio com status e motivo, nunca como zero;
 *  - nada é somado entre moedas nem entre universos;
 *  - não existe score: sinais são lidos um a um.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  var C = FOS.Constants;

  var COLUNAS = {
    HOME: ['secao', 'indicador', 'valor', 'unidade', 'status', 'motivo', 'detalhe'],
    MOVIMENTACOES: [
      'data', 'conta', 'descricao', 'valor', 'moeda',
      'categoria', 'subcategoria', 'universo',
      'evento_conciliado', 'versao', 'periodo', 'editavel', 'referencia'
    ],
    PLANEJAMENTO: [
      'bloco', 'item', 'status', 'alvo', 'acumulado', 'faltante',
      'ritmo_necessario', 'ritmo_observado', 'vencimento', 'prioridade', 'motivo'
    ],
    PATRIMONIO: [
      'bloco', 'item', 'moeda', 'capital_investido', 'valor_mercado',
      'resultado_nao_realizado', 'distribuicoes', 'snapshot', 'qualidade', 'motivo'
    ]
  };

  /** Colunas de origem: nunca editáveis à mão em MOVIMENTAÇÕES. */
  var COLUNAS_ORIGEM_MOVIMENTACOES = ['data', 'conta', 'descricao', 'valor', 'moeda', 'referencia'];

  var ROTULO_SINAL = {
    REDUCAO_PROTECAO: 'Proteção reduziu no mês',
    GASTO_EXTRAORDINARIO_ANORMAL: 'Gasto extraordinário acima do limite',
    VIDA_PARA_TRADING: 'Dinheiro da Vida foi para o Trading',
    RESERVA_FORA_DA_FINALIDADE: 'Reserva usada fora da finalidade',
    QUEDA_RUNWAY: 'Runway caiu além do limite',
    COMPROMISSO_SEM_PROVISAO: 'Compromisso assumido sem provisão',
    RETIRADA_APOS_MES_FORTE: 'Retirada de patrimônio após mês forte'
  };

  var ROTULO_ACAO = {
    CRIAR_PROVISAO: 'Criar provisão para o compromisso assumido',
    REVISAR_RUNWAY: 'Revisar runway',
    REVISAR_GASTOS_EXTRAORDINARIOS: 'Revisar gastos extraordinários do mês',
    REVISAR_USO_RESERVA: 'Revisar uso da reserva',
    REVISAR_PROTECAO: 'Revisar nível de proteção',
    REVISAR_APORTE_TRADING: 'Revisar aporte da Vida para o Trading',
    REVISAR_RETIRADA_PATRIMONIO: 'Revisar retirada de patrimônio',
    REFORCAR_PROVISAO: 'Reforçar provisão vencida e descoberta',
    AJUSTAR_RITMO_PROVISAO: 'Ajustar ritmo de acumulação da provisão'
  };

  function linhaHome(secao, indicador, managed, unidade, detalhe) {
    var m = managed || {};
    var temValor = m.value !== null && m.value !== undefined;
    return {
      secao: secao,
      indicador: indicador,
      valor: temValor ? m.value : '',
      unidade: unidade || '',
      status: m.status || (temValor ? 'OK' : 'NULL'),
      motivo: m.reason || '',
      detalhe: detalhe || ''
    };
  }

  function linhaTexto(secao, indicador, texto, status, motivo, detalhe) {
    return {
      secao: secao,
      indicador: indicador,
      valor: texto === null || texto === undefined ? '' : texto,
      unidade: '',
      status: status || 'OK',
      motivo: motivo || '',
      detalhe: detalhe || ''
    };
  }

  function estadoVazio(colunas, motivo) {
    var linha = {};
    colunas.forEach(function (c) { linha[c] = ''; });
    if (Object.prototype.hasOwnProperty.call(linha, 'secao')) linha.secao = 'SEM_DADOS';
    if (Object.prototype.hasOwnProperty.call(linha, 'bloco')) linha.bloco = 'SEM_DADOS';
    if (Object.prototype.hasOwnProperty.call(linha, 'indicador')) linha.indicador = 'Nenhum fechamento disponível';
    if (Object.prototype.hasOwnProperty.call(linha, 'item')) linha.item = 'Nenhum fechamento disponível';
    if (Object.prototype.hasOwnProperty.call(linha, 'status')) linha.status = 'NULL';
    if (Object.prototype.hasOwnProperty.call(linha, 'motivo')) linha.motivo = motivo || 'SEM_FECHAMENTO_DISPONIVEL';
    if (Object.prototype.hasOwnProperty.call(linha, 'descricao')) linha.descricao = 'Nenhuma movimentação registrada';
    return [linha];
  }

  /**
   * HOME: o mês em uma tela. Estado, qualidade, dinheiro, trading, sinais,
   * as três ações mais relevantes e os bloqueios.
   */
  function home(painel) {
    if (!painel || !painel.atual || !painel.atual.dados) {
      return estadoVazio(COLUNAS.HOME, painel && painel.atual ? painel.atual.reason : 'SEM_FECHAMENTO_DISPONIVEL');
    }
    var vm = painel.atual;
    var d = vm.dados;
    var linhas = [];

    linhas.push(linhaTexto('ESTADO', 'Competência', d.competencia));
    linhas.push(linhaTexto('ESTADO', 'Estado formal do ciclo', d.estado_ciclo.formal,
      d.estado_ciclo.formal ? 'OK' : 'NULL', d.estado_ciclo.formal ? '' : 'ESTADO_INDISPONIVEL'));
    linhas.push(linhaTexto('ESTADO', 'Estado sugerido', d.estado_ciclo.sugerido,
      d.estado_ciclo.sugerido ? 'OK' : 'DADO_INSUFICIENTE',
      d.estado_ciclo.sugerido ? '' : 'ESTADO_SUGERIDO_INDISPONIVEL', d.estado_ciclo.motivo));
    linhas.push(linhaTexto('ESTADO', 'Movimento no fechamento', d.estado_ciclo.movimento, 'OK', '', d.estado_ciclo.motivo));

    linhas.push(linhaTexto('QUALIDADE', 'Qualidade do fechamento', d.qualidade.nivel,
      d.qualidade.nivel === 'COMPLETO' ? 'OK' : 'ATENCAO'));
    linhas.push(linhaTexto('QUALIDADE', 'Frescor do dado', vm.status, vm.status, vm.reason || ''));
    linhas.push(linhaTexto('QUALIDADE', 'Itens abertos na fila de revisão', d.qualidade.itens_fila_abertos,
      d.qualidade.itens_fila_abertos ? 'ATENCAO' : 'OK'));
    linhas.push(linhaTexto('QUALIDADE', 'Conciliações pendentes', d.qualidade.conciliacoes_pendentes,
      d.qualidade.conciliacoes_pendentes ? 'ATENCAO' : 'OK'));

    linhas.push(linhaHome('DINHEIRO', 'Caixa de vida', d.vida.caixa_vida_brl, 'BRL'));
    linhas.push(linhaHome('DINHEIRO', 'Disponível', d.vida.disponivel_brl, 'BRL'));
    linhas.push(linhaHome('DINHEIRO', 'Runway', d.vida.runway_meses, 'meses'));
    linhas.push(linhaHome('DINHEIRO', 'Custo de vida do mês', d.vida.custo_vida_mes_brl, 'BRL'));
    var funcoes = d.vida.funcoes_do_dinheiro || {};
    linhas.push(linhaTexto('DINHEIRO', 'Função do dinheiro: proteção',
      funcoes.protecao === null || funcoes.protecao === undefined ? '' : funcoes.protecao,
      funcoes.status || 'NULL', funcoes.reason || '', 'BRL'));
    linhas.push(linhaTexto('DINHEIRO', 'Função do dinheiro: objetivos',
      funcoes.objetivos === null || funcoes.objetivos === undefined ? '' : funcoes.objetivos,
      funcoes.status || 'NULL', funcoes.reason || '', 'BRL'));
    linhas.push(linhaTexto('DINHEIRO', 'Função do dinheiro: livre',
      funcoes.livre === null || funcoes.livre === undefined ? '' : funcoes.livre,
      funcoes.status || 'NULL', funcoes.reason || '', 'BRL'));

    var m = (d.trading && d.trading.metricas) || {};
    linhas.push(linhaHome('TRADING', 'Caixa retirado', m.caixa_retirado_brl, 'BRL'));
    linhas.push(linhaHome('TRADING', 'P&L operacional', m.pnl_operacional_gbp, 'GBP'));
    linhas.push(linhaHome('TRADING', 'Resultado da reserva', m.resultado_reserva_brl, 'BRL'));
    linhas.push(linhaHome('TRADING', 'Custo operacional', m.custo_operacional_brl, 'BRL'));
    linhas.push(linhaTexto('TRADING', 'Observação',
      'As quatro métricas são independentes e não somáveis entre si.'));

    (d.sinais || []).forEach(function (s) {
      var texto = s.valor === true ? 'SIM' : (s.valor === false ? 'NAO' : '');
      linhas.push(linhaTexto('SINAIS', ROTULO_SINAL[s.codigo] || s.codigo, texto,
        s.valor === true ? 'ATENCAO' : s.status, s.reason || '', s.codigo));
    });

    var acoes = (d.acoes || []).slice(0, 3);
    if (!acoes.length) {
      linhas.push(linhaTexto('ACOES', 'Nenhuma ação sugerida', 'Nada exige decisão neste fechamento.'));
    } else {
      acoes.forEach(function (a, i) {
        linhas.push(linhaTexto('ACOES', 'Ação ' + (i + 1), ROTULO_ACAO[a.codigo] || a.codigo,
          'ATENCAO', '', a.descricao));
      });
    }

    var bloqueios = (painel.bloqueios || []);
    if (!bloqueios.length) {
      linhas.push(linhaTexto('ALERTAS', 'Bloqueios', 'Nenhum bloqueio ativo.'));
    } else {
      bloqueios.forEach(function (b) {
        linhas.push(linhaTexto('ALERTAS', b.codigo, b.detalhe || 'Bloqueia o fechamento', 'RISCO', b.codigo));
      });
    }
    return linhas;
  }

  /**
   * MOVIMENTAÇÕES: visão mediada do ledger. Origem imutável em colunas
   * protegidas; só categoria e subcategoria mudam, e apenas por ação
   * controlada em competência ainda aberta.
   */
  function movimentacoes(params) {
    var linhas = FOS.Ledger.visaoCorrente(params.linhas || []);
    if (!linhas.length) return estadoVazio(COLUNAS.MOVIMENTACOES, 'SEM_MOVIMENTACAO');
    var fechadas = {};
    (params.competenciasFechadas || []).forEach(function (c) { fechadas[String(c)] = true; });

    return FOS.Core.sortBy(linhas, [
      function (l) { return String(l.data_origem); },
      function (l) { return String(l.fingerprint); }
    ]).map(function (l) {
      var competencia = FOS.Dates.competenciaOf(String(l.data_origem));
      var fechada = !!fechadas[competencia];
      return {
        data: l.data_origem,
        conta: l.conta_id,
        descricao: l.descricao_origem,
        valor: l.valor_origem,
        moeda: l.moeda_origem,
        categoria: l.categoria,
        subcategoria: l.subcategoria || '',
        universo: l.universo,
        evento_conciliado: l.evento_conciliado_id || '',
        versao: l.versao_gerencial,
        periodo: fechada ? 'FECHADO' : 'ABERTO',
        editavel: fechada ? 'NAO (use restatement)' : 'SIM (via fila de revisão)',
        referencia: String(l.fingerprint).slice(0, 12)
      };
    });
  }

  /** PLANEJAMENTO: custo de vida, provisões e objetivos com ritmo e status. */
  function planejamento(painel) {
    if (!painel || !painel.atual || !painel.atual.dados) {
      return estadoVazio(COLUNAS.PLANEJAMENTO, painel && painel.atual ? painel.atual.reason : 'SEM_FECHAMENTO_DISPONIVEL');
    }
    var d = painel.atual.dados;
    var linhas = [];

    function linha(bloco, item, campos) {
      return Object.assign({
        bloco: bloco, item: item, status: '', alvo: '', acumulado: '', faltante: '',
        ritmo_necessario: '', ritmo_observado: '', vencimento: '', prioridade: '', motivo: ''
      }, campos || {});
    }

    linhas.push(linha('CUSTO_DE_VIDA', 'Custo de vida do mês', {
      status: d.vida.custo_vida_mes_brl.status,
      acumulado: d.vida.custo_vida_mes_brl.value === null ? '' : d.vida.custo_vida_mes_brl.value,
      motivo: d.vida.custo_vida_mes_brl.reason || ''
    }));
    linhas.push(linha('CUSTO_DE_VIDA', 'Custo de vida médio', {
      status: d.vida.custo_vida_medio_brl.status,
      acumulado: d.vida.custo_vida_medio_brl.value === null ? '' : d.vida.custo_vida_medio_brl.value,
      motivo: d.vida.custo_vida_medio_brl.reason || ''
    }));
    linhas.push(linha('CUSTO_DE_VIDA', 'Runway', {
      status: d.vida.runway_meses.status,
      acumulado: d.vida.runway_meses.value === null ? '' : d.vida.runway_meses.value,
      motivo: d.vida.runway_meses.reason || ''
    }));

    (d.provisoes || []).forEach(function (p) {
      linhas.push(linha('PROVISAO', p.nome, {
        status: p.status,
        alvo: p.valor_alvo,
        acumulado: p.valor_acumulado,
        faltante: p.valor_faltante,
        ritmo_necessario: p.ritmo_necessario === null ? '' : p.ritmo_necessario,
        ritmo_observado: p.ritmo_observado === null ? '' : p.ritmo_observado,
        vencimento: p.vencimento || '',
        prioridade: p.prioridade === null ? '' : p.prioridade,
        motivo: p.provisao_id
      }));
    });
    if (!(d.provisoes || []).length) {
      linhas.push(linha('PROVISAO', 'Nenhuma provisão registrada', { status: 'NULL', motivo: 'SEM_PROVISOES' }));
    }

    (d.objetivos || []).forEach(function (o) {
      linhas.push(linha('OBJETIVO', o.nome, {
        status: o.status,
        alvo: o.valor_alvo,
        acumulado: o.valor_acumulado,
        faltante: o.valor_faltante,
        vencimento: o.prazo || '',
        motivo: o.objetivo_id
      }));
    });
    if (!(d.objetivos || []).length) {
      linhas.push(linha('OBJETIVO', 'Nenhum objetivo registrado', { status: 'NULL', motivo: 'SEM_OBJETIVOS' }));
    }

    linhas.push(linha('FECHAMENTO', 'Competência fechada', {
      status: d.estado, vencimento: d.competencia, motivo: d.qualidade.nivel
    }));
    return linhas;
  }

  /**
   * PATRIMÔNIO: posições, totais por moeda e BRL gerencial.
   * O capital de Trading aparece em bloco próprio e NUNCA é somado ao
   * patrimônio: são universos distintos.
   */
  function patrimonio(painel) {
    if (!painel || !painel.atual || !painel.atual.dados) {
      return estadoVazio(COLUNAS.PATRIMONIO, painel && painel.atual ? painel.atual.reason : 'SEM_FECHAMENTO_DISPONIVEL');
    }
    var d = painel.atual.dados;
    var linhas = [];

    function linha(bloco, item, campos) {
      return Object.assign({
        bloco: bloco, item: item, moeda: '', capital_investido: '', valor_mercado: '',
        resultado_nao_realizado: '', distribuicoes: '', snapshot: '', qualidade: '', motivo: ''
      }, campos || {});
    }

    var posicoes = (d.patrimonio && d.patrimonio.posicoes) || [];
    posicoes.forEach(function (p) {
      linhas.push(linha('POSICAO', p.posicao_id, {
        moeda: p.moeda,
        capital_investido: p.capital_investido,
        valor_mercado: p.valor_mercado === null ? '' : p.valor_mercado,
        resultado_nao_realizado: p.valor_mercado === null ? '' : FOS.Core.round2(p.valor_mercado - p.capital_investido),
        snapshot: p.data_snapshot || '',
        qualidade: p.snapshot_status,
        motivo: p.snapshot_status === 'OK' ? '' : 'SNAPSHOT_' + p.snapshot_status
      }));
    });
    if (!posicoes.length) {
      linhas.push(linha('POSICAO', 'Nenhuma posição registrada', { qualidade: 'NULL', motivo: 'SEM_POSICOES' }));
    }

    var porMoeda = (d.patrimonio && d.patrimonio.por_moeda) || {};
    Object.keys(porMoeda).sort().forEach(function (moeda) {
      linhas.push(linha('TOTAL_POR_MOEDA', 'Total em ' + moeda, {
        moeda: moeda,
        capital_investido: porMoeda[moeda].capital_investido,
        valor_mercado: porMoeda[moeda].incompleto ? '' : porMoeda[moeda].valor_mercado,
        qualidade: porMoeda[moeda].incompleto ? 'INCOMPLETO' : 'OK',
        motivo: porMoeda[moeda].incompleto ? 'POSICAO_SEM_SNAPSHOT' : ''
      }));
    });

    var brl = d.patrimonio && d.patrimonio.brl_gerencial;
    linhas.push(linha('BRL_GERENCIAL', 'Patrimônio convertido (gerencial)', {
      moeda: d.moeda_gerencial,
      valor_mercado: brl && brl.value !== null ? brl.value : '',
      qualidade: brl ? brl.status : 'NULL',
      motivo: brl && brl.reason ? brl.reason : ''
    }));

    var capitalTrading = (d.trading && d.trading.capital_gbp)
      || { value: null, status: 'NULL', reason: 'CAPITAL_TRADING_INDISPONIVEL' };
    linhas.push(linha('TRADING_SEPARADO', 'Capital em trading (não somado ao patrimônio)', {
      moeda: 'GBP',
      capital_investido: capitalTrading.value === null ? '' : capitalTrading.value,
      qualidade: capitalTrading.status,
      motivo: capitalTrading.reason || 'UNIVERSO_SEPARADO'
    }));

    (painel.historico || []).slice(-6).forEach(function (h) {
      linhas.push(linha('HISTORICO', h.competencia, {
        moeda: h.moeda_gerencial || '',
        valor_mercado: h.patrimonio_brl_gerencial === null ? '' : h.patrimonio_brl_gerencial,
        qualidade: h.qualidade,
        motivo: h.restatement ? 'RESTATEMENT_v' + h.versao : 'FECHAMENTO_v' + h.versao
      }));
    });
    return linhas;
  }

  FOS.Surfaces = {
    COLUNAS: COLUNAS,
    COLUNAS_ORIGEM_MOVIMENTACOES: COLUNAS_ORIGEM_MOVIMENTACOES,
    ROTULO_SINAL: ROTULO_SINAL,
    ROTULO_ACAO: ROTULO_ACAO,
    home: home,
    movimentacoes: movimentacoes,
    planejamento: planejamento,
    patrimonio: patrimonio,
    estadoVazio: estadoVazio
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/adapters/clock.js ===== */
/**
 * Relógio. Isolado para que todo teste seja determinístico:
 * o domínio jamais chama new Date() diretamente.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.Adapters = FOS.Adapters || {};

  /** Relógio real (usa o fuso do script; grava sempre em ISO 8601 UTC). */
  function relogioReal() {
    return {
      agora: function () { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); },
      hoje: function () { return new Date().toISOString().slice(0, 10); }
    };
  }

  /** Relógio fixo para testes e reprocessamentos determinísticos. */
  function relogioFixo(instanteIso) {
    return {
      agora: function () { return instanteIso; },
      hoje: function () { return String(instanteIso).slice(0, 10); }
    };
  }

  FOS.Adapters.relogioReal = relogioReal;
  FOS.Adapters.relogioFixo = relogioFixo;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/adapters/spreadsheet.js ===== */
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
 *
 * Fronteira de tipos: o Sheets devolve Date para toda célula formatada como
 * data, e o domínio trabalha com texto ISO. A conversão acontece aqui, uma
 * vez só, na leitura — ver normalizarCelula.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.Adapters = FOS.Adapters || {};

  function ehData(valor) {
    return Object.prototype.toString.call(valor) === '[object Date]';
  }

  function doisDigitos(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /**
   * Formatação de fallback, usada quando Utilities não está disponível.
   * Usa os getters LOCAIS (não os UTC) de propósito: no Apps Script o fuso do
   * runtime é o do projeto, que é o mesmo da planilha. Usar UTC deslocaria o
   * dia para trás em qualquer fuso negativo — foi exatamente esse tipo de erro
   * que motivou esta função existir.
   */
  function formatarDataLocal(data) {
    return data.getFullYear() + '-' + doisDigitos(data.getMonth() + 1) + '-' + doisDigitos(data.getDate())
      + 'T' + doisDigitos(data.getHours()) + ':' + doisDigitos(data.getMinutes())
      + ':' + doisDigitos(data.getSeconds());
  }

  /**
   * Converte um valor de célula para o que o domínio entende.
   *
   *  - Date com hora zerada  -> 'AAAA-MM-DD' (campo de data)
   *  - Date com hora         -> ISO completo, preservando o instante (timestamp)
   *  - Date inválida         -> '' (o domínio recusa com motivo, sem chutar dia)
   *  - número, texto, booleano, vazio -> devolvidos intactos
   *
   * A conversão usa SEMPRE o fuso da planilha, nunca UTC: converter em UTC
   * desloca o dia (2026-09-01 vira 2026-08-31 em fuso negativo) e contamina
   * competência, conciliação e fingerprint.
   */
  function normalizarCelula(valor, ctx) {
    if (!ehData(valor)) return valor;
    if (isNaN(valor.getTime())) return '';
    var opcoes = ctx || {};
    var texto;
    if (typeof opcoes.formatarData === 'function' && opcoes.fusoHorario) {
      texto = opcoes.formatarData(valor, opcoes.fusoHorario, "yyyy-MM-dd'T'HH:mm:ssXXX");
    } else {
      texto = formatarDataLocal(valor);
    }
    var horaZerada = texto.slice(11, 19) === '00:00:00';
    return horaZerada ? texto.slice(0, 10) : texto;
  }

  /**
   * @param {Object} spreadsheet objeto Spreadsheet do Apps Script
   * @param {{fusoHorario?:string, formatarData?:Function}} [opcoes]
   *   injetáveis para manter o adaptador testável fora do Apps Script
   */
  function criar(spreadsheet, opcoes) {
    var ctxData = opcoes || {};
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
          return FOS.Schema.toObject(headers, row.map(function (celula) {
            return normalizarCelula(celula, ctxData);
          }));
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

      /**
       * Reescreve a área de dados de uma aba de projeção.
       * Escreve a partir da linha 2 explicitamente, sem depender de
       * getLastRow() logo após o clearContent() — esse valor pode não ter
       * sido reavaliado ainda e deixaria um buraco de linhas em branco.
       */
      substituirTabela: function (nome, objetos) {
        var sheet = aba(nome);
        var headers = this.cabecalhos(nome);
        var ultima = sheet.getLastRow();
        if (ultima > 1) {
          sheet.getRange(2, 1, ultima - 1, headers.length).clearContent();
        }
        if (!objetos || !objetos.length) return 0;
        var linhas = objetos.map(function (obj) {
          return headers.map(function (h) {
            var v = obj[h];
            return v === undefined || v === null ? '' : v;
          });
        });
        sheet.getRange(2, 1, linhas.length, headers.length).setValues(linhas);
        return linhas.length;
      }
    };
  }

  FOS.Adapters.criarPlanilha = criar;
  FOS.Adapters.normalizarCelula = normalizarCelula;

  /** Fábrica usada dentro do Apps Script (não executa no Node). */
  FOS.Adapters.planilhaAtiva = function () {
    if (typeof SpreadsheetApp === 'undefined') {
      FOS.Core.fail('SPREADSHEET_APP_INDISPONIVEL', 'SpreadsheetApp só existe no Apps Script');
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    return criar(ss, {
      fusoHorario: ss.getSpreadsheetTimeZone(),
      formatarData: typeof Utilities === 'undefined' ? null : Utilities.formatDate
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/adapters/drive.js ===== */
/**
 * Adaptador de arquivos (DriveApp). Único ponto que lê arquivos de extrato.
 * Contrato: lerArquivo(idOuNome) -> {nome:string, conteudo:string}
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.Adapters = FOS.Adapters || {};

  function criar(driveApp) {
    return {
      lerArquivoPorId: function (fileId) {
        var arquivo = driveApp.getFileById(fileId);
        return { nome: arquivo.getName(), conteudo: arquivo.getBlob().getDataAsString() };
      },
      lerArquivoPorNome: function (nome) {
        var iterador = driveApp.getFilesByName(nome);
        if (!iterador.hasNext()) {
          FOS.Core.fail('ARQUIVO_NAO_ENCONTRADO', 'Arquivo não encontrado no Drive: ' + nome);
        }
        var arquivo = iterador.next();
        if (iterador.hasNext()) {
          FOS.Core.fail('ARQUIVO_AMBIGUO', 'Mais de um arquivo com o nome: ' + nome);
        }
        return { nome: arquivo.getName(), conteudo: arquivo.getBlob().getDataAsString() };
      }
    };
  }

  FOS.Adapters.criarDrive = criar;

  FOS.Adapters.driveAtivo = function () {
    if (typeof DriveApp === 'undefined') {
      FOS.Core.fail('DRIVE_APP_INDISPONIVEL', 'DriveApp só existe no Apps Script');
    }
    return criar(DriveApp);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/adapters/rates.js ===== */
/**
 * Adaptador de taxa de câmbio (provedor abstrato, PTAX como implementação).
 *
 * Regras:
 *  - o provedor NUNCA inventa taxa: sem cotação para a data exata devolve null;
 *  - a única rede usada é UrlFetchApp, isolada aqui;
 *  - a resposta é normalizada para a tabela que o domínio entende.
 *
 * A URL do provedor é parâmetro de configuração (aba 00), não constante de
 * código, e nenhuma credencial é usada ou armazenada.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.Adapters = FOS.Adapters || {};

  /**
   * Provedor manual: as taxas vêm de registros já presentes na planilha.
   * É o padrão do V1 — sem rede, sem dependência externa.
   */
  function provedorManual(registros) {
    return {
      nome: 'MANUAL',
      tabela: function () { return FOS.Fx.tabelaDeRegistros(registros); }
    };
  }

  /**
   * Provedor de cache: lê as taxas já materializadas na aba 00.
   * É sempre consultado ANTES do provedor externo, para que reprocessar um
   * fechamento antigo use a mesma taxa usada na época.
   */
  function provedorCache(configRows) {
    return {
      nome: 'CACHE',
      tabela: function () { return FOS.Fx.tabelaDeCache(configRows); }
    };
  }

  /**
   * Provedor HTTP parametrizado (PTAX ou equivalente).
   *
   * Contrato de segurança:
   *  - a URL vem da configuração, nunca do código;
   *  - só aceita https;
   *  - qualquer falha (rede, HTTP != 200, corpo inesperado, estouro de
   *    tempo) devolve null + reason. Nunca inventa taxa, nunca repete a
   *    taxa de outro dia;
   *  - nenhuma credencial é enviada ou armazenada.
   *
   * @param {Object} urlFetchApp adaptador de rede
   * @param {{url:string, extrair:Function, nome?:string, timeoutMs?:number, relogio?:Object}} opcoes
   */
  function provedorHttp(urlFetchApp, opcoes) {
    var opts = opcoes || {};
    return {
      nome: opts.nome || 'PTAX',
      obter: function (moedaEstrangeira, moedaGerencial, dataIso) {
        var url = String(opts.url || '')
          .replace('{data}', encodeURIComponent(dataIso))
          .replace('{moeda}', encodeURIComponent(moedaEstrangeira))
          .replace('{moeda_gerencial}', encodeURIComponent(moedaGerencial));
        if (url.indexOf('https://') !== 0) {
          return { value: null, reason: 'PROVEDOR_URL_INVALIDA' };
        }
        var inicio = opts.relogio && opts.relogio.agoraMs ? opts.relogio.agoraMs() : null;
        var resposta;
        try {
          resposta = urlFetchApp.fetch(url, {
            method: 'get',
            muteHttpExceptions: true,
            followRedirects: false,
            validateHttpsCertificates: true
          });
        } catch (e) {
          return { value: null, reason: 'PROVEDOR_INDISPONIVEL:' + (e && e.message ? e.message : 'ERRO') };
        }
        if (inicio !== null && opts.timeoutMs) {
          var duracao = opts.relogio.agoraMs() - inicio;
          if (duracao > Number(opts.timeoutMs)) {
            return { value: null, reason: 'PROVEDOR_TEMPO_EXCEDIDO:' + duracao + 'ms' };
          }
        }
        var codigo = resposta.getResponseCode();
        if (codigo !== 200) {
          return { value: null, reason: 'PROVEDOR_HTTP_' + codigo };
        }
        var taxa;
        try {
          taxa = opts.extrair(resposta.getContentText(), dataIso);
        } catch (e2) {
          return { value: null, reason: 'PROVEDOR_RESPOSTA_INESPERADA' };
        }
        if (taxa === null || taxa === undefined || !Number.isFinite(Number(taxa)) || Number(taxa) <= 0) {
          return { value: null, reason: 'TAXA_NAO_PUBLICADA:' + dataIso };
        }
        return { value: Number(taxa), reason: null };
      }
    };
  }

  /**
   * Provedor configurado a partir da aba 00 (política do usuário).
   * Política MANUAL é o padrão do V1: nenhuma chamada externa acontece.
   */
  function provedorConfigurado(config, configRows, deps) {
    var politica = String(config.param('POLITICA_TAXA_CAMBIO').value || 'MANUAL').toUpperCase();
    var cache = provedorCache(configRows);
    if (politica !== 'HTTP') {
      return { nome: politica === 'HTTP' ? 'HTTP' : 'MANUAL', primario: cache, externo: null, politica: politica };
    }
    var url = config.param('URL_PROVEDOR_TAXA_CAMBIO').value;
    if (!url || !(deps && deps.urlFetchApp)) {
      return { nome: 'HTTP_INDISPONIVEL', primario: cache, externo: null, politica: politica };
    }
    return {
      nome: 'HTTP',
      primario: cache,
      politica: politica,
      externo: provedorHttp(deps.urlFetchApp, {
        url: url,
        nome: String(config.param('PROVEDOR_TAXA_CAMBIO').value || 'PTAX'),
        timeoutMs: config.param('TIMEOUT_PROVEDOR_TAXA_MS').value || 15000,
        relogio: deps.relogio,
        extrair: deps.extrair || function (texto) {
          var dados = JSON.parse(texto);
          return dados && dados.taxa !== undefined ? Number(dados.taxa) : null;
        }
      })
    };
  }

  /**
   * Resolve a taxa por qualquer provedor, devolvendo sempre o formato do
   * domínio ({value, status, reason, provedor, data}).
   */
  function resolverTaxa(provedor, moedaEstrangeira, moedaGerencial, dataIso) {
    if (provedor && typeof provedor.tabela === 'function') {
      return FOS.Fx.resolver(provedor.tabela(), moedaEstrangeira, moedaGerencial, dataIso, provedor.nome);
    }
    if (provedor && typeof provedor.obter === 'function') {
      var r = provedor.obter(moedaEstrangeira, moedaGerencial, dataIso);
      if (r.value === null) {
        return { value: null, status: 'NULL', reason: r.reason || 'TAXA_INDISPONIVEL', provedor: provedor.nome, data: null };
      }
      return { value: r.value, status: 'OK', reason: null, provedor: provedor.nome, data: dataIso };
    }
    return { value: null, status: 'NULL', reason: 'PROVEDOR_NAO_CONFIGURADO', provedor: null, data: null };
  }

  FOS.Adapters.provedorManual = provedorManual;
  FOS.Adapters.provedorCache = provedorCache;
  FOS.Adapters.provedorHttp = provedorHttp;
  FOS.Adapters.provedorConfigurado = provedorConfigurado;
  FOS.Adapters.resolverTaxa = resolverTaxa;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/app/repository.js ===== */
/**
 * Repositório: acesso tipado às abas internas.
 * Fica entre o adaptador de planilha (linhas cruas) e os workflows.
 * Não contém regra de negócio — apenas leitura, escrita e normalização de tipos.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.App = FOS.App || {};
  var A = FOS.Constants.ABAS_INTERNAS;

  function numerico(obj, campos) {
    campos.forEach(function (c) {
      if (obj[c] === '' || obj[c] === undefined || obj[c] === null) { obj[c] = null; return; }
      var n = FOS.Config.parseNumber(obj[c]);
      obj[c] = n === null ? obj[c] : n;
    });
    return obj;
  }

  function criar(planilha) {
    function ler(aba) {
      return planilha.lerTabela(aba).filter(function (linha) {
        // Ignora linhas totalmente vazias deixadas pela planilha.
        return Object.keys(linha).some(function (k) {
          return linha[k] !== '' && linha[k] !== null && linha[k] !== undefined;
        });
      });
    }

    return {
      planilha: planilha,

      config: function () {
        return FOS.Config.build(ler(A.CONFIG));
      },
      configLinhas: function () { return ler(A.CONFIG); },

      regras: function () {
        return ler(A.REGRAS).map(function (r) {
          return numerico(r, ['prioridade', 'versao', 'confianca']);
        });
      },

      eventos: function () {
        return ler(A.EVENTOS_MANUAIS).map(function (e) {
          return numerico(e, ['valor', 'valor_origem_moeda']);
        });
      },

      saldosTrading: function () {
        return ler(A.SALDOS_TRADING).map(function (s) { return numerico(s, ['saldo']); });
      },

      staging: function () {
        return ler(A.IMPORT_EXTRATO).map(function (l) {
          return numerico(l, ['valor', 'linha_ordinal', 'ordinal_ocorrencia']);
        });
      },

      ledger: function () {
        return ler(A.LEDGER).map(function (l) {
          return numerico(l, ['valor_origem', 'versao_gerencial', 'confianca', 'regra_versao']);
        });
      },

      fila: function () { return ler(A.FILA_REVISAO); },

      provisoes: function () {
        return ler(A.PROVISOES).map(function (p) {
          return numerico(p, ['versao', 'valor_alvo', 'valor_acumulado', 'prioridade']);
        });
      },

      objetivos: function () {
        return ler(A.OBJETIVOS).map(function (o) {
          return numerico(o, ['versao', 'valor_alvo', 'valor_acumulado', 'prioridade']);
        });
      },

      posicoes: function () {
        return ler(A.POSICOES).map(function (e) { return numerico(e, ['valor', 'quantidade']); });
      },

      fechamentos: function () {
        return ler(A.FECHAMENTOS).map(function (f) {
          return numerico(f, ['versao', 'caixa_vida_brl', 'disponivel_brl', 'runway_meses', 'patrimonio_brl_gerencial']);
        });
      },

      restatements: function () { return ler(A.RESTATEMENTS); },

      log: function () { return ler(A.LOG); },

      anexar: function (aba, objetos) {
        return planilha.anexarLinhas(aba, objetos);
      },

      substituir: function (aba, objetos) {
        return planilha.substituirTabela(aba, objetos);
      }
    };
  }

  FOS.App.criarRepositorio = criar;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/app/audit.js ===== */
/**
 * Log de auditoria (aba 90).
 * Toda ação relevante registra ANTES e DEPOIS. O log é append-only e é a
 * primeira coisa a consultar quando um número não bate.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.App = FOS.App || {};
  var A = FOS.Constants.ABAS_INTERNAS;

  var LIMITE_TEXTO = 4000;

  function serializar(valor) {
    if (valor === undefined || valor === null) return '';
    var texto = typeof valor === 'string' ? valor : FOS.Core.canonicalJson(valor);
    if (texto.length > LIMITE_TEXTO) {
      return texto.slice(0, LIMITE_TEXTO) + '...[truncado:' + texto.length + ']';
    }
    return texto;
  }

  function criar(repositorio, relogio, ator) {
    var buffer = [];
    return {
      registrar: function (registro) {
        var agora = relogio.agora();
        var linha = {
          log_id: 'LOG-' + FOS.Hash.hashParts([agora, registro.acao, registro.entidade_id, buffer.length]).slice(0, 14),
          timestamp: agora,
          ator: registro.ator || ator || 'SISTEMA',
          acao: registro.acao,
          entidade: registro.entidade,
          entidade_id: registro.entidade_id || '',
          antes: serializar(registro.antes),
          depois: serializar(registro.depois),
          resultado: registro.resultado || 'OK',
          detalhe: serializar(registro.detalhe)
        };
        buffer.push(linha);
        return linha;
      },

      /** Grava tudo o que foi acumulado. Chamado ao fim de cada workflow. */
      persistir: function () {
        if (!buffer.length) return 0;
        var escritas = repositorio.anexar(A.LOG, buffer);
        buffer = [];
        return escritas;
      },

      pendentes: function () { return buffer.slice(); }
    };
  }

  FOS.App.criarAuditoria = criar;
  FOS.App.serializarParaLog = serializar;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/app/seed.js ===== */
/**
 * Semente sintética de configuração.
 *
 * ATENÇÃO: todos os valores aqui são FICTÍCIOS e existem apenas para o
 * sistema arrancar e para os testes rodarem. Nenhum dado pessoal, saldo real,
 * conta real ou valor financeiro real do usuário entra neste repositório.
 * Em produção, estes números são editados diretamente na aba 00.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.App = FOS.App || {};
  var C = FOS.Constants;

  function parametro(chave, valor, tipo, unidade, descricao, status, reason) {
    return {
      secao: 'PARAMETRO',
      chave: chave,
      valor: status === C.STATUS_PARAMETRO.BLOQUEADO ? '' : valor,
      tipo: tipo,
      unidade: unidade || '',
      universo: '',
      modo_ingestao: '',
      moeda: '',
      ativa: '',
      elegivel_importacao: '',
      status: status || C.STATUS_PARAMETRO.ATIVO,
      reason: reason || '',
      versao: 1,
      atualizado_em: '',
      descricao: descricao || ''
    };
  }

  function conta(id, nome, universo, modo, moeda, ativa, elegivel) {
    return {
      secao: 'CONTA',
      chave: id,
      valor: nome,
      tipo: 'TEXTO',
      unidade: '',
      universo: universo,
      modo_ingestao: modo,
      moeda: moeda,
      ativa: ativa ? 'TRUE' : 'FALSE',
      elegivel_importacao: elegivel ? 'TRUE' : 'FALSE',
      status: C.STATUS_PARAMETRO.ATIVO,
      reason: '',
      versao: 1,
      atualizado_em: '',
      descricao: ''
    };
  }

  function enumRow(nome, valor) {
    return {
      secao: 'ENUM', chave: nome, valor: valor, tipo: 'TEXTO', unidade: '',
      universo: '', modo_ingestao: '', moeda: '', ativa: '', elegivel_importacao: '',
      status: C.STATUS_PARAMETRO.ATIVO, reason: '', versao: 1, atualizado_em: '', descricao: ''
    };
  }

  var PARAMETROS = [
    parametro('MOEDA_GERENCIAL', 'BRL', 'TEXTO', '', 'Moeda de consolidação gerencial.'),
    parametro('PROVEDOR_TAXA_CAMBIO', 'PTAX', 'TEXTO', '', 'Provedor abstrato de taxa; PTAX é a implementação prevista.'),
    parametro('JANELA_CONCILIACAO_DIAS', 3, 'NUMERO', 'dias', 'Janela de conciliação evento x extrato.'),
    parametro('CONFIANCA_MINIMA_CLASSIFICACAO', 0.9, 'NUMERO', '', 'Abaixo disso a linha vai para a fila de revisão.'),
    parametro('FECHAMENTOS_PARA_AVANCO_ESTADO', 2, 'NUMERO', 'fechamentos', 'Fechamentos consecutivos exigidos para avanço formal de estado.'),
    parametro('FECHAMENTOS_MINIMOS_PROVISAO', 2, 'NUMERO', 'fechamentos', 'Mínimo de histórico para avaliar ritmo de provisão.'),
    parametro('FECHAMENTOS_MINIMOS_MES_FORTE', 3, 'NUMERO', 'fechamentos', 'Mínimo de histórico para classificar mês forte.'),
    parametro('LIMITE_GASTO_EXTRAORDINARIO_PCT_CAIXA_VIDA', 0.3, 'PERCENTUAL', '', 'Limite reversível de gasto extraordinário sobre o caixa de vida.'),
    parametro('QUEDA_RUNWAY_PCT_SINAL', 0.2, 'PERCENTUAL', '', 'Queda relativa de runway que aciona o sinal.'),
    parametro('MES_FORTE_PCT_ACIMA_MEDIA', 0.2, 'PERCENTUAL', '', 'Quanto acima da média caracteriza mês forte.'),
    parametro('RUNWAY_MINIMO_ESTABILIZANDO_MESES', 1, 'NUMERO', 'meses', 'Limiar de runway para sair de FRAGIL.'),
    parametro('RUNWAY_MINIMO_ESTAVEL_MESES', 3, 'NUMERO', 'meses', 'Limiar de runway para ESTAVEL.'),
    parametro('RUNWAY_MINIMO_EXPANSAO_MESES', 6, 'NUMERO', 'meses', 'Limiar de runway para EXPANSAO.'),
    parametro('MESES_MEDIA_CUSTO_VIDA', 3, 'NUMERO', 'meses', 'Janela de média do custo de vida para o runway.'),
    parametro('CONTA_RESERVA_TRADING_BRL', 'RESERVA_BANCA_BRL', 'TEXTO', '', 'Conta da reserva de banca em BRL.'),
    parametro('SALDO_INICIAL_CAIXA_VIDA_BRL', 10000, 'NUMERO', 'BRL', 'SINTÉTICO. Substituir pelo saldo real na planilha de produção.'),
    parametro('COMPETENCIA_INICIAL_CAIXA_VIDA', '2026-01', 'TEXTO', '', 'Competência a partir da qual o ledger conta para o caixa.'),
    parametro('MAX_IDADE_VIEWMODEL_DIAS', 45, 'NUMERO', 'dias', 'Acima disso o dashboard marca o dado como STALE.'),
    parametro('POLITICA_TAXA_CAMBIO', 'MANUAL', 'TEXTO', '',
      'MANUAL usa apenas as taxas materializadas na planilha; HTTP consulta o provedor configurado.'),
    parametro('URL_PROVEDOR_TAXA_CAMBIO', '', 'TEXTO', '',
      'URL https do provedor de taxa, com {data} e {moeda}.', C.STATUS_PARAMETRO.BLOQUEADO,
      'POLITICA_MANUAL_NO_V1'),
    parametro('TIMEOUT_PROVEDOR_TAXA_MS', 15000, 'NUMERO', 'ms', 'Acima disso a consulta é tratada como indisponível.'),
    parametro('CUSTO_VIDA_ALVO_MENSAL_BRL', '', 'NUMERO', 'BRL',
      'Alvo canônico de custo de vida.', C.STATUS_PARAMETRO.BLOQUEADO,
      'AGUARDANDO_DEFINICAO_DO_USUARIO'),
    parametro('PATRIMONIO_ALVO_BRL', '', 'NUMERO', 'BRL',
      'Alvo de patrimônio.', C.STATUS_PARAMETRO.BLOQUEADO,
      'AGUARDANDO_DEFINICAO_DO_USUARIO')
  ];

  /** Catálogo de contas sintético, conforme o desenho de universos aprovado. */
  var CONTAS = [
    conta('INTER_CC', 'Inter Conta Corrente', C.UNIVERSO.VIDA, C.MODO_INGESTAO.IMPORTACAO_MENSAL, C.MOEDA.BRL, true, true),
    conta('NUBANK', 'Nubank', C.UNIVERSO.VIDA, C.MODO_INGESTAO.IMPORTACAO_MENSAL, C.MOEDA.BRL, false, false),
    conta('BETFAIR', 'Betfair', C.UNIVERSO.TRADING, C.MODO_INGESTAO.SALDO_SEMANAL, C.MOEDA.GBP, true, false),
    conta('NETELLER', 'Neteller', C.UNIVERSO.TRADING, C.MODO_INGESTAO.SALDO_SEMANAL, C.MOEDA.GBP, true, false),
    conta('WISE', 'Wise', C.UNIVERSO.TRADING, C.MODO_INGESTAO.SALDO_SEMANAL, C.MOEDA.GBP, true, false),
    conta('RESERVA_BANCA_BRL', 'Reserva de Banca BRL', C.UNIVERSO.TRADING, C.MODO_INGESTAO.SALDO_SEMANAL, C.MOEDA.BRL, true, false)
  ];

  var ENUMS = []
    .concat(C.values(C.CATEGORIA).map(function (v) { return enumRow('CATEGORIA', v); }))
    .concat(C.values(C.TIPO_EVENTO).map(function (v) { return enumRow('TIPO_EVENTO', v); }))
    .concat(C.values(C.EVENTO_POSICAO).map(function (v) { return enumRow('EVENTO_POSICAO', v); }))
    .concat(C.values(C.UNIVERSO).map(function (v) { return enumRow('UNIVERSO', v); }))
    .concat(C.values(C.ESTADO_CICLO).map(function (v) { return enumRow('ESTADO_CICLO', v); }))
    .concat(C.values(C.SINAL).map(function (v) { return enumRow('SINAL', v); }));

  function regra(id, prioridade, campo, operador, referencia, categoria, confianca, opcoes) {
    var o = opcoes || {};
    return {
      regra_id: id,
      versao: o.versao || 1,
      prioridade: prioridade,
      ativo: 'TRUE',
      campo: campo,
      operador: operador,
      valor_referencia: referencia,
      conta_escopo: o.conta_escopo || '',
      sinal_valor: o.sinal_valor || 'QUALQUER',
      categoria: categoria,
      subcategoria: o.subcategoria || '',
      universo: FOS.Rules.UNIVERSO_POR_CATEGORIA[categoria],
      confianca: confianca,
      vigente_desde: o.vigente_desde || '',
      vigente_ate: o.vigente_ate || '',
      observacao: o.observacao || 'Regra sintética de exemplo.'
    };
  }

  /**
   * Regras sintéticas. A ordem por prioridade é o que dá determinismo:
   * a fronteira Wise->Inter é reconhecida antes de qualquer regra genérica.
   */
  var REGRAS = [
    regra('R001', 10, 'descricao_normalizada', 'CONTEM', 'WISE', C.CATEGORIA.SAQUE_TRADING, 0.95,
      { sinal_valor: 'CREDITO', conta_escopo: 'INTER_CC', observacao: 'Fronteira reconhecida Wise -> Inter.' }),
    regra('R010', 20, 'descricao_normalizada', 'CONTEM', 'CORRETORA TRADING', C.CATEGORIA.CUSTO_TRADING, 0.95,
      { sinal_valor: 'DEBITO', observacao: 'Custo operacional de trading pago pela conta de vida.' }),
    regra('R011', 20, 'descricao_normalizada', 'CONTEM', 'ASSINATURA DADOS ESPORTIVOS', C.CATEGORIA.CUSTO_TRADING, 0.95,
      { sinal_valor: 'DEBITO' }),
    regra('R020', 30, 'descricao_normalizada', 'CONTEM', 'SUPERMERCADO', C.CATEGORIA.CUSTO_VIDA, 0.95,
      { sinal_valor: 'DEBITO' }),
    regra('R021', 30, 'descricao_normalizada', 'CONTEM', 'ALUGUEL', C.CATEGORIA.CUSTO_VIDA, 0.98,
      { sinal_valor: 'DEBITO' }),
    regra('R022', 30, 'descricao_normalizada', 'CONTEM', 'ENERGIA', C.CATEGORIA.CUSTO_VIDA, 0.95,
      { sinal_valor: 'DEBITO' }),
    regra('R030', 40, 'descricao_normalizada', 'CONTEM', 'TRANSFERENCIA ENTRE CONTAS PROPRIAS',
      C.CATEGORIA.TRANSFERENCIA_INTERNA, 0.95),
    regra('R040', 50, 'descricao_normalizada', 'CONTEM', 'APORTE CORRETORA PATRIMONIO',
      C.CATEGORIA.PATRIMONIO_OBJETIVOS, 0.95, { sinal_valor: 'DEBITO' }),
    regra('R050', 60, 'descricao_normalizada', 'CONTEM', 'DESPESA MEDICA', C.CATEGORIA.GASTO_EXTRAORDINARIO, 0.95,
      { sinal_valor: 'DEBITO' }),
    regra('R900', 90, 'descricao_normalizada', 'CONTEM', 'PIX RECEBIDO', C.CATEGORIA.CUSTO_VIDA, 0.4,
      { sinal_valor: 'CREDITO', observacao: 'Confiança baixa de propósito: cai na fila de revisão.' })
  ];

  FOS.App.Seed = {
    PARAMETROS: PARAMETROS,
    CONTAS: CONTAS,
    ENUMS: ENUMS,
    REGRAS: REGRAS,
    configRows: function () { return PARAMETROS.concat(CONTAS).concat(ENUMS); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/app/bootstrap.js ===== */
/**
 * Bootstrap do workbook: cria as abas visíveis e internas com os cabeçalhos
 * do schema, aplica formatação e proteção, e semeia a configuração sintética
 * quando a aba 00 está vazia. Idempotente: rodar de novo não duplica nada.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.App = FOS.App || {};
  var C = FOS.Constants;
  var A = C.ABAS_INTERNAS;
  var V = C.ABAS_VISIVEIS;

  var MOEDA = '#,##0.00';
  var NUMERO = '#,##0.00';
  var DATA = 'yyyy-mm-dd';

  /**
   * As quatro superfícies de leitura. O cabeçalho vem de Surfaces.COLUNAS
   * para que aba e construtor nunca saiam de sincronia.
   */
  var ABAS_VISIVEIS = [
    {
      nome: V.HOME,
      colunas: FOS.Surfaces.COLUNAS.HOME,
      nota: 'HOME é gerada pelo Finance OS a partir do último fechamento. '
        + 'Não edite: use o menu Finance OS para atualizar.',
      formato: {
        congelarLinhas: 1,
        congelarColunas: 2,
        larguras: [140, 300, 130, 90, 120, 260, 260],
        formatos: { valor: NUMERO },
        filtro: true
      }
    },
    {
      nome: V.MOVIMENTACOES,
      colunas: FOS.Surfaces.COLUNAS.MOVIMENTACOES,
      nota: 'Visão do ledger canônico. As colunas de origem são imutáveis; '
        + 'categoria e subcategoria mudam apenas pela fila de revisão, '
        + 'e só em competência ainda aberta.',
      formato: {
        congelarLinhas: 1,
        congelarColunas: 2,
        larguras: [100, 130, 340, 120, 70, 180, 150, 120, 140, 80, 100, 190, 120],
        formatos: { valor: MOEDA, data: DATA },
        filtro: true
      },
      protegidas: FOS.Surfaces.COLUNAS_ORIGEM_MOVIMENTACOES,
      validacoes: [{ coluna: 'categoria', valores: C.values(C.CATEGORIA) }]
    },
    {
      nome: V.PLANEJAMENTO,
      colunas: FOS.Surfaces.COLUNAS.PLANEJAMENTO,
      nota: 'Provisões e objetivos versionados. Alterações entram por evento '
        + 'manual na aba 11, nunca digitando aqui.',
      formato: {
        congelarLinhas: 1,
        congelarColunas: 2,
        larguras: [150, 280, 150, 120, 120, 120, 140, 140, 110, 90, 200],
        formatos: {
          alvo: MOEDA, acumulado: MOEDA, faltante: MOEDA,
          ritmo_necessario: MOEDA, ritmo_observado: MOEDA, vencimento: DATA
        },
        filtro: true
      }
    },
    {
      nome: V.PATRIMONIO,
      colunas: FOS.Surfaces.COLUNAS.PATRIMONIO,
      nota: 'Posições e patrimônio. O capital de Trading aparece em bloco '
        + 'próprio e nunca é somado ao patrimônio.',
      formato: {
        congelarLinhas: 1,
        congelarColunas: 2,
        larguras: [170, 260, 80, 150, 150, 170, 130, 110, 120, 200],
        formatos: {
          capital_investido: MOEDA, valor_mercado: MOEDA,
          resultado_nao_realizado: MOEDA, distribuicoes: MOEDA, snapshot: DATA
        },
        filtro: true
      }
    }
  ];

  /** Abas internas ficam ocultas por padrão: são motor, não interface. */
  var ABAS_INTERNAS_OCULTAS = [
    A.IMPORT_EXTRATO, A.REGRAS, A.LEDGER, A.PROVISOES, A.OBJETIVOS,
    A.POSICOES, A.FECHAMENTOS, A.RESTATEMENTS, A.LOG
  ];

  /** Abas internas que o usuário usa no dia a dia continuam visíveis. */
  var ABAS_INTERNAS_OPERACIONAIS = [A.CONFIG, A.EVENTOS_MANUAIS, A.SALDOS_TRADING, A.FILA_REVISAO];

  function criarEstrutura(planilha) {
    var criadas = [];
    ABAS_VISIVEIS.forEach(function (aba) {
      planilha.criarAba(aba.nome, aba.colunas);
      criadas.push(aba.nome);
    });
    FOS.Schema.nomes().forEach(function (nome) {
      planilha.criarAba(nome, FOS.Schema.get(nome).colunas);
      criadas.push(nome);
    });
    return criadas;
  }

  /** Formatação das quatro superfícies. Cosmética e idempotente. */
  function formatarSuperficies(planilha) {
    if (!planilha.formatarAba) return [];
    return ABAS_VISIVEIS.map(function (aba) {
      planilha.formatarAba(aba.nome, aba.formato);
      if (planilha.notaAba) planilha.notaAba(aba.nome, aba.nota);
      if (aba.protegidas && planilha.protegerColunas) {
        planilha.protegerColunas(aba.nome, aba.protegidas, 'origem imutável do ledger');
      }
      (aba.validacoes || []).forEach(function (v) {
        if (planilha.validarColunaPorLista) planilha.validarColunaPorLista(aba.nome, v.coluna, v.valores);
      });
      return aba.nome;
    });
  }

  /**
   * Organiza o workbook: superfícies primeiro, abas operacionais depois,
   * motor oculto. Ocultar não impede manutenção — o dono reexibe a aba
   * pelo menu do Sheets a qualquer momento.
   */
  function organizarAbas(planilha) {
    if (!planilha.ocultarAba) return [];
    var ordem = ABAS_VISIVEIS.map(function (a) { return a.nome; })
      .concat(ABAS_INTERNAS_OPERACIONAIS)
      .concat(ABAS_INTERNAS_OCULTAS);
    if (planilha.ordenarAbas) planilha.ordenarAbas(ordem);
    ABAS_INTERNAS_OCULTAS.forEach(function (nome) { planilha.ocultarAba(nome, true); });
    ABAS_INTERNAS_OPERACIONAIS.forEach(function (nome) { planilha.ocultarAba(nome, false); });
    return ordem;
  }

  /** Semeia 00 e 20 apenas se estiverem vazias (nunca sobrescreve). */
  function semear(repositorio) {
    var resultado = { config: 0, regras: 0 };
    if (!repositorio.configLinhas().length) {
      resultado.config = repositorio.anexar(A.CONFIG, FOS.App.Seed.configRows());
    }
    if (!repositorio.regras().length) {
      resultado.regras = repositorio.anexar(A.REGRAS, FOS.App.Seed.REGRAS);
    }
    return resultado;
  }

  function inicializar(deps) {
    var planilha = deps.planilha;
    var criadas = criarEstrutura(planilha);
    var repositorio = deps.repositorio || FOS.App.criarRepositorio(planilha);
    var semeadas = semear(repositorio);
    var formatadas = formatarSuperficies(planilha);
    var ordem = deps.organizar === false ? [] : organizarAbas(planilha);

    if (deps.auditoria) {
      deps.auditoria.registrar({
        acao: 'BOOTSTRAP',
        entidade: 'WORKBOOK',
        entidade_id: '',
        antes: null,
        depois: {
          abas: criadas.length,
          config_semeada: semeadas.config,
          regras_semeadas: semeadas.regras,
          superficies_formatadas: formatadas.length
        },
        resultado: 'OK',
        detalhe: 'Estrutura criada/verificada.'
      });
      deps.auditoria.persistir();
    }
    return { abas: criadas, semeadas: semeadas, formatadas: formatadas, ordem: ordem };
  }

  FOS.App.Bootstrap = {
    ABAS_VISIVEIS: ABAS_VISIVEIS,
    ABAS_INTERNAS_OCULTAS: ABAS_INTERNAS_OCULTAS,
    ABAS_INTERNAS_OPERACIONAIS: ABAS_INTERNAS_OPERACIONAIS,
    criarEstrutura: criarEstrutura,
    formatarSuperficies: formatarSuperficies,
    organizarAbas: organizarAbas,
    semear: semear,
    inicializar: inicializar
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/app/workflows.js ===== */
/**
 * Workflows: orquestração entre repositório, domínio e log de auditoria.
 * Toda escrita no workbook passa por aqui. Nenhuma regra financeira mora
 * neste arquivo — ele só coordena.
 *
 * Nenhum workflow move dinheiro, conecta conta ou chama serviço financeiro.
 * O sistema lê, classifica, concilia e congela. Ação é sempre do usuário.
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.App = FOS.App || {};
  var A = FOS.Constants.ABAS_INTERNAS;
  var C = FOS.Constants;

  /**
   * @param {Object} deps {repositorio, relogio, ator, provedorTaxa}
   */
  function criar(deps) {
    var repo = deps.repositorio;
    var relogio = deps.relogio;
    var ator = deps.ator || 'SISTEMA';
    var auditoria = deps.auditoria || FOS.App.criarAuditoria(repo, relogio, ator);

    function classificarLinhas(linhasStaging, config, regras, agora) {
      var confiancaMinima = config.param('CONFIANCA_MINIMA_CLASSIFICACAO').value;
      if (confiancaMinima === null) confiancaMinima = 0.9;
      var novasLinhasLedger = [];
      var novosItensFila = [];
      linhasStaging.forEach(function (linha) {
        var decisao = FOS.Rules.classificar(linha, regras, confiancaMinima);
        if (decisao.decidido) {
          novasLinhasLedger.push(FOS.Ledger.novaLinha(linha, decisao, agora, ator));
        } else {
          novosItensFila.push(FOS.Queue.novoItem({
            origem: C.ORIGEM_FILA.CLASSIFICACAO,
            referencia: linha.fingerprint,
            motivo: decisao.motivo,
            detalhe: linha.data + ' | ' + linha.conta_id + ' | ' + linha.valor,
            candidatos: decisao.candidatos,
            agora: agora
          }));
        }
      });
      return { linhasLedger: novasLinhasLedger, itensFila: novosItensFila };
    }

    /**
     * Importa um extrato para uma conta elegível.
     * Atômico: ou o arquivo inteiro entra, ou nada entra.
     */
    function importarExtrato(params) {
      var agora = relogio.agora();
      var config = repo.config();
      var ledgerLinhas = repo.ledger();
      var plano = FOS.Import.planejar({
        config: config,
        contaId: params.contaId,
        nomeArquivo: params.nomeArquivo,
        conteudo: params.conteudo,
        fingerprintsConhecidos: FOS.Ledger.fingerprints(ledgerLinhas)
          .concat(repo.staging().map(function (s) { return s.fingerprint; })),
        agora: agora
      });

      if (!plano.ok) {
        auditoria.registrar({
          acao: 'IMPORTAR_EXTRATO',
          entidade: A.IMPORT_EXTRATO,
          entidade_id: plano.import_id,
          antes: { linhas_ledger: ledgerLinhas.length },
          depois: { linhas_ledger: ledgerLinhas.length },
          resultado: 'REJEITADO',
          detalhe: { motivo: plano.motivo, erros: plano.erros }
        });
        auditoria.persistir();
        return { ok: false, plano: plano, escritas: 0 };
      }

      var resultado = { ok: true, plano: plano, escritas: 0, classificadas: 0, emFila: 0 };
      if (plano.novas.length) {
        var classificacao = classificarLinhas(plano.novas, config, repo.regras(), agora);
        repo.anexar(A.IMPORT_EXTRATO, plano.novas);
        repo.anexar(A.LEDGER, classificacao.linhasLedger);
        repo.anexar(A.FILA_REVISAO, classificacao.itensFila);
        resultado.escritas = plano.novas.length;
        resultado.classificadas = classificacao.linhasLedger.length;
        resultado.emFila = classificacao.itensFila.length;
      }

      auditoria.registrar({
        acao: 'IMPORTAR_EXTRATO',
        entidade: A.IMPORT_EXTRATO,
        entidade_id: plano.import_id,
        antes: { linhas_ledger: ledgerLinhas.length },
        depois: { linhas_ledger: ledgerLinhas.length + resultado.classificadas },
        resultado: plano.novas.length ? 'OK' : 'SEM_NOVIDADE',
        detalhe: {
          arquivo: plano.arquivo_nome,
          conta: plano.conta_id,
          novas: plano.novas.length,
          duplicadas: plano.duplicadas.length,
          em_fila: resultado.emFila
        }
      });
      auditoria.persistir();
      return resultado;
    }

    /**
     * Concilia eventos manuais com o ledger.
     * A conciliação vira NOVA VERSÃO da linha do ledger (append-only).
     */
    function conciliarEventos() {
      var agora = relogio.agora();
      var config = repo.config();
      var janela = config.param('JANELA_CONCILIACAO_DIAS').value;
      if (janela === null) janela = 3;
      var todasLinhas = repo.ledger();
      var correntes = FOS.Ledger.visaoCorrente(todasLinhas);
      var eventos = repo.eventos();

      var invalidos = [];
      eventos.forEach(function (e) {
        var v = FOS.Events.validar(e, config);
        if (!v.ok) invalidos.push({ evento_id: e.evento_id, erros: v.erros });
      });

      var naoConciliados = correntes.filter(function (l) { return !l.evento_conciliado_id; });
      var resultado = FOS.Matching.conciliar({
        eventos: eventos.filter(function (e) {
          return invalidos.every(function (i) { return i.evento_id !== e.evento_id; });
        }),
        linhas: naoConciliados,
        janelaDias: Number(janela),
        agora: agora
      });

      var novasVersoes = [];
      resultado.conciliacoes.forEach(function (c) {
        if (c.origem === 'JA_CONCILIADO') return;
        var atual = correntes.filter(function (l) { return l.fingerprint === c.fingerprint; })[0];
        if (!atual) return;
        var alteracoes = { evento_conciliado_id: c.evento_id };
        if (c.categoria_esperada && atual.categoria !== c.categoria_esperada) {
          alteracoes.categoria = c.categoria_esperada;
          alteracoes.universo = FOS.Rules.UNIVERSO_POR_CATEGORIA[c.categoria_esperada];
        }
        novasVersoes.push(FOS.Ledger.reclassificar(atual, alteracoes, agora, ator, 'CONCILIACAO_EVENTO'));
      });

      var filaExistente = {};
      repo.fila().forEach(function (i) { filaExistente[i.item_id] = true; });
      var itensNovos = resultado.itensFila.filter(function (i) { return !filaExistente[i.item_id]; });

      repo.anexar(A.LEDGER, novasVersoes);
      repo.anexar(A.FILA_REVISAO, itensNovos);

      auditoria.registrar({
        acao: 'CONCILIAR_EVENTOS',
        entidade: A.LEDGER,
        entidade_id: '',
        antes: { linhas: todasLinhas.length, conciliadas: correntes.length - naoConciliados.length },
        depois: { linhas: todasLinhas.length + novasVersoes.length },
        resultado: resultado.pendentes.length ? 'PARCIAL' : 'OK',
        detalhe: {
          conciliadas: novasVersoes.length,
          pendentes: resultado.pendentes,
          eventos_invalidos: invalidos
        }
      });
      auditoria.persistir();
      return {
        conciliadas: novasVersoes.length,
        pendentes: resultado.pendentes,
        itensFila: itensNovos,
        eventosInvalidos: invalidos
      };
    }

    /** Reconstrói o contexto histórico a partir dos fechamentos já gravados. */
    function historico(competencia) {
      var fechados = repo.fechamentos().filter(function (f) {
        return String(f.estado) === C.ESTADO_FECHAMENTO.FECHADO
          && String(f.competencia) < String(competencia);
      });
      var porCompetencia = {};
      fechados.forEach(function (f) {
        var atual = porCompetencia[f.competencia];
        if (!atual || Number(f.versao) > Number(atual.versao)) porCompetencia[f.competencia] = f;
      });
      var ordenados = FOS.Core.sortBy(
        Object.keys(porCompetencia).map(function (k) { return porCompetencia[k]; }),
        [function (f) { return String(f.competencia); }]
      );
      var resumos = [];
      var sugeridos = [];
      var historicoProvisoes = {};
      var historicoObjetivos = {};
      ordenados.forEach(function (f) {
        var snapshot;
        try {
          snapshot = JSON.parse(f.snapshot_json);
        } catch (e) {
          return;
        }
        var resumo = FOS.Closing.resumoParaHistorico(snapshot);
        resumos.push(resumo);
        sugeridos.push(snapshot.estado_ciclo.sugerido);
        (snapshot.provisoes || []).forEach(function (p) {
          (historicoProvisoes[p.provisao_id] = historicoProvisoes[p.provisao_id] || [])
            .push({ competencia: snapshot.competencia, valor_acumulado: p.valor_acumulado });
        });
        (snapshot.objetivos || []).forEach(function (o) {
          (historicoObjetivos[o.objetivo_id] = historicoObjetivos[o.objetivo_id] || [])
            .push({ competencia: snapshot.competencia, valor_acumulado: o.valor_acumulado });
        });
      });
      return {
        fechamentos: ordenados,
        resumos: resumos,
        sugeridos: sugeridos,
        estadoFormalAnterior: resumos.length ? resumos[resumos.length - 1].estado_formal : null,
        historicoProvisoes: historicoProvisoes,
        historicoObjetivos: historicoObjetivos,
        ultimoFechamento: ordenados.length ? ordenados[ordenados.length - 1] : null
      };
    }

    /**
     * Provedor usado para LER taxa (fechamento, painel, diagnóstico).
     * Ordem: override de teste -> tabela injetada -> cache da aba 00.
     * Nunca é o provedor externo: leitura não faz rede.
     */
    function provedorDeLeitura(config) {
      if (deps.provedorTaxa) return deps.provedorTaxa;
      if (deps.taxas) return FOS.Adapters.provedorManual(deps.taxas);
      return FOS.Adapters.provedorCache(repo.configLinhas());
    }

    function montarContexto(competencia, versao, motivoVersao) {
      var config = repo.config();
      var range = FOS.Dates.competenciaRange(competencia);
      var saldos = repo.saldosTrading();
      var posicoes = FOS.Positions.projetar(repo.posicoes(), { ateData: range.fim });
      var hist = historico(competencia);

      var moedaGerencial = config.param('MOEDA_GERENCIAL').value || C.MOEDA.BRL;
      var exposicao = saldos.some(function (s) {
        var conta = config.conta(s.conta_id);
        return conta && conta.moeda && conta.moeda !== moedaGerencial;
      }) || FOS.Positions.listar(posicoes).some(function (p) {
        return p.moeda && p.moeda !== moedaGerencial;
      });

      // O fechamento NUNCA chama a rede: ele lê a taxa já materializada na
      // aba 00 (cache). Buscar cotação é trabalho de atualizarCacheTaxas, que
      // é uma ação separada e explícita. Assim reprocessar um mês antigo usa
      // exatamente a taxa da época, e o fechamento é determinístico e offline.
      var provedor = provedorDeLeitura(config);
      var taxa = FOS.Adapters.resolverTaxa(provedor, C.MOEDA.GBP, moedaGerencial, range.fim);
      var taxaAnterior = FOS.Adapters.resolverTaxa(
        provedor, C.MOEDA.GBP, moedaGerencial,
        FOS.Dates.competenciaRange(FOS.Dates.addMonths(competencia, -1)).fim
      );

      return {
        config: config,
        competencia: competencia,
        agora: relogio.agora(),
        ator: ator,
        versao: versao || 1,
        motivoVersao: motivoVersao || 'FECHAMENTO_ORIGINAL',
        linhas: repo.ledger(),
        eventos: repo.eventos(),
        saldos: saldos,
        itensFila: repo.fila(),
        posicoes: posicoes,
        provisoesLinhas: repo.provisoes(),
        objetivosLinhas: repo.objetivos(),
        taxa: taxa,
        taxaAnterior: taxaAnterior,
        exposicaoEstrangeira: exposicao,
        fechamentosAnteriores: hist.resumos,
        sugeridosAnteriores: hist.sugeridos,
        estadoFormalAnterior: hist.estadoFormalAnterior,
        historicoProvisoes: hist.historicoProvisoes,
        historicoObjetivos: hist.historicoObjetivos,
        fechamentoAnterior: hist.ultimoFechamento,
        recalcularChecksum: FOS.Closing.checksumDaLinha
      };
    }

    /**
     * Competências com movimento no ledger, anteriores à informada, que ainda
     * não foram fechadas. Só conta a partir de COMPETENCIA_INICIAL_CAIXA_VIDA,
     * para que histórico importado de antes do início do sistema não bloqueie
     * nada para sempre.
     */
    function competenciasAnterioresEmAberto(competencia) {
      var config = repo.config();
      var inicial = config.param(FOS.Life.PARAM_COMPETENCIA_INICIAL).value;
      var fechadas = {};
      competenciasFechadas().forEach(function (c) { fechadas[c] = true; });

      var comMovimento = {};
      FOS.Ledger.visaoCorrente(repo.ledger()).forEach(function (l) {
        var comp = FOS.Dates.competenciaOf(String(l.data_origem));
        if (comp >= String(competencia)) return;
        if (inicial && comp < String(inicial)) return;
        if (fechadas[comp]) return;
        comMovimento[comp] = true;
      });
      return Object.keys(comMovimento).sort();
    }

    /** Validação sem escrita: mostra o que impede o fechamento. */
    function revisarCompetencia(competencia) {
      var ctx = montarContexto(competencia);
      var validacao = FOS.Closing.validar(ctx);
      var snapshot = FOS.Closing.montarSnapshot(ctx);
      return { validacao: validacao, snapshot: snapshot, estado: C.ESTADO_FECHAMENTO.EM_REVISAO };
    }

    /** Fecha a competência. Só grava FECHADO se todas as validações passarem. */
    function fecharCompetencia(competencia) {
      var existentes = repo.fechamentos().filter(function (f) {
        return String(f.competencia) === String(competencia);
      });
      var jaFechado = existentes.filter(function (f) {
        return String(f.estado) === C.ESTADO_FECHAMENTO.FECHADO;
      });
      if (jaFechado.length) {
        FOS.Core.fail('COMPETENCIA_JA_FECHADA',
          'Competência já fechada: ' + competencia + '. Use restatement para corrigir.');
      }

      // Fechar fora de ordem quebra o significado de "fechamentos
      // consecutivos" do estado do ciclo: o mês mais novo não enxergaria o
      // mais antigo como histórico, e o mais antigo, fechado depois, também
      // não corrigiria o que já foi congelado.
      var pendentesAnteriores = competenciasAnterioresEmAberto(competencia);
      if (pendentesAnteriores.length) {
        FOS.Core.fail('COMPETENCIA_ANTERIOR_EM_ABERTO',
          'Feche primeiro, em ordem: ' + pendentesAnteriores.join(', ')
            + '. O estado do ciclo depende de fechamentos consecutivos.',
          { competencia: competencia, pendentes: pendentesAnteriores });
      }
      var ctx = montarContexto(competencia, 1, 'FECHAMENTO_ORIGINAL');
      var resultado = FOS.Closing.fechar(ctx);

      if (resultado.validacao.ok) {
        repo.anexar(A.FECHAMENTOS, [resultado.fechamento]);
      }
      auditoria.registrar({
        acao: 'FECHAR_COMPETENCIA',
        entidade: A.FECHAMENTOS,
        entidade_id: resultado.fechamento.fechamento_id,
        antes: { estado: C.ESTADO_FECHAMENTO.ABERTO },
        depois: { estado: resultado.fechamento.estado, checksum: resultado.fechamento.checksum },
        resultado: resultado.validacao.ok ? 'FECHADO' : 'BLOQUEADO',
        detalhe: { violacoes: resultado.validacao.violacoes }
      });
      auditoria.persistir();
      return resultado;
    }

    /** Reapresenta uma competência já fechada, gerando nova versão. */
    function reapresentarCompetencia(competencia, motivo) {
      var fechamentos = repo.fechamentos();
      var origem = FOS.Restatement.versaoVigente(fechamentos, competencia);
      if (!origem) FOS.Core.fail('FECHAMENTO_INEXISTENTE', 'Sem fechamento para ' + competencia);
      var ctx = montarContexto(competencia, Number(origem.versao) + 1, 'RESTATEMENT');
      // O fechamento anterior aqui é a versão que está sendo reapresentada.
      ctx.fechamentoAnterior = origem;
      var resultadoNovo = FOS.Closing.fechar(ctx);
      if (!resultadoNovo.validacao.ok) {
        auditoria.registrar({
          acao: 'RESTATEMENT',
          entidade: A.RESTATEMENTS,
          entidade_id: origem.fechamento_id,
          antes: { versao: origem.versao, checksum: origem.checksum },
          depois: null,
          resultado: 'BLOQUEADO',
          detalhe: { violacoes: resultadoNovo.validacao.violacoes }
        });
        auditoria.persistir();
        return { ok: false, validacao: resultadoNovo.validacao };
      }

      var restatement = FOS.Restatement.criar({
        fechamentoOrigem: origem,
        resultadoNovo: resultadoNovo,
        motivo: motivo,
        agora: relogio.agora(),
        ator: ator
      });

      repo.anexar(A.FECHAMENTOS, [restatement.fechamentoNovo]);
      repo.anexar(A.RESTATEMENTS, [restatement.linhaRestatement]);
      auditoria.registrar({
        acao: 'RESTATEMENT',
        entidade: A.RESTATEMENTS,
        entidade_id: restatement.linhaRestatement.restatement_id,
        antes: { versao: origem.versao, checksum: origem.checksum },
        depois: { versao: restatement.fechamentoNovo.versao, checksum: restatement.fechamentoNovo.checksum },
        resultado: 'OK',
        detalhe: { motivo: motivo, campos_alterados: restatement.campos_alterados }
      });
      auditoria.persistir();
      return { ok: true, restatement: restatement, resultado: resultadoNovo };
    }

    /** View-model somente leitura da competência (para o dashboard da próxima onda). */
    function viewModel(competencia, opcoes) {
      var vigente = FOS.Restatement.versaoVigente(repo.fechamentos(), competencia);
      if (!vigente) return FOS.ViewModel.construir(null, {});
      var snapshot;
      try {
        snapshot = JSON.parse(vigente.snapshot_json);
      } catch (e) {
        return FOS.ViewModel.construir(null, { erro: 'SNAPSHOT_ILEGIVEL' });
      }
      var opts = opcoes || {};
      opts.agora = opts.agora || relogio.hoje();
      if (opts.maxIdadeDias === undefined) {
        var maxIdade = repo.config().param('MAX_IDADE_VIEWMODEL_DIAS').value;
        if (maxIdade !== null) opts.maxIdadeDias = Number(maxIdade);
      }
      return FOS.ViewModel.construir(snapshot, opts);
    }


    /* ---------------------------------------------------------------- */
    /* Onda 2: fluxos operacionais que fechavam o ciclo pela metade      */
    /* ---------------------------------------------------------------- */

    /** Competências já fechadas: usadas para proteger período fechado. */
    function competenciasFechadas() {
      var fechadas = {};
      repo.fechamentos().forEach(function (f) {
        if (String(f.estado) === C.ESTADO_FECHAMENTO.FECHADO) fechadas[String(f.competencia)] = true;
      });
      return Object.keys(fechadas).sort();
    }

    /**
     * Reclassificação manual de uma linha do ledger.
     * A origem é imutável (Ledger.reclassificar recusa), a competência
     * precisa estar aberta e a decisão vem SEMPRE do usuário: não existe
     * caminho aqui que escolha categoria sozinho.
     */
    function reclassificarLinha(params) {
      var agora = relogio.agora();
      var referencia = String(params.referencia || '').trim();
      var categoria = String(params.categoria || '').trim().toUpperCase();
      if (!referencia) FOS.Core.fail('REFERENCIA_OBRIGATORIA', 'Informe a referência da linha do ledger');
      if (!C.isValid(C.CATEGORIA, categoria)) {
        FOS.Core.fail('CATEGORIA_NAO_CANONICA',
          'Categoria fora do catálogo canônico: ' + params.categoria,
          { categorias: C.values(C.CATEGORIA) });
      }

      var correntes = FOS.Ledger.visaoCorrente(repo.ledger());
      var alvos = correntes.filter(function (l) {
        return String(l.fingerprint) === referencia
          || String(l.fingerprint).slice(0, 12) === referencia;
      });
      if (!alvos.length) FOS.Core.fail('LINHA_INEXISTENTE', 'Nenhuma linha do ledger com referência ' + referencia);
      if (alvos.length > 1) FOS.Core.fail('REFERENCIA_AMBIGUA', 'Mais de uma linha com a referência ' + referencia);
      var atual = alvos[0];

      var competencia = FOS.Dates.competenciaOf(String(atual.data_origem));
      if (competenciasFechadas().indexOf(competencia) !== -1) {
        FOS.Core.fail('PERIODO_FECHADO',
          'A competência ' + competencia + ' já está fechada. Use restatement para corrigi-la.',
          { competencia: competencia });
      }

      if (atual.categoria === categoria
        && String(atual.subcategoria || '') === String(params.subcategoria || '')) {
        auditoria.registrar({
          acao: 'RECLASSIFICAR_LINHA',
          entidade: A.LEDGER,
          entidade_id: atual.linha_id,
          antes: { categoria: atual.categoria, subcategoria: atual.subcategoria },
          depois: { categoria: categoria, subcategoria: params.subcategoria || '' },
          resultado: 'SEM_MUDANCA',
          detalhe: 'Reclassificação idempotente: categoria já era essa.'
        });
        auditoria.persistir();
        return { ok: true, alterado: false, linha: atual };
      }

      var nova = FOS.Ledger.reclassificar(atual, {
        categoria: categoria,
        subcategoria: params.subcategoria || '',
        universo: FOS.Rules.UNIVERSO_POR_CATEGORIA[categoria],
        regra_id: 'MANUAL',
        regra_versao: '',
        confianca: 1
      }, agora, params.ator || ator, params.motivo || 'RECLASSIFICACAO_MANUAL');

      repo.anexar(A.LEDGER, [nova]);
      auditoria.registrar({
        acao: 'RECLASSIFICAR_LINHA',
        entidade: A.LEDGER,
        entidade_id: nova.linha_id,
        antes: {
          categoria: atual.categoria, subcategoria: atual.subcategoria,
          universo: atual.universo, versao: atual.versao_gerencial
        },
        depois: {
          categoria: nova.categoria, subcategoria: nova.subcategoria,
          universo: nova.universo, versao: nova.versao_gerencial
        },
        resultado: 'OK',
        detalhe: { motivo: params.motivo || 'RECLASSIFICACAO_MANUAL', competencia: competencia }
      });
      auditoria.persistir();
      return { ok: true, alterado: true, linha: nova, versao_anterior: atual };
    }

    /**
     * Resolve um item da fila de revisão.
     * Exige escolha explícita do usuário: sem `categoria` (para item de
     * classificação) ou sem `fingerprint` (para item de conciliação) o
     * workflow recusa. Nunca deduz a resposta.
     * Idempotente: item já resolvido devolve SEM_MUDANCA sem escrever nada.
     */
    function resolverItemFila(params) {
      var agora = relogio.agora();
      var itemId = String(params.item_id || '').trim();
      var itens = repo.fila();
      var item = itens.filter(function (i) { return String(i.item_id) === itemId; })[0];
      if (!item) FOS.Core.fail('ITEM_FILA_INEXISTENTE', 'Item não encontrado na fila: ' + itemId);

      if (String(item.status) !== C.STATUS_FILA.ABERTO) {
        auditoria.registrar({
          acao: 'RESOLVER_ITEM_FILA',
          entidade: A.FILA_REVISAO,
          entidade_id: itemId,
          antes: { status: item.status },
          depois: { status: item.status },
          resultado: 'SEM_MUDANCA',
          detalhe: 'Item já estava resolvido.'
        });
        auditoria.persistir();
        return { ok: true, alterado: false, item: item };
      }

      var decisao = String(params.decisao || '').trim().toUpperCase();
      if (['CLASSIFICAR', 'CONCILIAR', 'DESCARTAR'].indexOf(decisao) === -1) {
        FOS.Core.fail('DECISAO_OBRIGATORIA',
          'Informe a decisão: CLASSIFICAR, CONCILIAR ou DESCARTAR',
          { item_id: itemId, motivo: item.motivo });
      }

      var resultadoLedger = null;
      if (decisao === 'CLASSIFICAR') {
        if (!params.categoria) {
          FOS.Core.fail('CATEGORIA_OBRIGATORIA',
            'Resolver por classificação exige a categoria escolhida pelo usuário',
            { item_id: itemId, categorias: C.values(C.CATEGORIA) });
        }
        // A linha pode nunca ter entrado no ledger (não havia regra que a
        // classificasse). Nesse caso ela entra agora, como versão 1, com a
        // categoria que o usuário escolheu.
        var jaNoLedger = FOS.Ledger.visaoCorrente(repo.ledger()).some(function (l) {
          return String(l.fingerprint) === String(item.referencia);
        });
        resultadoLedger = jaNoLedger
          ? reclassificarLinha({
            referencia: item.referencia,
            categoria: params.categoria,
            subcategoria: params.subcategoria,
            motivo: 'RESOLUCAO_FILA:' + itemId,
            ator: params.ator
          })
          : classificarPendente({
            fingerprint: item.referencia,
            categoria: params.categoria,
            subcategoria: params.subcategoria,
            motivo: 'RESOLUCAO_FILA:' + itemId,
            ator: params.ator
          });
      } else if (decisao === 'CONCILIAR') {
        if (!params.fingerprint) {
          FOS.Core.fail('FINGERPRINT_OBRIGATORIO',
            'Resolver conciliação exige a linha escolhida pelo usuário',
            { item_id: itemId, candidatos: item.candidatos });
        }
        resultadoLedger = conciliarManualmente({
          evento_id: item.referencia,
          fingerprint: params.fingerprint,
          motivo: 'RESOLUCAO_FILA:' + itemId,
          ator: params.ator
        });
      }

      var resolvido = FOS.Queue.resolver(
        item,
        decisao + (params.categoria ? ':' + params.categoria : '')
          + (params.fingerprint ? ':' + String(params.fingerprint).slice(0, 12) : ''),
        agora,
        params.ator || 'USUARIO'
      );
      // A fila é uma projeção de trabalho pendente: reescrevê-la inteira
      // mantém um item por linha, sem duplicar histórico (que vive na aba 90).
      repo.substituir(A.FILA_REVISAO, itens.map(function (i) {
        return String(i.item_id) === itemId ? resolvido : i;
      }));

      auditoria.registrar({
        acao: 'RESOLVER_ITEM_FILA',
        entidade: A.FILA_REVISAO,
        entidade_id: itemId,
        antes: { status: item.status, motivo: item.motivo, referencia: item.referencia },
        depois: { status: resolvido.status, resolucao: resolvido.resolucao },
        resultado: 'OK',
        detalhe: {
          decisao: decisao,
          ledger_alterado: resultadoLedger ? resultadoLedger.alterado : false
        }
      });
      auditoria.persistir();
      return { ok: true, alterado: true, item: resolvido, ledger: resultadoLedger };
    }

    /**
     * Classifica uma linha que está no staging (aba 10) e ainda não entrou no
     * ledger, porque nenhuma regra a cobria. A categoria vem do usuário.
     */
    function classificarPendente(params) {
      var agora = relogio.agora();
      var categoria = String(params.categoria || '').trim().toUpperCase();
      if (!C.isValid(C.CATEGORIA, categoria)) {
        FOS.Core.fail('CATEGORIA_NAO_CANONICA',
          'Categoria fora do catálogo canônico: ' + params.categoria,
          { categorias: C.values(C.CATEGORIA) });
      }
      var staging = repo.staging().filter(function (l) {
        return String(l.fingerprint) === String(params.fingerprint);
      })[0];
      if (!staging) {
        FOS.Core.fail('LINHA_INEXISTENTE',
          'Nenhuma linha em staging com fingerprint ' + params.fingerprint);
      }
      var competencia = FOS.Dates.competenciaOf(String(staging.data));
      if (competenciasFechadas().indexOf(competencia) !== -1) {
        FOS.Core.fail('PERIODO_FECHADO', 'Competência já fechada: ' + competencia);
      }

      var nova = FOS.Ledger.novaLinha(staging, {
        categoria: categoria,
        subcategoria: params.subcategoria || '',
        universo: FOS.Rules.UNIVERSO_POR_CATEGORIA[categoria],
        regra_id: 'MANUAL',
        regra_versao: '',
        confianca: 1
      }, agora, params.ator || 'USUARIO');
      nova.motivo_versao = params.motivo || 'CLASSIFICACAO_MANUAL';

      repo.anexar(A.LEDGER, [nova]);
      auditoria.registrar({
        acao: 'CLASSIFICAR_PENDENTE',
        entidade: A.LEDGER,
        entidade_id: nova.linha_id,
        antes: { categoria: null, origem: 'STAGING', fingerprint: staging.fingerprint },
        depois: { categoria: nova.categoria, universo: nova.universo, versao: 1 },
        resultado: 'OK',
        detalhe: { motivo: params.motivo || 'CLASSIFICACAO_MANUAL', competencia: competencia }
      });
      return { ok: true, alterado: true, linha: nova };
    }

    /** Conciliação escolhida à mão (sai da fila de ambiguidade). */
    function conciliarManualmente(params) {
      var agora = relogio.agora();
      var eventos = repo.eventos();
      var evento = eventos.filter(function (e) { return String(e.evento_id) === String(params.evento_id); })[0];
      if (!evento) FOS.Core.fail('EVENTO_INEXISTENTE', 'Evento não encontrado: ' + params.evento_id);

      var correntes = FOS.Ledger.visaoCorrente(repo.ledger());
      var alvos = correntes.filter(function (l) {
        return String(l.fingerprint) === String(params.fingerprint)
          || String(l.fingerprint).slice(0, 12) === String(params.fingerprint);
      });
      if (!alvos.length) FOS.Core.fail('LINHA_INEXISTENTE', 'Linha não encontrada: ' + params.fingerprint);
      var atual = alvos[0];

      if (String(atual.evento_conciliado_id || '') === String(evento.evento_id)) {
        return { ok: true, alterado: false, linha: atual };
      }
      if (atual.evento_conciliado_id) {
        FOS.Core.fail('LINHA_JA_CONCILIADA',
          'Linha já conciliada com o evento ' + atual.evento_conciliado_id);
      }
      var competencia = FOS.Dates.competenciaOf(String(atual.data_origem));
      if (competenciasFechadas().indexOf(competencia) !== -1) {
        FOS.Core.fail('PERIODO_FECHADO', 'Competência já fechada: ' + competencia);
      }

      var expectativa = FOS.Events.expectativaConciliacao(evento);
      var alteracoes = { evento_conciliado_id: evento.evento_id };
      if (expectativa && expectativa.categoria_esperada && atual.categoria !== expectativa.categoria_esperada) {
        alteracoes.categoria = expectativa.categoria_esperada;
        alteracoes.universo = FOS.Rules.UNIVERSO_POR_CATEGORIA[expectativa.categoria_esperada];
      }
      var nova = FOS.Ledger.reclassificar(atual, alteracoes, agora,
        params.ator || ator, params.motivo || 'CONCILIACAO_MANUAL');
      repo.anexar(A.LEDGER, [nova]);
      auditoria.registrar({
        acao: 'CONCILIAR_MANUALMENTE',
        entidade: A.LEDGER,
        entidade_id: nova.linha_id,
        antes: { evento_conciliado_id: atual.evento_conciliado_id || '', categoria: atual.categoria },
        depois: { evento_conciliado_id: nova.evento_conciliado_id, categoria: nova.categoria },
        resultado: 'OK',
        detalhe: { evento_id: evento.evento_id, motivo: params.motivo || 'CONCILIACAO_MANUAL' }
      });
      return { ok: true, alterado: true, linha: nova };
    }

    /**
     * Materializa eventos declarativos nos subledgers.
     *  NOVA_OBRIGACAO  -> nova versão em 30_PROVISOES
     *  NOVO_OBJETIVO   -> nova versão em 31_OBJETIVOS
     *  APORTE_POSICAO  -> evento APORTE em 32_LEDGER_POSICOES
     *  RETIRADA_POSICAO-> evento RETIRADA em 32_LEDGER_POSICOES
     * Idempotente: cada evento manual materializa no máximo uma vez, e a
     * origem do registro fica gravada em origem_evento_id / evento_id.
     */
    function materializarEventos() {
      var agora = relogio.agora();
      var config = repo.config();
      var eventos = repo.eventos();
      var provisoesLinhas = repo.provisoes();
      var objetivosLinhas = repo.objetivos();
      var posicoesLinhas = repo.posicoes();

      var provisoesNovas = [];
      var objetivosNovos = [];
      var posicoesNovas = [];
      var ignorados = [];
      var invalidos = [];

      function jaMaterializado(linhas, campo, eventoId) {
        return (linhas || []).some(function (l) { return String(l[campo] || '') === String(eventoId); });
      }

      FOS.Core.sortBy(eventos, [
        function (e) { return String(e.data); },
        function (e) { return String(e.evento_id); }
      ]).forEach(function (evento) {
        var tipo = String(evento.tipo_evento || '').toUpperCase();
        if (String(evento.status || '') === FOS.Events.STATUS_EVENTO.CANCELADO) return;
        if ([C.TIPO_EVENTO.NOVA_OBRIGACAO, C.TIPO_EVENTO.NOVO_OBJETIVO,
          C.TIPO_EVENTO.APORTE_POSICAO, C.TIPO_EVENTO.RETIRADA_POSICAO].indexOf(tipo) === -1) return;

        var validacao = FOS.Events.validar(evento, config);
        if (!validacao.ok) {
          invalidos.push({ evento_id: evento.evento_id, erros: validacao.erros });
          return;
        }
        var valor = FOS.Normalize.valor(evento.valor);
        var referencia = String(evento.referencia_id).trim();

        if (tipo === C.TIPO_EVENTO.NOVA_OBRIGACAO) {
          if (jaMaterializado(provisoesLinhas.concat(provisoesNovas), 'origem_evento_id', evento.evento_id)) {
            ignorados.push({ evento_id: evento.evento_id, motivo: 'JA_MATERIALIZADO' });
            return;
          }
          var provisaoAtual = FOS.Subledger.correntes(
            provisoesLinhas.concat(provisoesNovas), 'provisao_id'
          ).filter(function (p) { return String(p.provisao_id) === referencia; })[0];
          var novaProvisao = provisaoAtual
            ? FOS.Subledger.novaVersao(provisaoAtual, {
              valor_alvo: valor,
              vencimento: evento.data,
              origem_evento_id: evento.evento_id
            }, agora, 'NOVA_OBRIGACAO:' + evento.evento_id)
            : {
              provisao_id: referencia,
              versao: 1,
              nome: evento.descricao || referencia,
              valor_alvo: valor,
              valor_acumulado: 0,
              vencimento: evento.data,
              prioridade: FOS.Config.parseNumber(evento.observacao) || 5,
              moeda: String(evento.moeda || C.MOEDA.BRL).toUpperCase(),
              origem_evento_id: evento.evento_id,
              vigente_desde: String(evento.data),
              vigente_ate: '',
              criado_em: agora,
              motivo_versao: 'CRIADA_POR_EVENTO:' + evento.evento_id,
              observacao: ''
            };
          provisoesNovas.push(novaProvisao);
          return;
        }

        if (tipo === C.TIPO_EVENTO.NOVO_OBJETIVO) {
          if (jaMaterializado(objetivosLinhas.concat(objetivosNovos), 'origem_evento_id', evento.evento_id)) {
            ignorados.push({ evento_id: evento.evento_id, motivo: 'JA_MATERIALIZADO' });
            return;
          }
          var objetivoAtual = FOS.Subledger.correntes(
            objetivosLinhas.concat(objetivosNovos), 'objetivo_id'
          ).filter(function (o) { return String(o.objetivo_id) === referencia; })[0];
          var novoObjetivo = objetivoAtual
            ? FOS.Subledger.novaVersao(objetivoAtual, {
              valor_alvo: valor,
              prazo: evento.data,
              origem_evento_id: evento.evento_id
            }, agora, 'NOVO_OBJETIVO:' + evento.evento_id)
            : {
              objetivo_id: referencia,
              versao: 1,
              nome: evento.descricao || referencia,
              valor_alvo: valor,
              valor_acumulado: 0,
              prazo: evento.data,
              prioridade: 5,
              moeda: String(evento.moeda || C.MOEDA.BRL).toUpperCase(),
              origem_evento_id: evento.evento_id,
              vigente_desde: String(evento.data),
              vigente_ate: '',
              criado_em: agora,
              motivo_versao: 'CRIADO_POR_EVENTO:' + evento.evento_id,
              observacao: ''
            };
          objetivosNovos.push(novoObjetivo);
          return;
        }

        // APORTE_POSICAO / RETIRADA_POSICAO
        var eventoIdPosicao = 'PE-' + FOS.Hash.hashParts([evento.evento_id, tipo]).slice(0, 12);
        if (jaMaterializado(posicoesLinhas.concat(posicoesNovas), 'origem', evento.evento_id)
          || jaMaterializado(posicoesLinhas.concat(posicoesNovas), 'evento_id', eventoIdPosicao)) {
          ignorados.push({ evento_id: evento.evento_id, motivo: 'JA_MATERIALIZADO' });
          return;
        }
        posicoesNovas.push({
          evento_id: eventoIdPosicao,
          posicao_id: referencia,
          tipo_evento: tipo === C.TIPO_EVENTO.APORTE_POSICAO
            ? C.EVENTO_POSICAO.APORTE : C.EVENTO_POSICAO.RETIRADA,
          data: evento.data,
          valor: valor,
          moeda: String(evento.moeda || C.MOEDA.BRL).toUpperCase(),
          quantidade: '',
          compensa_evento_id: '',
          origem: evento.evento_id,
          criado_em: agora,
          observacao: evento.descricao || ''
        });
      });

      repo.anexar(A.PROVISOES, provisoesNovas);
      repo.anexar(A.OBJETIVOS, objetivosNovos);
      repo.anexar(A.POSICOES, posicoesNovas);

      if (provisoesNovas.length || objetivosNovos.length || posicoesNovas.length || invalidos.length) {
        auditoria.registrar({
          acao: 'MATERIALIZAR_EVENTOS',
          entidade: 'SUBLEDGERS',
          entidade_id: '',
          antes: {
            provisoes: provisoesLinhas.length,
            objetivos: objetivosLinhas.length,
            posicoes: posicoesLinhas.length
          },
          depois: {
            provisoes: provisoesLinhas.length + provisoesNovas.length,
            objetivos: objetivosLinhas.length + objetivosNovos.length,
            posicoes: posicoesLinhas.length + posicoesNovas.length
          },
          resultado: invalidos.length ? 'PARCIAL' : 'OK',
          detalhe: { ignorados: ignorados, invalidos: invalidos }
        });
        auditoria.persistir();
      }

      return {
        provisoes: provisoesNovas,
        objetivos: objetivosNovos,
        posicoes: posicoesNovas,
        ignorados: ignorados,
        invalidos: invalidos
      };
    }

    /**
     * Registro manual de evento de posição.
     * Cobre DISTRIBUICAO e SNAPSHOT_VALOR_MERCADO, que não vêm de evento
     * declarativo. Append-only: correção é sempre evento compensatório.
     */
    function registrarEventoPosicao(params) {
      var agora = relogio.agora();
      var existentes = repo.posicoes();
      var evento = {
        evento_id: String(params.evento_id || ('PM-' + FOS.Hash.hashParts([
          params.posicao_id, params.tipo_evento, params.data, params.valor
        ]).slice(0, 12))),
        posicao_id: String(params.posicao_id || ''),
        tipo_evento: String(params.tipo_evento || '').toUpperCase(),
        data: String(params.data || ''),
        valor: FOS.Normalize.valor(params.valor),
        moeda: String(params.moeda || C.MOEDA.BRL).toUpperCase(),
        quantidade: params.quantidade === undefined || params.quantidade === null ? '' : params.quantidade,
        compensa_evento_id: String(params.compensa_evento_id || ''),
        origem: params.origem || 'MANUAL',
        criado_em: agora,
        observacao: params.observacao || ''
      };

      if (existentes.some(function (e) { return String(e.evento_id) === evento.evento_id; })) {
        auditoria.registrar({
          acao: 'REGISTRAR_EVENTO_POSICAO',
          entidade: A.POSICOES,
          entidade_id: evento.evento_id,
          antes: { eventos: existentes.length },
          depois: { eventos: existentes.length },
          resultado: 'SEM_MUDANCA',
          detalhe: 'Evento de posição já registrado.'
        });
        auditoria.persistir();
        return { ok: true, alterado: false, evento: evento };
      }

      var validacao = FOS.Positions.validarEvento(evento, existentes);
      if (!validacao.ok) {
        auditoria.registrar({
          acao: 'REGISTRAR_EVENTO_POSICAO',
          entidade: A.POSICOES,
          entidade_id: evento.evento_id,
          antes: { eventos: existentes.length },
          depois: { eventos: existentes.length },
          resultado: 'REJEITADO',
          detalhe: { erros: validacao.erros }
        });
        auditoria.persistir();
        return { ok: false, alterado: false, erros: validacao.erros };
      }

      repo.anexar(A.POSICOES, [evento]);
      auditoria.registrar({
        acao: 'REGISTRAR_EVENTO_POSICAO',
        entidade: A.POSICOES,
        entidade_id: evento.evento_id,
        antes: { eventos: existentes.length },
        depois: { eventos: existentes.length + 1, tipo: evento.tipo_evento, valor: evento.valor },
        resultado: 'OK',
        detalhe: { posicao_id: evento.posicao_id, compensa: evento.compensa_evento_id || null }
      });
      auditoria.persistir();
      return { ok: true, alterado: true, evento: evento };
    }

    /** Correção de evento de posição: só por evento compensatório. */
    function compensarEventoPosicao(params) {
      var existentes = repo.posicoes();
      var original = existentes.filter(function (e) {
        return String(e.evento_id) === String(params.evento_id);
      })[0];
      if (!original) FOS.Core.fail('EVENTO_POSICAO_INEXISTENTE', 'Evento não encontrado: ' + params.evento_id);
      if (!params.motivo) FOS.Core.fail('MOTIVO_OBRIGATORIO', 'Compensação exige motivo explícito');

      var tipo = String(original.tipo_evento).toUpperCase();
      if (tipo === C.EVENTO_POSICAO.SNAPSHOT_VALOR_MERCADO) {
        if (params.valor === undefined || params.valor === null) {
          FOS.Core.fail('VALOR_OBRIGATORIO', 'Corrigir snapshot exige o novo valor de mercado');
        }
        return registrarEventoPosicao({
          posicao_id: original.posicao_id,
          tipo_evento: C.EVENTO_POSICAO.SNAPSHOT_VALOR_MERCADO,
          data: params.data || original.data,
          valor: params.valor,
          moeda: original.moeda,
          compensa_evento_id: original.evento_id,
          origem: 'COMPENSACAO',
          observacao: params.motivo
        });
      }
      var compensatorio = FOS.Positions.eventoCompensatorio(
        original,
        'PC-' + FOS.Hash.hashParts([original.evento_id, 'COMPENSA']).slice(0, 12),
        relogio.agora(),
        params.motivo
      );
      return registrarEventoPosicao(compensatorio);
    }

    /**
     * Diagnóstico de setup: o que exatamente impede o primeiro fechamento.
     * Não corrige nada — explica.
     */
    function diagnosticoSetup(competencia) {
      var config = repo.config();
      var bloqueios = [];
      var avisos = [];

      var parametrosCriticos = [
        { chave: FOS.Life.PARAM_SALDO_INICIAL, porque: 'Sem saldo inicial não há caixa de vida, disponível nem runway.' },
        { chave: FOS.Life.PARAM_COMPETENCIA_INICIAL, porque: 'Define a partir de quando o ledger conta para o caixa.' },
        { chave: 'MOEDA_GERENCIAL', porque: 'Define a moeda de consolidação do patrimônio.' },
        { chave: FOS.State.PARAM_RUNWAY_ESTABILIZANDO, porque: 'Sem limiar não há estado do ciclo.' },
        { chave: FOS.State.PARAM_RUNWAY_ESTAVEL, porque: 'Sem limiar não há estado do ciclo.' },
        { chave: FOS.State.PARAM_RUNWAY_EXPANSAO, porque: 'Sem limiar não há estado do ciclo.' },
        { chave: FOS.Signals.PARAM_LIMITE_GASTO_EXTRA, porque: 'Sem limite não há sinal de gasto extraordinário anormal.' },
        { chave: FOS.Signals.PARAM_QUEDA_RUNWAY, porque: 'Sem percentual não há sinal de queda de runway.' },
        { chave: FOS.Signals.PARAM_MES_FORTE, porque: 'Sem percentual não há leitura de mês forte.' }
      ];
      parametrosCriticos.forEach(function (p) {
        var valor = config.param(p.chave);
        if (valor.value === null) {
          bloqueios.push({
            codigo: 'PARAMETRO_INDISPONIVEL',
            chave: p.chave,
            status: valor.status,
            reason: valor.reason,
            impacto: p.porque
          });
        }
      });

      Object.keys(config.parametros).forEach(function (chave) {
        var p = config.parametros[chave];
        if (p.status === 'BLOQUEADO' && !parametrosCriticos.some(function (c) { return c.chave === chave; })) {
          avisos.push({
            codigo: 'PARAMETRO_BLOQUEADO',
            chave: chave,
            reason: p.reason,
            impacto: 'Não impede o fechamento; os cálculos que dependem dele ficam null com motivo.'
          });
        }
      });

      var contas = Object.keys(config.contas).map(function (k) { return config.contas[k]; });
      if (!contas.filter(function (c) { return FOS.Accounts.elegibilidadeImportacao(c).elegivel; }).length) {
        bloqueios.push({
          codigo: 'SEM_CONTA_ELEGIVEL',
          chave: 'CONTA',
          impacto: 'Nenhuma conta de vida ativa e elegível: não há como importar extrato.'
        });
      }
      if (!contas.filter(function (c) { return c.universo === C.UNIVERSO.TRADING && c.ativa; }).length) {
        avisos.push({
          codigo: 'SEM_CONTA_TRADING',
          chave: 'CONTA',
          impacto: 'Sem conta de trading ativa as métricas de trading ficam indisponíveis.'
        });
      }
      if (!repo.regras().length) {
        bloqueios.push({
          codigo: 'SEM_REGRAS_CLASSIFICACAO',
          chave: A.REGRAS,
          impacto: 'Sem regra nenhuma linha é classificada: tudo cairia na fila de revisão.'
        });
      }

      var validacao = null;
      if (competencia) {
        try {
          validacao = FOS.Closing.validar(montarContexto(competencia));
          validacao.violacoes.forEach(function (v) {
            bloqueios.push({
              codigo: v.codigo,
              chave: competencia,
              reason: v.detalhe,
              impacto: 'Invariante do fechamento não satisfeita.'
            });
          });
        } catch (e) {
          bloqueios.push({
            codigo: e.code || 'ERRO_DE_VALIDACAO',
            chave: competencia,
            reason: e.message,
            impacto: 'Não foi possível avaliar a competência.'
          });
        }
      }

      return {
        pronto: bloqueios.length === 0,
        competencia: competencia || null,
        bloqueios: bloqueios,
        avisos: avisos,
        validacao: validacao
      };
    }

    /**
     * Atualiza (ou cria) o cache de taxas na aba 00.
     * Com política MANUAL nada é consultado: apenas relata o que falta.
     * Nenhuma taxa é inventada em nenhuma hipótese.
     */
    function atualizarCacheTaxas(params) {
      var p = params || {};
      var agora = relogio.agora();
      var config = repo.config();
      var configRows = repo.configLinhas();
      var moedaGerencial = config.param('MOEDA_GERENCIAL').value || C.MOEDA.BRL;
      var moedaEstrangeira = p.moeda || C.MOEDA.GBP;
      var datas = p.datas || [];
      var provedor = FOS.Adapters.provedorConfigurado(config, configRows, {
        urlFetchApp: deps.urlFetchApp,
        relogio: relogio,
        extrair: deps.extrairTaxa
      });

      var novas = [];
      var faltando = [];
      datas.forEach(function (data) {
        var doCache = FOS.Adapters.resolverTaxa(provedor.primario, moedaEstrangeira, moedaGerencial, data);
        if (doCache.value !== null) return;
        if (!provedor.externo) {
          faltando.push({ data: data, reason: 'POLITICA_' + provedor.politica + '_SEM_PROVEDOR_EXTERNO' });
          return;
        }
        var externo = provedor.externo.obter(moedaEstrangeira, moedaGerencial, data);
        novas.push(FOS.Fx.linhaDeCache(moedaEstrangeira, moedaGerencial, data,
          externo.value, provedor.externo.nome, agora, externo.reason));
        if (externo.value === null) faltando.push({ data: data, reason: externo.reason });
      });

      if (novas.length) repo.anexar(A.CONFIG, novas);
      auditoria.registrar({
        acao: 'ATUALIZAR_CACHE_TAXAS',
        entidade: A.CONFIG,
        entidade_id: FOS.Fx.SECAO_TAXA,
        antes: { linhas_taxa: configRows.filter(function (r) { return r.secao === FOS.Fx.SECAO_TAXA; }).length },
        depois: { linhas_taxa: configRows.filter(function (r) { return r.secao === FOS.Fx.SECAO_TAXA; }).length + novas.length },
        resultado: faltando.length ? 'PARCIAL' : 'OK',
        detalhe: { politica: provedor.politica, datas: datas, faltando: faltando }
      });
      auditoria.persistir();
      return { politica: provedor.politica, gravadas: novas.length, faltando: faltando };
    }

    /**
     * Payload completo do painel de leitura (dashboard e abas visíveis).
     * Tudo que sai daqui passou pela allowlist do view-model.
     */
    function painel(competencia, opcoes) {
      var opts = opcoes || {};
      var fechamentos = repo.fechamentos();
      var fechados = fechamentos.filter(function (f) {
        return String(f.estado) === C.ESTADO_FECHAMENTO.FECHADO;
      });
      var alvo = competencia
        || (fechados.length
          ? FOS.Core.sortBy(fechados, [function (f) { return String(f.competencia); }])[fechados.length - 1].competencia
          : null);

      var vigente = alvo ? FOS.Restatement.versaoVigente(fechamentos, alvo) : null;
      var snapshot = null;
      var erro = null;
      if (vigente) {
        try {
          snapshot = JSON.parse(vigente.snapshot_json);
        } catch (e) {
          erro = 'SNAPSHOT_ILEGIVEL';
        }
      }

      var restatements = repo.restatements();
      var porCompetencia = {};
      restatements.forEach(function (r) { porCompetencia[String(r.competencia)] = true; });

      var historico = FOS.Core.sortBy(fechados, [
        function (f) { return String(f.competencia); },
        function (f) { return Number(f.versao); }
      ]).map(function (f) {
        return {
          competencia: f.competencia,
          versao: Number(f.versao),
          estado: f.estado,
          qualidade: f.qualidade,
          fechado_em: f.fechado_em,
          moeda_gerencial: C.MOEDA.BRL,
          caixa_vida_brl: f.caixa_vida_brl === '' ? null : f.caixa_vida_brl,
          disponivel_brl: f.disponivel_brl === '' ? null : f.disponivel_brl,
          runway_meses: f.runway_meses === '' ? null : f.runway_meses,
          patrimonio_brl_gerencial: f.patrimonio_brl_gerencial === '' ? null : f.patrimonio_brl_gerencial,
          estado_ciclo_formal: f.estado_ciclo_formal,
          estado_ciclo_sugerido: f.estado_ciclo_sugerido,
          restatement: Number(f.versao) > 1,
          motivo_versao: f.motivo_versao,
          checksum_curto: String(f.checksum || '').slice(0, 8)
        };
      });

      var bloqueios = [];
      if (opts.incluirBloqueios !== false && alvo) {
        try {
          bloqueios = diagnosticoSetup(vigente ? null : alvo).bloqueios;
        } catch (e) {
          bloqueios = [{ codigo: 'DIAGNOSTICO_INDISPONIVEL', detalhe: e.message }];
        }
      }

      var maxIdade = repo.config().param('MAX_IDADE_VIEWMODEL_DIAS').value;
      return FOS.ViewModel.construirPainel({
        snapshot: snapshot,
        erro: erro,
        agora: opts.agora || relogio.hoje(),
        maxIdadeDias: opts.maxIdadeDias === undefined
          ? (maxIdade === null ? undefined : Number(maxIdade))
          : opts.maxIdadeDias,
        historico: historico,
        restatements: restatements,
        bloqueios: bloqueios.map(function (b) {
          return { codigo: b.codigo, detalhe: b.impacto || b.reason || b.detalhe || null };
        })
      });
    }

    /**
     * Regenera as quatro abas visíveis a partir do modelo canônico.
     * Idempotente e destrutivo apenas na projeção: as abas visíveis podem
     * ser apagadas sem perda, porque a verdade está nas abas internas.
     */
    function atualizarSuperficies(competencia, opcoes) {
      var opts = opcoes || {};
      var dadosPainel = painel(competencia, opts);
      var fechadas = competenciasFechadas();

      var linhas = {
        HOME: FOS.Surfaces.home(dadosPainel),
        MOVIMENTACOES: FOS.Surfaces.movimentacoes({
          linhas: repo.ledger(),
          competenciasFechadas: fechadas
        }),
        PLANEJAMENTO: FOS.Surfaces.planejamento(dadosPainel),
        PATRIMONIO: FOS.Surfaces.patrimonio(dadosPainel)
      };

      repo.substituir(C.ABAS_VISIVEIS.HOME, linhas.HOME);
      repo.substituir(C.ABAS_VISIVEIS.MOVIMENTACOES, linhas.MOVIMENTACOES);
      repo.substituir(C.ABAS_VISIVEIS.PLANEJAMENTO, linhas.PLANEJAMENTO);
      repo.substituir(C.ABAS_VISIVEIS.PATRIMONIO, linhas.PATRIMONIO);

      if (opts.formatar !== false && repo.planilha.formatarAba) {
        FOS.App.Bootstrap.formatarSuperficies(repo.planilha);
      }

      auditoria.registrar({
        acao: 'ATUALIZAR_SUPERFICIES',
        entidade: 'ABAS_VISIVEIS',
        entidade_id: dadosPainel.atual.dados ? dadosPainel.atual.dados.competencia : '',
        antes: null,
        depois: {
          home: linhas.HOME.length,
          movimentacoes: linhas.MOVIMENTACOES.length,
          planejamento: linhas.PLANEJAMENTO.length,
          patrimonio: linhas.PATRIMONIO.length,
          status: dadosPainel.atual.status
        },
        resultado: 'OK',
        detalhe: { competencia: competencia || 'ULTIMO_FECHAMENTO' }
      });
      auditoria.persistir();
      return { painel: dadosPainel, linhas: linhas };
    }

    return {
      auditoria: auditoria,
      importarExtrato: importarExtrato,
      conciliarEventos: conciliarEventos,
      revisarCompetencia: revisarCompetencia,
      fecharCompetencia: fecharCompetencia,
      reapresentarCompetencia: reapresentarCompetencia,
      viewModel: viewModel,
      montarContexto: montarContexto,
      historico: historico,
      classificarLinhas: classificarLinhas,
      // Onda 2
      competenciasFechadas: competenciasFechadas,
      competenciasAnterioresEmAberto: competenciasAnterioresEmAberto,
      provedorDeLeitura: provedorDeLeitura,
      reclassificarLinha: reclassificarLinha,
      classificarPendente: classificarPendente,
      resolverItemFila: resolverItemFila,
      conciliarManualmente: conciliarManualmente,
      materializarEventos: materializarEventos,
      registrarEventoPosicao: registrarEventoPosicao,
      compensarEventoPosicao: compensarEventoPosicao,
      diagnosticoSetup: diagnosticoSetup,
      atualizarCacheTaxas: atualizarCacheTaxas,
      painel: painel,
      atualizarSuperficies: atualizarSuperficies
    };
  }

  FOS.App.criarWorkflows = criar;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ===== src/main.js ===== */
/**
 * Pontos de entrada do Apps Script.
 *
 * Este é o único arquivo que o Google chama diretamente. Ele monta os
 * adaptadores reais e delega para os workflows. Nada aqui decide regra.
 *
 * Limites explícitos e permanentes:
 *  - nenhuma função conecta conta bancária, corretora ou casa de apostas;
 *  - nenhuma função move dinheiro ou emite ordem;
 *  - o painel é somente leitura e não expõe nenhuma API que escreva.
 */

/* global SpreadsheetApp, HtmlService, Session, UrlFetchApp */

function _fosAmbiente() {
  var planilha = FOS.Adapters.planilhaAtiva();
  var repositorio = FOS.App.criarRepositorio(planilha);
  var relogio = FOS.Adapters.relogioReal();
  var ator = 'APPS_SCRIPT';
  var auditoria = FOS.App.criarAuditoria(repositorio, relogio, ator);
  return {
    planilha: planilha,
    repositorio: repositorio,
    relogio: relogio,
    ator: ator,
    auditoria: auditoria,
    workflows: FOS.App.criarWorkflows({
      repositorio: repositorio,
      relogio: relogio,
      ator: ator,
      auditoria: auditoria,
      urlFetchApp: typeof UrlFetchApp === 'undefined' ? null : UrlFetchApp
    })
  };
}

function _fosUi() {
  return SpreadsheetApp.getUi();
}

/** Menu curto, em linguagem humana. Toda ação é manual e explícita. */
function onOpen() {
  _fosUi()
    .createMenu('Finance OS')
    .addItem('Preparar planilha', 'fosSetup')
    .addItem('Importar extrato', 'fosImportarExtrato')
    .addItem('Revisar pendências', 'fosRevisarPendencias')
    .addItem('Registrar evento', 'fosRegistrarEvento')
    .addItem('Fechar mês', 'fosFecharMes')
    .addSeparator()
    .addItem('Abrir painel', 'fosAbrirPainel')
    .addItem('Atualizar abas', 'fosAtualizarAbas')
    .addToUi();
}

/** Preparar planilha: cria estrutura, semeia configuração e diagnostica. */
function fosSetup() {
  var amb = _fosAmbiente();
  var r = FOS.App.Bootstrap.inicializar({
    planilha: amb.planilha,
    repositorio: amb.repositorio,
    auditoria: amb.auditoria
  });
  var diag = amb.workflows.diagnosticoSetup();
  var linhas = ['Estrutura verificada: ' + r.abas.length + ' abas.'];
  if (r.semeadas.config) linhas.push('Configuração inicial semeada: ' + r.semeadas.config + ' linhas.');
  linhas.push('');
  if (diag.pronto) {
    linhas.push('Tudo pronto para o primeiro fechamento.');
  } else {
    linhas.push('Falta resolver antes do primeiro fechamento:');
    diag.bloqueios.forEach(function (b) {
      linhas.push('- ' + b.chave + ' (' + b.codigo + '): ' + b.impacto);
    });
  }
  if (diag.avisos.length) {
    linhas.push('');
    linhas.push('Avisos (não impedem o fechamento):');
    diag.avisos.forEach(function (a) {
      linhas.push('- ' + a.chave + ': ' + (a.reason || a.impacto));
    });
  }
  _fosUi().alert('Preparar planilha', linhas.join('\n'), _fosUi().ButtonSet.OK);
}

function fosImportarExtrato() {
  var ui = _fosUi();
  var conta = ui.prompt('Importar extrato', 'De qual conta? (ex.: INTER_CC)', ui.ButtonSet.OK_CANCEL);
  if (conta.getSelectedButton() !== ui.Button.OK) return;
  var arquivo = ui.prompt('Importar extrato', 'Nome do arquivo no Drive (.csv ou .ofx):', ui.ButtonSet.OK_CANCEL);
  if (arquivo.getSelectedButton() !== ui.Button.OK) return;

  var amb = _fosAmbiente();
  var lido = FOS.Adapters.driveAtivo().lerArquivoPorNome(arquivo.getResponseText().trim());
  var resultado = amb.workflows.importarExtrato({
    contaId: conta.getResponseText().trim(),
    nomeArquivo: lido.nome,
    conteudo: lido.conteudo
  });
  if (!resultado.ok) {
    ui.alert('Importação recusada',
      'Nada foi gravado.\nMotivo: ' + resultado.plano.motivo, ui.ButtonSet.OK);
    return;
  }
  amb.workflows.conciliarEventos();
  amb.workflows.materializarEventos();
  ui.alert('Importação concluída',
    'Novas movimentações: ' + resultado.plano.novas.length
    + '\nJá existentes (ignoradas): ' + resultado.plano.duplicadas.length
    + '\nPrecisam da sua revisão: ' + resultado.emFila, ui.ButtonSet.OK);
}

/** Revisar pendências: mostra a fila e explica como resolver. */
function fosRevisarPendencias() {
  var amb = _fosAmbiente();
  var abertos = FOS.Queue.abertos(amb.repositorio.fila());
  var ui = _fosUi();
  if (!abertos.length) {
    ui.alert('Revisar pendências', 'Nada pendente. A fila de revisão está vazia.', ui.ButtonSet.OK);
    return;
  }
  var item = abertos[0];
  var resposta = ui.prompt(
    'Revisar pendências (' + abertos.length + ' item(ns))',
    'Item: ' + item.item_id + '\nMotivo: ' + item.motivo + '\nDetalhe: ' + item.detalhe
      + '\n\nEscreva a categoria escolhida:\n' + FOS.Constants.values(FOS.Constants.CATEGORIA).join(', '),
    ui.ButtonSet.OK_CANCEL
  );
  if (resposta.getSelectedButton() !== ui.Button.OK) return;
  try {
    amb.workflows.resolverItemFila({
      item_id: item.item_id,
      decisao: 'CLASSIFICAR',
      categoria: resposta.getResponseText().trim().toUpperCase(),
      ator: 'USUARIO'
    });
    ui.alert('Pendência resolvida', 'Restam ' + (abertos.length - 1) + ' item(ns).', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Não foi possível resolver', e.message, ui.ButtonSet.OK);
  }
}

/** Registrar evento: materializa o que já foi declarado na aba 11. */
function fosRegistrarEvento() {
  var amb = _fosAmbiente();
  var r = amb.workflows.materializarEventos();
  var conciliacao = amb.workflows.conciliarEventos();
  _fosUi().alert('Registrar evento',
    'Provisões criadas/atualizadas: ' + r.provisoes.length
    + '\nObjetivos criados/atualizados: ' + r.objetivos.length
    + '\nEventos de posição gerados: ' + r.posicoes.length
    + '\nConciliações feitas: ' + conciliacao.conciliadas
    + (r.invalidos.length ? '\n\nEventos com erro: ' + r.invalidos.length : ''),
    _fosUi().ButtonSet.OK);
}

function fosFecharMes() {
  var ui = _fosUi();
  var resposta = ui.prompt('Fechar mês', 'Qual competência? (AAAA-MM)', ui.ButtonSet.OK_CANCEL);
  if (resposta.getSelectedButton() !== ui.Button.OK) return;
  var competencia = resposta.getResponseText().trim();
  var amb = _fosAmbiente();
  try {
    var r = amb.workflows.fecharCompetencia(competencia);
    if (r.validacao.ok) {
      amb.workflows.atualizarSuperficies(competencia);
      ui.alert('Mês fechado',
        competencia + ' está fechado e congelado.\nChecksum: ' + r.fechamento.checksum,
        ui.ButtonSet.OK);
    } else {
      ui.alert('Ainda não dá para fechar',
        'Resolva antes:\n' + r.validacao.violacoes.map(function (v) {
          return '- ' + v.codigo + (v.detalhe ? ': ' + v.detalhe : '');
        }).join('\n'), ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert('Não foi possível fechar', e.message, ui.ButtonSet.OK);
  }
}

function fosAtualizarAbas() {
  var amb = _fosAmbiente();
  var r = amb.workflows.atualizarSuperficies(null);
  _fosUi().alert('Abas atualizadas',
    'HOME, MOVIMENTAÇÕES, PLANEJAMENTO e PATRIMÔNIO foram regeradas a partir do último fechamento.'
    + '\nStatus do dado: ' + r.painel.atual.status, _fosUi().ButtonSet.OK);
}

/**
 * Monta o HTML do painel com o payload já injetado.
 * Nenhuma função do servidor fica exposta ao navegador: os dados chegam
 * embutidos e a página não tem como pedir mais nada.
 */
function _fosHtmlPainel(painel) {
  var json = JSON.stringify(painel)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  var html = HtmlService.createHtmlOutputFromFile('dashboard').getContent();
  return html.replace('/*__PAINEL__*/null', json);
}

/** Abre o painel dentro da própria planilha (sem publicar web app). */
function fosAbrirPainel() {
  var amb = _fosAmbiente();
  var painel = amb.workflows.painel(null, {});
  var saida = HtmlService.createHtmlOutput(_fosHtmlPainel(painel))
    .setTitle('Finance OS')
    .setWidth(1100)
    .setHeight(800);
  SpreadsheetApp.getUi().showModalDialog(saida, 'Finance OS');
}

/**
 * Entrada web opcional, NÃO publicada nesta entrega.
 * Se um dia for implantada, só responde ao dono da planilha: qualquer outro
 * usuário recebe uma página de acesso negado, sem dado nenhum.
 */
function doGet() {
  var autorizado = false;
  var motivo = 'ACESSO_NEGADO';
  try {
    var efetivo = Session.getEffectiveUser().getEmail();
    var ativo = Session.getActiveUser().getEmail();
    autorizado = !!efetivo && !!ativo && efetivo === ativo;
    if (!autorizado) motivo = 'USUARIO_NAO_AUTORIZADO';
  } catch (e) {
    autorizado = false;
    motivo = 'IDENTIDADE_INDISPONIVEL';
  }
  if (!autorizado) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">'
      + '<title>Finance OS</title></head><body>'
      + '<h1>Acesso negado</h1><p>' + motivo + '</p></body></html>'
    ).setTitle('Finance OS');
  }
  var amb = _fosAmbiente();
  return HtmlService.createHtmlOutput(_fosHtmlPainel(amb.workflows.painel(null, {})))
    .setTitle('Finance OS')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

