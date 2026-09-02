'use strict';
const { describe, it, assert } = globalThis.__fosTest;
const fs = require('fs');
const path = require('path');
const FOS = require('../_load');

const RAIZ = path.join(__dirname, '..', '..', 'src');

/** Remove comentários: a verificação é sobre o código, não sobre a prosa. */
function semComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((linha) => linha.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

function lerArquivos(dir) {
  const completo = path.join(RAIZ, dir);
  return fs.readdirSync(completo)
    .filter((f) => f.endsWith('.js'))
    .map((f) => {
      const bruto = fs.readFileSync(path.join(completo, f), 'utf8');
      return { nome: dir + '/' + f, conteudo: semComentarios(bruto), bruto: bruto };
    });
}

describe('Isolamento entre domínio e plataforma', () => {
  const dominio = lerArquivos('domain');

  it('nenhum arquivo de domínio referencia APIs do Apps Script', () => {
    const proibidos = ['SpreadsheetApp', 'DriveApp', 'UrlFetchApp', 'PropertiesService', 'Utilities.'];
    dominio.forEach((arq) => {
      proibidos.forEach((api) => {
        assert.equal(arq.conteudo.indexOf(api), -1, arq.nome + ' referencia ' + api);
      });
    });
  });

  it('nenhum arquivo de domínio lê o relógio do runtime', () => {
    dominio.forEach((arq) => {
      assert.equal(arq.conteudo.indexOf('new Date('), -1, arq.nome + ' usa new Date()');
      assert.equal(arq.conteudo.indexOf('Date.now('), -1, arq.nome + ' usa Date.now()');
      assert.equal(arq.conteudo.indexOf('Math.random('), -1, arq.nome + ' usa Math.random()');
    });
  });

  it('todo arquivo do projeto é sintaticamente válido e carregado pelo loader', () => {
    const carregados = FOS.__arquivos;
    ['domain', 'adapters', 'app'].forEach((dir) => {
      lerArquivos(dir).forEach((arq) => {
        assert.includes(carregados, arq.nome, arq.nome + ' não está no loader');
      });
    });
  });

  it('não há segredo, token ou URL de produção no código', () => {
    const suspeitos = [/api[_-]?key\s*[:=]/i, /secret\s*[:=]\s*['"]/i, /Bearer\s+[A-Za-z0-9]/];
    ['domain', 'adapters', 'app'].forEach((dir) => {
      lerArquivos(dir).forEach((arq) => {
        suspeitos.forEach((re) => {
          assert.notOk(re.test(arq.conteudo), arq.nome + ' parece conter segredo');
        });
      });
    });
  });

  it('appsscript.json declara apenas escopos necessários', () => {
    const manifesto = JSON.parse(fs.readFileSync(path.join(RAIZ, 'appsscript.json'), 'utf8'));
    assert.equal(manifesto.runtimeVersion, 'V8');
    assert.equal(manifesto.oauthScopes.length, 3);
    assert.includes(manifesto.oauthScopes, 'https://www.googleapis.com/auth/spreadsheets.currentonly');
    assert.includes(manifesto.oauthScopes, 'https://www.googleapis.com/auth/drive.readonly');
    assert.notOk(Object.prototype.hasOwnProperty.call(manifesto, 'webapp'),
      'o V1 não publica web app');
  });
});

describe('Ausência de ação financeira autônoma', () => {
  it('nenhum workflow expõe função de mover dinheiro', () => {
    const workflows = FOS.App.criarWorkflows({
      repositorio: { config: () => FOS.Config.build([]), ledger: () => [], staging: () => [] },
      relogio: FOS.Adapters.relogioFixo('2026-01-01T00:00:00Z')
    });
    const proibidas = ['transferir', 'pagar', 'investir', 'executarOrdem', 'conectarConta'];
    proibidas.forEach((nome) => {
      assert.equal(workflows[nome], undefined, 'workflow expõe ' + nome);
    });
  });

  it('toda ação sugerida é marcada como não executável', () => {
    const acoes = FOS.Closing.acoesSugeridas(
      FOS.Constants.values(FOS.Constants.SINAL).map((codigo) => ({ codigo, valor: true })),
      []
    );
    assert.equal(acoes.length, 7);
    acoes.forEach((a) => assert.equal(a.executa_automaticamente, false));
  });
});
