'use strict';
/**
 * Dataset sintético e reproduzível.
 *
 * TODOS os valores, contas, descrições e datas aqui são FICTÍCIOS e foram
 * escritos para exercitar as regras do sistema. Nenhum dado pessoal, saldo
 * real ou transação real do usuário existe neste repositório.
 */
const FOS = require('../_load');
const { planilhaFake } = require('./fakes');

const A = FOS.Constants.ABAS_INTERNAS;

const AGORA = '2026-05-01T12:00:00Z';

/* ------------------------------------------------------------------ */
/* Arquivos de extrato sintéticos                                      */
/* ------------------------------------------------------------------ */

const CSV_JANEIRO = [
  'data;descricao;valor',
  '05/01/2026;ALUGUEL JANEIRO;-2500,00',
  '06/01/2026;SUPERMERCADO BOM PRECO;-800,00',
  '10/01/2026;ENERGIA ELETRICA;-300,00',
  '15/01/2026;TRANSFERENCIA RECEBIDA WISE;6000,00',
  '20/01/2026;CORRETORA TRADING MENSALIDADE;-200,00'
].join('\n');

const CSV_FEVEREIRO = [
  'data;descricao;valor',
  '05/02/2026;ALUGUEL FEVEREIRO;-2500,00',
  '07/02/2026;SUPERMERCADO BOM PRECO;-900,00',
  '10/02/2026;APORTE CORRETORA PATRIMONIO;-1500,00',
  '11/02/2026;ENERGIA ELETRICA;-320,00',
  '14/02/2026;TRANSFERENCIA RECEBIDA WISE;5000,00',
  '20/02/2026;CORRETORA TRADING MENSALIDADE;-200,00'
].join('\n');

/** Duas transações legítimas idênticas no mesmo arquivo. */
const CSV_DUPLICATAS_LEGITIMAS = [
  'data;descricao;valor',
  '03/03/2026;SUPERMERCADO BOM PRECO;-120,00',
  '03/03/2026;SUPERMERCADO BOM PRECO;-120,00'
].join('\n');

/** Arquivo com uma linha inválida: a importação inteira deve ser rejeitada. */
const CSV_INVALIDO = [
  'data;descricao;valor',
  '05/03/2026;ALUGUEL MARCO;-2500,00',
  '32/03/2026;DATA IMPOSSIVEL;-100,00',
  '06/03/2026;ENERGIA ELETRICA;-300,00'
].join('\n');

const OFX_JANEIRO = [
  '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>',
  '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260105<TRNAMT>-2500.00<MEMO>ALUGUEL JANEIRO</STMTTRN>',
  '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260106<TRNAMT>-800.00<MEMO>SUPERMERCADO BOM PRECO</STMTTRN>',
  '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'
].join('\n');

/* ------------------------------------------------------------------ */
/* Saldos semanais de trading (aba 12)                                 */
/* ------------------------------------------------------------------ */

function saldo(id, data, conta, valor, moeda) {
  return {
    registro_id: id,
    data_referencia: data,
    conta_id: conta,
    saldo: valor,
    moeda: moeda,
    origem: 'MANUAL',
    registrado_em: AGORA,
    observacao: 'sintetico'
  };
}

const SALDOS_TRADING = [
  // Fechamento de dezembro (base do mês de janeiro)
  saldo('S001', '2025-12-28', 'BETFAIR', 5000, 'GBP'),
  saldo('S002', '2025-12-28', 'NETELLER', 1500, 'GBP'),
  saldo('S003', '2025-12-28', 'WISE', 500, 'GBP'),
  saldo('S004', '2025-12-28', 'RESERVA_BANCA_BRL', 20000, 'BRL'),
  // Janeiro
  saldo('S011', '2026-01-31', 'BETFAIR', 5600, 'GBP'),
  saldo('S012', '2026-01-31', 'NETELLER', 1400, 'GBP'),
  saldo('S013', '2026-01-31', 'WISE', 300, 'GBP'),
  saldo('S014', '2026-01-31', 'RESERVA_BANCA_BRL', 20500, 'BRL'),
  // Fevereiro
  saldo('S021', '2026-02-28', 'BETFAIR', 6100, 'GBP'),
  saldo('S022', '2026-02-28', 'NETELLER', 1300, 'GBP'),
  saldo('S023', '2026-02-28', 'WISE', 400, 'GBP'),
  saldo('S024', '2026-02-28', 'RESERVA_BANCA_BRL', 21000, 'BRL'),
  // Março
  saldo('S031', '2026-03-31', 'BETFAIR', 6400, 'GBP'),
  saldo('S032', '2026-03-31', 'NETELLER', 1200, 'GBP'),
  saldo('S033', '2026-03-31', 'WISE', 350, 'GBP'),
  saldo('S034', '2026-03-31', 'RESERVA_BANCA_BRL', 21200, 'BRL')
];

/* ------------------------------------------------------------------ */
/* Eventos manuais (aba 11)                                            */
/* ------------------------------------------------------------------ */

function evento(campos) {
  return Object.assign({
    evento_id: '',
    tipo_evento: '',
    data: '',
    conta_origem: '',
    conta_destino: '',
    valor: 0,
    moeda: 'BRL',
    valor_origem_moeda: '',
    moeda_origem: '',
    descricao: 'sintetico',
    referencia_id: '',
    status: 'PENDENTE',
    fingerprint_conciliado: '',
    criado_em: AGORA,
    criado_por: 'TESTE',
    observacao: ''
  }, campos);
}

const EVENTOS = [
  evento({
    evento_id: 'EV001', tipo_evento: 'SAQUE_TRADING', data: '2026-01-15',
    conta_origem: 'WISE', conta_destino: 'INTER_CC',
    valor: 6000, moeda: 'BRL', valor_origem_moeda: 1000, moeda_origem: 'GBP'
  }),
  evento({
    evento_id: 'EV002', tipo_evento: 'SAQUE_TRADING', data: '2026-02-14',
    conta_origem: 'WISE', conta_destino: 'INTER_CC',
    valor: 5000, moeda: 'BRL', valor_origem_moeda: 820, moeda_origem: 'GBP'
  }),
  evento({
    evento_id: 'EV010', tipo_evento: 'APORTE_POSICAO', data: '2026-02-10',
    conta_origem: 'INTER_CC', conta_destino: '',
    valor: 1500, moeda: 'BRL', referencia_id: 'POS_ETF'
  }),
  evento({
    evento_id: 'EV020', tipo_evento: 'NOVA_OBRIGACAO', data: '2026-01-03',
    valor: 3000, moeda: 'BRL', referencia_id: 'PROV_IPTU',
    descricao: 'IPTU sintetico com vencimento em junho'
  }),
  evento({
    evento_id: 'EV030', tipo_evento: 'NOVO_OBJETIVO', data: '2026-01-03',
    valor: 20000, moeda: 'BRL', referencia_id: 'OBJ_RESERVA',
    descricao: 'Objetivo sintetico de reserva'
  })
];

/* ------------------------------------------------------------------ */
/* Provisões e objetivos versionados (abas 30 e 31)                    */
/* ------------------------------------------------------------------ */

function provisao(id, versao, acumulado, vigenteDesde, extra) {
  return Object.assign({
    provisao_id: id,
    versao: versao,
    nome: 'IPTU sintetico',
    valor_alvo: 3000,
    valor_acumulado: acumulado,
    vencimento: '2026-06-10',
    prioridade: 1,
    moeda: 'BRL',
    origem_evento_id: 'EV020',
    vigente_desde: vigenteDesde,
    vigente_ate: '',
    criado_em: AGORA,
    motivo_versao: versao === 1 ? 'CRIACAO' : 'APORTE_MENSAL',
    observacao: ''
  }, extra || {});
}

const PROVISOES = [
  provisao('PROV_IPTU', 1, 500, '2026-01-31'),
  provisao('PROV_IPTU', 2, 1200, '2026-02-28'),
  provisao('PROV_IPTU', 3, 1900, '2026-03-31')
];

function objetivo(id, versao, acumulado, vigenteDesde) {
  return {
    objetivo_id: id,
    versao: versao,
    nome: 'Reserva sintetica',
    valor_alvo: 20000,
    valor_acumulado: acumulado,
    prazo: '2027-12-31',
    prioridade: 2,
    moeda: 'BRL',
    origem_evento_id: 'EV030',
    vigente_desde: vigenteDesde,
    vigente_ate: '',
    criado_em: AGORA,
    motivo_versao: versao === 1 ? 'CRIACAO' : 'APORTE_MENSAL',
    observacao: ''
  };
}

const OBJETIVOS = [
  objetivo('OBJ_RESERVA', 1, 1000, '2026-01-31'),
  objetivo('OBJ_RESERVA', 2, 1500, '2026-02-28'),
  objetivo('OBJ_RESERVA', 3, 2000, '2026-03-31')
];

/* ------------------------------------------------------------------ */
/* Eventos de posição (aba 32)                                         */
/* ------------------------------------------------------------------ */

function eventoPosicao(campos) {
  return Object.assign({
    evento_id: '',
    posicao_id: 'POS_ETF',
    tipo_evento: '',
    data: '',
    valor: 0,
    moeda: 'BRL',
    quantidade: '',
    compensa_evento_id: '',
    origem: 'MANUAL',
    criado_em: AGORA,
    observacao: 'sintetico'
  }, campos);
}

const POSICOES = [
  eventoPosicao({ evento_id: 'PE001', tipo_evento: 'APORTE', data: '2026-01-20', valor: 2000, quantidade: 20 }),
  eventoPosicao({ evento_id: 'PE002', tipo_evento: 'SNAPSHOT_VALOR_MERCADO', data: '2026-01-31', valor: 2050 }),
  // origem = EV010: este aporte É a materialização do evento manual APORTE_POSICAO.
  eventoPosicao({
    evento_id: 'PE003', tipo_evento: 'APORTE', data: '2026-02-10',
    valor: 1500, quantidade: 14, origem: 'EV010'
  }),
  eventoPosicao({ evento_id: 'PE004', tipo_evento: 'DISTRIBUICAO', data: '2026-02-20', valor: 30 }),
  eventoPosicao({ evento_id: 'PE005', tipo_evento: 'SNAPSHOT_VALOR_MERCADO', data: '2026-02-28', valor: 3650 }),
  eventoPosicao({ evento_id: 'PE006', tipo_evento: 'SNAPSHOT_VALOR_MERCADO', data: '2026-03-31', valor: 3720 })
];

/* ------------------------------------------------------------------ */
/* Taxas de câmbio sintéticas (provedor manual)                        */
/* ------------------------------------------------------------------ */

const TAXAS = [
  { data: '2025-12-31', moeda_estrangeira: 'GBP', moeda_gerencial: 'BRL', taxa: 6.2 },
  { data: '2026-01-31', moeda_estrangeira: 'GBP', moeda_gerencial: 'BRL', taxa: 6.3 },
  { data: '2026-02-28', moeda_estrangeira: 'GBP', moeda_gerencial: 'BRL', taxa: 6.5 },
  { data: '2026-03-31', moeda_estrangeira: 'GBP', moeda_gerencial: 'BRL', taxa: 6.4 }
];

/* ------------------------------------------------------------------ */
/* Montagem do workbook de teste                                       */
/* ------------------------------------------------------------------ */

/**
 * Cria um workbook fake já com estrutura, configuração semeada e (opcional)
 * dados sintéticos carregados.
 * @param {{comDados?:boolean, taxas?:Array, agora?:string}} [opcoes]
 */
function montarWorkbook(opcoes) {
  const opts = opcoes || {};
  const planilha = planilhaFake();
  const repositorio = FOS.App.criarRepositorio(planilha);
  const relogio = FOS.Adapters.relogioFixo(opts.agora || AGORA);
  const auditoria = FOS.App.criarAuditoria(repositorio, relogio, 'TESTE');

  FOS.App.Bootstrap.inicializar({ planilha, repositorio, auditoria });

  if (opts.comDados !== false) {
    repositorio.anexar(A.EVENTOS_MANUAIS, EVENTOS);
    repositorio.anexar(A.SALDOS_TRADING, SALDOS_TRADING);
    repositorio.anexar(A.PROVISOES, PROVISOES);
    repositorio.anexar(A.OBJETIVOS, OBJETIVOS);
    repositorio.anexar(A.POSICOES, POSICOES);
  }

  const workflows = FOS.App.criarWorkflows({
    repositorio,
    relogio,
    ator: 'TESTE',
    auditoria,
    provedorTaxa: FOS.Adapters.provedorManual(opts.taxas === undefined ? TAXAS : opts.taxas)
  });

  return { planilha, repositorio, relogio, auditoria, workflows };
}

/** Importa janeiro e fevereiro e concilia — estado base para os fechamentos. */
function workbookComMovimento(opcoes) {
  const ctx = montarWorkbook(opcoes);
  ctx.workflows.importarExtrato({
    contaId: 'INTER_CC', nomeArquivo: 'extrato-janeiro.csv', conteudo: CSV_JANEIRO
  });
  ctx.workflows.importarExtrato({
    contaId: 'INTER_CC', nomeArquivo: 'extrato-fevereiro.csv', conteudo: CSV_FEVEREIRO
  });
  ctx.workflows.conciliarEventos();
  return ctx;
}

module.exports = {
  AGORA,
  CSV_JANEIRO,
  CSV_FEVEREIRO,
  CSV_DUPLICATAS_LEGITIMAS,
  CSV_INVALIDO,
  OFX_JANEIRO,
  SALDOS_TRADING,
  EVENTOS,
  PROVISOES,
  OBJETIVOS,
  POSICOES,
  TAXAS,
  saldo,
  evento,
  provisao,
  objetivo,
  eventoPosicao,
  montarWorkbook,
  workbookComMovimento
};
