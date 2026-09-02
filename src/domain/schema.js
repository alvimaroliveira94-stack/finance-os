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
    descricao: 'Parâmetros, catálogo de contas, enums e taxas materializadas. Parâmetro bloqueado devolve null + reason.',
    chave: ['secao', 'chave'],
    colunas: [
      'secao',                  // PARAMETRO | CONTA | ENUM | TAXA
      'chave',
      'valor',
      'tipo',                   // NUMERO | TEXTO | BOOLEANO | PERCENTUAL
      'unidade',
      'universo',               // usado por secao=CONTA
      'modo_ingestao',          // usado por secao=CONTA e secao=TAXA (MANUAL | HTTP)
      'moeda',
      'ativa',                  // usado por secao=CONTA
      'elegivel_importacao',    // usado por secao=CONTA
      'status',                 // ATIVO | BLOQUEADO
      'reason',
      'versao',
      'atualizado_em',
      'descricao',
      'data_cotacao'            // usado por secao=TAXA: dia efetivo da cotação publicada
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
