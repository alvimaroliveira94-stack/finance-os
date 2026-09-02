'use strict';
/**
 * Comando de menu "Publicar taxa do mês".
 *
 * Defeito real encontrado na implantação: a política do V1 é MANUAL, o motor
 * de câmbio já sabia ler taxa materializada na aba 00, mas não havia nenhuma
 * porta para publicar essa taxa. Resultado: nenhuma competência com exposição
 * em GBP fechava, e a única saída era editar a aba interna à mão.
 *
 * Política aprovada que estes testes protegem:
 *  1. a taxa pertence à competência, não ao dia em que se fecha o mês;
 *  2. a data de referência é o último dia calendário da competência;
 *  3. havendo PTAX nessa data, é essa a taxa;
 *  4. não havendo, usa-se a PTAX do último dia útil anterior;
 *  5. quem publica informa a taxa E o dia efetivo da cotação;
 *  6. o sistema guarda as duas datas de forma auditável;
 *  7. POLITICA_TAXA_CAMBIO segue MANUAL e o fechamento segue offline.
 */
const { describe, it, assert } = globalThis.__fosTest;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');
const { DESTINO } = require('../../tools/build');

const A = FOS.Constants.ABAS_INTERNAS;
const MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');

/**
 * Workflows como main.js os monta: nenhum provedor de taxa injetado, então a
 * única fonte possível é o cache materializado na planilha.
 */
function producao(ctx, urlFetchApp) {
  return FOS.App.criarWorkflows({
    repositorio: ctx.repositorio,
    relogio: ctx.relogio,
    ator: 'APPS_SCRIPT',
    auditoria: ctx.auditoria,
    urlFetchApp: urlFetchApp || null
  });
}

/** Workbook de produção com janeiro importado e conciliado, sem taxa nenhuma. */
function comJaneiro() {
  const ctx = dataset.montarWorkbook({ taxas: [] });
  const workflows = producao(ctx);
  workflows.importarExtrato({
    contaId: 'INTER_CC', nomeArquivo: 'janeiro.csv', conteudo: dataset.CSV_JANEIRO
  });
  workflows.conciliarEventos();
  return { ctx, workflows };
}

function linhasDeTaxa(ctx) {
  return ctx.repositorio.configLinhas().filter((r) => r.secao === FOS.Fx.SECAO_TAXA);
}

function logDe(ctx, acao) {
  return ctx.repositorio.planilha.lerTabela(A.LOG).filter((l) => l.acao === acao);
}

describe('Publicar taxa do mês: gravação', () => {
  it('materializa a taxa sob a data de referência da competência', { scenario: 'C49' }, () => {
    const { ctx, workflows } = comJaneiro();
    const r = workflows.publicarTaxaCambio({
      competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-31', ator: 'USUARIO'
    });

    assert.ok(r.ok);
    assert.ok(r.alterado);
    assert.equal(r.resultado, 'OK');
    assert.equal(r.data_referencia, '2026-01-31');
    assert.equal(r.chave, 'BRL/GBP@2026-01-31');
    assert.equal(r.versao, 1);

    const linhas = linhasDeTaxa(ctx);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].chave, 'BRL/GBP@2026-01-31');
    assert.equal(Number(linhas[0].valor), 6.3);
    assert.equal(linhas[0].status, 'ATIVO');
    assert.equal(Number(linhas[0].versao), 1);
    assert.equal(linhas[0].data_cotacao, '2026-01-31');
    assert.equal(linhas[0].modo_ingestao, 'PTAX');
  });

  it('cotação de dia útil anterior vale para a data de referência do mês', { scenario: 'C49' }, () => {
    // 2026-01-31 é sábado: não há PTAX. A política manda usar a do último dia
    // útil anterior — e o sistema guarda as duas datas, sem adivinhar nada.
    const { ctx, workflows } = comJaneiro();
    const r = workflows.publicarTaxaCambio({
      competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30', ator: 'USUARIO'
    });

    assert.equal(r.data_referencia, '2026-01-31');
    assert.equal(r.data_cotacao, '2026-01-30');

    const tabela = FOS.Fx.tabelaDeCache(ctx.repositorio.configLinhas());
    assert.equal(tabela['BRL/GBP']['2026-01-31'].valor, 6.3);
    assert.equal(tabela['BRL/GBP']['2026-01-31'].data_cotacao, '2026-01-30');
    assert.equal(tabela['BRL/GBP']['2026-01-30'], undefined,
      'a cotação não é publicada sob o próprio dia, e sim sob a data de referência');

    const resolvida = FOS.Fx.resolver(tabela, 'GBP', 'BRL', '2026-01-31', 'CACHE');
    assert.equal(resolvida.value, 6.3);
    assert.equal(resolvida.data, '2026-01-31');
    assert.equal(resolvida.data_cotacao, '2026-01-30');
  });

  it('destrava o fechamento que antes bloqueava por falta de taxa', { scenario: 'C49' }, () => {
    const { workflows } = comJaneiro();

    const bloqueado = workflows.fecharCompetencia('2026-01');
    assert.notOk(bloqueado.validacao.ok);
    assert.includes(bloqueado.validacao.violacoes.map((v) => v.codigo), 'TAXA_CAMBIAL_DISPONIVEL');

    workflows.publicarTaxaCambio({ competencia: '2025-12', taxa: 6.2, dataCotacao: '2025-12-31' });
    workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30' });

    const r = workflows.fecharCompetencia('2026-01');
    assert.ok(r.validacao.ok, JSON.stringify(r.validacao.violacoes));
    assert.equal(r.snapshot.cambio.taxa, 6.3);
    assert.equal(r.snapshot.cambio.data_taxa, '2026-01-31');
    assert.equal(r.snapshot.cambio.data_cotacao, '2026-01-30');
    assert.equal(r.snapshot.cambio.provedor, 'PTAX');
    assert.equal(r.snapshot.cambio.efeito_cambial_brl.value, 700);
  });

  it('sem a taxa do mês anterior o mês fecha, mas o efeito cambial fica null', { scenario: 'C49' }, () => {
    const { workflows } = comJaneiro();
    workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30' });

    const r = workflows.fecharCompetencia('2026-01');
    assert.ok(r.validacao.ok, JSON.stringify(r.validacao.violacoes));
    assert.equal(r.snapshot.cambio.taxa, 6.3);
    assert.isNull(r.snapshot.cambio.efeito_cambial_brl.value);
    assert.includes(r.snapshot.cambio.efeito_cambial_brl.reason, 'TAXA_INDISPONIVEL');
  });

  it('o diagnóstico avisa que falta a taxa do mês anterior', { scenario: 'C49' }, () => {
    const { workflows } = comJaneiro();
    workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30' });

    const diag = workflows.diagnosticoSetup('2026-01');
    const aviso = diag.avisos.filter((a) => a.codigo === 'TAXA_CAMBIO_ANTERIOR_NAO_PUBLICADA')[0];
    assert.ok(aviso, 'esperado aviso sobre a taxa da competência anterior');
    assert.equal(aviso.chave, '2025-12');
  });

  it('o diagnóstico diz o que fazer quando a taxa não está publicada', { scenario: 'C49' }, () => {
    const { workflows } = comJaneiro();
    const diag = workflows.diagnosticoSetup('2026-01');
    const bloqueio = diag.bloqueios.filter((b) => b.codigo === 'TAXA_CAMBIO_NAO_PUBLICADA')[0];
    assert.ok(bloqueio, 'esperado bloqueio nomeado para a taxa ausente');
    assert.includes(bloqueio.impacto, 'Publicar taxa do mês');
    assert.includes(bloqueio.impacto, '2026-01-31');
  });
});

describe('Publicar taxa do mês: idempotência e correção', () => {
  it('republicar o mesmo valor e a mesma cotação não grava linha nova', { scenario: 'C49' }, () => {
    const { ctx, workflows } = comJaneiro();
    workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30' });
    const r = workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30' });

    assert.ok(r.ok);
    assert.notOk(r.alterado);
    assert.equal(r.resultado, 'SEM_MUDANCA');
    assert.equal(r.versao, 1);
    assert.equal(linhasDeTaxa(ctx).length, 1);
    assert.equal(logDe(ctx, 'PUBLICAR_TAXA_CAMBIO').filter((l) => l.resultado === 'SEM_MUDANCA').length, 1);
  });

  it('mudar apenas a data da cotação é uma correção, não um no-op', { scenario: 'C49' }, () => {
    const { ctx, workflows } = comJaneiro();
    workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-31' });
    const r = workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30' });

    assert.ok(r.alterado);
    assert.equal(r.versao, 2);
    assert.equal(linhasDeTaxa(ctx).length, 2);
  });

  it('corrigir publica versão maior e preserva a anterior', { scenario: 'C49' }, () => {
    const { ctx, workflows } = comJaneiro();
    workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30' });
    const r = workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.45, dataCotacao: '2026-01-30' });

    assert.equal(r.resultado, 'CORRIGIDA');
    assert.equal(r.versao, 2);
    assert.equal(r.substituiu.taxa, 6.3);

    const linhas = linhasDeTaxa(ctx);
    assert.equal(linhas.length, 2, 'append-only: a versão 1 continua na planilha');
    assert.equal(Number(linhas[0].valor), 6.3);
    assert.equal(Number(linhas[1].valor), 6.45);

    const tabela = FOS.Fx.tabelaDeCache(ctx.repositorio.configLinhas());
    assert.equal(tabela['BRL/GBP']['2026-01-31'].valor, 6.45);
    assert.equal(tabela['BRL/GBP']['2026-01-31'].versao, 2);
  });

  it('a versão vigente é a maior, não a última linha da planilha', { scenario: 'C49' }, () => {
    // Regressão: tabelaDeCache resolvia duplicata por "última linha lida vence",
    // então a ordem física das linhas da aba 00 podia mudar um fechamento.
    const v1 = FOS.Fx.linhaDeCache('GBP', 'BRL', '2026-01-31', 6.3, 'PTAX', '2026-02-01T00:00:00Z',
      null, { versao: 1, dataCotacao: '2026-01-30' });
    const v2 = FOS.Fx.linhaDeCache('GBP', 'BRL', '2026-01-31', 6.45, 'PTAX', '2026-02-02T00:00:00Z',
      null, { versao: 2, dataCotacao: '2026-01-30' });

    assert.equal(FOS.Fx.tabelaDeCache([v1, v2])['BRL/GBP']['2026-01-31'].valor, 6.45);
    assert.equal(FOS.Fx.tabelaDeCache([v2, v1])['BRL/GBP']['2026-01-31'].valor, 6.45,
      'a ordem física das linhas não pode alterar a taxa vigente');
  });

  it('linha bloqueada de versão maior despublica a taxa', { scenario: 'C49' }, () => {
    const v1 = FOS.Fx.linhaDeCache('GBP', 'BRL', '2026-01-31', 6.3, 'PTAX', '2026-02-01T00:00:00Z',
      null, { versao: 1, dataCotacao: '2026-01-30' });
    const v2 = FOS.Fx.linhaDeCache('GBP', 'BRL', '2026-01-31', null, 'PTAX', '2026-02-02T00:00:00Z',
      'TAXA_RETIRADA', { versao: 2 });

    const tabela = FOS.Fx.tabelaDeCache([v1, v2]);
    assert.equal(tabela['BRL/GBP'], undefined);
    assert.includes(
      FOS.Fx.resolver(tabela, 'GBP', 'BRL', '2026-01-31', 'CACHE').reason, 'TAXA_INDISPONIVEL');
  });
});

describe('Publicar taxa do mês: proteções', () => {
  it('recusa competência já fechada e não grava nada', { scenario: 'C49' }, () => {
    const { ctx, workflows } = comJaneiro();
    workflows.publicarTaxaCambio({ competencia: '2025-12', taxa: 6.2, dataCotacao: '2025-12-31' });
    workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30' });
    assert.ok(workflows.fecharCompetencia('2026-01').validacao.ok);

    const antes = linhasDeTaxa(ctx).length;
    assert.throws(
      () => workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 9.9, dataCotacao: '2026-01-30' }),
      'PERIODO_FECHADO');
    assert.equal(linhasDeTaxa(ctx).length, antes);
  });

  it('correção pós-fechamento exige motivo e só vale após reapresentar', { scenario: 'C49' }, () => {
    const { ctx, workflows } = comJaneiro();
    workflows.publicarTaxaCambio({ competencia: '2025-12', taxa: 6.2, dataCotacao: '2025-12-31' });
    workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30' });
    const original = workflows.fecharCompetencia('2026-01');
    assert.ok(original.validacao.ok);

    assert.throws(() => workflows.publicarTaxaCambio({
      competencia: '2026-01', taxa: 6.45, dataCotacao: '2026-01-30', permitirCompetenciaFechada: true
    }), 'MOTIVO_OBRIGATORIO');

    const r = workflows.publicarTaxaCambio({
      competencia: '2026-01', taxa: 6.45, dataCotacao: '2026-01-30',
      permitirCompetenciaFechada: true, motivo: 'PTAX republicada pelo Banco Central', ator: 'USUARIO'
    });
    assert.equal(r.resultado, 'CORRECAO_POS_FECHAMENTO');

    // O fechamento gravado não muda: o snapshot é imutável.
    const gravado = ctx.repositorio.fechamentos().filter((f) => f.competencia === '2026-01')[0];
    assert.equal(JSON.parse(gravado.snapshot_json).cambio.taxa, 6.3);
    assert.equal(gravado.checksum, original.fechamento.checksum);

    // A correção só aparece quando a competência é reapresentada.
    const novo = workflows.reapresentarCompetencia('2026-01', 'Correção da taxa publicada');
    assert.ok(novo.ok, JSON.stringify(novo.validacao && novo.validacao.violacoes));
    assert.equal(Number(novo.resultado.fechamento.versao), 2);
    assert.equal(novo.resultado.snapshot.cambio.taxa, 6.45);
    assert.equal(novo.resultado.snapshot.cambio.data_cotacao, '2026-01-30');
  });

  it('reapresentar sem corrigir a taxa preserva a taxa da época', { scenario: 'C49' }, () => {
    const { ctx, workflows } = comJaneiro();
    workflows.publicarTaxaCambio({ competencia: '2025-12', taxa: 6.2, dataCotacao: '2025-12-31' });
    workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30' });
    workflows.fecharCompetencia('2026-01');

    // Fevereiro tem outra taxa; reprocessar janeiro não pode enxergá-la.
    workflows.publicarTaxaCambio({ competencia: '2026-02', taxa: 9.9, dataCotacao: '2026-02-27' });

    const novo = workflows.reapresentarCompetencia('2026-01', 'Reprocessamento sem mudança de taxa');
    assert.ok(novo.ok, JSON.stringify(novo.validacao && novo.validacao.violacoes));
    assert.equal(novo.resultado.snapshot.cambio.taxa, 6.3);
    assert.equal(novo.resultado.snapshot.cambio.data_cotacao, '2026-01-30');
    assert.equal(ctx.repositorio.configLinhas().filter(
      (r) => r.chave === 'BRL/GBP@2026-01-31').length, 1);
  });

  it('publicar não faz rede em nenhuma hipótese', { scenario: 'C49' }, () => {
    const { ctx } = comJaneiro();
    const proibida = {
      fetch() { throw new Error('o fluxo de publicação manual não pode chamar a rede'); }
    };
    // Mesmo com a política trocada para HTTP e uma URL configurada.
    ctx.repositorio.substituir(A.CONFIG, ctx.repositorio.configLinhas().map((r) => {
      if (r.chave === 'POLITICA_TAXA_CAMBIO') return Object.assign({}, r, { valor: 'HTTP' });
      if (r.chave === 'URL_PROVEDOR_TAXA_CAMBIO') {
        return Object.assign({}, r, { status: 'ATIVO', reason: '', valor: 'https://exemplo.invalido/{data}' });
      }
      return r;
    }));
    const workflows = producao(ctx, proibida);
    const r = workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30' });
    assert.ok(r.alterado);

    // E o fechamento seguinte também continua offline.
    workflows.publicarTaxaCambio({ competencia: '2025-12', taxa: 6.2, dataCotacao: '2025-12-31' });
    assert.ok(workflows.fecharCompetencia('2026-01').validacao.ok);
  });
});

describe('Publicar taxa do mês: validações', () => {
  const casos = [
    ['competência inválida', { competencia: '2026-13', taxa: 6.3 }, 'COMPETENCIA_INVALIDA'],
    ['competência vazia', { competencia: '', taxa: 6.3 }, 'COMPETENCIA_INVALIDA'],
    ['taxa não numérica', { competencia: '2026-01', taxa: 'seis' }, 'TAXA_INVALIDA'],
    ['taxa vazia', { competencia: '2026-01', taxa: '' }, 'TAXA_INVALIDA'],
    ['taxa zero', { competencia: '2026-01', taxa: 0 }, 'TAXA_INVALIDA'],
    ['taxa negativa', { competencia: '2026-01', taxa: -6.3 }, 'TAXA_INVALIDA'],
    ['data de cotação inválida', { competencia: '2026-01', taxa: 6.3, dataCotacao: '31/01/2026' }, 'DATA_INVALIDA'],
    ['cotação depois da referência', { competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-02-02' }, 'DATA_COTACAO_POSTERIOR'],
    ['cotação de outra competência', { competencia: '2026-01', taxa: 6.3, dataCotacao: '2025-12-31' }, 'DATA_COTACAO_FORA_DA_COMPETENCIA']
  ];

  casos.forEach(([nome, params, codigo]) => {
    it('recusa ' + nome + ' sem gravar', { scenario: 'C49' }, () => {
      const { ctx, workflows } = comJaneiro();
      assert.throws(() => workflows.publicarTaxaCambio(params), codigo);
      assert.equal(linhasDeTaxa(ctx).length, 0);
    });
  });

  it('recusa publicar taxa da própria moeda gerencial', { scenario: 'C49' }, () => {
    const { workflows } = comJaneiro();
    assert.throws(() => workflows.publicarTaxaCambio({
      competencia: '2026-01', taxa: 1, moeda: 'BRL'
    }), 'TAXA_DESNECESSARIA');
  });

  it('"Preparar planilha" acrescenta data_cotacao a uma aba 00 já existente', { scenario: 'C49' }, () => {
    // Situação real: a planilha de produção foi criada antes desta coluna
    // existir. O bootstrap é idempotente e reescreve o cabeçalho, então uma
    // passada por "Preparar planilha" migra a estrutura sem perder linha.
    const { ctx, workflows } = comJaneiro();
    const aba = ctx.repositorio.planilha._abas[A.CONFIG];
    const linhasAntes = aba.linhas.length;
    aba.headers = aba.headers.filter((h) => h !== 'data_cotacao');
    assert.throws(() => workflows.publicarTaxaCambio({
      competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30'
    }), 'ESTRUTURA_DESATUALIZADA');

    FOS.App.Bootstrap.inicializar({
      planilha: ctx.repositorio.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria
    });
    assert.includes(ctx.repositorio.planilha.cabecalhos(A.CONFIG), 'data_cotacao');
    assert.equal(ctx.repositorio.planilha._abas[A.CONFIG].linhas.length, linhasAntes,
      'a migração de cabeçalho não pode perder linhas');

    const r = workflows.publicarTaxaCambio({
      competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30'
    });
    assert.ok(r.alterado);
    assert.equal(linhasDeTaxa(ctx)[0].data_cotacao, '2026-01-30');
  });

  it('recusa gravar quando a aba 00 ainda não tem a coluna data_cotacao', { scenario: 'C49' }, () => {
    const { ctx, workflows } = comJaneiro();
    const aba = ctx.repositorio.planilha._abas[A.CONFIG];
    aba.headers = aba.headers.filter((h) => h !== 'data_cotacao');
    assert.throws(() => workflows.publicarTaxaCambio({
      competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30'
    }), 'ESTRUTURA_DESATUALIZADA');
    assert.equal(linhasDeTaxa(ctx).length, 0);
  });
});

describe('Publicar taxa do mês: auditoria e leitura', () => {
  it('registra ator, antes, depois e as duas datas', { scenario: 'C49' }, () => {
    const { ctx, workflows } = comJaneiro();
    workflows.publicarTaxaCambio({
      competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30', ator: 'USUARIO'
    });
    workflows.publicarTaxaCambio({
      competencia: '2026-01', taxa: 6.45, dataCotacao: '2026-01-30', ator: 'USUARIO'
    });

    const log = logDe(ctx, 'PUBLICAR_TAXA_CAMBIO');
    assert.equal(log.length, 2);
    assert.equal(log[0].ator, 'USUARIO', 'o log registra quem agiu, não o ambiente');
    assert.equal(log[0].entidade_id, 'BRL/GBP@2026-01-31');
    assert.equal(log[0].resultado, 'OK');
    assert.equal(log[1].resultado, 'CORRIGIDA');

    const detalhe = JSON.parse(log[0].detalhe);
    assert.equal(detalhe.competencia, '2026-01');
    assert.equal(detalhe.data_referencia, '2026-01-31');
    assert.equal(detalhe.data_cotacao, '2026-01-30');
    assert.equal(detalhe.politica, 'MANUAL');
    assert.equal(detalhe.provedor, 'PTAX');

    assert.equal(log[0].antes, '', 'a primeira publicação não tem estado anterior');
    assert.equal(JSON.parse(log[1].antes).taxa, 6.3);
    assert.equal(JSON.parse(log[1].depois).taxa, 6.45);
  });

  it('taxasPublicadas relata a competência e a anterior', { scenario: 'C49' }, () => {
    const { workflows } = comJaneiro();
    const vazio = workflows.taxasPublicadas('2026-01');
    assert.equal(vazio.par, 'BRL/GBP');
    assert.notOk(vazio.atual.publicada);
    assert.equal(vazio.atual.data_referencia, '2026-01-31');
    assert.equal(vazio.atual.reason, 'TAXA_NAO_PUBLICADA');
    assert.equal(vazio.anterior.competencia, '2025-12');
    assert.equal(vazio.anterior.data_referencia, '2025-12-31');

    workflows.publicarTaxaCambio({ competencia: '2026-01', taxa: 6.3, dataCotacao: '2026-01-30' });
    const parcial = workflows.taxasPublicadas('2026-01');
    assert.ok(parcial.atual.publicada);
    assert.equal(parcial.atual.taxa, 6.3);
    assert.equal(parcial.atual.data_cotacao, '2026-01-30');
    assert.equal(parcial.atual.versao, 1);
    assert.notOk(parcial.anterior.publicada);
  });
});

describe('Ponto de entrada: Publicar taxa do mês', () => {
  it('está no menu, imediatamente antes de Fechar mês', { scenario: 'C49' }, () => {
    assert.includes(MAIN, "addItem('Publicar taxa do mês', 'fosPublicarTaxaCambio')");
    const menu = MAIN.slice(MAIN.indexOf('function onOpen'), MAIN.indexOf('function fosSetup'));
    assert.ok(menu.indexOf('Registrar evento') < menu.indexOf('Publicar taxa do mês'));
    assert.ok(menu.indexOf('Publicar taxa do mês') < menu.indexOf('Fechar mês'));
  });

  it('existe como função global no arquivo empacotado', { scenario: 'C49' }, () => {
    const contexto = vm.createContext({});
    vm.runInContext(fs.readFileSync(DESTINO, 'utf8'), contexto, { filename: 'financeos.gs' });
    assert.equal(typeof contexto.fosPublicarTaxaCambio, 'function');
  });

  it('o comando não oferece edição manual da aba interna', { scenario: 'C49' }, () => {
    const comando = MAIN.slice(
      MAIN.indexOf('function fosPublicarTaxaCambio'), MAIN.indexOf('function fosFecharMes'));
    assert.includes(comando, 'publicarTaxaCambio');
    assert.includes(comando, "ator: 'USUARIO'");
    assert.equal(comando.indexOf('anexarLinhas'), -1, 'o menu não escreve na planilha por fora do workflow');
    assert.equal(comando.indexOf('UrlFetchApp'), -1, 'o comando não conhece rede');
  });

  it('a linha gravada avisa que a aba não deve ser editada à mão', { scenario: 'C49' }, () => {
    const linha = FOS.Fx.linhaDeCache('GBP', 'BRL', '2026-01-31', 6.3, 'PTAX', '2026-02-01T00:00:00Z',
      null, { versao: 1, dataCotacao: '2026-01-30' });
    assert.includes(linha.descricao, 'Não editar à mão');
    assert.includes(linha.descricao, 'menu Finance OS');
    assert.includes(linha.descricao, '2026-01-30');
  });
});
