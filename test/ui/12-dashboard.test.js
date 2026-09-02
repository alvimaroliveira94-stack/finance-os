'use strict';
/**
 * Testes estruturais do dashboard.
 *
 * O HTML é lido como texto e verificado contra o contrato: allowlist,
 * estados, acessibilidade, responsividade, navegação por teclado e
 * segurança. Não há dependência de navegador aqui — a medição em navegador
 * real fica no harness opcional `npm run qa:visual`.
 */
const { describe, it, assert } = globalThis.__fosTest;
const fs = require('fs');
const path = require('path');
const FOS = require('../_load');
const dataset = require('../fixtures/dataset');
const { injetar } = require('../../tools/preview');

const HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'ui', 'dashboard.html'), 'utf8'
);

const TOKENS = {
  background: '#FAF7F2',
  surface: '#FFFFFF',
  texto: '#2B2620',
  secundario: '#6B6459',
  borda: '#E4DED3',
  positivo: '#2F6B4F',
  atencao: '#B8791A',
  risco: '#A63A2E',
  neutro: '#5B6B7A'
};

/* Contraste WCAG calculado a partir dos tokens declarados no CSS. */
function hexParaRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function luminancia(rgb) {
  const canal = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(rgb[0]) + 0.7152 * canal(rgb[1]) + 0.0722 * canal(rgb[2]);
}
function contraste(a, b) {
  const la = luminancia(hexParaRgb(a));
  const lb = luminancia(hexParaRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function painelSintetico() {
  const ctx = dataset.workbookComMovimento({ agora: '2026-03-05T12:00:00Z' });
  ctx.workflows.materializarEventos();
  ctx.workflows.fecharCompetencia('2026-01');
  ctx.workflows.fecharCompetencia('2026-02');
  return ctx.workflows.painel('2026-02', { agora: '2026-03-05' });
}

describe('Sistema visual do dashboard', () => {
  it('usa exatamente os tokens de cor canônicos', { scenario: 'C37' }, () => {
    Object.keys(TOKENS).forEach((nome) => {
      assert.includes(HTML.toUpperCase(), TOKENS[nome].toUpperCase(), 'token ausente: ' + nome);
    });
  });

  it('não introduz cor fora da paleta', { scenario: 'C37' }, () => {
    const hexes = (HTML.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toUpperCase());
    const permitidos = Object.keys(TOKENS).map((k) => TOKENS[k].toUpperCase());
    const forasteiros = hexes.filter((h) => permitidos.indexOf(h) === -1);
    assert.deep(forasteiros, [], 'cores fora da paleta: ' + forasteiros.join(', '));
  });

  it('não usa gradiente, glassmorphism, sombra pesada nem emoji como ícone', { scenario: 'C37' }, () => {
    ['gradient(', 'backdrop-filter', 'box-shadow', 'text-shadow'].forEach((proibido) => {
      assert.equal(HTML.indexOf(proibido), -1, 'proibido no V1: ' + proibido);
    });
    const emojis = HTML.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || [];
    assert.deep(emojis, [], 'emoji encontrado no HTML');
  });

  it('mantém contraste AA nas combinações usadas', { scenario: 'C37' }, () => {
    const pares = [
      ['texto sobre fundo', TOKENS.texto, TOKENS.background, 4.5],
      ['texto sobre superfície', TOKENS.texto, TOKENS.surface, 4.5],
      ['secundário sobre fundo', TOKENS.secundario, TOKENS.background, 4.5],
      ['secundário sobre superfície', TOKENS.secundario, TOKENS.surface, 4.5],
      ['positivo sobre superfície', TOKENS.positivo, TOKENS.surface, 4.5],
      // O token de atenção fica abaixo de AA como texto pequeno: por decisão
      // explícita ele só é usado como acento (borda), com o texto em --texto.
      ['atenção como acento sobre superfície', TOKENS.atencao, TOKENS.surface, 3],
      ['risco sobre superfície', TOKENS.risco, TOKENS.surface, 4.5],
      ['neutro sobre superfície', TOKENS.neutro, TOKENS.surface, 4.5]
    ];
    pares.forEach(([nome, a, b, minimo]) => {
      const razao = contraste(a, b);
      assert.ok(razao >= minimo, nome + ': ' + razao.toFixed(2) + ':1 abaixo de ' + minimo);
    });
  });

  it('o token de atenção nunca é usado como cor de texto', { scenario: 'C37' }, () => {
    // border-color é permitido; o que não pode é `color:` puro.
    const comoTexto = HTML.match(/(^|[^-])color:\s*var\(--atencao\)/gm) || [];
    assert.deep(comoTexto, [],
      'atenção só pode ser acento: como texto pequeno fica abaixo de AA');
  });

  it('alinha números com fonte tabular', { scenario: 'C37' }, () => {
    assert.includes(HTML, 'font-variant-numeric:tabular-nums');
    assert.includes(HTML, 'td.num,th.num{text-align:right');
  });
});

describe('Acessibilidade do dashboard', () => {
  it('tem idioma, título e viewport declarados', { scenario: 'C37' }, () => {
    assert.includes(HTML, '<html lang="pt-BR">');
    assert.includes(HTML, '<title>Finance OS</title>');
    assert.includes(HTML, 'name="viewport"');
  });

  it('tem skip link como primeiro elemento focável', { scenario: 'C39' }, () => {
    const corpo = HTML.slice(HTML.indexOf('<body>'));
    const primeiroFocavel = corpo.indexOf('<a ');
    assert.includes(corpo.slice(primeiroFocavel, primeiroFocavel + 120), 'href="#conteudo"');
    assert.includes(HTML, 'class="pular"');
    assert.includes(HTML, '.pular:focus{left:16px');
  });

  it('usa marcação semântica com seções rotuladas', { scenario: 'C37' }, () => {
    ['<header', '<nav', '<main', '<footer', '<section', '<h1', '<h2', '<h3', '<table', '<caption']
      .forEach((tag) => assert.includes(HTML, tag, 'faltou ' + tag));
    const secoes = HTML.match(/<section [^>]*>/g) || [];
    assert.equal(secoes.length, 4);
    secoes.forEach((s) => assert.includes(s, 'aria-labelledby'));
  });

  it('usa aria só onde é necessário', { scenario: 'C37' }, () => {
    const arias = (HTML.match(/aria-[a-z]+/g) || []);
    const permitidos = ['aria-label', 'aria-labelledby', 'aria-live', 'aria-busy'];
    arias.forEach((a) => assert.includes(permitidos, a, 'aria inesperado: ' + a));
    assert.equal(HTML.indexOf('role="button"'), -1, 'não simular controles com role');
  });

  it('respeita prefers-reduced-motion', { scenario: 'C37' }, () => {
    assert.includes(HTML, '@media (prefers-reduced-motion: no-preference)');
    const animacoes = (HTML.match(/animation:/g) || []).length;
    const dentroDoGuarda = HTML
      .slice(HTML.indexOf('@media (prefers-reduced-motion: no-preference)'))
      .match(/animation:/g) || [];
    assert.equal(animacoes, dentroDoGuarda.length, 'animação fora do guarda de movimento reduzido');
  });

  it('tem foco visível e não usa outline:none', { scenario: 'C39' }, () => {
    assert.includes(HTML, ':focus-visible{outline:2px solid');
    assert.equal(HTML.indexOf('outline:none'), -1);
    assert.equal(HTML.indexOf('outline: none'), -1);
  });
});

describe('Navegação por teclado', () => {
  it('navega por âncoras nativas, sem tabindex positivo', { scenario: 'C39' }, () => {
    const tabindexes = (HTML.match(/tabindex="(-?\d+)"/g) || [])
      .map((t) => Number(t.match(/-?\d+/)[0]));
    tabindexes.forEach((t) => assert.ok(t <= 0, 'tabindex positivo quebra a ordem natural: ' + t));
    assert.includes(HTML, 'id="conteudo" tabindex="-1"', 'alvo do skip link precisa ser focável por script');
  });

  it('as quatro seções são alcançáveis por link de âncora', { scenario: 'C39' }, () => {
    ['#visao-geral', '#planejamento', '#patrimonio', '#historico'].forEach((ancora) => {
      assert.includes(HTML, 'href="' + ancora + '"');
      assert.includes(HTML, 'id="' + ancora.slice(1) + '"');
    });
  });

  it('não depende de mouse: nenhum handler de clique ou hover-only', { scenario: 'C39' }, () => {
    ['onclick=', 'onmouseover=', 'addEventListener(\'click\''].forEach((proibido) => {
      assert.equal(HTML.indexOf(proibido), -1, 'interação dependente de mouse: ' + proibido);
    });
  });
});

describe('Layout responsivo', () => {
  it('limita a largura a 960px e usa a viewport do dispositivo', { scenario: 'C38' }, () => {
    assert.includes(HTML, 'max-width:960px');
    assert.includes(HTML, 'width=device-width, initial-scale=1');
  });

  it('tem pontos de quebra para tablet e mobile', { scenario: 'C38' }, () => {
    assert.includes(HTML, '@media (max-width:820px)');
    assert.includes(HTML, '@media (max-width:560px)');
    const mobile = HTML.slice(HTML.indexOf('@media (max-width:560px)'));
    assert.includes(mobile, 'grid-template-columns:1fr', 'no mobile as grades viram uma coluna');
  });

  it('tabelas largas rolam dentro do próprio container', { scenario: 'C38' }, () => {
    assert.includes(HTML, '.tabela-rolagem{overflow-x:auto}');
    const tabelas = (HTML.match(/<table id=/g) || []).length;
    const containers = (HTML.match(/class="tabela-rolagem"/g) || []).length;
    assert.equal(containers, tabelas, 'toda tabela precisa de container rolável');
  });

  it('não fixa largura em pixels no conteúdo', { scenario: 'C38' }, () => {
    // max-width/min-width são limites, não larguras fixas.
    const largurasFixas = (HTML.match(/(^|[^-])\bwidth:\s*\d{3,}px/gm) || [])
      .filter((l) => l.indexOf('960') === -1);
    assert.deep(largurasFixas, [], 'largura fixa encontrada: ' + largurasFixas.join(', '));
  });
});

describe('Segurança do dashboard', () => {
  it('declara CSP restritiva e bloqueia conexões externas', { scenario: 'C48' }, () => {
    const csp = (HTML.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1];
    assert.ok(csp, 'CSP ausente');
    assert.includes(csp, "default-src 'none'");
    assert.includes(csp, "connect-src 'none'");
    assert.includes(csp, "form-action 'none'");
    assert.includes(csp, "base-uri 'none'");
  });

  it('não carrega nada de fora: sem CDN, host externo ou fonte remota', { scenario: 'C48' }, () => {
    const urls = HTML.match(/https?:\/\/[^\s"')]+/g) || [];
    assert.deep(urls, [], 'referência externa encontrada: ' + urls.join(', '));
    ['<script src', '<link rel="stylesheet"', '@import', 'fetch(', 'XMLHttpRequest', 'WebSocket']
      .forEach((proibido) => assert.equal(HTML.indexOf(proibido), -1, 'proibido: ' + proibido));
  });

  it('não expõe nenhuma chamada ao servidor, muito menos mutável', { scenario: 'C48' }, () => {
    assert.equal(HTML.indexOf('google.script.run'), -1,
      'o painel recebe os dados injetados; não pode chamar o servidor');
    ['localStorage', 'sessionStorage', 'document.cookie', 'eval(']
      .forEach((proibido) => assert.equal(HTML.indexOf(proibido), -1, 'proibido: ' + proibido));
  });

  it('escapa todo conteúdo antes de inserir no DOM', { scenario: 'C48' }, () => {
    assert.includes(HTML, 'function esc(valor)');
    assert.includes(HTML, ".replace(/&/g, '&amp;')");
    const injecoes = (HTML.match(/innerHTML\s*=/g) || []).length;
    assert.ok(injecoes > 0);
    // Todo texto vindo do payload passa por esc(); o teste de payload malicioso
    // abaixo prova o comportamento na prática.
  });

  it('conteúdo malicioso no payload sai escapado', { scenario: 'C48' }, () => {
    const painel = FOS.ViewModel.construirPainel({
      snapshot: null, agora: '2026-03-05',
      historico: [], restatements: [],
      bloqueios: [{ codigo: '<img src=x onerror=alert(1)>', detalhe: '</script><script>alert(2)</script>' }]
    });
    const html = injetar(painel);
    assert.equal(html.indexOf('</script><script>alert(2)'), -1, 'quebra do bloco de script');
    assert.includes(html, '\\u003c', 'o payload precisa escapar sinais de menor');
  });
});

describe('Contrato de dados do dashboard', () => {
  it('consome apenas o payload allowlisted, sem vazamento', { scenario: 'C47' }, () => {
    const painel = painelSintetico();
    assert.deep(FOS.ViewModel.auditarVazamento(painel), []);
    const texto = FOS.Core.canonicalJson(painel);
    ['ALUGUEL', 'SUPERMERCADO', 'extrato-janeiro.csv', 'snapshot_json']
      .forEach((termo) => assert.equal(texto.indexOf(termo), -1, 'vazou: ' + termo));
  });

  it('o payload tem forma estável: atual, histórico, restatements e bloqueios', { scenario: 'C47' }, () => {
    const painel = painelSintetico();
    assert.deep(Object.keys(painel).sort(),
      ['atual', 'bloqueios', 'gerado_em', 'historico', 'restatements', 'somente_leitura']);
    assert.ok(painel.somente_leitura);
    assert.equal(painel.historico.length, 2);
    painel.historico.forEach((h) => {
      Object.keys(h).forEach((campo) => {
        assert.includes(FOS.ViewModel.ALLOWLIST_HISTORICO, campo, 'campo fora da allowlist: ' + campo);
      });
    });
  });

  it('a página renderiza a partir do payload injetado, sem buscar dados', { scenario: 'C47' }, () => {
    assert.includes(HTML, 'var PAINEL = /*__PAINEL__*/null;');
    const html = injetar(painelSintetico());
    assert.equal(html.indexOf('/*__PAINEL__*/null'), -1, 'o payload precisa substituir o marcador');
    assert.includes(html, '"competencia":"2026-02"');
  });

  it('não faz conta financeira no navegador', { scenario: 'C47' }, () => {
    const script = HTML.slice(HTML.lastIndexOf('<script>'));
    ['runway', 'disponivel =', 'caixa_vida =', 'pnl ='].forEach((calculo) => {
      assert.equal(script.indexOf(calculo + ' ='), -1, 'cálculo financeiro no browser: ' + calculo);
    });
    // A única aritmética permitida é de apresentação (percentual da barra).
    const operacoesDivisao = (script.match(/\/ total/g) || []).length;
    assert.ok(operacoesDivisao <= 1, 'aritmética além da proporção da barra');
  });
});

describe('Estados do dashboard', () => {
  it('tem esqueleto de carregamento, vazio, erro e stale', { scenario: 'C35' }, () => {
    ['estado-carregando', 'estado-erro', 'estado-vazio', 'painel'].forEach((id) => {
      assert.includes(HTML, 'id="' + id + '"');
    });
    assert.includes(HTML, 'class="esqueleto"');
    assert.includes(HTML, 'aria-busy="true"');
    assert.includes(HTML, 'faixa-frescor');
  });

  it('valor indisponível vira travessão com motivo, nunca zero', { scenario: 'C35' }, () => {
    assert.includes(HTML, 'class="numero vazio">—');
    assert.includes(HTML, "esc((m && m.reason) || 'VALOR_INDISPONIVEL')");
    const painel = FOS.ViewModel.construirPainel({
      snapshot: {
        competencia: '2026-01', estado: 'FECHADO', moeda_gerencial: 'BRL',
        qualidade: { nivel: 'PARCIAL', itens_fila_abertos: 0, conciliacoes_pendentes: 0 },
        vida: {
          caixa_vida_brl: FOS.Core.nullValue('SALDO_INICIAL_BLOQUEADO'),
          disponivel_brl: FOS.Core.nullValue('CAIXA_INDISPONIVEL'),
          runway_meses: FOS.Core.insufficient('SEM_CUSTO_VIDA_OBSERVADO'),
          custo_vida_mes_brl: FOS.Core.value(0),
          custo_vida_medio_brl: FOS.Core.insufficient('SEM_CUSTO_VIDA_OBSERVADO'),
          funcoes_do_dinheiro: { status: 'NULL', reason: 'CAIXA_INDISPONIVEL' }
        },
        trading: { capital_gbp: FOS.Core.value(100), metricas: {} },
        estado_ciclo: { sugerido: null, formal: null, movimento: 'DADO_INSUFICIENTE' },
        sinais: [], acoes: [], provisoes: [], objetivos: [],
        patrimonio: { brl_gerencial: FOS.Core.nullValue('TAXA_INDISPONIVEL'), por_moeda: {}, posicoes: [] }
      },
      agora: '2026-02-05', historico: [], restatements: [], bloqueios: []
    });
    assert.isNull(painel.atual.dados.vida.caixa_vida_brl.value);
    assert.equal(painel.atual.dados.vida.caixa_vida_brl.reason, 'SALDO_INICIAL_BLOQUEADO');
    assert.equal(painel.atual.dados.vida.runway_meses.status, 'DADO_INSUFICIENTE');
  });

  it('estado de erro não mostra dados', { scenario: 'C35' }, () => {
    const painel = FOS.ViewModel.construirPainel({
      snapshot: null, erro: 'SNAPSHOT_ILEGIVEL', agora: '2026-03-05',
      historico: [], restatements: [], bloqueios: []
    });
    assert.equal(painel.atual.status, 'ERROR');
    assert.isNull(painel.atual.dados);
  });

  it('estado vazio explica o motivo e lista bloqueios', { scenario: 'C35' }, () => {
    const ctx = dataset.montarWorkbook();
    const painel = ctx.workflows.painel(null, { agora: '2026-03-05' });
    assert.equal(painel.atual.status, 'NULL');
    assert.equal(painel.atual.reason, 'SEM_FECHAMENTO_DISPONIVEL');
    assert.includes(HTML, 'id="vazio-bloqueios"');
  });
});
