'use strict';
/**
 * Migração única: aposentar as dez regras de semente sintéticas.
 *
 * A semente existe para o sistema ter algo a classificar antes da primeira
 * calibração real — andaime de desenvolvimento, não decisão aprovada nem
 * evidência operacional. A política já aprovada é aposentá-la; o que este
 * arquivo testa é que a execução dessa política:
 *
 *  - nunca acontece por instalar código (não está em onOpen);
 *  - mostra o que vai mudar antes de mudar;
 *  - só executa com a palavra exata digitada, nada de aproximação;
 *  - atinge exatamente as dez regras nomeadas, nenhuma outra — em especial
 *    nenhuma regra CAL-*, que é decisão humana calibrada, o oposto do que
 *    esta migração remove;
 *  - preserva a linha, nunca apaga;
 *  - é idempotente, com mensagem própria na segunda execução.
 *
 * Dado inteiramente sintético.
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
const MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');

const SEMENTE = ['R001', 'R010', 'R011', 'R020', 'R021', 'R022', 'R030', 'R040', 'R050', 'R900'];

function montar() {
  return dataset.montarWorkbook({ comDados: false });
}

/** Roda fosAposentarRegrasDeSemente() real contra um workbook em memória. */
function rodar(ctx, respostas) {
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
  sandbox.fosAposentarRegrasDeSemente();
  return ui;
}

function regraPorId(ctx, id) {
  return ctx.repositorio.regras().filter((r) => String(r.regra_id) === id)[0];
}

function ativas(ctx, ids) {
  return ctx.repositorio.regras()
    .filter((r) => ids.indexOf(String(r.regra_id)) !== -1 && FOS.Config.parseBool(r.ativo) === true);
}

/** Retrato estável do que a migração poderia ter escrito. */
function retrato(ctx) {
  return JSON.stringify(ctx.repositorio.regras());
}

describe('Aposentar regras de semente: superfície', () => {
  it('a função existe empacotada, e onOpen não a referencia', { scenario: 'C54' }, () => {
    const ctx = vm.createContext({});
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'financeos.gs'), 'utf8'),
      ctx, { filename: 'financeos.gs' });
    assert.equal(typeof ctx.fosAposentarRegrasDeSemente, 'function');

    const onOpen = MAIN.slice(MAIN.indexOf('function onOpen'), MAIN.indexOf('function fosSetup'));
    assert.equal(onOpen.indexOf('fosAposentarRegrasDeSemente'), -1,
      'a migração não pode aparecer no menu: execução é manual, pelo editor');
  });

  it('não está acoplada a Preparar planilha, Calibrar classificação nem outro workflow',
    { scenario: 'C54' }, () => {
      ['fosSetup', 'fosCalibrarClassificacao', 'fosRevisarPendencias', 'fosFecharMes']
        .forEach((fn) => {
          const inicio = MAIN.indexOf('function ' + fn + '(');
          assert.ok(inicio !== -1, fn + ' precisa existir em main.js');
          const prox = MAIN.indexOf('\nfunction ', inicio + 1);
          const corpo = MAIN.slice(inicio, prox === -1 ? undefined : prox);
          assert.equal(corpo.indexOf('AposentarRegrasDeSemente'), -1,
            fn + ' não pode chamar a migração');
        });
    });
});

describe('Aposentar regras de semente: preview', () => {
  it('lista exatamente as dez, com id, referência, categoria, status e uso',
    { scenario: 'C54' }, () => {
      const ctx = dataset.workbookComMovimento({ comDados: false });
      const preview = ctx.workflows.previewAposentadoriaSemente();

      assert.equal(preview.length, 10);
      assert.deep(preview.map((r) => r.regra_id), SEMENTE);
      preview.forEach((r) => {
        assert.equal(r.encontrada, true);
        assert.equal(r.ativo, true);
        assert.ok(r.categoria, 'categoria ausente para ' + r.regra_id);
        assert.ok(r.valor_referencia, 'valor_referencia ausente para ' + r.regra_id);
        assert.ok(typeof r.classificacoes === 'number');
      });

      // CSV_JANEIRO/FEVEREIRO do dataset batem ALUGUEL (R021) e SUPERMERCADO (R020).
      const r021 = preview.filter((r) => r.regra_id === 'R021')[0];
      assert.ok(r021.classificacoes >= 2, 'ALUGUEL de janeiro e fevereiro deveria contar em R021');
      const r900 = preview.filter((r) => r.regra_id === 'R900')[0];
      assert.equal(r900.classificacoes, 0, 'nada no dataset base casa PIX RECEBIDO de baixa confiança');
    });

  it('o diálogo mostra o preview antes de pedir a confirmação', { scenario: 'C54' }, () => {
    const ctx = montar();
    const ui = rodar(ctx, [null]);
    const prompt = ui.prompts('Aposentar regras de semente')[0];
    assert.ok(prompt, 'esperado o diálogo de confirmação');
    SEMENTE.forEach((id) => assert.includes(prompt.texto, id));
    assert.includes(prompt.texto, 'ATIVA');
    assert.includes(prompt.texto, 'classificações históricas');
    assert.includes(prompt.texto, 'APOSENTAR');
  });
});

describe('Aposentar regras de semente: confirmação', () => {
  it('cancelar não escreve nada, com mensagem própria', { scenario: 'C54' }, () => {
    const ctx = montar();
    const antes = retrato(ctx);
    const ui = rodar(ctx, [null]);

    assert.equal(retrato(ctx), antes);
    assert.equal(ativas(ctx, SEMENTE).length, 10);
    const alerta = ui.alerts('Aposentar regras de semente')[0];
    assert.includes(alerta.texto, 'Cancelado');
    assert.includes(alerta.texto, 'Nada foi gravado');
  });

  it('texto incorreto não escreve nada, com mensagem clara', { scenario: 'C54' }, () => {
    const ctx = montar();
    const antes = retrato(ctx);

    ['aposentar', 'APOSENTAR ', ' APOSENTAR', 'CONFIRMAR', 'sim', '', 'APOSENTA'].forEach((texto) => {
      const ui = rodar(ctx, [texto]);
      assert.equal(retrato(ctx), antes, 'não deveria escrever para: "' + texto + '"');
      const alerta = ui.alerts('Aposentar regras de semente')[0];
      assert.includes(alerta.texto, 'não confere');
      assert.includes(alerta.texto, 'nada foi gravado');
    });
    assert.equal(ativas(ctx, SEMENTE).length, 10);
  });

  it('"aposentar" em minúsculo não é aceito por aproximação', { scenario: 'C54' }, () => {
    const ctx = montar();
    rodar(ctx, ['aposentar']);
    assert.equal(ativas(ctx, SEMENTE).length, 10, 'só o texto exato confirma a migração');
  });

  it('APOSENTAR exato desativa e confirma com contagem', { scenario: 'C54' }, () => {
    const ctx = montar();
    const ui = rodar(ctx, ['APOSENTAR']);

    assert.equal(ativas(ctx, SEMENTE).length, 0);
    const alerta = ui.alerts('Aposentar regras de semente')[1] || ui.alerts('Aposentar regras de semente')[0];
    assert.includes(alerta.texto, '10');
  });
});

describe('Aposentar regras de semente: alcance exato', () => {
  it('desativa exatamente as dez, nem mais nem menos', { scenario: 'C54' }, () => {
    const ctx = montar();
    const r = ctx.workflows.aposentarRegrasDeSemente({ ator: 'USUARIO' });

    assert.equal(r.desativadas, 10);
    assert.deep(r.regras.slice().sort(), SEMENTE.slice().sort());
    assert.equal(ativas(ctx, SEMENTE).length, 0);
    assert.equal(ctx.repositorio.regras().length, 10, 'nenhuma linha some nem aparece');
  });

  it('nenhuma regra CAL-* pode ser atingida', { scenario: 'C54' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    // Uma regra calibrada real, criada fora da migração.
    const calibrada = FOS.Calibration.linhaDeRegra({
      regraId: 'CAL-0001', versao: 1, chave: 'PIX ENVIADO | FULANO DE TAL | SAI',
      direcao: 'SAI', categoria: 'CUSTO_VIDA', agora: dataset.AGORA, desde: '2026-02-01'
    });
    ctx.repositorio.anexar(A.REGRAS, [calibrada]);
    assert.equal(FOS.Config.parseBool(regraPorId(ctx, 'CAL-0001').ativo), true);

    ctx.workflows.aposentarRegrasDeSemente({ ator: 'USUARIO' });

    assert.equal(FOS.Config.parseBool(regraPorId(ctx, 'CAL-0001').ativo), true,
      'a migração de semente não pode desativar regra calibrada');
    assert.equal(regraPorId(ctx, 'CAL-0001').vigente_ate, '',
      'nem sequer tocar seus campos');
  });

  it('regra_id fora da lista, mesmo com nome parecido, não é afetada',
    { scenario: 'C54' }, () => {
      const ctx = montar();
      const estranha = Object.assign({}, regraPorId(ctx, 'R900'), {
        regra_id: 'R9000', valor_referencia: 'OUTRA COISA'
      });
      ctx.repositorio.anexar(A.REGRAS, [estranha]);

      ctx.workflows.aposentarRegrasDeSemente({ ator: 'USUARIO' });

      assert.equal(FOS.Config.parseBool(regraPorId(ctx, 'R9000').ativo), true,
        'só os dez ids literais entram na chamada a desativarRegras');
    });
});

describe('Aposentar regras de semente: preservação e auditoria', () => {
  it('preserva a linha: ativo=FALSE, vigente_ate preenchido, motivo explícito',
    { scenario: 'C54' }, () => {
      const ctx = montar();
      const referencias = {};
      SEMENTE.forEach((id) => { referencias[id] = regraPorId(ctx, id).valor_referencia; });

      ctx.workflows.aposentarRegrasDeSemente({ ator: 'USUARIO' });

      SEMENTE.forEach((id) => {
        const linha = regraPorId(ctx, id);
        assert.ok(linha, 'a linha de ' + id + ' precisa continuar existindo');
        assert.equal(linha.valor_referencia, referencias[id], 'referência preservada em ' + id);
        assert.equal(FOS.Config.parseBool(linha.ativo), false);
        assert.equal(linha.vigente_ate, '2026-05-01');
        assert.equal(linha.observacao, 'APOSENTADA_REGRA_SEMENTE_SINTETICA');
      });
    });

  it('a auditoria registra ator, entidade e o antes/depois', { scenario: 'C54' }, () => {
    const ctx = montar();
    ctx.workflows.aposentarRegrasDeSemente({ ator: 'USUARIO' });

    const registros = ctx.planilha.lerTabela(A.LOG);
    const entrada = registros.filter((e) => String(e.acao) === 'DESATIVAR_REGRAS').slice(-1)[0];

    assert.ok(entrada, 'esperado um registro DESATIVAR_REGRAS na auditoria');
    assert.equal(entrada.ator, 'USUARIO');
    assert.equal(entrada.entidade, A.REGRAS);
    SEMENTE.forEach((id) => assert.includes(entrada.entidade_id, id));
  });
});

describe('Aposentar regras de semente: idempotência', () => {
  it('segunda execução não altera nada e avisa que já está aposentada',
    { scenario: 'C54' }, () => {
      const ctx = montar();
      ctx.workflows.aposentarRegrasDeSemente({ ator: 'USUARIO' });
      const depoisDaPrimeira = retrato(ctx);

      const segunda = ctx.workflows.aposentarRegrasDeSemente({ ator: 'USUARIO' });
      assert.equal(segunda.desativadas, 0);
      assert.equal(segunda.alterado, false);
      assert.equal(retrato(ctx), depoisDaPrimeira, 'nenhuma alteração na segunda execução');
    });

  it('a segunda execução pela UI mostra a mensagem de já aposentada', { scenario: 'C54' }, () => {
    const ctx = montar();
    ctx.workflows.aposentarRegrasDeSemente({ ator: 'USUARIO' });

    const ui = rodar(ctx, ['APOSENTAR']);
    const alerta = ui.alerts('Aposentar regras de semente')[1] || ui.alerts('Aposentar regras de semente')[0];
    assert.includes(alerta.texto, 'já estavam aposentadas');
    assert.equal(ativas(ctx, SEMENTE).length, 0);
  });

  it('o preview na segunda rodada mostra as dez como JA INATIVA', { scenario: 'C54' }, () => {
    const ctx = montar();
    ctx.workflows.aposentarRegrasDeSemente({ ator: 'USUARIO' });
    const preview = ctx.workflows.previewAposentadoriaSemente();
    preview.forEach((r) => assert.equal(r.ativo, false));
  });
});
