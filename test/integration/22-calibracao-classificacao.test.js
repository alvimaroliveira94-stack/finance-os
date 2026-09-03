'use strict';
/**
 * Calibrar classificação: a regra nasce da decisão humana, com escopo exato.
 *
 * Dois defeitos concretos motivaram este desenho, e os dois estão testados
 * aqui como armadilhas estruturais:
 *
 * 1. **Identidade numérica não é identidade de contraparte.** Um mesmo código
 *    do extrato pode aparecer com contrapartes diferentes. Agrupar por ele
 *    juntaria pessoas distintas sob uma decisão só.
 *
 * 2. **CONTEM generaliza em silêncio.** "FULANO DE TAL" é substring de
 *    "FULANO DE TAL JUNIOR": aprovar o primeiro com CONTEM capturaria o
 *    segundo, que ninguém decidiu. Por isso a regra persistida é IGUAL sobre
 *    a assinatura inteira.
 *
 * TODO o dado deste arquivo é sintético. Nenhuma descrição, valor, conta ou
 * contraparte real do usuário existe aqui — as armadilhas foram REPRODUZIDAS
 * em nomes inventados, não copiadas.
 */
const { describe, it, assert } = globalThis.__fosTest;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');
const { uiFake } = require('../fixtures/fakes');

const C = FOS.Constants;
const A = C.ABAS_INTERNAS;
const Cal = FOS.Calibration;
const MODO = Cal.MODO;
const ESTADO = Cal.ESTADO;
const MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');

/* ------------------------------------------------------------------ */
/* Fixtures sintéticas                                                 */
/* ------------------------------------------------------------------ */

/**
 * Mês antigo: existe só para criar HISTÓRICO no ledger.
 * SICRANO recebe duas categorias diferentes (histórico instável).
 * BELTRANA recebe sempre a mesma (histórico coerente).
 */
const CSV_HISTORICO = [
  'data;descricao;valor',
  '05/01/2026;PIX ENVIADO SICRANO DE ALMEIDA;-100,00',
  '12/01/2026;PIX ENVIADO SICRANO DE ALMEIDA;-200,00',
  '15/01/2026;PIX ENVIADO BELTRANA COSTA;-300,00'
].join('\n');

/**
 * Mês corrente: as pendências a calibrar. Cada bloco é uma armadilha real.
 *  - dois códigos numéricos distintos para a MESMA contraparte;
 *  - o mesmo código numérico para contrapartes DIFERENTES;
 *  - um nome que é prefixo de outro;
 *  - a mesma contraparte nas duas direções;
 *  - duas grafias da mesma entidade;
 *  - uma assinatura com histórico instável e outra com histórico coerente.
 */
const CSV_MES = [
  'data;descricao;valor',
  '02/02/2026;PIX RECEBIDO FULANO DE TAL CP 11111111;1000,00',
  '03/02/2026;PIX RECEBIDO FULANO DE TAL CP 22222222;1200,00',
  '04/02/2026;PIX RECEBIDO FULANO DE TAL JUNIOR CP 11111111;2000,00',
  '05/02/2026;PIX ENVIADO CICLANA DA SILVA;-500,00',
  '06/02/2026;PIX RECEBIDO CICLANA DA SILVA;500,00',
  '07/02/2026;COMPRA NO DEBITO MERCADINHO XPTO;-50,00',
  '08/02/2026;COMPRA NO DEBITO MERCADINHO XPTO LTDA;-60,00',
  '09/02/2026;PIX ENVIADO SICRANO DE ALMEIDA;-150,00',
  '10/02/2026;PIX ENVIADO BELTRANA COSTA;-350,00'
].join('\n');

/** Duas saídas idênticas: um evento manual do mesmo valor fica ambíguo. */
const CSV_AMBIGUO = [
  'data;descricao;valor',
  '07/02/2026;DESPESA MEDICA CLINICA;-500,00',
  '08/02/2026;DESPESA MEDICA EXAME;-500,00'
].join('\n');

/** Mês retroativo, importado depois: exercita regra vigente vs. data antiga. */
const CSV_RETROATIVO = [
  'data;descricao;valor',
  '05/01/2026;PIX ENVIADO ZELIA MARTINS;-300,00'
].join('\n');

const CSV_ZELIA = [
  'data;descricao;valor',
  '10/02/2026;PIX ENVIADO ZELIA MARTINS;-350,00'
].join('\n');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function montar() {
  return dataset.montarWorkbook({ comDados: false });
}

function importar(ctx, nome, conteudo) {
  return ctx.workflows.importarExtrato({ contaId: 'INTER_CC', nomeArquivo: nome, conteudo: conteudo });
}

function abertos(ctx) {
  return FOS.Queue.abertos(ctx.repositorio.fila());
}

function stagingPorFingerprint(ctx) {
  const mapa = {};
  ctx.repositorio.staging().forEach((l) => { mapa[String(l.fingerprint)] = l; });
  return mapa;
}

/** Primeiro item aberto cuja linha de staging contém o trecho. */
function itemDe(ctx, trecho) {
  const mapa = stagingPorFingerprint(ctx);
  const encontrados = abertos(ctx).filter((i) => {
    const l = mapa[String(i.referencia)];
    return l && String(l.descricao_normalizada).indexOf(trecho) !== -1;
  });
  assert.ok(encontrados.length, 'esperado item aberto para "' + trecho + '"');
  return encontrados[0];
}

/** Classifica manualmente uma pendência — é assim que o histórico nasce. */
function resolverManual(ctx, trecho, categoria) {
  ctx.workflows.resolverItemFila({
    item_id: String(itemDe(ctx, trecho).item_id),
    decisao: 'CLASSIFICAR',
    categoria: categoria,
    ator: 'USUARIO'
  });
}

/** Linha corrente do ledger por data de origem. */
function linhaEm(ctx, data) {
  const linhas = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
    .filter((l) => String(l.data_origem) === data);
  assert.equal(linhas.length, 1, 'esperada uma linha no ledger em ' + data);
  return linhas[0];
}

/** Workbook com histórico já formado e o mês corrente pendente. */
function comHistoricoEMesCorrente() {
  const ctx = montar();
  importar(ctx, 'historico.csv', CSV_HISTORICO);
  // Duas decisões diferentes para a mesma assinatura: instabilidade semântica.
  resolverManual(ctx, 'SICRANO DE ALMEIDA', 'CUSTO_VIDA');
  resolverManual(ctx, 'SICRANO DE ALMEIDA', 'GASTO_EXTRAORDINARIO');
  resolverManual(ctx, 'BELTRANA COSTA', 'CUSTO_VIDA');
  importar(ctx, 'mes.csv', CSV_MES);
  return ctx;
}

function grupoDe(ctx, chave) {
  const g = ctx.workflows.gruposDeCalibracao().filter((x) => x.chave === chave)[0];
  assert.ok(g, 'grupo esperado: ' + chave);
  return g;
}

function regrasCal(ctx) {
  return ctx.repositorio.regras().filter((r) => String(r.regra_id).indexOf(Cal.PREFIXO_ID) === 0);
}

function categoriaDe(ctx, trecho) {
  const linhas = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
    .filter((l) => FOS.Normalize.descricao(l.descricao_origem).indexOf(trecho) !== -1);
  assert.ok(linhas.length, 'esperada linha no ledger para "' + trecho + '"');
  return linhas[0];
}

/**
 * Roda o comando real de main.js contra um workbook em memória.
 * Os dois únicos pontos de plataforma (`_fosUi` e `_fosAmbiente`) são
 * substituídos; todo o resto do comando é o código que vai para produção.
 */
function rodarComando(ctx, respostas) {
  const sandbox = vm.createContext({ FOS, console });
  vm.runInContext(MAIN, sandbox, { filename: 'main.js' });
  const ui = uiFake(respostas);
  sandbox._fosUi = () => ui;
  sandbox._fosAmbiente = () => ({
    planilha: ctx.planilha,
    repositorio: ctx.repositorio,
    relogio: ctx.relogio,
    ator: 'APPS_SCRIPT',
    auditoria: ctx.auditoria,
    workflows: ctx.workflows
  });
  sandbox.fosCalibrarClassificacao();
  return ui;
}

/** Tudo que o comando poderia ter escrito, em texto estável. */
function retrato(ctx) {
  return JSON.stringify({
    fila: ctx.repositorio.fila(),
    ledger: ctx.repositorio.ledger(),
    regras: ctx.repositorio.regras()
  });
}

/** Diálogos de decisão (o de escopo tem título próprio). */
function decisoes(ui) {
  return ui.prompts('Calibrar classificação');
}

const S = {
  FULANO: 'PIX RECEBIDO | FULANO DE TAL | ENTRA',
  JUNIOR: 'PIX RECEBIDO | FULANO DE TAL JUNIOR | ENTRA',
  CICLANA_SAI: 'PIX ENVIADO | CICLANA DA SILVA | SAI',
  CICLANA_ENTRA: 'PIX RECEBIDO | CICLANA DA SILVA | ENTRA',
  MERCADINHO: 'COMPRA NO DEBITO | MERCADINHO XPTO | SAI',
  MERCADINHO_LTDA: 'COMPRA NO DEBITO | MERCADINHO XPTO LTDA | SAI',
  SICRANO: 'PIX ENVIADO | SICRANO DE ALMEIDA | SAI',
  BELTRANA: 'PIX ENVIADO | BELTRANA COSTA | SAI',
  ZELIA: 'PIX ENVIADO | ZELIA MARTINS | SAI'
};

/* ------------------------------------------------------------------ */
/* Assinatura                                                          */
/* ------------------------------------------------------------------ */

describe('Calibração: assinatura segura', () => {
  it('nenhum dígito entra na chave: dois códigos, uma contraparte',
    { scenario: 'C53' }, () => {
      const a = Cal.assinatura({ descricao_normalizada: 'PIX RECEBIDO FULANO DE TAL CP 11111111', valor: 1000 });
      const b = Cal.assinatura({ descricao_normalizada: 'PIX RECEBIDO FULANO DE TAL CP 22222222', valor: 1200 });
      assert.equal(a.chave, S.FULANO);
      assert.equal(b.chave, a.chave, 'o código do extrato não pode separar a mesma contraparte');
      assert.equal(a.contraparte, 'FULANO DE TAL');
    });

  it('o mesmo código com contrapartes diferentes produz assinaturas diferentes',
    { scenario: 'C53' }, () => {
      const a = Cal.assinatura({ descricao_normalizada: 'PIX RECEBIDO FULANO DE TAL CP 11111111', valor: 1000 });
      const b = Cal.assinatura({ descricao_normalizada: 'PIX RECEBIDO FULANO DE TAL JUNIOR CP 11111111', valor: 2000 });
      assert.notEqual(a.chave, b.chave,
        'código numérico compartilhado jamais pode fundir contrapartes distintas');
      assert.equal(b.chave, S.JUNIOR);
    });

  it('ruído estrutural sai por palavra inteira, sem mutilar nomes',
    { scenario: 'C53' }, () => {
      assert.equal(
        Cal.assinatura({ descricao_normalizada: 'COMPRA NO DEBITO NO ESTABELECIMENTO PADARIA CENTRAL', valor: -30 }).contraparte,
        'PADARIA CENTRAL');
      assert.equal(
        Cal.assinatura({ descricao_normalizada: 'PIX ENVIADO CPFL ENERGIA', valor: -80 }).contraparte,
        'CPFL ENERGIA', 'recortar "CP" como substring inventaria uma contraparte');
    });

  it('a mesma contraparte em direções opostas são duas decisões',
    { scenario: 'C53' }, () => {
      const sai = Cal.assinatura({ descricao_normalizada: 'PIX ENVIADO CICLANA DA SILVA', valor: -500 });
      const entra = Cal.assinatura({ descricao_normalizada: 'PIX RECEBIDO CICLANA DA SILVA', valor: 500 });
      assert.equal(sai.chave, S.CICLANA_SAI);
      assert.equal(entra.chave, S.CICLANA_ENTRA);
      assert.notEqual(sai.chave, entra.chave);
    });

  it('duas grafias da mesma entidade não são fundidas por conta própria',
    { scenario: 'C53' }, () => {
      assert.notEqual(
        Cal.assinatura({ descricao_normalizada: 'COMPRA NO DEBITO MERCADINHO XPTO', valor: -50 }).chave,
        Cal.assinatura({ descricao_normalizada: 'COMPRA NO DEBITO MERCADINHO XPTO LTDA', valor: -60 }).chave,
        'fundir grafias é decisão humana, não inferência do sistema');
    });

  it('descrição sem tipo conhecido continua exata, sob OUTRO',
    { scenario: 'C53' }, () => {
      const a = Cal.assinatura({ descricao_normalizada: 'LOJA DESCONHECIDA XPTO', valor: -430 });
      assert.equal(a.tipo, 'OUTRO');
      assert.equal(a.chave, 'OUTRO | LOJA DESCONHECIDA XPTO | SAI');
    });

  it('a assinatura de uma linha do ledger é recomputada da descrição de origem',
    { scenario: 'C53' }, () => {
      const ctx = montar();
      importar(ctx, 'mes.csv', CSV_MES);
      const staging = ctx.repositorio.staging()
        .filter((l) => l.descricao_normalizada.indexOf('SICRANO') !== -1)[0];
      resolverManual(ctx, 'SICRANO DE ALMEIDA', 'CUSTO_VIDA');
      const linha = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
        .filter((l) => String(l.fingerprint) === String(staging.fingerprint))[0];

      assert.ok(linha, 'a linha precisa existir no ledger');
      assert.equal(linha.descricao_normalizada, undefined,
        'o ledger não guarda a descrição normalizada: a assinatura é derivada');
      assert.equal(Cal.assinatura(linha).chave, Cal.assinatura(staging).chave);
      assert.equal(Cal.assinatura(linha).chave, S.SICRANO);
    });
});

/* ------------------------------------------------------------------ */
/* Grupos                                                              */
/* ------------------------------------------------------------------ */

describe('Calibração: grupos da fila', () => {
  it('agrupa as pendências abertas por assinatura, com soma e exemplos',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();
      const grupos = ctx.workflows.gruposDeCalibracao();
      assert.deep(grupos.map((g) => g.chave).sort(), [
        S.MERCADINHO, S.MERCADINHO_LTDA, S.BELTRANA, S.SICRANO,
        S.CICLANA_SAI, S.CICLANA_ENTRA, S.FULANO, S.JUNIOR
      ].sort());

      const fulano = grupoDe(ctx, S.FULANO);
      assert.equal(fulano.quantidade, 2, 'os dois códigos são a mesma contraparte');
      assert.equal(fulano.soma, 2200);
      assert.equal(fulano.data_min, '2026-02-02');
      assert.equal(fulano.exemplos.length, 2);
      assert.deep(Object.keys(fulano.observado).sort(), ['11111111', '22222222'],
        'os códigos aparecem como contexto da decisão, nunca como chave');
      assert.equal(grupos[0].quantidade, 2, 'o maior grupo vem primeiro');
    });

  it('itens de conciliação não entram: a pergunta deles é outra',
    { scenario: 'C53' }, () => {
      const ctx = montar();
      ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
        evento_id: 'EV-AMB', tipo_evento: 'GASTO_EXTRAORDINARIO', data: '2026-02-07',
        conta_origem: 'INTER_CC', valor: 500, moeda: 'BRL', descricao: 'sintetico'
      })]);
      importar(ctx, 'mes.csv', CSV_AMBIGUO);
      ctx.workflows.conciliarEventos();

      const origens = abertos(ctx).map((i) => String(i.origem));
      assert.ok(origens.indexOf('CONCILIACAO') !== -1, 'o cenário precisa ter item de conciliação');
      const itensDeGrupo = {};
      ctx.workflows.gruposDeCalibracao().forEach((g) => {
        g.itens.forEach((id) => { itensDeGrupo[id] = true; });
      });
      abertos(ctx).filter((i) => String(i.origem) === 'CONCILIACAO').forEach((i) => {
        assert.notOk(itensDeGrupo[String(i.item_id)],
          'item de conciliação não pode virar grupo de calibração');
      });
    });

  it('cada grupo traz a evidência histórica que decide se pode virar regra',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();

      const inedito = grupoDe(ctx, S.FULANO);
      assert.equal(inedito.estabilidade.estado, ESTADO.INEDITO);
      assert.equal(inedito.estabilidade.ocorrencias, 0);
      assert.equal(inedito.pode_aprender, true);

      const coerente = grupoDe(ctx, S.BELTRANA);
      assert.equal(coerente.estabilidade.estado, ESTADO.COERENTE);
      assert.equal(coerente.estabilidade.ocorrencias, 1);
      assert.equal(coerente.estabilidade.categoria, 'CUSTO_VIDA');
      assert.equal(coerente.pode_aprender, true);

      const instavel = grupoDe(ctx, S.SICRANO);
      assert.equal(instavel.estabilidade.estado, ESTADO.INSTAVEL);
      assert.equal(instavel.estabilidade.ocorrencias, 2);
      assert.isNull(instavel.estabilidade.categoria);
      assert.equal(instavel.pode_aprender, false,
        'padrão semanticamente instável não pode virar regra automática');
    });
});

/* ------------------------------------------------------------------ */
/* Os três modos                                                       */
/* ------------------------------------------------------------------ */

describe('Calibração: três modos explícitos', () => {
  it('a gramática torna a persistência a opção mais cara de digitar',
    { scenario: 'C53' }, () => {
      const grupo = { chave: S.FULANO, regra_vigente: null };
      assert.deep(Cal.interpretarResposta(grupo, 'pular').decisao,
        { chave: S.FULANO, categoria: null, modo: MODO.PULAR });
      assert.deep(Cal.interpretarResposta(grupo, 'custo_vida').decisao,
        { chave: S.FULANO, categoria: 'CUSTO_VIDA', modo: MODO.SO_AGORA });
      assert.deep(Cal.interpretarResposta(grupo, 'custo_vida aprender').decisao,
        { chave: S.FULANO, categoria: 'CUSTO_VIDA', modo: MODO.APRENDER, confirmouCorrecao: false });

      assert.notOk(Cal.interpretarResposta(grupo, '').ok);
      assert.includes(Cal.interpretarResposta(grupo, 'custo de vida').erro, 'CATEGORIA_NAO_CANONICA');
      assert.includes(Cal.interpretarResposta(grupo, 'custo_vida sempre').erro, 'MODO_DESCONHECIDO');
      assert.includes(Cal.interpretarResposta(grupo, 'custo_vida corrigir').erro,
        'SEM_REGRA_VIGENTE_PARA_CORRIGIR');
    });

  it('CORRIGIR só é aceito quando existe regra vigente para a assinatura',
    { scenario: 'C53' }, () => {
      const grupo = { chave: S.FULANO, regra_vigente: { regra_id: 'CAL-0001', versao: 1, categoria: 'CUSTO_VIDA' } };
      assert.deep(Cal.interpretarResposta(grupo, 'transferencia_interna CORRIGIR').decisao, {
        chave: S.FULANO, categoria: 'TRANSFERENCIA_INTERNA',
        modo: MODO.APRENDER, confirmouCorrecao: true
      });
    });

  it('classificar não é aprender: só agora resolve o mês e não cria regra',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();
      const antes = ctx.repositorio.regras().length;
      const r = ctx.workflows.calibrarClassificacao({
        decisoes: [{ chave: S.FULANO, categoria: 'TRANSFERENCIA_INTERNA', modo: MODO.SO_AGORA }],
        ator: 'USUARIO'
      });

      assert.equal(r.aprendidas.length, 0);
      assert.equal(r.resolvidosSoAgora.length, 2);
      assert.equal(ctx.repositorio.regras().length, antes, 'nenhuma regra pode nascer sem APRENDER');
      const linha = categoriaDe(ctx, 'FULANO DE TAL CP 11111111');
      assert.equal(linha.categoria, 'TRANSFERENCIA_INTERNA');
      assert.equal(linha.regra_id, 'MANUAL',
        'sem regra, a procedência é a decisão humana');
    });

  it('PULAR não altera nada', { scenario: 'C53' }, () => {
    const ctx = comHistoricoEMesCorrente();
    const regrasAntes = ctx.repositorio.regras().length;
    const abertosAntes = abertos(ctx).length;
    const r = ctx.workflows.calibrarClassificacao({
      decisoes: [{ chave: S.FULANO, categoria: null, modo: MODO.PULAR }],
      ator: 'USUARIO'
    });
    assert.deep(r.ignoradas, [{ chave: S.FULANO, motivo: 'PULADO' }]);
    assert.equal(ctx.repositorio.regras().length, regrasAntes);
    assert.equal(abertos(ctx).length, abertosAntes);
  });

  it('aprender cria a regra, resolve o grupo e registra a procedência no ledger',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();
      const r = ctx.workflows.calibrarClassificacao({
        decisoes: [{ chave: S.FULANO, categoria: 'TRANSFERENCIA_INTERNA', modo: MODO.APRENDER }],
        ator: 'USUARIO'
      });

      assert.equal(r.aprendidas.length, 1);
      assert.equal(r.aprendidas[0].resultado, 'CRIADA');
      assert.equal(r.resolvidosPorRegra.length, 2, 'a própria regra resolve as pendências que a originaram');
      assert.equal(r.resolvidosSoAgora.length, 0);

      const regras = regrasCal(ctx);
      assert.equal(regras.length, 1);
      assert.equal(regras[0].regra_id, 'CAL-0001');
      assert.equal(Number(regras[0].versao), 1);
      assert.equal(regras[0].campo, 'assinatura');
      assert.equal(regras[0].operador, 'IGUAL');
      assert.equal(regras[0].valor_referencia, S.FULANO);
      assert.equal(Number(regras[0].prioridade), Cal.PRIORIDADE);
      assert.equal(Number(regras[0].confianca), 1);
      assert.equal(regras[0].sinal_valor, 'CREDITO');
      assert.equal(regras[0].vigente_desde, '2026-02-02',
        'a regra nasce das linhas do grupo: vigência começa na mais antiga delas');

      const linha = categoriaDe(ctx, 'FULANO DE TAL CP 22222222');
      assert.equal(linha.categoria, 'TRANSFERENCIA_INTERNA');
      assert.equal(linha.regra_id, 'CAL-0001');
      assert.equal(Number(linha.regra_versao), 1);
    });
});

/* ------------------------------------------------------------------ */
/* Escopo exato                                                        */
/* ------------------------------------------------------------------ */

describe('Calibração: escopo exato', () => {
  it('aprovar um grupo não alcança o nome que o contém', { scenario: 'C53' }, () => {
    const ctx = comHistoricoEMesCorrente();
    ctx.workflows.calibrarClassificacao({
      decisoes: [{ chave: S.FULANO, categoria: 'TRANSFERENCIA_INTERNA', modo: MODO.APRENDER }],
      ator: 'USUARIO'
    });

    const restantes = ctx.workflows.gruposDeCalibracao().map((g) => g.chave);
    assert.includes(restantes, S.JUNIOR,
      'FULANO DE TAL JUNIOR não foi decidido por ninguém e precisa continuar pendente');
    assert.equal(FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
      .filter((l) => FOS.Normalize.descricao(l.descricao_origem).indexOf('JUNIOR') !== -1).length, 0);
  });

  it('a mesma decisão com CONTEM capturaria o vizinho: é o defeito que IGUAL evita',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();
      const alvo = ctx.repositorio.staging()
        .filter((l) => l.descricao_normalizada.indexOf('JUNIOR') !== -1)[0];

      const igual = Cal.linhaDeRegra({
        regraId: 'X', versao: 1, chave: S.FULANO, direcao: 'ENTRA',
        categoria: 'TRANSFERENCIA_INTERNA', agora: dataset.AGORA, desde: '2026-02-02'
      });
      const contem = Object.assign({}, igual, {
        campo: 'descricao_normalizada', operador: 'CONTEM', valor_referencia: 'FULANO DE TAL'
      });

      assert.notOk(FOS.Rules.classificar(alvo, [igual], 0.9).decidido,
        'IGUAL sobre a assinatura não alcança o vizinho');
      assert.ok(FOS.Rules.classificar(alvo, [contem], 0.9).decidido,
        'CONTEM alcançaria — este é exatamente o risco recusado');
    });

  it('o portão recusa regra que alcance mais pendências que o grupo aprovado',
    { scenario: 'C53' }, () => {
      const veredito = Cal.avaliarPersistencia({
        modo: MODO.APRENDER, grupo: { quantidade: 1 }, categoria: 'CUSTO_VIDA',
        casados: 28, estabilidade: { estado: ESTADO.INEDITO }, vigentes: []
      });
      assert.notOk(veredito.ok);
      assert.includes(veredito.motivo, 'ESCOPO_MAIOR_QUE_O_GRUPO');
    });

  it('linha já classificada é histórico, não escopo: não bloqueia o aprendizado',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();
      // BELTRANA tem uma ocorrência já no ledger e uma pendente.
      const r = ctx.workflows.calibrarClassificacao({
        decisoes: [{ chave: S.BELTRANA, categoria: 'CUSTO_VIDA', modo: MODO.APRENDER }],
        ator: 'USUARIO'
      });
      assert.deep(r.rebaixadas, []);
      assert.equal(r.aprendidas.length, 1);
    });
});

/* ------------------------------------------------------------------ */
/* Estabilidade histórica                                              */
/* ------------------------------------------------------------------ */

describe('Calibração: estabilidade histórica', () => {
  it('histórico instável nunca vira regra, mas o mês é classificado',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();
      const r = ctx.workflows.calibrarClassificacao({
        decisoes: [{ chave: S.SICRANO, categoria: 'CUSTO_VIDA', modo: MODO.APRENDER }],
        ator: 'USUARIO'
      });

      assert.equal(r.aprendidas.length, 0);
      assert.equal(r.rebaixadas.length, 1);
      assert.equal(r.rebaixadas[0].motivo, 'HISTORICO_INSTAVEL');
      assert.equal(regrasCal(ctx).length, 0);
      assert.equal(r.resolvidosSoAgora.length, 1, 'a decisão do mês continua valendo');
      assert.equal(categoriaDe(ctx, 'PIX ENVIADO SICRANO DE ALMEIDA').categoria, 'CUSTO_VIDA');
    });

  it('divergir de histórico coerente, sem regra vigente, não vira regra',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();
      const r = ctx.workflows.calibrarClassificacao({
        decisoes: [{ chave: S.BELTRANA, categoria: 'GASTO_EXTRAORDINARIO', modo: MODO.APRENDER }],
        ator: 'USUARIO'
      });
      assert.equal(r.aprendidas.length, 0);
      assert.includes(r.rebaixadas[0].motivo, 'DIVERGE_DO_HISTORICO');
      assert.equal(regrasCal(ctx).length, 0);
      assert.equal(r.resolvidosSoAgora.length, 1,
        'exceção do mês é permitida; virar regra é que não');
    });

  it('confirmar não basta: sem regra vigente, divergência continua sendo exceção',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();
      const r = ctx.workflows.calibrarClassificacao({
        decisoes: [{
          chave: S.BELTRANA, categoria: 'GASTO_EXTRAORDINARIO',
          modo: MODO.APRENDER, confirmouCorrecao: true
        }],
        ator: 'USUARIO'
      });
      assert.equal(r.aprendidas.length, 0);
      assert.includes(r.rebaixadas[0].motivo, 'DIVERGE_DO_HISTORICO');
    });

  it('categoria fora do catálogo é recusada pelo portão', { scenario: 'C53' }, () => {
    const veredito = Cal.avaliarPersistencia({
      modo: MODO.APRENDER, grupo: { quantidade: 1 }, categoria: 'CUSTO DE VIDA',
      casados: 1, estabilidade: { estado: ESTADO.INEDITO }, vigentes: []
    });
    assert.notOk(veredito.ok);
    assert.includes(veredito.motivo, 'CATEGORIA_NAO_CANONICA');
  });

  it('sem APRENDER o portão nem chega a avaliar', { scenario: 'C53' }, () => {
    const veredito = Cal.avaliarPersistencia({
      modo: MODO.SO_AGORA, grupo: { quantidade: 1 }, categoria: 'CUSTO_VIDA',
      casados: 1, estabilidade: { estado: ESTADO.INEDITO }, vigentes: []
    });
    assert.notOk(veredito.ok);
    assert.equal(veredito.motivo, 'PERSISTENCIA_NAO_SOLICITADA');
  });
});

/* ------------------------------------------------------------------ */
/* Correção e versionamento                                            */
/* ------------------------------------------------------------------ */

/**
 * Estado onde a correção é alcançável: a regra já existe e uma ocorrência
 * ANTERIOR à vigência dela é importada depois (retroativo). A pendência
 * aparece com a regra vigente ao lado, e aí CORRIGIR faz sentido.
 */
function comRegraVigenteEPendenciaAntiga() {
  const ctx = montar();
  importar(ctx, 'fev.csv', CSV_ZELIA);
  ctx.workflows.calibrarClassificacao({
    decisoes: [{ chave: S.ZELIA, categoria: 'CUSTO_VIDA', modo: MODO.APRENDER }],
    ator: 'USUARIO'
  });
  importar(ctx, 'jan.csv', CSV_RETROATIVO);
  return ctx;
}

describe('Calibração: correção de regra e versionamento', () => {
  it('a pendência antiga aparece com a regra vigente e o histórico coerente',
    { scenario: 'C53' }, () => {
      const ctx = comRegraVigenteEPendenciaAntiga();
      const g = grupoDe(ctx, S.ZELIA);
      assert.deep(g.regra_vigente, { regra_id: 'CAL-0001', versao: 1, categoria: 'CUSTO_VIDA' });
      assert.equal(g.estabilidade.estado, ESTADO.COERENTE);
      assert.equal(g.estabilidade.categoria, 'CUSTO_VIDA');
    });

  it('divergir de regra vigente sem confirmar CORRIGIR não altera a regra',
    { scenario: 'C53' }, () => {
      const ctx = comRegraVigenteEPendenciaAntiga();
      const r = ctx.workflows.calibrarClassificacao({
        decisoes: [{ chave: S.ZELIA, categoria: 'GASTO_EXTRAORDINARIO', modo: MODO.APRENDER }],
        ator: 'USUARIO'
      });
      assert.equal(r.aprendidas.length, 0);
      assert.equal(r.rebaixadas[0].motivo, 'CORRECAO_NAO_CONFIRMADA');
      const regras = regrasCal(ctx);
      assert.equal(regras.length, 1);
      assert.equal(FOS.Config.parseBool(regras[0].ativo), true);
      assert.equal(regras[0].categoria, 'CUSTO_VIDA');
      assert.equal(linhaEm(ctx, '2026-02-10').categoria, 'CUSTO_VIDA');
    });

  it('EXCEÇÃO ATUAL não é CORREÇÃO DA REGRA: só agora muda a linha, não a regra',
    { scenario: 'C53' }, () => {
      const ctx = comRegraVigenteEPendenciaAntiga();
      ctx.workflows.calibrarClassificacao({
        decisoes: [{ chave: S.ZELIA, categoria: 'GASTO_EXTRAORDINARIO', modo: MODO.SO_AGORA }],
        ator: 'USUARIO'
      });
      const regras = regrasCal(ctx);
      assert.equal(regras.length, 1);
      assert.equal(regras[0].categoria, 'CUSTO_VIDA', 'a regra segue intacta');
      const antiga = linhaEm(ctx, '2026-01-05');
      assert.equal(antiga.categoria, 'GASTO_EXTRAORDINARIO');
      assert.equal(antiga.regra_id, 'MANUAL');
    });

  it('CORRIGIR desativa a versão vigente e cria a próxima com a MESMA identidade',
    { scenario: 'C53' }, () => {
      const ctx = comRegraVigenteEPendenciaAntiga();
      const r = ctx.workflows.calibrarClassificacao({
        decisoes: [{
          chave: S.ZELIA, categoria: 'GASTO_EXTRAORDINARIO',
          modo: MODO.APRENDER, confirmouCorrecao: true
        }],
        ator: 'USUARIO'
      });

      assert.equal(r.aprendidas.length, 1);
      assert.equal(r.aprendidas[0].resultado, 'CORRIGIDA');
      assert.equal(r.aprendidas[0].regra_id, 'CAL-0001');
      assert.equal(r.aprendidas[0].versao, 2);

      const regras = regrasCal(ctx);
      assert.equal(regras.length, 2, 'a versão antiga permanece na aba: histórico não se apaga');
      const v1 = regras.filter((x) => Number(x.versao) === 1)[0];
      const v2 = regras.filter((x) => Number(x.versao) === 2)[0];
      assert.equal(v1.regra_id, v2.regra_id, 'a identidade da regra é estável entre versões');
      assert.equal(FOS.Config.parseBool(v1.ativo), false);
      assert.equal(v1.vigente_ate, '2026-05-01');
      assert.includes(String(v1.observacao), 'CORRIGIDA_POR_CALIBRACAO');
      assert.equal(FOS.Config.parseBool(v2.ativo), true);
      assert.equal(v2.categoria, 'GASTO_EXTRAORDINARIO');
      assert.equal(linhaEm(ctx, '2026-02-10').categoria, 'CUSTO_VIDA',
        'a linha já classificada não é reescrita pela correção da regra');
      const antiga = linhaEm(ctx, '2026-01-05');
      assert.equal(antiga.categoria, 'GASTO_EXTRAORDINARIO');
      assert.equal(antiga.regra_id, 'CAL-0001');
      assert.equal(Number(antiga.regra_versao), 2);
    });

  it('duas versões ativas da mesma assinatura seriam ambiguidade — por isso desativa antes',
    { scenario: 'C53' }, () => {
      const v1 = Cal.linhaDeRegra({
        regraId: 'CAL-0001', versao: 1, chave: S.ZELIA, direcao: 'SAI',
        categoria: 'CUSTO_VIDA', agora: dataset.AGORA, desde: '2026-01-01'
      });
      const v2 = Object.assign({}, v1, { versao: 2, categoria: 'GASTO_EXTRAORDINARIO' });
      const tx = {
        data: '2026-03-01', conta_id: 'INTER_CC', valor: -300,
        descricao_normalizada: 'PIX ENVIADO ZELIA MARTINS'
      };
      const d = FOS.Rules.classificar(tx, [v1, v2], 0.9);
      assert.notOk(d.decidido);
      assert.equal(d.motivo, 'AMBIGUIDADE_REGRAS');
      assert.equal(FOS.Rules.classificar(tx, [v2], 0.9).categoria, 'GASTO_EXTRAORDINARIO');
    });

  it('falha entre os dois passos deixa a identidade sem regra ativa, e o retry conclui',
    { scenario: 'C53' }, () => {
      const ctx = comRegraVigenteEPendenciaAntiga();
      const original = ctx.planilha.anexarLinhas.bind(ctx.planilha);
      let falhar = true;
      ctx.planilha.anexarLinhas = function (nome, objetos) {
        if (falhar && nome === A.REGRAS) {
          falhar = false;
          throw FOS.Core.DomainError('FALHA_SIMULADA', 'interrupção entre os dois passos');
        }
        return original(nome, objetos);
      };

      assert.throws(() => ctx.workflows.aplicarRegraCalibrada({
        chave: S.ZELIA, direcao: 'SAI', categoria: 'GASTO_EXTRAORDINARIO',
        quantidade: 1, desde: '2026-01-05', ator: 'USUARIO'
      }), 'FALHA_SIMULADA');

      // Estado intermediário: nenhuma regra ativa para a assinatura.
      assert.equal(Cal.vigentesDaAssinatura(ctx.repositorio.regras(), S.ZELIA).length, 0);
      assert.equal(regrasCal(ctx).length, 1, 'a linha da v1 continua lá, apenas inativa');
      const tx = ctx.repositorio.staging().filter((l) => String(l.data) === '2026-01-05')[0];
      const d = FOS.Rules.classificar(tx, ctx.repositorio.regras(), 0.9);
      assert.notOk(d.decidido,
        'o estado intermediário falha para a fila, nunca para a categoria errada');
      assert.equal(d.motivo, 'SEM_REGRA_APLICAVEL');
      assert.equal(Cal.idDaAssinatura(ctx.repositorio.regras(), S.ZELIA), 'CAL-0001',
        'a identidade sobrevive à falha: o retry não cria uma regra nova');

      // Retry: completa a transição, sem duplicar.
      const r = ctx.workflows.aplicarRegraCalibrada({
        chave: S.ZELIA, direcao: 'SAI', categoria: 'GASTO_EXTRAORDINARIO',
        quantidade: 1, desde: '2026-01-05', ator: 'USUARIO'
      });
      assert.equal(r.resultado, 'CRIADA');
      assert.equal(r.regra_id, 'CAL-0001');
      assert.equal(r.versao, 2);
      const ativas = Cal.vigentesDaAssinatura(ctx.repositorio.regras(), S.ZELIA);
      assert.equal(ativas.length, 1, 'exatamente uma versão ativa depois do retry');
      assert.equal(ativas[0].categoria, 'GASTO_EXTRAORDINARIO');
      assert.equal(regrasCal(ctx).length, 2, 'nenhuma linha duplicada');
    });

  it('aprender de novo a mesma categoria é no-op, não erro nem versão nova',
    { scenario: 'C53' }, () => {
      const ctx = comRegraVigenteEPendenciaAntiga();
      const antes = regrasCal(ctx).length;
      const r = ctx.workflows.aplicarRegraCalibrada({
        chave: S.ZELIA, direcao: 'SAI', categoria: 'CUSTO_VIDA',
        quantidade: 1, desde: '2026-01-05', ator: 'USUARIO'
      });
      assert.equal(r.resultado, 'JA_VIGENTE');
      assert.equal(r.alterado, false);
      assert.equal(regrasCal(ctx).length, antes);

      const veredito = Cal.avaliarPersistencia({
        modo: MODO.APRENDER, grupo: { quantidade: 1 }, categoria: 'CUSTO_VIDA', casados: 1,
        estabilidade: { estado: ESTADO.COERENTE, categoria: 'CUSTO_VIDA' },
        vigentes: Cal.vigentesDaAssinatura(ctx.repositorio.regras(), S.ZELIA)
      });
      assert.notOk(veredito.ok);
      assert.equal(veredito.motivo, 'REGRA_JA_VIGENTE');
      assert.equal(veredito.noop, true);
    });

  it('a identidade CAL-NNNN é sequencial e não se repete', { scenario: 'C53' }, () => {
    assert.equal(Cal.proximoId([]), 'CAL-0001');
    assert.equal(Cal.proximoId([{ regra_id: 'CAL-0001' }, { regra_id: 'R900' }]), 'CAL-0002');
    assert.equal(Cal.proximoId([{ regra_id: 'CAL-0009' }, { regra_id: 'CAL-0002' }]), 'CAL-0010');
  });
});

/* ------------------------------------------------------------------ */
/* Aplicação em bloco e reprocessamento                                */
/* ------------------------------------------------------------------ */

describe('Calibração: aplicação em bloco', () => {
  it('uma decisão reprovada no portão não impede as outras', { scenario: 'C53' }, () => {
    const ctx = comHistoricoEMesCorrente();
    const r = ctx.workflows.calibrarClassificacao({
      decisoes: [
        { chave: S.FULANO, categoria: 'TRANSFERENCIA_INTERNA', modo: MODO.APRENDER },
        { chave: S.SICRANO, categoria: 'CUSTO_VIDA', modo: MODO.APRENDER },
        { chave: S.MERCADINHO, categoria: 'CUSTO_VIDA', modo: MODO.SO_AGORA }
      ],
      ator: 'USUARIO'
    });

    assert.equal(r.aprendidas.length, 1);
    assert.equal(r.rebaixadas.length, 1);
    assert.equal(r.rebaixadas[0].chave, S.SICRANO);
    assert.equal(r.resolvidosPorRegra.length, 2);
    assert.equal(r.resolvidosSoAgora.length, 2, 'o rebaixado é classificado junto com o só-agora');
    assert.equal(r.aindaAbertos, 5, 'o que não foi decidido continua aberto');
  });

  it('grupo inexistente é ignorado com motivo, sem quebrar o bloco',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();
      const r = ctx.workflows.calibrarClassificacao({
        decisoes: [{ chave: 'OUTRO | NAO EXISTE | SAI', categoria: 'CUSTO_VIDA', modo: MODO.APRENDER }],
        ator: 'USUARIO'
      });
      assert.deep(r.ignoradas, [{ chave: 'OUTRO | NAO EXISTE | SAI', motivo: 'GRUPO_INEXISTENTE' }]);
      assert.equal(r.aprendidas.length, 0);
    });

  it('reprocessar só toca item aberto, e nunca reabre resolvido', { scenario: 'C53' }, () => {
    const ctx = comHistoricoEMesCorrente();
    ctx.workflows.calibrarClassificacao({
      decisoes: [{ chave: S.FULANO, categoria: 'TRANSFERENCIA_INTERNA', modo: MODO.APRENDER }],
      ator: 'USUARIO'
    });
    const resolvidosAntes = ctx.repositorio.fila()
      .filter((i) => String(i.status) !== 'ABERTO').length;

    const r = ctx.workflows.reprocessarFila({ ator: 'USUARIO' });
    assert.equal(r.resolvidos.length, 0, 'nada novo casa: as regras já foram aplicadas');
    assert.equal(ctx.repositorio.fila().filter((i) => String(i.status) !== 'ABERTO').length,
      resolvidosAntes, 'item resolvido permanece resolvido');
    assert.ok(r.mantidos.length > 0);
    assert.includes(r.mantidos.map((m) => m.motivo), 'SEM_REGRA_APLICAVEL');
  });

  it('competência fechada é recusada: o item continua aberto e o erro aparece',
    { scenario: 'C53' }, () => {
      const ctx = montar();
      importar(ctx, 'jan.csv', CSV_RETROATIVO);
      ctx.repositorio.anexar(A.FECHAMENTOS, [{
        fechamento_id: 'F-2026-01', competencia: '2026-01', versao: 1,
        estado: C.ESTADO_FECHAMENTO.FECHADO, gerado_em: dataset.AGORA,
        fechado_em: dataset.AGORA, checksum: 'sintetico', motivo_versao: 'TESTE',
        gerado_por: 'TESTE', snapshot_json: '{}'
      }]);

      const r = ctx.workflows.calibrarClassificacao({
        decisoes: [{ chave: S.ZELIA, categoria: 'CUSTO_VIDA', modo: MODO.APRENDER }],
        ator: 'USUARIO'
      });

      assert.equal(r.aprendidas.length, 1, 'a regra pode nascer: ela vale para o futuro');
      assert.equal(r.resolvidosPorRegra.length, 0);
      assert.equal(r.erros.length, 1);
      assert.equal(r.erros[0].codigo, 'PERIODO_FECHADO');
      assert.equal(abertos(ctx).length, 1, 'competência fechada não é tocada em hipótese alguma');
    });
});

/* ------------------------------------------------------------------ */
/* Desativação de regras                                               */
/* ------------------------------------------------------------------ */

describe('Calibração: desativação de regras', () => {
  it('desativa por identidade, preserva a linha e é idempotente', { scenario: 'C53' }, () => {
    const ctx = montar();
    const alvos = ['R001', 'R900'];
    const antes = ctx.repositorio.regras().length;

    const r = ctx.workflows.desativarRegras({ regraIds: alvos, motivo: 'REGRA_DE_SEMENTE', ator: 'USUARIO' });
    assert.equal(r.desativadas, 2);
    assert.equal(ctx.repositorio.regras().length, antes, 'nada é apagado');
    ctx.repositorio.regras().filter((x) => alvos.indexOf(String(x.regra_id)) !== -1).forEach((x) => {
      assert.equal(FOS.Config.parseBool(x.ativo), false);
      assert.equal(x.vigente_ate, '2026-05-01');
      assert.equal(x.observacao, 'REGRA_DE_SEMENTE');
    });

    const segunda = ctx.workflows.desativarRegras({ regraIds: alvos, ator: 'USUARIO' });
    assert.equal(segunda.desativadas, 0);
    assert.equal(segunda.alterado, false);
  });

  it('sem alvo explícito não desativa nada', { scenario: 'C53' }, () => {
    const ctx = montar();
    assert.throws(() => ctx.workflows.desativarRegras({ regraIds: [] }), 'REGRAS_NAO_INFORMADAS');
  });

  it('instalar ou preparar a planilha jamais desativa regra sozinho',
    { scenario: 'C53' }, () => {
      const ctx = montar();
      const ativasAntes = ctx.repositorio.regras()
        .filter((r) => FOS.Config.parseBool(r.ativo) === true).length;
      assert.ok(ativasAntes > 0);

      FOS.App.Bootstrap.inicializar({
        planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria
      });
      assert.equal(
        ctx.repositorio.regras().filter((r) => FOS.Config.parseBool(r.ativo) === true).length,
        ativasAntes,
        'a política de aposentar regras de semente exige comando explícito');
    });
});

/* ------------------------------------------------------------------ */
/* Superfície                                                          */
/* ------------------------------------------------------------------ */

describe('Calibração: superfície', () => {
  it('o comando entra no menu logo após Reclassificar movimentação',
    { scenario: 'C53' }, () => {
      const reclassificar = MAIN.indexOf("addItem('Reclassificar movimentação'");
      const calibrar = MAIN.indexOf("addItem('Calibrar classificação'");
      const submenu = MAIN.indexOf("createMenu('Abrir entrada')");
      assert.ok(reclassificar !== -1 && calibrar !== -1 && submenu !== -1);
      assert.ok(reclassificar < calibrar && calibrar < submenu,
        'a ordem do menu é a decidida: calibrar entre reclassificar e o submenu de entrada');
      assert.includes(MAIN, 'function fosCalibrarClassificacao()');
    });

  it('a aba de regras continua interna: não é ponto de entrada nem fica visível',
    { scenario: 'C53' }, () => {
      const ctx = montar();
      assert.equal(
        Object.keys(FOS.App.Bootstrap.ABAS_DE_ENTRADA)
          .map((k) => FOS.App.Bootstrap.ABAS_DE_ENTRADA[k])
          .indexOf(A.REGRAS), -1,
        'ninguém edita a aba 20 na mão: quem escreve nela é o workflow');
      assert.ok(ctx.planilha.abaEstaOculta(A.REGRAS), 'a aba 20 permanece oculta');
      assert.throws(() => FOS.App.Bootstrap.abrirEntrada(ctx.planilha, A.REGRAS), 'ABA_NAO_E_ENTRADA');
    });

  it('o diálogo mostra a evidência histórica e as opções coerentes com o grupo',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();
      const instavel = grupoDe(ctx, S.SICRANO);
      const inedito = grupoDe(ctx, S.FULANO);
      assert.equal(instavel.pode_aprender, false,
        'o diálogo não pode oferecer APRENDER para padrão instável');
      assert.equal(inedito.pode_aprender, true);
      assert.isNull(inedito.regra_vigente,
        'sem regra vigente o diálogo não pode oferecer CORRIGIR');
    });
});

/* ------------------------------------------------------------------ */
/* Escopo da sessão                                                    */
/* ------------------------------------------------------------------ */

describe('Calibração: seleção de escopo (domínio)', () => {
  const grupos = [
    { chave: 'A', tipo: 'PIX ENVIADO', contraparte: 'UM', direcao: 'SAI', quantidade: 2, soma: -10 },
    { chave: 'B', tipo: 'PIX RECEBIDO', contraparte: 'DOIS', direcao: 'ENTRA', quantidade: 1, soma: 5 },
    { chave: 'C', tipo: 'OUTRO', contraparte: 'TRES', direcao: 'SAI', quantidade: 3, soma: -30 }
  ];

  it('o resumo numera os grupos e carrega o que a decisão exige',
    { scenario: 'C53' }, () => {
      assert.deep(Cal.resumo(grupos), [
        { numero: 1, quantidade: 2, tipo: 'PIX ENVIADO', contraparte: 'UM', direcao: 'SAI', soma: -10, chave: 'A' },
        { numero: 2, quantidade: 1, tipo: 'PIX RECEBIDO', contraparte: 'DOIS', direcao: 'ENTRA', soma: 5, chave: 'B' },
        { numero: 3, quantidade: 3, tipo: 'OUTRO', contraparte: 'TRES', direcao: 'SAI', soma: -30, chave: 'C' }
      ]);
    });

  it('um grupo, vários grupos e TODOS', { scenario: 'C53' }, () => {
    assert.deep(Cal.interpretarSelecao(grupos, '2').numeros, [2]);
    assert.deep(Cal.interpretarSelecao(grupos, '1,3').numeros, [1, 3]);
    assert.deep(Cal.interpretarSelecao(grupos, ' 3 , 1 ').numeros, [1, 3]);
    assert.deep(Cal.interpretarSelecao(grupos, 'TODOS').numeros, [1, 2, 3]);
    assert.deep(Cal.interpretarSelecao(grupos, 'todos').grupos.map((g) => g.chave), ['A', 'B', 'C']);
    assert.deep(Cal.interpretarSelecao(grupos, '3,1').grupos.map((g) => g.chave), ['A', 'C']);
  });

  it('índices repetidos são deduplicados, não recusados', { scenario: 'C53' }, () => {
    assert.deep(Cal.interpretarSelecao(grupos, '2,2,2').numeros, [2]);
    assert.deep(Cal.interpretarSelecao(grupos, '3,1,3,1').numeros, [1, 3]);
  });

  it('entrada inválida é recusada com motivo, nunca interpretada por aproximação',
    { scenario: 'C53' }, () => {
      assert.equal(Cal.interpretarSelecao(grupos, '').erro, 'SELECAO_VAZIA');
      assert.equal(Cal.interpretarSelecao(grupos, '   ').erro, 'SELECAO_VAZIA');
      assert.equal(Cal.interpretarSelecao(grupos, '4').erro, 'GRUPO_INEXISTENTE:4');
      assert.equal(Cal.interpretarSelecao(grupos, '0').erro, 'GRUPO_INEXISTENTE:0');
      assert.equal(Cal.interpretarSelecao(grupos, '1,9').erro, 'GRUPO_INEXISTENTE:9');
      assert.equal(Cal.interpretarSelecao(grupos, 'abc').erro, 'SELECAO_INVALIDA:abc');
      assert.equal(Cal.interpretarSelecao(grupos, '-1').erro, 'SELECAO_INVALIDA:-1');
      assert.equal(Cal.interpretarSelecao(grupos, '1,x').erro, 'SELECAO_INVALIDA:x');
      assert.equal(Cal.interpretarSelecao(grupos, 'TODO').erro, 'SELECAO_INVALIDA:TODO',
        '"TODO" não é "TODOS": aproximação em comando que grava é inaceitável');
      assert.equal(Cal.interpretarSelecao(grupos, '1.5').erro, 'SELECAO_INVALIDA:1.5');
    });

  it('uma recusa não seleciona nada: não há seleção parcial', { scenario: 'C53' }, () => {
    const r = Cal.interpretarSelecao(grupos, '1,2,99');
    assert.notOk(r.ok);
    assert.equal(r.numeros, undefined);
    assert.equal(r.grupos, undefined);
  });
});

describe('Calibração: seleção de escopo (comando)', () => {
  it('a primeira pergunta é o escopo, com a lista numerada e legível',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();
      const grupos = ctx.workflows.gruposDeCalibracao();
      const ui = rodarComando(ctx, [null]);

      const escopo = ui.prompts('Calibrar classificação — escopo');
      assert.equal(escopo.length, 1, 'o escopo é perguntado uma vez, antes de tudo');
      assert.equal(ui.dialogos[0].titulo, 'Calibrar classificação — escopo');

      const texto = escopo[0].texto;
      assert.includes(texto, '8 grupo(s) de pendências abertas.');
      assert.includes(texto, 'TODOS');
      grupos.forEach((g, i) => {
        const linha = texto.split('\n').filter((l) => l.indexOf(String(i + 1) + '.  ') !== -1)[0];
        assert.ok(linha, 'faltou a linha do grupo ' + (i + 1));
        assert.includes(linha, g.tipo);
        assert.includes(linha, g.contraparte);
        assert.includes(linha, g.direcao);
        assert.includes(linha, String(g.quantidade) + ' item(ns)');
        assert.includes(linha, Number(g.soma).toFixed(2));
      });
    });

  it('selecionar um grupo pergunta só por ele', { scenario: 'C53' }, () => {
    const ctx = comHistoricoEMesCorrente();
    const grupos = ctx.workflows.gruposDeCalibracao();
    const alvo = grupos.map((g) => g.chave).indexOf(S.FULANO) + 1;

    const ui = rodarComando(ctx, [String(alvo), 'TRANSFERENCIA_INTERNA APRENDER', true]);

    const perguntados = decisoes(ui);
    assert.equal(perguntados.length, 1, 'um grupo selecionado, um diálogo de decisão');
    assert.includes(perguntados[0].texto, 'FULANO DE TAL · ENTRA');
    assert.includes(perguntados[0].texto, 'Grupo ' + alvo + ' de 8',
      'o número mostrado é o da lista de escopo, para você reconhecer o grupo');
    assert.equal(regrasCal(ctx).length, 1);
  });

  it('selecionar vários pergunta por todos eles, e só por eles',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();
      const grupos = ctx.workflows.gruposDeCalibracao();
      const a = grupos.map((g) => g.chave).indexOf(S.FULANO) + 1;
      const b = grupos.map((g) => g.chave).indexOf(S.MERCADINHO) + 1;

      const ui = rodarComando(ctx, [
        [a, b].sort((x, y) => x - y).join(','),
        'TRANSFERENCIA_INTERNA APRENDER', 'CUSTO_VIDA', true
      ]);

      const perguntados = decisoes(ui);
      assert.equal(perguntados.length, 2);
      const chavesPerguntadas = perguntados.map((d) => d.texto);
      assert.ok(chavesPerguntadas.some((t) => t.indexOf('FULANO DE TAL · ENTRA') !== -1));
      assert.ok(chavesPerguntadas.some((t) => t.indexOf('MERCADINHO XPTO · SAI') !== -1));
      assert.equal(chavesPerguntadas.filter((t) => t.indexOf('SICRANO') !== -1).length, 0);
    });

  it('TODOS pergunta por todos os grupos', { scenario: 'C53' }, () => {
    const ctx = comHistoricoEMesCorrente();
    const total = ctx.workflows.gruposDeCalibracao().length;
    const roteiro = ['TODOS'].concat(new Array(total).fill('PULAR'));

    const ui = rodarComando(ctx, roteiro);
    assert.equal(decisoes(ui).length, total);
  });

  it('cancelar na seleção não grava nada', { scenario: 'C53' }, () => {
    const ctx = comHistoricoEMesCorrente();
    const antes = retrato(ctx);
    const ui = rodarComando(ctx, [null]);

    assert.equal(decisoes(ui).length, 0, 'cancelar no escopo não pergunta nenhuma decisão');
    assert.equal(retrato(ctx), antes, 'nenhuma escrita: fila, ledger e regras intactos');
    assert.equal(ui.alerts().length, 1);
    assert.equal(ui.alerts()[0].titulo, 'Calibrar classificação',
      'cancelar é encerramento deliberado, não erro de digitação');
    assert.equal(ui.alerts('Seleção não entendida').length, 0);
    assert.includes(ui.alerts()[0].texto, 'Encerrado por você');
    assert.includes(ui.alerts()[0].texto, 'Nada foi gravado');
  });

  it('entrada inválida encerra com erro claro e sem escrever', { scenario: 'C53' }, () => {
    const ctx = comHistoricoEMesCorrente();
    const antes = retrato(ctx);

    [['abc'], ['99'], ['0'], ['1,x'], ['TODO'], ['']].forEach((roteiro) => {
      const ui = rodarComando(ctx, roteiro);
      assert.equal(decisoes(ui).length, 0, 'nenhuma decisão é perguntada: ' + roteiro[0]);
      const erro = ui.alerts('Seleção não entendida')[0];
      assert.ok(erro, 'esperado alerta de seleção não entendida para: ' + roteiro[0]);
      assert.includes(erro.texto, 'Nada foi gravado');
      assert.equal(retrato(ctx), antes, 'nenhuma escrita após entrada inválida');
    });

    assert.includes(rodarComando(ctx, ['99']).alerts('Seleção não entendida')[0].texto,
      'Os números vão de 1 a 8');
    assert.includes(rodarComando(ctx, ['abc']).alerts('Seleção não entendida')[0].texto,
      'Não entendi "abc"');
  });

  it('índices repetidos não perguntam o mesmo grupo duas vezes', { scenario: 'C53' }, () => {
    const ctx = comHistoricoEMesCorrente();
    const alvo = ctx.workflows.gruposDeCalibracao().map((g) => g.chave).indexOf(S.FULANO) + 1;
    const ui = rodarComando(ctx, [[alvo, alvo, alvo].join(','), 'TRANSFERENCIA_INTERNA', true]);
    assert.equal(decisoes(ui).length, 1);
  });

  it('grupo não selecionado não sofre alteração alguma', { scenario: 'C53' }, () => {
    const ctx = comHistoricoEMesCorrente();
    const grupos = ctx.workflows.gruposDeCalibracao();
    const alvo = grupos.map((g) => g.chave).indexOf(S.FULANO) + 1;
    const naoSelecionados = grupos.filter((g) => g.chave !== S.FULANO);

    const itensAntes = {};
    ctx.repositorio.fila().forEach((i) => { itensAntes[String(i.item_id)] = JSON.stringify(i); });
    const ledgerAntes = ctx.repositorio.ledger().length;

    rodarComando(ctx, [String(alvo), 'TRANSFERENCIA_INTERNA APRENDER', true]);

    naoSelecionados.forEach((g) => {
      g.itens.forEach((id) => {
        const agora = ctx.repositorio.fila().filter((i) => String(i.item_id) === id)[0];
        assert.equal(JSON.stringify(agora), itensAntes[id],
          'item do grupo não selecionado alterado: ' + id);
      });
    });

    const chavesAtuais = ctx.workflows.gruposDeCalibracao().map((g) => g.chave);
    naoSelecionados.forEach((g) => {
      assert.includes(chavesAtuais, g.chave, 'grupo não selecionado sumiu da fila: ' + g.chave);
    });
    assert.equal(regrasCal(ctx).length, 1, 'só a regra do grupo selecionado nasceu');
    assert.equal(regrasCal(ctx)[0].valor_referencia, S.FULANO);
    assert.equal(ctx.repositorio.ledger().length, ledgerAntes + 2,
      'só as duas linhas do grupo selecionado entraram no ledger');
  });

  it('recusar a confirmação final não grava nada, mesmo com decisões tomadas',
    { scenario: 'C53' }, () => {
      const ctx = comHistoricoEMesCorrente();
      const alvo = ctx.workflows.gruposDeCalibracao().map((g) => g.chave).indexOf(S.FULANO) + 1;
      const antes = retrato(ctx);

      rodarComando(ctx, [String(alvo), 'TRANSFERENCIA_INTERNA APRENDER', false]);
      assert.equal(retrato(ctx), antes,
        'nenhuma escrita acontece antes da confirmação única');
    });
});
