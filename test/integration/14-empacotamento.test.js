'use strict';
/**
 * Empacotamento para o Apps Script.
 *
 * O que estes testes protegem: no Apps Script todo o código global roda antes
 * de qualquer função ser chamada, na ordem em que os arquivos aparecem no
 * editor. Como vários módulos leem FOS.Constants na carga, a ordem errada
 * quebra o projeto antes do primeiro clique. O arquivo único de dist/ elimina
 * esse risco, e aqui garantimos que ele existe, está atualizado e funciona
 * sozinho num contexto limpo.
 */
const { describe, it, assert } = globalThis.__fosTest;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ORDEM } = require('../../tools/ordem');
const { montar, DESTINO } = require('../../tools/build');

const RAIZ = path.join(__dirname, '..', '..');
const SRC = path.join(RAIZ, 'src');

describe('Arquivo único para o Apps Script', () => {
  it('existe e está sincronizado com src/', { scenario: 'C46' }, () => {
    assert.ok(fs.existsSync(DESTINO), 'dist/financeos.gs não existe: rode npm run build');
    assert.equal(fs.readFileSync(DESTINO, 'utf8'), montar(),
      'dist/financeos.gs está desatualizado: rode npm run build');
  });

  it('inclui todos os arquivos de src, inclusive main.js', { scenario: 'C46' }, () => {
    const arquivosEmDisco = [];
    ['domain', 'adapters', 'app'].forEach((dir) => {
      fs.readdirSync(path.join(SRC, dir))
        .filter((f) => f.endsWith('.js'))
        .forEach((f) => arquivosEmDisco.push(dir + '/' + f));
    });
    arquivosEmDisco.push('main.js');
    arquivosEmDisco.forEach((arquivo) => {
      assert.includes(ORDEM, arquivo, 'arquivo fora da ordem canônica: ' + arquivo);
    });
    assert.equal(ORDEM.length, arquivosEmDisco.length, 'a ordem tem arquivo que não existe em src/');
  });

  it('carrega sozinho num contexto limpo e roda o fluxo completo', { scenario: 'C46' }, () => {
    const contexto = vm.createContext({});
    vm.runInContext(fs.readFileSync(DESTINO, 'utf8'), contexto, { filename: 'financeos.gs' });
    const FOS = contexto.FOS;

    assert.ok(FOS, 'o bundle precisa definir o namespace FOS');
    ['Core', 'Constants', 'Schema', 'Ledger', 'Closing', 'ViewModel', 'Surfaces', 'Adapters', 'App']
      .forEach((mod) => assert.ok(FOS[mod], 'módulo ausente no bundle: ' + mod));
    assert.equal(typeof contexto.onOpen, 'function', 'onOpen precisa existir no escopo global');
    assert.equal(typeof contexto.doGet, 'function');

    // Fluxo mínimo usando só o que o bundle define, com planilha em memória.
    const abas = {};
    const planilha = {
      listarAbas() { return Object.keys(abas); },
      criarAba(nome, headers) {
        if (!abas[nome]) abas[nome] = { headers: (headers || []).slice(), linhas: [] };
        return nome;
      },
      cabecalhos(nome) { return abas[nome].headers.slice(); },
      lerTabela(nome) {
        return abas[nome].linhas.map((row) => FOS.Schema.toObject(abas[nome].headers, row));
      },
      anexarLinhas(nome, objetos) {
        (objetos || []).forEach((obj) => {
          abas[nome].linhas.push(abas[nome].headers.map((h) => (obj[h] == null ? '' : obj[h])));
        });
        return (objetos || []).length;
      },
      substituirTabela(nome, objetos) {
        abas[nome].linhas = [];
        return this.anexarLinhas(nome, objetos);
      }
    };
    const repositorio = FOS.App.criarRepositorio(planilha);
    const relogio = FOS.Adapters.relogioFixo('2026-03-05T12:00:00Z');
    FOS.App.Bootstrap.inicializar({ planilha, repositorio, organizar: false });
    assert.equal(planilha.listarAbas().length, 18, '4 abas visíveis + 14 internas');

    const workflows = FOS.App.criarWorkflows({ repositorio, relogio, ator: 'BUNDLE' });
    const r = workflows.importarExtrato({
      contaId: 'INTER_CC',
      nomeArquivo: 'janeiro.csv',
      conteudo: [
        'data;descricao;valor',
        '05/01/2026;ALUGUEL JANEIRO;-2500,00',
        '10/01/2026;ENERGIA ELETRICA;-300,00'
      ].join('\n')
    });
    assert.ok(r.ok, 'o bundle precisa importar extrato de ponta a ponta');
    assert.equal(r.classificadas, 2);
    assert.equal(repositorio.ledger().length, 2);

    const diag = workflows.diagnosticoSetup();
    assert.ok(diag.pronto, JSON.stringify(diag.bloqueios));
  });

  it('a ordem canônica é obrigatória: fora dela o carregamento quebra', { scenario: 'C46' }, () => {
    // Este teste documenta o motivo de existir o arquivo único. Em ordem
    // alfabética (o mais provável ao colar arquivo por arquivo) o código
    // global falha, porque módulos leem FOS.Constants na carga.
    const alfabetica = ORDEM.filter((a) => a !== 'main.js').slice().sort();
    const contexto = vm.createContext({});
    let erro = null;
    try {
      alfabetica.forEach((arquivo) => {
        vm.runInContext(fs.readFileSync(path.join(SRC, arquivo), 'utf8'), contexto, { filename: arquivo });
      });
    } catch (e) {
      erro = e;
    }
    assert.ok(erro, 'se a ordem deixar de importar, este teste e o build podem ser simplificados');
    assert.includes(String(erro.message), 'undefined');
  });

  it('o manifesto declara só o necessário e nenhum web app', { scenario: 'C48' }, () => {
    const manifesto = JSON.parse(fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf8'));
    assert.equal(manifesto.runtimeVersion, 'V8');
    assert.deep(manifesto.oauthScopes.slice().sort(), [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/script.container.ui',
      'https://www.googleapis.com/auth/spreadsheets.currentonly'
    ]);
    ['webapp', 'executionApi', 'urlFetchWhitelist'].forEach((campo) => {
      assert.notOk(Object.prototype.hasOwnProperty.call(manifesto, campo),
        'manifesto não pode declarar ' + campo);
    });
  });

  it('o HTML do painel é um arquivo separado, como o Apps Script exige', { scenario: 'C46' }, () => {
    assert.ok(fs.existsSync(path.join(SRC, 'ui', 'dashboard.html')));
    const bundle = fs.readFileSync(DESTINO, 'utf8');
    // A página mínima de acesso negado é gerada inline no doGet e pode estar
    // no .gs; o que não pode é o painel inteiro ter sido embutido.
    assert.equal(bundle.indexOf('/*__PAINEL__*/null;'), -1,
      'o painel não pode entrar no .gs: precisa ser um arquivo HTML chamado dashboard');
    assert.equal(bundle.indexOf('Content-Security-Policy'), -1);
    assert.includes(bundle, "createHtmlOutputFromFile('dashboard')");
  });
});
