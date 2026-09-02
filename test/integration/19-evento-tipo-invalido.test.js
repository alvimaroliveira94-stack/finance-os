'use strict';
/**
 * Erro silencioso na aba 11_EVENTOS_MANUAIS.
 *
 * Defeito real encontrado na validação de produção: a coluna tipo_evento não
 * tinha lista fechada na planilha, e um valor digitado errado
 * (NOVA_OBRIGAÇÃO com cedilha, espaço sobrando, singular/plural) era
 * descartado sem que ninguém soubesse:
 *
 *  - materializarEventos filtrava o tipo ANTES de validá-lo, então o evento
 *    nunca entrava na lista de inválidos;
 *  - fosRegistrarEvento mostrava só essa lista, e não a da conciliação, que
 *    era justamente a única que continha TIPO_EVENTO_INVALIDO;
 *  - o diagnóstico de setup não mencionava eventos inválidos.
 *
 * O usuário via "Provisões criadas: 0" — a mesma mensagem de quando não há
 * nada a fazer. Nenhum efeito financeiro incorreto era produzido, mas o erro
 * era indistinguível do silêncio normal.
 *
 * Princípio que estes testes protegem: a validação rígida vive no código; o
 * dropdown é conveniência; e nenhum erro pode ser silencioso.
 */
const { describe, it, assert } = globalThis.__fosTest;
const fs = require('fs');
const path = require('path');
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');

const C = FOS.Constants;
const A = C.ABAS_INTERNAS;
const MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');

/** Workflows como main.js os monta, sem nada injetado. */
function producao(ctx) {
  return FOS.App.criarWorkflows({
    repositorio: ctx.repositorio,
    relogio: ctx.relogio,
    ator: 'APPS_SCRIPT',
    auditoria: ctx.auditoria
  });
}

/** Declara um evento na aba 11 exatamente como quem digita nela. */
function comEvento(campos) {
  const ctx = dataset.montarWorkbook({ comDados: false });
  const workflows = producao(ctx);
  ctx.repositorio.anexar(A.EVENTOS_MANUAIS, [Object.assign({
    evento_id: 'EV-001',
    tipo_evento: 'NOVA_OBRIGACAO',
    data: '2026-01-15',
    conta_origem: '',
    conta_destino: '',
    valor: 1000,
    moeda: 'BRL',
    valor_origem_moeda: '',
    moeda_origem: '',
    descricao: 'Obrigação sintética',
    referencia_id: 'PROV-SINTETICA',
    status: 'PENDENTE',
    fingerprint_conciliado: '',
    criado_em: '2026-01-15T10:00:00Z',
    criado_por: 'USUARIO',
    observacao: '3'
  }, campos || {})]);
  return { ctx, workflows };
}

const TYPOS = [
  ['acento', 'NOVA_OBRIGAÇÃO'],
  ['espaço no fim', 'NOVA_OBRIGACAO '],
  ['espaço no meio', 'NOVA OBRIGACAO'],
  ['plural', 'NOVAS_OBRIGACOES'],
  ['vazio', '']
];

describe('Evento com tipo_evento inválido: nada é silencioso', () => {
  TYPOS.forEach(([nome, tipo]) => {
    it('tipo com ' + nome + ' é recusado, não ignorado', { scenario: 'C50' }, () => {
      const { ctx, workflows } = comEvento({ tipo_evento: tipo });
      const mat = workflows.materializarEventos();
      const con = workflows.conciliarEventos();

      assert.equal(ctx.repositorio.provisoes().length, 0, 'nada é materializado');
      assert.equal(mat.invalidos.length, 1, 'a materialização precisa reportar o tipo desconhecido');
      assert.equal(mat.invalidos[0].evento_id, 'EV-001');
      assert.includes(mat.invalidos[0].erros.map((e) => e.codigo), 'TIPO_EVENTO_INVALIDO');
      assert.includes(con.eventosInvalidos.map((i) => i.evento_id), 'EV-001');
    });
  });

  it('o log de auditoria registra a recusa', { scenario: 'C50' }, () => {
    const { ctx, workflows } = comEvento({ tipo_evento: 'NOVA_OBRIGAÇÃO' });
    workflows.materializarEventos();

    const log = ctx.repositorio.planilha.lerTabela(A.LOG)
      .filter((l) => l.acao === 'MATERIALIZAR_EVENTOS');
    assert.equal(log.length, 1, 'antes nem a linha de log era gravada');
    assert.equal(log[0].resultado, 'PARCIAL');
    assert.includes(log[0].detalhe, 'TIPO_EVENTO_INVALIDO');
    assert.includes(log[0].detalhe, 'EV-001');
  });

  it('caixa baixa continua aceita: o domínio normaliza, não recusa', { scenario: 'C50' }, () => {
    const { ctx, workflows } = comEvento({ tipo_evento: 'nova_obrigacao' });
    const mat = workflows.materializarEventos();
    assert.equal(mat.invalidos.length, 0);
    assert.equal(ctx.repositorio.provisoes().length, 1);
  });

  it('tipo válido que não materializa continua passando em silêncio', { scenario: 'C50' }, () => {
    // SAQUE_TRADING é conciliado, não materializado: sair do laço sem gravar
    // é o comportamento correto, e não pode virar falso positivo.
    const { workflows } = comEvento({
      tipo_evento: 'SAQUE_TRADING',
      conta_origem: 'BETFAIR_GBP',
      conta_destino: 'INTER_CC',
      referencia_id: '',
      moeda: 'GBP'
    });
    const mat = workflows.materializarEventos();
    assert.equal(mat.invalidos.length, 0, 'tipo válido não materializável não é erro');
    assert.equal(mat.provisoes.length, 0);
  });

  it('evento cancelado com tipo inválido não vira ruído', { scenario: 'C50' }, () => {
    const { workflows } = comEvento({ tipo_evento: 'NOVA_OBRIGAÇÃO', status: 'CANCELADO' });
    assert.equal(workflows.materializarEventos().invalidos.length, 0,
      'linha retratada pelo usuário não precisa ser cobrada');
  });
});

describe('Diagnóstico de setup avisa antes do fechamento', () => {
  it('lista os eventos inválidos como aviso', { scenario: 'C50' }, () => {
    const { workflows } = comEvento({ tipo_evento: 'NOVA_OBRIGAÇÃO' });
    const diag = workflows.diagnosticoSetup('2026-01');
    const aviso = diag.avisos.filter((a) => a.codigo === 'EVENTOS_MANUAIS_INVALIDOS')[0];

    assert.ok(aviso, 'esperado aviso de eventos inválidos');
    assert.equal(aviso.chave, A.EVENTOS_MANUAIS);
    assert.includes(aviso.reason, 'EV-001');
    assert.includes(aviso.reason, 'TIPO_EVENTO_INVALIDO');
    assert.equal(aviso.eventos.length, 1);
  });

  it('é aviso, não bloqueio: um evento errado não trava o mês', { scenario: 'C50' }, () => {
    const { workflows } = comEvento({ tipo_evento: 'NOVA_OBRIGAÇÃO' });
    const diag = workflows.diagnosticoSetup('2026-01');
    assert.equal(diag.bloqueios.filter((b) => b.codigo === 'EVENTOS_MANUAIS_INVALIDOS').length, 0);
  });

  it('outros erros de declaração também aparecem', { scenario: 'C50' }, () => {
    const { workflows } = comEvento({ tipo_evento: 'NOVA_OBRIGACAO', referencia_id: '' });
    const aviso = workflows.diagnosticoSetup('2026-01').avisos
      .filter((a) => a.codigo === 'EVENTOS_MANUAIS_INVALIDOS')[0];
    assert.ok(aviso);
    assert.includes(aviso.reason, 'REFERENCIA_OBRIGATORIA');
  });

  it('sem evento inválido não há aviso', { scenario: 'C50' }, () => {
    const { workflows } = comEvento({});
    const diag = workflows.diagnosticoSetup('2026-01');
    assert.equal(diag.avisos.filter((a) => a.codigo === 'EVENTOS_MANUAIS_INVALIDOS').length, 0);
  });
});

describe('Lista fechada na aba 11', () => {
  it('tipo_evento, moeda e status recebem lista fechada na preparação', { scenario: 'C50' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const validacoes = ctx.planilha.chamadasDe('validarColunaPorLista')
      .filter((v) => v.nome === A.EVENTOS_MANUAIS);
    assert.deep(validacoes.map((v) => v.coluna), ['tipo_evento', 'moeda', 'status']);
  });

  it('a lista sai do SPEC do domínio, não de uma cópia', { scenario: 'C50' }, () => {
    const ctx = dataset.montarWorkbook({ comDados: false });
    const tipos = ctx.planilha.chamadasDe('validarColunaPorLista')
      .filter((v) => v.nome === A.EVENTOS_MANUAIS && v.coluna === 'tipo_evento')[0].valores;
    assert.deep(tipos, Object.keys(FOS.Events.SPEC));
    assert.equal(tipos.length, 7);
  });

  it('preparar de novo não duplica regra nem perde linha', { scenario: 'C50' }, () => {
    const { ctx } = comEvento({});
    const linhasAntes = ctx.repositorio.eventos().length;
    FOS.App.Bootstrap.inicializar({
      planilha: ctx.planilha, repositorio: ctx.repositorio, auditoria: ctx.auditoria
    });
    const validacoes = ctx.planilha.chamadasDe('validarColunaPorLista')
      .filter((v) => v.nome === A.EVENTOS_MANUAIS && v.coluna === 'tipo_evento');
    assert.equal(validacoes.length, 2, 'reaplicar a mesma regra é idempotente no Sheets');
    assert.deep(validacoes[0].valores, validacoes[1].valores);
    assert.equal(ctx.repositorio.eventos().length, linhasAntes);
  });

  it('os valores existentes na planilha sintética são compatíveis', { scenario: 'C50' }, () => {
    // A validação não pode invalidar o que já está declarado.
    const ctx = dataset.montarWorkbook();
    ctx.repositorio.eventos().forEach((e) => {
      assert.ok(FOS.Events.tipoConhecido(e.tipo_evento), 'tipo fora da lista: ' + e.tipo_evento);
      assert.includes(C.values(C.MOEDA), String(e.moeda).toUpperCase());
      assert.includes(C.values(FOS.Events.STATUS_EVENTO), String(e.status).toUpperCase());
    });
  });

  it('o dropdown não é a fonte de verdade: o código recusa o que foi colado',
    { scenario: 'C50' }, () => {
      // Colar valores no Sheets substitui a regra da célula. Escrever direto no
      // repositório reproduz esse caminho — e o domínio continua recusando.
      const { ctx, workflows } = comEvento({ tipo_evento: 'TIPO_COLADO_QUE_NAO_EXISTE' });
      assert.equal(workflows.materializarEventos().invalidos.length, 1);
      assert.equal(ctx.repositorio.provisoes().length, 0);
    });
});

describe('Ponto de entrada: Registrar evento', () => {
  it('a mensagem junta os dois caminhos de recusa', { scenario: 'C50' }, () => {
    const comando = MAIN.slice(
      MAIN.indexOf('function fosRegistrarEvento'), MAIN.indexOf('function fosPublicarTaxaCambio'));
    assert.includes(comando, 'conciliacao.eventosInvalidos');
    assert.includes(comando, 'r.invalidos');
    assert.includes(comando, 'Eventos recusados');
    assert.includes(comando, '11_EVENTOS_MANUAIS');
  });

  it('_fosEventosRecusados junta sem repetir evento_id', { scenario: 'C50' }, () => {
    const sandbox = {};
    // eslint-disable-next-line no-new-func
    new Function('exports', MAIN.slice(MAIN.indexOf('function _fosEventosRecusados'),
      MAIN.indexOf('/** Registrar evento')) + '\nexports.f = _fosEventosRecusados;')(sandbox);

    const juntos = sandbox.f([
      [{ evento_id: 'EV-1', erros: [{ codigo: 'TIPO_EVENTO_INVALIDO', detalhe: 'NOVA_OBRIGAÇÃO' }] }],
      [
        { evento_id: 'EV-1', erros: [{ codigo: 'TIPO_EVENTO_INVALIDO', detalhe: 'NOVA_OBRIGAÇÃO' }] },
        { evento_id: 'EV-2', erros: [{ codigo: 'CONTA_ORIGEM_DESCONHECIDA', detalhe: 'XPTO' }] }
      ]
    ]);

    assert.equal(juntos.length, 2, 'o mesmo evento nos dois caminhos aparece uma vez só');
    assert.equal(juntos[0].evento_id, 'EV-1');
    assert.deep(juntos[0].erros, ['TIPO_EVENTO_INVALIDO (NOVA_OBRIGAÇÃO)']);
    assert.deep(juntos[1].erros, ['CONTA_ORIGEM_DESCONHECIDA (XPTO)']);
  });

  it('evento sem evento_id ainda é identificável na mensagem', { scenario: 'C50' }, () => {
    const sandbox = {};
    // eslint-disable-next-line no-new-func
    new Function('exports', MAIN.slice(MAIN.indexOf('function _fosEventosRecusados'),
      MAIN.indexOf('/** Registrar evento')) + '\nexports.f = _fosEventosRecusados;')(sandbox);
    const juntos = sandbox.f([[{ evento_id: '', erros: [{ codigo: 'TIPO_EVENTO_INVALIDO' }] }]]);
    assert.equal(juntos[0].evento_id, '(sem evento_id)');
    assert.deep(juntos[0].erros, ['TIPO_EVENTO_INVALIDO']);
  });
});
