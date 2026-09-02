'use strict';
/**
 * QA visual do dashboard em navegador real (Chromium headless), usando
 * SOMENTE os previews sintéticos gerados por tools/preview.js.
 *
 *   node tools/preview.js && node tools/qa-visual.js
 *
 * Este harness é opcional e não faz parte de `npm test`: a suíte principal
 * continua sem dependência de navegador. Aqui medimos o que só o navegador
 * sabe responder — overflow horizontal real, ordem de foco e contraste
 * computado — para inspeção antes de empacotar.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SAIDA = path.join(RAIZ, 'out');
const PORTA = 9333;

const CANDIDATOS_CHROME = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome'
].filter(Boolean);

function acharChrome() {
  const encontrado = CANDIDATOS_CHROME.find((c) => fs.existsSync(c));
  if (!encontrado) {
    console.error('Chromium não encontrado. Defina CHROME_PATH para rodar o QA visual.');
    process.exit(2);
  }
  return encontrado;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pegarJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let corpo = '';
      res.on('data', (c) => { corpo += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(corpo)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/** Cliente mínimo do DevTools Protocol sobre o WebSocket nativo do Node. */
function conectar(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pendentes = new Map();
    ws.addEventListener('open', () => resolve({
      enviar(metodo, params) {
        id += 1;
        const meuId = id;
        return new Promise((res, rej) => {
          pendentes.set(meuId, { res, rej });
          ws.send(JSON.stringify({ id: meuId, method: metodo, params: params || {} }));
        });
      },
      fechar() { ws.close(); }
    }));
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pendentes.has(msg.id)) {
        const { res, rej } = pendentes.get(msg.id);
        pendentes.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
  });
}

/* Cálculo de contraste WCAG, para conferir os tokens no ambiente real. */
function luminancia(rgb) {
  const canal = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(rgb[0]) + 0.7152 * canal(rgb[1]) + 0.0722 * canal(rgb[2]);
}

function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  const claro = Math.max(la, lb);
  const escuro = Math.min(la, lb);
  return (claro + 0.05) / (escuro + 0.05);
}

function parseRgb(texto) {
  const m = String(texto).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const VIEWPORTS = [
  { nome: 'desktop', largura: 1280, altura: 900 },
  { nome: 'tablet', largura: 820, altura: 1100 },
  { nome: 'mobile', largura: 390, altura: 844 }
];

const SONDA = `(function () {
  var doc = document.documentElement;
  var focaveis = Array.prototype.slice.call(
    document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')
  ).filter(function (el) {
    return el.offsetParent !== null || el.classList.contains('pular');
  });
  var elementos = Array.prototype.slice.call(document.querySelectorAll('main *'));
  var estouros = elementos.filter(function (el) {
    var r = el.getBoundingClientRect();
    return r.right > window.innerWidth + 1 && getComputedStyle(el).overflowX !== 'auto';
  }).map(function (el) {
    return (el.tagName + '.' + (el.className || '')).slice(0, 60);
  });
  var corpo = getComputedStyle(document.body);
  var secundario = document.querySelector('.legenda');
  var rotulo = document.querySelector('.rotulo');
  return {
    scrollWidth: doc.scrollWidth,
    innerWidth: window.innerWidth,
    overflowHorizontal: doc.scrollWidth > window.innerWidth + 1,
    estouros: estouros.slice(0, 5),
    focaveis: focaveis.map(function (el) {
      return {
        tag: el.tagName.toLowerCase(),
        texto: (el.textContent || '').trim().slice(0, 28),
        tabindex: el.getAttribute('tabindex')
      };
    }),
    secoesComTitulo: Array.prototype.slice.call(document.querySelectorAll('section')).map(function (s) {
      return { id: s.id, temTitulo: !!s.getAttribute('aria-labelledby') };
    }),
    tabelasSemCabecalho: Array.prototype.slice.call(document.querySelectorAll('table')).filter(function (t) {
      // Tabelas dentro de estados ocultos (vazio/erro) ainda não foram
      // renderizadas: não são superfície de leitura.
      return t.offsetParent !== null && t.querySelectorAll('th[scope]').length === 0;
    }).length,
    cores: {
      corpoTexto: corpo.color,
      corpoFundo: corpo.backgroundColor,
      secundario: secundario ? getComputedStyle(secundario).color : null,
      rotulo: rotulo ? getComputedStyle(rotulo).color : null,
      superficie: document.querySelector('.celula')
        ? getComputedStyle(document.querySelector('.celula')).backgroundColor : null
    },
    valoresVazios: document.querySelectorAll('.numero.vazio').length,
    motivosVisiveis: document.querySelectorAll('.motivo').length,
    zerosFalsos: Array.prototype.slice.call(document.querySelectorAll('.numero'))
      .filter(function (n) { return n.textContent.indexOf('0,00') !== -1 && n.classList.contains('vazio'); }).length
  };
})()`;

async function main() {
  const arquivos = fs.existsSync(SAIDA)
    ? fs.readdirSync(SAIDA).filter((f) => f.startsWith('preview-') && f.endsWith('.html'))
    : [];
  if (!arquivos.length) {
    console.error('Nenhum preview encontrado. Rode antes: node tools/preview.js');
    process.exit(2);
  }

  const chrome = spawn(acharChrome(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + PORTA, '--remote-allow-origins=*', 'about:blank'
  ], { stdio: 'ignore' });

  let alvo = null;
  for (let i = 0; i < 40 && !alvo; i++) {
    await esperar(250);
    try {
      const lista = await pegarJson('http://127.0.0.1:' + PORTA + '/json/list');
      alvo = lista.find((t) => t.type === 'page');
    } catch (e) { /* ainda subindo */ }
  }
  if (!alvo) { chrome.kill(); console.error('Chromium não respondeu.'); process.exit(2); }

  const cdp = await conectar(alvo.webSocketDebuggerUrl);
  await cdp.enviar('Page.enable');
  await cdp.enviar('Runtime.enable');

  const problemas = [];
  const relatorio = [];

  for (const arquivo of arquivos.sort()) {
    for (const vp of VIEWPORTS) {
      await cdp.enviar('Emulation.setDeviceMetricsOverride', {
        width: vp.largura, height: vp.altura, deviceScaleFactor: 1,
        mobile: vp.nome === 'mobile'
      });
      await cdp.enviar('Page.navigate', { url: 'file://' + path.join(SAIDA, arquivo) });
      await esperar(450);
      const r = await cdp.enviar('Runtime.evaluate', {
        expression: SONDA, returnByValue: true, awaitPromise: false
      });
      const dados = r.result.value;
      if (!dados) { problemas.push(arquivo + '@' + vp.nome + ': sonda não retornou'); continue; }

      if (dados.overflowHorizontal) {
        problemas.push(arquivo + '@' + vp.nome + ': overflow horizontal ('
          + dados.scrollWidth + 'px > ' + dados.innerWidth + 'px) em ' + dados.estouros.join(', '));
      }
      if (dados.tabelasSemCabecalho > 0) {
        problemas.push(arquivo + '@' + vp.nome + ': ' + dados.tabelasSemCabecalho + ' tabela(s) sem th[scope]');
      }
      const comTabindexPositivo = dados.focaveis.filter((f) => Number(f.tabindex) > 0);
      if (comTabindexPositivo.length) {
        problemas.push(arquivo + '@' + vp.nome + ': tabindex positivo quebra a ordem natural de foco');
      }
      if (dados.focaveis.length && dados.focaveis[0].texto.indexOf('Ir para o conteúdo') !== 0) {
        problemas.push(arquivo + '@' + vp.nome + ': o primeiro foco não é o skip link');
      }

      if (vp.nome === 'desktop') {
        const texto = parseRgb(dados.cores.corpoTexto);
        const fundo = parseRgb(dados.cores.corpoFundo);
        const secundario = parseRgb(dados.cores.secundario);
        const superficie = parseRgb(dados.cores.superficie);
        const pares = [
          ['texto/fundo', texto, fundo, 4.5],
          ['secundário/fundo', secundario, fundo, 4.5],
          ['texto/superfície', texto, superficie, 4.5]
        ];
        pares.forEach(([nome, a, b, minimo]) => {
          if (!a || !b) return;
          const razao = contraste(a, b);
          relatorio.push('  contraste ' + nome + ': ' + razao.toFixed(2) + ':1'
            + (razao >= minimo ? ' (AA ok)' : ' (ABAIXO DE AA)'));
          if (razao < minimo) problemas.push(arquivo + ': contraste ' + nome + ' ' + razao.toFixed(2) + ':1 < ' + minimo);
        });
        relatorio.push('  ' + arquivo + ': ' + dados.focaveis.length + ' elementos focáveis, '
          + dados.valoresVazios + ' valores vazios com motivo, '
          + dados.motivosVisiveis + ' motivos visíveis');
      }
    }
  }

  cdp.fechar();
  chrome.kill();

  console.log('QA visual (dataset sintético)\n');
  relatorio.forEach((l) => console.log(l));
  console.log('');
  if (problemas.length) {
    console.log('Problemas encontrados:');
    problemas.forEach((p) => console.log('  - ' + p));
    process.exit(1);
  }
  console.log('Nenhum problema encontrado em ' + arquivos.length + ' preview(s) x '
    + VIEWPORTS.length + ' viewports.');
}

main().catch((e) => { console.error(e); process.exit(2); });
