'use strict';
/**
 * Runner de testes minimalista, sem dependências externas.
 * Suporta describe/it, tags de cenário canônico e testes marcados como
 * PENDENTE (superfícies visuais previstas para a próxima onda).
 */

const suites = [];
let current = null;

function describe(name, fn) {
  const suite = { name, tests: [] };
  suites.push(suite);
  const prev = current;
  current = suite;
  fn();
  current = prev;
}

/**
 * @param {string} name
 * @param {{scenario?:string, pending?:string}|Function} optsOrFn
 * @param {Function} [maybeFn]
 */
function it(name, optsOrFn, maybeFn) {
  const opts = typeof optsOrFn === 'function' ? {} : optsOrFn || {};
  const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn;
  if (!current) throw new Error('it() fora de describe()');
  current.tests.push({ name, fn, scenario: opts.scenario || null, pending: opts.pending || null });
}

function fail(msg, extra) {
  const err = new Error(msg + (extra ? '\n    ' + extra : ''));
  err.assertion = true;
  throw err;
}

function stable(value) {
  return JSON.stringify(value, function (k, v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce(function (acc, key) { acc[key] = v[key]; return acc; }, {});
    }
    return v;
  });
}

const assert = {
  ok(cond, msg) { if (!cond) fail(msg || 'esperado valor verdadeiro, recebido ' + stable(cond)); },
  notOk(cond, msg) { if (cond) fail(msg || 'esperado valor falso, recebido ' + stable(cond)); },
  equal(actual, expected, msg) {
    if (actual !== expected) fail(msg || 'esperado ' + stable(expected) + ', recebido ' + stable(actual));
  },
  notEqual(actual, expected, msg) {
    if (actual === expected) fail(msg || 'esperado valor diferente de ' + stable(expected));
  },
  close(actual, expected, tol, msg) {
    const t = tol == null ? 1e-9 : tol;
    if (typeof actual !== 'number' || Math.abs(actual - expected) > t) {
      fail(msg || 'esperado ~' + expected + ' (tol ' + t + '), recebido ' + stable(actual));
    }
  },
  deep(actual, expected, msg) {
    if (stable(actual) !== stable(expected)) {
      fail(msg || 'esperado ' + stable(expected) + '\n    recebido ' + stable(actual));
    }
  },
  isNull(actual, msg) { if (actual !== null) fail(msg || 'esperado null, recebido ' + stable(actual)); },
  throws(fn, matcher, msg) {
    let threw = null;
    try { fn(); } catch (e) { threw = e; }
    if (!threw) fail(msg || 'esperado lançamento de erro');
    if (matcher) {
      const text = String(threw.code || '') + ' ' + String(threw.message || '');
      if (text.indexOf(matcher) === -1) {
        fail(msg || 'erro esperado contendo "' + matcher + '", recebido "' + text.trim() + '"');
      }
    }
    return threw;
  },
  includes(haystack, needle, msg) {
    const arr = Array.isArray(haystack) ? haystack : String(haystack);
    const found = Array.isArray(arr) ? arr.indexOf(needle) !== -1 : arr.indexOf(needle) !== -1;
    if (!found) fail(msg || 'esperado conter ' + stable(needle) + ' em ' + stable(haystack));
  }
};

function run(options) {
  const opts = options || {};
  const results = { pass: 0, failCount: 0, pending: 0, failures: [], scenarios: {} };
  for (const suite of suites) {
    let printedSuite = false;
    for (const test of suite.tests) {
      const label = suite.name + ' › ' + test.name;
      if (test.scenario) {
        results.scenarios[test.scenario] = results.scenarios[test.scenario] || { pass: 0, fail: 0, pending: 0 };
      }
      if (test.pending) {
        results.pending++;
        if (test.scenario) results.scenarios[test.scenario].pending++;
        if (!opts.quiet) {
          if (!printedSuite) { console.log('\n  ' + suite.name); printedSuite = true; }
          console.log('    ~ ' + test.name + '  [PENDENTE: ' + test.pending + ']');
        }
        continue;
      }
      try {
        test.fn();
        results.pass++;
        if (test.scenario) results.scenarios[test.scenario].pass++;
        if (!opts.quiet) {
          if (!printedSuite) { console.log('\n  ' + suite.name); printedSuite = true; }
          console.log('    ✓ ' + test.name);
        }
      } catch (e) {
        results.failCount++;
        if (test.scenario) results.scenarios[test.scenario].fail++;
        results.failures.push({ label, error: e });
        if (!opts.quiet) {
          if (!printedSuite) { console.log('\n  ' + suite.name); printedSuite = true; }
          console.log('    ✗ ' + test.name);
        }
      }
    }
  }
  return results;
}

module.exports = { describe, it, assert, run, suites };
