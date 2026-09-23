const fs = require('fs');
const vm = require('vm');
const codigo = fs.readFileSync('dashboard.js', 'utf8');
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
sandbox.ambientesMonitorados = [{ id: 1, nome: 'Laboratório', tipo: 'Laboratório' }];
sandbox.heatmapMesAtual = new Date(2026, 8, 1);
sandbox.modoLocal = false;
sandbox.simulacaoAtiva = true;
sandbox.ambienteHeatmapSelecionado = 'todos';
sandbox.heatmapSimuladoBase = {};
console.log('sample', sandbox.gerarValorDiaCalendario(1, sandbox.heatmapMesAtual, 1));
console.log('base-before', sandbox.heatmapSimuladoBase);
const matriz = sandbox.gerarHeatmapMensal();
console.log('matriz', matriz.slice(0, 10));
console.log('heatmapSimuladoBase', sandbox.heatmapSimuladoBase);
