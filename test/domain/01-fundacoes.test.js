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

  it('bate com os vetores oficiais do FNV-1a 64', { scenario: 'C04' }, () => {
    // Referência externa: sem isso o hash seria só "o que o código faz hoje".
    const vetores = [
      ['', 'cbf29ce484222325'],
      ['a', 'af63dc4c8601ec8c'],
      ['b', 'af63df4c8601f1a5'],
      ['c', 'af63de4c8601eff2'],
      ['foobar', '85944171f73967e8'],
      ['chongo was here!\n', '46810940eff5f915']
    ];
    vetores.forEach(([entrada, esperado]) => {
      assert.equal(FOS.Hash.fnv1a64(entrada), esperado, 'vetor oficial: ' + JSON.stringify(entrada));
    });
  });

  it('não depende de BigInt (não garantido no Apps Script)', { scenario: 'C04' }, () => {
    const bruto = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'domain', 'hash.js'), 'utf8'
    );
    // A menção em comentário é intencional (explica a decisão); o que não pode
    // é o código usar BigInt.
    const codigo = bruto.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
    assert.equal(codigo.indexOf('BigInt'), -1, 'hash não pode depender de BigInt');
  });

  it('trata acento e emoji como bytes UTF-8', { scenario: 'C04' }, () => {
    assert.deep(FOS.Hash.bytesUtf8('á'), [195, 161]);
    assert.deep(FOS.Hash.bytesUtf8('\u{1F600}'), [240, 159, 152, 128]);
    assert.notEqual(FOS.Hash.fnv1a64('acao'), FOS.Hash.fnv1a64('ação'));
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

  it('parseCompetencia tolera YYYY-MM e YYYY-MM-DD, nunca lança', { scenario: 'C56' }, () => {
    assert.equal(FOS.Dates.parseCompetencia('2026-08'), '2026-08');
    assert.equal(FOS.Dates.parseCompetencia('2026-08-01'), '2026-08',
      'a forma que o Sheets produz quando interpreta "2026-08" como data');
    assert.equal(FOS.Dates.parseCompetencia('2026-08-15'), '2026-08',
      'qualquer dia do mês deriva a mesma competência, não só o dia 01');
    assert.equal(FOS.Dates.parseCompetencia('2026-08-31'), '2026-08');
    assert.isNull(FOS.Dates.parseCompetencia(''));
    assert.isNull(FOS.Dates.parseCompetencia(null));
    assert.isNull(FOS.Dates.parseCompetencia(undefined));
    assert.isNull(FOS.Dates.parseCompetencia('AGOSTO/2026'), 'texto livre não é adivinhado');
    assert.isNull(FOS.Dates.parseCompetencia('2026-13'), 'mês fora do intervalo 1-12');
    assert.isNull(FOS.Dates.parseCompetencia('2026-02-30'), 'data completa mas inexistente');
    assert.isNull(FOS.Dates.parseCompetencia(46600), 'número de série bruto de planilha não é aceito');
    assert.isNull(FOS.Dates.parseCompetencia(new Date(2026, 7, 1)),
      'só string — um Date não normalizado não deve ser adivinhado aqui');
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
    const p = config.param('URL_PROVEDOR_TAXA_CAMBIO');
    assert.isNull(p.value);
    assert.equal(p.status, 'BLOQUEADO');
    assert.equal(p.reason, 'POLITICA_MANUAL_NO_V1');
  });

  it('não inventa valor para parâmetro inexistente', () => {
    const p = config.param('PARAMETRO_QUE_NAO_EXISTE');
    assert.isNull(p.value);
    assert.includes(p.reason, 'PARAMETRO_INEXISTENTE');
  });

  it('lança ao exigir parâmetro numérico bloqueado', () => {
    const bloqueado = FOS.Config.build(FOS.App.Seed.configRows().concat([{
      secao: 'PARAMETRO', chave: 'PARAMETRO_NUMERICO_PENDENTE', valor: '', tipo: 'NUMERO',
      status: 'BLOQUEADO', reason: 'AGUARDANDO_DEFINICAO_DO_USUARIO'
    }]));
    assert.throws(() => bloqueado.requireNumber('PARAMETRO_NUMERICO_PENDENTE'), 'PARAMETRO_INDISPONIVEL');
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

describe('Competência inicial: fronteira YYYY-MM sobrevive à conversão do Sheets', () => {
  function configComCompetenciaInicial(valorBruto, tipo) {
    const rows = FOS.App.Seed.configRows().concat([{
      secao: 'PARAMETRO', chave: 'COMPETENCIA_INICIAL_CAIXA_VIDA', valor: valorBruto,
      tipo: tipo || 'TEXTO', status: 'ATIVO'
    }]);
    return FOS.Config.build(rows);
  }

  it('chave correta com YYYY-MM permanece correta', { scenario: 'C56' }, () => {
    const config = configComCompetenciaInicial('2026-08');
    assert.equal(config.param('COMPETENCIA_INICIAL_CAIXA_VIDA').value, '2026-08');
    assert.equal(config.param('COMPETENCIA_INICIAL_CAIXA_VIDA').status, 'OK');
  });

  it('valor vindo como YYYY-MM-DD vira YYYY-MM', { scenario: 'C56' }, () => {
    const config = configComCompetenciaInicial('2026-08-01');
    const p = config.param('COMPETENCIA_INICIAL_CAIXA_VIDA');
    assert.equal(p.value, '2026-08');
    assert.equal(p.status, 'OK');
  });

  it('valor irreconhecível vira null com reason específico', { scenario: 'C56' }, () => {
    const config = configComCompetenciaInicial('AGOSTO/2026');
    const p = config.param('COMPETENCIA_INICIAL_CAIXA_VIDA');
    assert.isNull(p.value);
    assert.equal(p.status, 'NULL');
    assert.equal(p.reason, 'COMPETENCIA_INICIAL_FORMATO_INVALIDO');
  });

  it('valor ausente continua com o reason genérico de sempre', { scenario: 'C56' }, () => {
    const config = configComCompetenciaInicial('');
    const p = config.param('COMPETENCIA_INICIAL_CAIXA_VIDA');
    assert.isNull(p.value);
    assert.equal(p.reason, 'PARAMETRO_SEM_VALOR');
  });

  it('demais parâmetros TEXTO não sofrem nenhuma alteração de comportamento', { scenario: 'C56' }, () => {
    const config = FOS.Config.build(FOS.App.Seed.configRows());
    assert.equal(config.param('MOEDA_GERENCIAL').value, 'BRL');
    assert.equal(config.param('POLITICA_TAXA_CAMBIO').value, 'MANUAL');
    assert.equal(config.param('CONTA_RESERVA_TRADING_BRL').value, 'RESERVA_BANCA_BRL');
  });

  it('caixaVida inclui movimento do próprio mês de abertura quando a competência é válida',
    { scenario: 'C56' }, () => {
      const config = FOS.Config.build(FOS.App.Seed.configRows());
      const linhas = [{
        linha_id: 'L1', fingerprint: 'fp1', versao_gerencial: 1,
        data_origem: '2026-01-15', valor_origem: 500, conta_id: 'INTER_CC'
      }];
      const caixa = FOS.Life.caixaVida(config, linhas, '2026-01');
      assert.ok(FOS.Core.isOk(caixa));
      assert.equal(caixa.value, 10500, '10000 (saldo inicial) + 500 do próprio mês de abertura');
    });

  it('caixaVida falha explícito (fail-closed) quando a competência inicial está ausente ou inválida',
    { scenario: 'C56' }, () => {
      ['', 'AGOSTO/2026'].forEach((bruto) => {
        const config = configComCompetenciaInicial(bruto);
        const caixa = FOS.Life.caixaVida(config, [], '2026-01');
        assert.notOk(FOS.Core.isOk(caixa), 'bruto=' + JSON.stringify(bruto));
        assert.isNull(caixa.value);
        assert.ok(caixa.reason, 'precisa vir com motivo explícito, nunca calcular em silêncio');
      });
    });
});

describe('Schema das abas', () => {
  it('define as quatorze estruturas internas', () => {
    assert.equal(FOS.Schema.nomes().length, 14);
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
