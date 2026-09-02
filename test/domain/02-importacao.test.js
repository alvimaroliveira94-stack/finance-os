'use strict';
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');

const config = FOS.Config.build(FOS.App.Seed.configRows());

function planejar(nomeArquivo, conteudo, contaId, conhecidos) {
  return FOS.Import.planejar({
    config,
    contaId: contaId || 'INTER_CC',
    nomeArquivo,
    conteudo,
    fingerprintsConhecidos: conhecidos || [],
    agora: dataset.AGORA
  });
}

describe('Parsers de extrato', () => {
  it('lê CSV com separador ponto e vírgula e valores pt-BR', () => {
    const r = FOS.Parsers.parseCsv(dataset.CSV_JANEIRO);
    assert.equal(r.erros.length, 0);
    assert.equal(r.transacoes.length, 5);
    assert.equal(r.transacoes[0].data, '2026-01-05');
    assert.equal(r.transacoes[0].valor, -2500);
    assert.equal(r.transacoes[0].descricao_normalizada, 'ALUGUEL JANEIRO');
  });

  it('lê OFX', () => {
    const r = FOS.Parsers.parseOfx(dataset.OFX_JANEIRO);
    assert.equal(r.erros.length, 0);
    assert.equal(r.transacoes.length, 2);
    assert.equal(r.transacoes[1].valor, -800);
  });

  it('reporta cabeçalho inválido em vez de adivinhar colunas', () => {
    const r = FOS.Parsers.parseCsv('col1;col2\n1;2');
    assert.equal(r.erros[0].codigo, 'CABECALHO_INVALIDO');
  });

  it('recusa formato não suportado', () => {
    assert.throws(() => FOS.Parsers.parse('extrato.pdf', 'x'), 'FORMATO_NAO_SUPORTADO');
  });
});

describe('Fingerprint', () => {
  it('é determinístico para a mesma linha', { scenario: 'C04' }, () => {
    const tx = {
      data: '2026-01-05', valor: -2500, descricao_normalizada: 'ALUGUEL JANEIRO',
      conta_id: 'INTER_CC', ordinal_ocorrencia: 1
    };
    assert.equal(FOS.Fingerprint.calcular(tx), FOS.Fingerprint.calcular(FOS.Core.clone(tx)));
  });

  it('muda quando qualquer componente muda', { scenario: 'C04' }, () => {
    const base = {
      data: '2026-01-05', valor: -2500, descricao_normalizada: 'ALUGUEL JANEIRO',
      conta_id: 'INTER_CC', ordinal_ocorrencia: 1
    };
    const variacoes = [
      { data: '2026-01-06' }, { valor: -2500.01 },
      { descricao_normalizada: 'ALUGUEL FEVEREIRO' }, { conta_id: 'NUBANK' },
      { ordinal_ocorrencia: 2 }
    ];
    variacoes.forEach((v) => {
      assert.notEqual(FOS.Fingerprint.calcular(Object.assign({}, base, v)), FOS.Fingerprint.calcular(base));
    });
  });

  it('exige ordinal de ocorrência', { scenario: 'C04' }, () => {
    assert.throws(() => FOS.Fingerprint.calcular({
      data: '2026-01-05', valor: -1, descricao_normalizada: 'X', conta_id: 'INTER_CC'
    }), 'ORDINAL_AUSENTE');
  });

  it('numera ocorrências idênticas dentro do arquivo', { scenario: 'C01' }, () => {
    const linhas = FOS.Fingerprint.aplicar([
      { data: '2026-03-03', valor: -120, descricao_normalizada: 'SUPERMERCADO', conta_id: 'INTER_CC' },
      { data: '2026-03-03', valor: -120, descricao_normalizada: 'SUPERMERCADO', conta_id: 'INTER_CC' },
      { data: '2026-03-04', valor: -120, descricao_normalizada: 'SUPERMERCADO', conta_id: 'INTER_CC' }
    ]);
    assert.equal(linhas[0].ordinal_ocorrencia, 1);
    assert.equal(linhas[1].ordinal_ocorrencia, 2);
    assert.equal(linhas[2].ordinal_ocorrencia, 1);
    assert.notEqual(linhas[0].fingerprint, linhas[1].fingerprint);
  });
});

describe('Staging de importação', () => {
  it('aceita conta de vida elegível', () => {
    const plano = planejar('extrato-janeiro.csv', dataset.CSV_JANEIRO);
    assert.ok(plano.ok);
    assert.equal(plano.novas.length, 5);
    assert.equal(plano.duplicadas.length, 0);
    assert.equal(plano.moeda, 'BRL');
  });

  it('mantém duas transações legítimas idênticas como linhas distintas', { scenario: 'C01' }, () => {
    const plano = planejar('duplicatas.csv', dataset.CSV_DUPLICATAS_LEGITIMAS);
    assert.ok(plano.ok);
    assert.equal(plano.novas.length, 2);
    assert.notEqual(plano.novas[0].fingerprint, plano.novas[1].fingerprint);
    assert.equal(plano.novas[0].valor, plano.novas[1].valor);
  });

  it('reimportar o mesmo arquivo gera zero linhas novas', { scenario: 'C02' }, () => {
    const primeiro = planejar('extrato-janeiro.csv', dataset.CSV_JANEIRO);
    const conhecidos = primeiro.novas.map((l) => l.fingerprint);
    const segundo = planejar('extrato-janeiro.csv', dataset.CSV_JANEIRO, 'INTER_CC', conhecidos);
    assert.ok(segundo.ok);
    assert.equal(segundo.novas.length, 0);
    assert.equal(segundo.duplicadas.length, 5);
    assert.equal(segundo.motivo, 'REIMPORTACAO_SEM_NOVIDADE');
    assert.equal(segundo.arquivo_hash, primeiro.arquivo_hash);
  });

  it('rejeita o arquivo inteiro quando uma linha é inválida', { scenario: 'C03' }, () => {
    const plano = planejar('extrato-marco.csv', dataset.CSV_INVALIDO);
    assert.notOk(plano.ok);
    assert.equal(plano.motivo, 'ARQUIVO_COM_LINHAS_INVALIDAS');
    assert.equal(plano.novas.length, 0);
    assert.equal(plano.erros[0].codigo, 'DATA_INVALIDA');
  });

  it('rejeita arquivo sem transações', { scenario: 'C03' }, () => {
    const plano = planejar('vazio.csv', 'data;descricao;valor\n');
    assert.notOk(plano.ok);
    assert.equal(plano.motivo, 'ARQUIVO_VAZIO');
  });
});

describe('Firewall de contas', () => {
  it('recusa importação transacional de conta de trading', { scenario: 'C10' }, () => {
    ['BETFAIR', 'NETELLER', 'WISE', 'RESERVA_BANCA_BRL'].forEach((conta) => {
      const plano = planejar('extrato.csv', dataset.CSV_JANEIRO, conta);
      assert.notOk(plano.ok, conta + ' não pode importar extrato');
      assert.equal(plano.motivo, 'FIREWALL_TRADING_SEM_IMPORTACAO_TRANSACIONAL');
      assert.equal(plano.novas.length, 0);
    });
  });

  it('recusa conta de vida inativa e conta desconhecida', { scenario: 'C10' }, () => {
    assert.equal(planejar('e.csv', dataset.CSV_JANEIRO, 'NUBANK').motivo, 'CONTA_INATIVA');
    assert.equal(planejar('e.csv', dataset.CSV_JANEIRO, 'BANCO_X').motivo, 'CONTA_DESCONHECIDA');
  });

  it('só aceita saldo semanal de conta de trading', { scenario: 'C11' }, () => {
    assert.ok(FOS.Accounts.aceitaSaldoSemanal(config.conta('BETFAIR')).aceita);
    assert.notOk(FOS.Accounts.aceitaSaldoSemanal(config.conta('INTER_CC')).aceita);
    assert.equal(
      FOS.Accounts.aceitaSaldoSemanal(config.conta('INTER_CC')).motivo,
      'SALDO_SEMANAL_APENAS_TRADING'
    );
  });

  it('invariante bloqueia saldo semanal de conta que não é de trading', { scenario: 'C11' }, () => {
    const r = FOS.Invariants.firewallSaldosSemanais(config, [
      dataset.saldo('SX', '2026-01-31', 'INTER_CC', 100, 'BRL')
    ]);
    assert.notOk(r.ok);
  });

  it('reconhece a fronteira Wise para Inter e ignora movimento interno de trading', { scenario: 'C12' }, () => {
    assert.ok(FOS.Accounts.isFronteiraReconhecida('WISE', 'INTER_CC'));
    assert.notOk(FOS.Accounts.isFronteiraReconhecida('BETFAIR', 'INTER_CC'));
    assert.ok(FOS.Accounts.isMovimentoInternoTradingNaoControlado(config, 'BETFAIR', 'NETELLER'));
    assert.notOk(FOS.Accounts.isMovimentoInternoTradingNaoControlado(config, 'WISE', 'INTER_CC'));
  });
});
