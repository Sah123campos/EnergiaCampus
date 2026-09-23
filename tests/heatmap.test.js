const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function carregarDashboardEmSandbox() {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'dashboard.js'), 'utf8');
  const sandbox = {
    console,
    window: { location: { protocol: 'https:' } },
    document: {
      getElementById: () => null,
      body: { classList: { contains: () => false } },
      addEventListener: () => {},
      createElement: () => ({})
    },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setInterval: () => 1,
    clearInterval: () => {},
    Date,
    Math,
    Array,
    Object,
    Number,
    String,
    parseInt,
    URLSearchParams,
    JSON,
    RegExp,
    Intl,
    navigator: {}
  };

  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox);
  return sandbox;
}

test('heatmap em simulação preenche todos os dias do mês atual', () => {
  const sandbox = carregarDashboardEmSandbox();
  const ano = 2026;
  const mes = 8;
  sandbox.ambientesMonitorados = [{ id: 1, nome: 'Laboratório', tipo: 'Laboratório' }];
  sandbox.heatmapMesAtual = new Date(ano, mes, 1);
  sandbox.modoLocal = false;
  sandbox.simulacaoAtiva = true;
  sandbox.ambienteHeatmapSelecionado = 'todos';
  sandbox.heatmapSimuladoBase = {};

  const matriz = sandbox.gerarHeatmapMensal();
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();

  assert.equal(matriz.length, ultimoDia);
  assert.ok(matriz.every((valor) => valor !== null), 'todos os dias do mês devem ter valor no modo simulação');
});

test('consumo simulado não fica zerado', () => {
  const sandbox = carregarDashboardEmSandbox();
  sandbox.ambientesMonitorados = [{ id: 1, nome: 'Laboratório', tipo: 'Laboratório' }];

  const leitura = sandbox.gerarLeituraAleatoria(1);

  assert.ok(leitura.consumo_kwh > 0, 'o consumo simulado deve ser maior que zero');
  assert.ok(leitura.potencia_w > 0, 'a potência simulada deve ser maior que zero');
});
