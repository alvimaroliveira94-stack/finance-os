'use strict';
/**
 * Depreciação de parâmetros que nunca tiveram consumidor.
 *
 * A auditoria mostrou que PATRIMONIO_ALVO_BRL e CUSTO_VIDA_ALVO_MENSAL_BRL
 * eram declarados na semente e lidos por ninguém: não afetavam fechamento,
 * snapshot, estado do ciclo, planejamento nem dashboard. O único efeito era
 * aparecer em metadados.parametros_bloqueados e cobrar, a cada diagnóstico,
 * uma definição que o sistema não usaria para nada.
 *
 * Decisão arquitetural: os dois deixam de ser parâmetros canônicos. Meta de
 * patrimônio é objetivo versionado (aba 31, evento NOVO_OBJETIVO); custo de
 * vida operacional vem do ledger observado.
 *
 * Estes testes protegem a forma da depreciação:
 *  - a linha da planilha de produção NÃO é apagada;
 *  - a fonte de verdade é a lista no código, não a célula `status`;
 *  - "Preparar planilha" sincroniza o texto da linha, e nada mais;
 *  - fechamentos já gravados continuam íntegros.
 */
const { describe, it, assert } = globalThis.__fosTest;
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');

const C = FOS.Constants;
const A = C.ABAS_INTERNAS;
const DEPRECIADOS = Object.keys(FOS.Config.PARAMETROS_DEPRECIADOS);

/** A linha exatamente como a semente antiga a gravou na planilha real. */
function linhaLegada(chave, descricao, valor) {
  return {
    secao: 'PARAMETRO',
    chave: chave,
    valor: valor === undefined ? '' : valor,
    tipo: 'NUMERO',
    unidade: 'BRL',
    universo: '',
    modo_ingestao: '',
    moeda: '',
    ativa: '',
    elegivel_importacao: '',
    status: 'BLOQUEADO',
    reason: 'AGUARDANDO_DEFINICAO_DO_USUARIO',
    versao: 1,
    atualizado_em: '',
    descricao: descricao,
    data_cotacao: ''
  };
}

/** Reproduz a planilha de produção: já semeada, com as duas linhas antigas. */
function workbookDeProducao(opcoes) {
  const opts = opcoes || {};
  const ctx = dataset.montarWorkbook(opts.workbook || {});
  ctx.repositorio.anexar(A.CONFIG, [
    linhaLegada('PATRIMONIO_ALVO_BRL', 'Alvo de patrimônio.', opts.valorPatrimonio),
    linhaLegada('CUSTO_VIDA_ALVO_MENSAL_BRL', 'Alvo canônico de custo de vida.', opts.valorCustoVida)
  ]);
  return ctx;
}

function linhaDe(ctx, chave) {
  return ctx.repositorio.configLinhas().filter((r) => r.chave === chave)[0];
}

describe('Parâmetros depreciados: leitura', () => {
  it('a lista do código vence a célula da planilha', { scenario: 'C51' }, () => {
    // A linha em produção continua dizendo BLOQUEADO/AGUARDANDO_DEFINICAO.
    // O sistema já a trata como descontinuada, antes de qualquer migração.
    const ctx = workbookDeProducao();
    const config = ctx.repositorio.config();

    DEPRECIADOS.forEach((chave) => {
      const p = config.param(chave);
      assert.isNull(p.value);
      assert.equal(p.status, C.STATUS_PARAMETRO.DEPRECIADO, chave);
      assert.equal(p.reason, FOS.Config.PARAMETROS_DEPRECIADOS[chave]);
    });
  });

  it('um valor digitado na célula não ressuscita o parâmetro', { scenario: 'C51' }, () => {
    // Editar a aba 00 não é caminho para reverter uma decisão arquitetural.
    const ctx = workbookDeProducao({ valorPatrimonio: 2000000, valorCustoVida: 9000 });
    const config = ctx.repositorio.config();
    assert.isNull(config.param('PATRIMONIO_ALVO_BRL').value);
    assert.isNull(config.param('CUSTO_VIDA_ALVO_MENSAL_BRL').value);
    assert.equal(config.param('PATRIMONIO_ALVO_BRL').status, C.STATUS_PARAMETRO.DEPRECIADO);
  });

  it('exigir um parâmetro depreciado continua lançando', { scenario: 'C51' }, () => {
    const ctx = workbookDeProducao({ valorPatrimonio: 2000000 });
    assert.throws(
      () => ctx.repositorio.config().requireNumber('PATRIMONIO_ALVO_BRL'),
      'PARAMETRO_INDISPONIVEL');
  });

  it('a semente nova não cria mais essas linhas', { scenario: 'C51' }, () => {
    const chaves = FOS.App.Seed.configRows().map((r) => r.chave);
    DEPRECIADOS.forEach((chave) => assert.equal(chaves.indexOf(chave), -1, chave));
  });

  it('parâmetros vivos seguem intactos', { scenario: 'C51' }, () => {
    const config = FOS.Config.build(FOS.App.Seed.configRows());
    assert.equal(config.param('MESES_MEDIA_CUSTO_VIDA').value, 3);
    assert.equal(config.param('MOEDA_GERENCIAL').value, 'BRL');
    assert.equal(config.param('URL_PROVEDOR_TAXA_CAMBIO').status, C.STATUS_PARAMETRO.BLOQUEADO);
  });
});

describe('Parâmetros depreciados: deixam de ser pendência', () => {
  it('o diagnóstico não os cobra mais', { scenario: 'C51' }, () => {
    const ctx = workbookDeProducao();
    const diag = ctx.workflows.diagnosticoSetup();
    const chaves = diag.avisos.concat(diag.bloqueios).map((x) => x.chave);
    DEPRECIADOS.forEach((chave) => assert.equal(chaves.indexOf(chave), -1, chave));
  });

  it('o aviso de parâmetro bloqueado não promete dependentes inexistentes',
    { scenario: 'C51' }, () => {
      const ctx = workbookDeProducao();
      ctx.workflows.diagnosticoSetup().avisos
        .filter((a) => a.codigo === 'PARAMETRO_BLOQUEADO')
        .forEach((a) => {
          assert.includes(a.impacto, 'Não impede o fechamento');
          assert.equal(a.impacto.indexOf('os cálculos que dependem dele'), -1);
        });
    });

  it('somem de metadados.parametros_bloqueados do snapshot', { scenario: 'C51' }, () => {
    const ctx = workbookDeProducao({ workbook: {} });
    ctx.repositorio.anexar(A.CONFIG, [
      FOS.Fx.linhaDeCache('GBP', 'BRL', '2025-12-31', 6.2, 'PTAX', dataset.AGORA, null, { versao: 1 }),
      FOS.Fx.linhaDeCache('GBP', 'BRL', '2026-01-31', 6.3, 'PTAX', dataset.AGORA, null, { versao: 1 })
    ]);
    ctx.workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'janeiro.csv', conteudo: dataset.CSV_JANEIRO
    });
    ctx.workflows.conciliarEventos();

    const r = ctx.workflows.fecharCompetencia('2026-01');
    const bloqueados = r.snapshot.metadados.parametros_bloqueados;
    DEPRECIADOS.forEach((chave) => assert.equal(bloqueados.indexOf(chave), -1, chave));
    assert.includes(bloqueados, 'URL_PROVEDOR_TAXA_CAMBIO', 'os bloqueados de verdade continuam');
  });

  it('preencher o valor não muda mais nada no fechamento', { scenario: 'C51' }, () => {
    // Era o único efeito que restava: entrar/sair de parametros_bloqueados.
    function checksum(valor) {
      const ctx = workbookDeProducao({ valorPatrimonio: valor });
      ctx.repositorio.anexar(A.CONFIG, [
        FOS.Fx.linhaDeCache('GBP', 'BRL', '2025-12-31', 6.2, 'PTAX', dataset.AGORA, null, { versao: 1 }),
        FOS.Fx.linhaDeCache('GBP', 'BRL', '2026-01-31', 6.3, 'PTAX', dataset.AGORA, null, { versao: 1 })
      ]);
      ctx.workflows.importarExtrato({
        contaId: 'INTER_CC', nomeArquivo: 'janeiro.csv', conteudo: dataset.CSV_JANEIRO
      });
      ctx.workflows.conciliarEventos();
      return ctx.workflows.fecharCompetencia('2026-01').fechamento.checksum;
    }
    assert.equal(checksum(undefined), checksum(2000000),
      'o parâmetro não pode mais influenciar o checksum do fechamento');
  });
});

describe('Migração da planilha existente', () => {
  it('"Preparar planilha" sincroniza a linha sem apagá-la', { scenario: 'C51' }, () => {
    const ctx = workbookDeProducao({ valorPatrimonio: 2000000 });
    const linhasAntes = ctx.repositorio.configLinhas().length;

    const r = FOS.App.Bootstrap.inicializar({
      planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria
    });
    assert.deep(r.depreciadas.slice().sort(), DEPRECIADOS.slice().sort());
    assert.equal(ctx.repositorio.configLinhas().length, linhasAntes, 'nenhuma linha some');

    const linha = linhaDe(ctx, 'PATRIMONIO_ALVO_BRL');
    assert.equal(linha.status, C.STATUS_PARAMETRO.DEPRECIADO);
    assert.equal(linha.reason, FOS.Config.PARAMETROS_DEPRECIADOS.PATRIMONIO_ALVO_BRL);
    assert.includes(linha.descricao, 'descontinuado');
    assert.equal(Number(linha.valor), 2000000,
      'o valor que o usuário digitou continua na célula: nada é sobrescrito à toa');
  });

  it('só as colunas de metadados são tocadas', { scenario: 'C51' }, () => {
    const ctx = workbookDeProducao();
    FOS.App.Bootstrap.inicializar({
      planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria
    });
    ctx.planilha.chamadasDe('atualizarCampos').forEach((c) => {
      assert.equal(c.nome, A.CONFIG);
      assert.deep(Object.keys(c.campos).sort(), ['descricao', 'reason', 'status']);
    });

    const linha = linhaDe(ctx, 'CUSTO_VIDA_ALVO_MENSAL_BRL');
    assert.equal(linha.tipo, 'NUMERO');
    assert.equal(linha.unidade, 'BRL');
    assert.equal(Number(linha.versao), 1);
  });

  it('as linhas de taxa da mesma aba não são tocadas', { scenario: 'C51' }, () => {
    // A aba 00 guarda taxas publicadas: a migração não pode passar por cima.
    const ctx = workbookDeProducao();
    ctx.repositorio.anexar(A.CONFIG, [
      FOS.Fx.linhaDeCache('GBP', 'BRL', '2026-01-31', 6.3, 'PTAX', dataset.AGORA, null,
        { versao: 1, dataCotacao: '2026-01-30' })
    ]);
    const antes = FOS.Fx.tabelaDeCache(ctx.repositorio.configLinhas());
    FOS.App.Bootstrap.inicializar({
      planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria
    });
    assert.deep(FOS.Fx.tabelaDeCache(ctx.repositorio.configLinhas()), antes);
  });

  it('rodar de novo não reescreve nada', { scenario: 'C51' }, () => {
    const ctx = workbookDeProducao();
    FOS.App.Bootstrap.inicializar({
      planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria
    });
    const r = FOS.App.Bootstrap.inicializar({
      planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria
    });
    assert.deep(r.depreciadas, [], 'a segunda passada não tem o que sincronizar');
  });

  it('planilha nova não tem o que migrar', { scenario: 'C51' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const r = FOS.App.Bootstrap.inicializar({
      planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria
    });
    assert.deep(r.depreciadas, []);
  });

  it('a linha depreciada continua legível para quem abrir a aba 00', { scenario: 'C51' }, () => {
    const ctx = workbookDeProducao();
    FOS.App.Bootstrap.inicializar({
      planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria
    });
    const linha = linhaDe(ctx, 'PATRIMONIO_ALVO_BRL');
    assert.includes(linha.reason, 'SUBSTITUIDO_POR_OBJETIVOS');
    assert.includes(linha.reason, 'NOVO_OBJETIVO');
    assert.includes(linhaDe(ctx, 'CUSTO_VIDA_ALVO_MENSAL_BRL').reason, 'SEM_CONSUMIDOR');
  });
});

describe('Compatibilidade preservada', () => {
  it('um fechamento já gravado continua íntegro e verificável', { scenario: 'C51' }, () => {
    const ctx = workbookDeProducao();
    ctx.repositorio.anexar(A.CONFIG, [
      FOS.Fx.linhaDeCache('GBP', 'BRL', '2025-12-31', 6.2, 'PTAX', dataset.AGORA, null, { versao: 1 }),
      FOS.Fx.linhaDeCache('GBP', 'BRL', '2026-01-31', 6.3, 'PTAX', dataset.AGORA, null, { versao: 1 })
    ]);
    ctx.workflows.importarExtrato({
      contaId: 'INTER_CC', nomeArquivo: 'janeiro.csv', conteudo: dataset.CSV_JANEIRO
    });
    ctx.workflows.conciliarEventos();
    const original = ctx.workflows.fecharCompetencia('2026-01');
    assert.ok(original.validacao.ok, JSON.stringify(original.validacao.violacoes));

    // A migração acontece depois do mês já fechado.
    FOS.App.Bootstrap.inicializar({
      planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria
    });

    const linha = ctx.repositorio.fechamentos().filter((f) => f.competencia === '2026-01')[0];
    assert.equal(linha.checksum, original.fechamento.checksum);
    assert.equal(FOS.Closing.checksumDaLinha(linha), linha.checksum,
      'o snapshot gravado permanece verificável');
    assert.includes(JSON.parse(linha.snapshot_json).metadados.parametros_bloqueados.join(','),
      'URL_PROVEDOR_TAXA_CAMBIO');
  });

  it('meta de patrimônio segue pelo mecanismo de objetivos, intacto', { scenario: 'C51' }, () => {
    // Nenhuma mudança no caminho que substitui o parâmetro removido.
    const ctx = workbookDeProducao();
    ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [dataset.evento({
      evento_id: 'EV-OBJ-1',
      tipo_evento: 'NOVO_OBJETIVO',
      data: '2026-01-10',
      valor: 500000,
      referencia_id: 'OBJ-PATRIMONIO',
      descricao: 'Meta de patrimônio'
    })]);

    const r = ctx.workflows.materializarEventos();
    assert.equal(r.invalidos.length, 0, JSON.stringify(r.invalidos));
    assert.equal(r.objetivos.length, 1);

    const objetivo = ctx.repositorio.objetivos()
      .filter((o) => o.objetivo_id === 'OBJ-PATRIMONIO')[0];
    assert.ok(objetivo, 'o objetivo declarado pelo evento precisa existir');
    assert.equal(Number(objetivo.valor_alvo), 500000);
    assert.equal(Number(objetivo.versao), 1);
    assert.equal(objetivo.origem_evento_id, 'EV-OBJ-1');
  });
});
