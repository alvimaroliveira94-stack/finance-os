'use strict';
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');

describe('Hash determinístico', () => {
  it('produz o mesmo hash para a mesma entrada', () => {
    assert.equal(FOS.Hash.fnv1a64('ALUGUEL'), FOS.Hash.fnv1a64('ALUGUEL'));
  });

  it('produz hashes diferentes para entradas diferentes', () => {
    assert.notEqual(FOS.Hash.fnv1a64('ALUGUEL'), FOS.Hash.fnv1a64('ALUGUEI'));
  });

  it('separa as partes para não colidir por concatenação', () => {
    assert.notEqual(FOS.Hash.hashParts(['AB', 'C']), FOS.Hash.hashParts(['A', 'BC']));
  });

  it('devolve 16 caracteres hexadecimais', () => {
    assert.ok(/^[0-9a-f]{16}$/.test(FOS.Hash.fnv1a64('x')));
  });
});

describe('Datas', () => {
  it('rejeita data inexistente', () => {
    assert.notOk(FOS.Dates.isIso('2026-02-30'));
    assert.throws(() => FOS.Dates.assertIso('2026-02-30'), 'DATA_INVALIDA');
  });

  it('aceita ano bissexto', () => {
    assert.ok(FOS.Dates.isIso('2028-02-29'));
  });

  it('calcula diferença de dias entre meses', () => {
    assert.equal(FOS.Dates.diffDays('2026-02-01', '2026-01-31'), 1);
    assert.equal(FOS.Dates.diffDays('2026-01-31', '2026-02-03'), -3);
  });

  it('resolve o intervalo da competência', () => {
    assert.deep(FOS.Dates.competenciaRange('2026-02'), { inicio: '2026-02-01', fim: '2026-02-28' });
    assert.deep(FOS.Dates.competenciaRange('2028-02'), { inicio: '2028-02-01', fim: '2028-02-29' });
  });

  it('soma meses atravessando o ano', () => {
    assert.equal(FOS.Dates.addMonths('2026-01', -1), '2025-12');
    assert.equal(FOS.Dates.addMonths('2026-12', 2), '2027-02');
  });

  it('conta meses entre competências', () => {
    assert.equal(FOS.Dates.monthsBetween('2026-01', '2026-06'), 5);
  });
});

describe('Normalização', () => {
  it('normaliza descrição de forma determinística', () => {
    assert.equal(FOS.Normalize.descricao('Supermercado São João - Loja 12'), 'SUPERMERCADO SAO JOAO LOJA 12');
    assert.equal(
      FOS.Normalize.descricao('  energia   elétrica  '),
      FOS.Normalize.descricao('ENERGIA ELETRICA')
    );
  });

  it('interpreta valores em pt-BR e en-US', () => {
    assert.equal(FOS.Normalize.valor('-2.500,00'), -2500);
    assert.equal(FOS.Normalize.valor('1,234.56'), 1234.56);
    assert.equal(FOS.Normalize.valor('(120,00)'), -120);
    assert.isNull(FOS.Normalize.valor('abc'));
  });

  it('interpreta datas em ISO, pt-BR e OFX', () => {
    assert.equal(FOS.Normalize.data('05/01/2026'), '2026-01-05');
    assert.equal(FOS.Normalize.data('20260105'), '2026-01-05');
    assert.equal(FOS.Normalize.data('2026-01-05'), '2026-01-05');
    assert.isNull(FOS.Normalize.data('32/01/2026'));
  });
});

describe('Configuração (aba 00)', () => {
  const config = FOS.Config.build(FOS.App.Seed.configRows());

  it('lê parâmetro numérico ativo', () => {
    assert.equal(config.param('JANELA_CONCILIACAO_DIAS').value, 3);
    assert.equal(config.param('JANELA_CONCILIACAO_DIAS').status, 'OK');
  });

  it('devolve null com reason para parâmetro bloqueado', () => {
    const p = config.param('CUSTO_VIDA_ALVO_MENSAL_BRL');
    assert.isNull(p.value);
    assert.equal(p.status, 'BLOQUEADO');
    assert.equal(p.reason, 'AGUARDANDO_DEFINICAO_DO_USUARIO');
  });

  it('não inventa valor para parâmetro inexistente', () => {
    const p = config.param('PARAMETRO_QUE_NAO_EXISTE');
    assert.isNull(p.value);
    assert.includes(p.reason, 'PARAMETRO_INEXISTENTE');
  });

  it('lança ao exigir parâmetro numérico bloqueado', () => {
    assert.throws(() => config.requireNumber('PATRIMONIO_ALVO_BRL'), 'PARAMETRO_INDISPONIVEL');
  });

  it('carrega o catálogo de contas com universo e modo de ingestão', () => {
    const inter = config.conta('INTER_CC');
    assert.equal(inter.universo, 'VIDA');
    assert.equal(inter.modo_ingestao, 'IMPORTACAO_MENSAL');
    assert.ok(inter.ativa);
    assert.ok(inter.elegivel_importacao);

    const nubank = config.conta('NUBANK');
    assert.notOk(nubank.ativa);

    assert.equal(config.contasPorUniverso('TRADING').length, 4);
  });
});

describe('Schema das abas', () => {
  it('define as treze estruturas internas', () => {
    assert.equal(FOS.Schema.nomes().length, 13);
  });

  it('converte objeto para linha na ordem do schema', () => {
    const aba = FOS.Constants.ABAS_INTERNAS.LOG;
    const linha = FOS.Schema.toRow(aba, { log_id: 'L1', acao: 'TESTE' });
    assert.equal(linha[0], 'L1');
    assert.equal(linha.length, FOS.Schema.get(aba).colunas.length);
  });

  it('não tem coluna duplicada em nenhuma aba', () => {
    FOS.Schema.nomes().forEach((nome) => {
      const cols = FOS.Schema.get(nome).colunas;
      assert.equal(new Set(cols).size, cols.length, 'coluna duplicada em ' + nome);
    });
  });
});

describe('Valores gerenciados', () => {
  it('distingue OK, NULL, ERROR, STALE e DADO_INSUFICIENTE', () => {
    assert.equal(FOS.Core.value(10).status, 'OK');
    assert.equal(FOS.Core.nullValue('X').status, 'NULL');
    assert.equal(FOS.Core.errorValue('Y').status, 'ERROR');
    assert.equal(FOS.Core.staleValue(3, 'Z').status, 'STALE');
    assert.equal(FOS.Core.insufficient('W').status, 'DADO_INSUFICIENTE');
    assert.notOk(FOS.Core.isOk(FOS.Core.nullValue('X')));
  });

  it('serializa de forma canônica independente da ordem das chaves', () => {
    assert.equal(
      FOS.Core.canonicalJson({ b: 1, a: { d: 2, c: 3 } }),
      FOS.Core.canonicalJson({ a: { c: 3, d: 2 }, b: 1 })
    );
  });
});
