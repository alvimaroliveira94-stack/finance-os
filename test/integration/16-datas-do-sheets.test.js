'use strict';
/**
 * Regressão do bug de implantação: o Google Sheets devolve objetos Date para
 * toda célula formatada como data, e o domínio trabalha com texto ISO.
 *
 * Sintoma real, com extrato OFX importado no INTER_CC:
 *   ao resolver a pendência (2026-09-01 | INTER_CC | 99.9) informando
 *   CUSTO_VIDA, a resolução falhava com
 *   "DATA_INVALIDA: Data inválida em campo: Tue Sep 01 2026 00:00:00 GMT-0300".
 *
 * A conversão passou a acontecer uma única vez, na fronteira do adaptador, e
 * sempre no fuso da planilha — converter em UTC desloca o dia.
 */
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');
const { comoCelulaDoSheets } = require('../fixtures/fakes');

/** OFX sintético com a mesma forma do que quebrou em produção. */
const OFX_SETEMBRO = [
  '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>',
  '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260901<TRNAMT>99.90<MEMO>DEPOSITO NAO RECONHECIDO XPTO</STMTTRN>',
  '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260903<TRNAMT>-2500.00<MEMO>ALUGUEL SETEMBRO</STMTTRN>',
  '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'
].join('\n');

/** Simula Utilities.formatDate para um fuso de offset fixo. */
function formatadorDeFuso(offsetMinutos) {
  return function (data) {
    const deslocado = new Date(data.getTime() + offsetMinutos * 60000);
    const p = (n) => (n < 10 ? '0' : '') + n;
    const sinal = offsetMinutos >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutos);
    return deslocado.getUTCFullYear() + '-' + p(deslocado.getUTCMonth() + 1)
      + '-' + p(deslocado.getUTCDate())
      + 'T' + p(deslocado.getUTCHours()) + ':' + p(deslocado.getUTCMinutes())
      + ':' + p(deslocado.getUTCSeconds())
      + sinal + p(Math.floor(abs / 60)) + ':' + p(abs % 60);
  };
}

/** Spreadsheet mínimo do Apps Script, devolvendo o que getValues() devolveria. */
function spreadsheetStub(headers, linhas) {
  const sheet = {
    getLastRow: () => linhas.length + 1,
    getLastColumn: () => headers.length,
    getRange: (linha, coluna, numLinhas) => ({
      getValues: () => (linha === 1 ? [headers] : linhas.slice(linha - 2, linha - 2 + numLinhas))
    })
  };
  return { getSheetByName: () => sheet, getSheets: () => [sheet] };
}

describe('Fronteira de datas do Google Sheets', () => {
  it('converte célula Date em AAAA-MM-DD usando o fuso da planilha', { scenario: 'C04' }, () => {
    // Meia-noite de 01/09/2026 em São Paulo, como o Sheets entrega.
    const celula = new Date(Date.UTC(2026, 8, 1, 3, 0, 0));
    const planilha = FOS.Adapters.criarPlanilha(
      spreadsheetStub(['data', 'valor', 'descricao'], [[celula, 99.9, 'DEPOSITO XPTO']]),
      { fusoHorario: 'America/Sao_Paulo', formatarData: formatadorDeFuso(-180) }
    );
    const linha = planilha.lerTabela('10_IMPORT_EXTRATO')[0];
    assert.equal(linha.data, '2026-09-01');
    assert.ok(FOS.Dates.isIso(linha.data), 'o domínio precisa aceitar o valor sem conversão extra');
  });

  it('não usa UTC: em fuso positivo o dia não pode andar para trás', { scenario: 'C04' }, () => {
    // Meia-noite de 01/09/2026 em Tóquio = 31/08 15:00 UTC.
    const celula = new Date(Date.UTC(2026, 7, 31, 15, 0, 0));
    assert.equal(celula.toISOString().slice(0, 10), '2026-08-31',
      'em UTC o dia seria 31/08: é exatamente o erro que a correção evita');

    const planilha = FOS.Adapters.criarPlanilha(
      spreadsheetStub(['data'], [[celula]]),
      { fusoHorario: 'Asia/Tokyo', formatarData: formatadorDeFuso(540) }
    );
    assert.equal(planilha.lerTabela('10_IMPORT_EXTRATO')[0].data, '2026-09-01');
  });

  it('preserva timestamp quando a célula tem hora', { scenario: 'C36' }, () => {
    const celula = new Date(Date.UTC(2026, 8, 1, 17, 30, 15));
    const planilha = FOS.Adapters.criarPlanilha(
      spreadsheetStub(['timestamp'], [[celula]]),
      { fusoHorario: 'America/Sao_Paulo', formatarData: formatadorDeFuso(-180) }
    );
    assert.equal(planilha.lerTabela('90_LOG_AUDITORIA')[0].timestamp, '2026-09-01T14:30:15-03:00');
  });

  it('não converte número, texto, booleano nem vazio', { scenario: 'C04' }, () => {
    const planilha = FOS.Adapters.criarPlanilha(
      spreadsheetStub(
        ['valor', 'descricao', 'ativa', 'reason'],
        [[-2500.5, '2026-09-01 nao e data, e texto', true, '']]
      ),
      { fusoHorario: 'America/Sao_Paulo', formatarData: formatadorDeFuso(-180) }
    );
    const linha = planilha.lerTabela('00_CONFIG_PARAMETROS')[0];
    assert.equal(linha.valor, -2500.5);
    assert.equal(typeof linha.valor, 'number');
    assert.equal(linha.descricao, '2026-09-01 nao e data, e texto');
    assert.equal(linha.ativa, true);
    assert.equal(linha.reason, '');
  });

  it('data inválida vira vazio, sem chutar dia', { scenario: 'C04' }, () => {
    assert.equal(FOS.Adapters.normalizarCelula(new Date('nada'), {}), '');
  });

  it('funciona sem Utilities, pelo fuso do runtime do script', { scenario: 'C04' }, () => {
    // No Apps Script o fuso do runtime é o do projeto; o fallback usa os
    // getters locais justamente para não deslocar o dia.
    assert.equal(FOS.Adapters.normalizarCelula(new Date(2026, 8, 1), {}), '2026-09-01');
    assert.equal(FOS.Adapters.normalizarCelula(comoCelulaDoSheets('2026-09-01'), {}), '2026-09-01');
  });

  /**
   * Mesma fronteira, agora num parâmetro com contrato "YYYY-MM"
   * (COMPETENCIA_INICIAL_CAIXA_VIDA), não "YYYY-MM-DD": o Sheets pode ter
   * interpretado "2026-08" digitado como data e guardado 1º de agosto — o
   * adaptador entrega a data completa, igual entregaria para qualquer outra
   * coluna de data. O round-trip passa pelo adaptador real
   * (FOS.Adapters.criarPlanilha), não por uma string injetada direto.
   */
  it('COMPETENCIA_INICIAL_CAIXA_VIDA sobrevive à conversão Date do Sheets até virar YYYY-MM no Config',
    { scenario: 'C56' }, () => {
      // Meia-noite de 01/08/2026 em São Paulo — o que o Sheets devolveria
      // para uma célula que interpretou "2026-08" como data.
      const celula = new Date(Date.UTC(2026, 7, 1, 3, 0, 0));
      const planilha = FOS.Adapters.criarPlanilha(
        spreadsheetStub(
          ['secao', 'chave', 'valor', 'tipo', 'status'],
          [['PARAMETRO', 'COMPETENCIA_INICIAL_CAIXA_VIDA', celula, 'TEXTO', 'ATIVO']]
        ),
        { fusoHorario: 'America/Sao_Paulo', formatarData: formatadorDeFuso(-180) }
      );

      // Prova, sem pular o adaptador, que ele já entrega a data completa —
      // é exatamente aqui que o smoke real encontrou "2026-08-01".
      const linha = planilha.lerTabela('00_CONFIG_PARAMETROS')[0];
      assert.equal(linha.valor, '2026-08-01');

      // Config.build é o ponto único de normalização: a partir daqui, o
      // valor final para esta chave precisa já estar em YYYY-MM.
      const config = FOS.Config.build([linha]);
      const p = config.param('COMPETENCIA_INICIAL_CAIXA_VIDA');
      assert.equal(p.value, '2026-08');
      assert.equal(p.status, 'OK');
    });
});

describe('Resolver pendência com datas vindas do Sheets', () => {
  function workbookComoNoSheets() {
    const ctx = dataset.montarWorkbook({ datasComoDate: true, agora: '2026-09-20T12:00:00Z' });
    const r = ctx.workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'setembro.ofx', conteudo: OFX_SETEMBRO
    });
    assert.ok(r.ok, 'o extrato precisa entrar mesmo com a planilha devolvendo Date');
    return ctx;
  }

  it('a leitura do staging devolve data ISO, não Date', { scenario: 'C04' }, () => {
    const ctx = workbookComoNoSheets();
    const staging = ctx.repositorio.staging();
    assert.equal(staging.length, 2);
    staging.forEach((linha) => {
      assert.equal(typeof linha.data, 'string', 'a data não pode chegar como objeto ao domínio');
      assert.ok(FOS.Dates.isIso(linha.data), 'data fora do formato ISO: ' + linha.data);
    });
    assert.includes(staging.map((l) => l.data), '2026-09-01');
  });

  it('resolver a pendência classifica sem DATA_INVALIDA', { scenario: 'C40' }, () => {
    const ctx = workbookComoNoSheets();
    const abertos = FOS.Queue.abertos(ctx.repositorio.fila());
    const item = abertos.filter((i) => String(i.detalhe).indexOf('99.9') !== -1)[0];
    assert.ok(item, 'a linha sem regra precisa estar na fila: ' + JSON.stringify(abertos.map((i) => i.detalhe)));
    assert.includes(item.detalhe, '2026-09-01');

    const r = ctx.workflows.resolverItemFila({
      item_id: item.item_id, decisao: 'CLASSIFICAR', categoria: 'CUSTO_VIDA', ator: 'USUARIO'
    });

    assert.ok(r.alterado);
    assert.equal(FOS.Queue.abertos(ctx.repositorio.fila()).length, 0);
    const linha = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
      .filter((l) => String(l.fingerprint) === String(item.referencia))[0];
    assert.ok(linha, 'a linha resolvida precisa entrar no ledger');
    assert.equal(linha.categoria, 'CUSTO_VIDA');
    assert.equal(linha.data_origem, '2026-09-01', 'a data de origem precisa continuar no dia certo');
    assert.equal(linha.valor_origem, 99.9);
  });

  it('a competência derivada da linha continua correta', { scenario: 'C41' }, () => {
    const ctx = workbookComoNoSheets();
    FOS.Queue.abertos(ctx.repositorio.fila()).forEach((item) => {
      ctx.workflows.resolverItemFila({
        item_id: item.item_id, decisao: 'CLASSIFICAR', categoria: 'CUSTO_VIDA', ator: 'USUARIO'
      });
    });
    const competencias = FOS.Ledger.visaoCorrente(ctx.repositorio.ledger())
      .map((l) => FOS.Dates.competenciaOf(String(l.data_origem)));
    competencias.forEach((c) => assert.equal(c, '2026-09'));
  });

  it('reimportar o mesmo arquivo continua gerando zero linhas novas', { scenario: 'C02' }, () => {
    // O fingerprint depende da data: se a normalização variasse entre
    // gravação e leitura, a reimportação criaria duplicatas.
    const ctx = workbookComoNoSheets();
    const antes = ctx.repositorio.staging().length;
    const segunda = ctx.workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'setembro.ofx', conteudo: OFX_SETEMBRO
    });
    assert.equal(segunda.escritas, 0);
    assert.equal(segunda.plano.duplicadas.length, 2);
    assert.equal(ctx.repositorio.staging().length, antes);
  });
});
