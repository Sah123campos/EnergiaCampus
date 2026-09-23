// Função para buscar os dados da API
async function carregarDados() {
    try {
        const resMensal = await fetch('/api/relatorio/mensal');
        const dadosMensais = await resMensal.json();

        document.getElementById('consumo-mes').innerText = dadosMensais.consumo_atual_kwh.toFixed(2);
        document.getElementById('media-potencia').innerText = dadosMensais.media_potencia_w.toFixed(2);
        document.getElementById('total-leituras').innerText = dadosMensais.total_leituras;

        let variacao = dadosMensais.variacao_percentual;
        let elVariacao = document.getElementById('variacao');
        elVariacao.innerText = variacao.toFixed(2) + '%';

        if (variacao > 0) {
            elVariacao.style.color = '#e74c3c';
        } else {
            elVariacao.style.color = '#27ae60';
        }

        const resAmbientes = await fetch('/api/ambientes');
        const ambientes = await resAmbientes.json();
        ambientesMonitorados = ambientes;
        popularFiltroHeatmap();

        const corpoTabela = document.getElementById('corpo-tabela');
        corpoTabela.innerHTML = '';

        ambientes.forEach(amb => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${amb.id}</td>
                <td>${amb.nome}</td>
                <td>${amb.tipo}</td>
                <td>${amb.consumo_mes_kwh.toFixed(2)}</td>
                <td>${amb.ultima_potencia.toFixed(2)}</td>
            `;
            corpoTabela.appendChild(row);
        });

        if (ambientes.length > 0) {
            const primeiroAmbienteId = ambientes[0].id;
            carregarGrafico(primeiroAmbienteId);
        }

        await carregarAnaliseTecnica();
        await carregarAnomalias();
        await carregarHeatmap();
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
        ativarModoLocal();
        renderizarDadosLocais();
    }
}

let meuGrafico;
let graficoAnomalias;
let intervaloSimulacao;
let intervaloAtualizacaoDashboard;
let simulacaoAtiva = false;
let ambientesMonitorados = [];
let modoLocal = false;
let leiturasLocais = [];
let ambienteHeatmapSelecionado = 'todos';

const ambientesDemonstracao = [
    { id: 1, nome: 'Laboratório', tipo: 'Acadêmico' },
    { id: 2, nome: 'Oficina', tipo: 'Acadêmico' },
    { id: 3, nome: 'Bloco Administrativo', tipo: 'Administrativo' }
];

function ativarModoLocal() {
    modoLocal = true;
    ambientesMonitorados = ambientesDemonstracao.map(ambiente => ({ ...ambiente }));
}

function renderizarDadosLocais() {
    const consumo = leiturasLocais.reduce((total, leitura) => total + leitura.consumo_kwh, 0);
    const potencia = leiturasLocais.length
        ? leiturasLocais.reduce((total, leitura) => total + leitura.potencia_w, 0) / leiturasLocais.length
        : 0;

    document.getElementById('consumo-mes').innerText = consumo.toFixed(2);
    document.getElementById('media-potencia').innerText = potencia.toFixed(2);
    document.getElementById('total-leituras').innerText = leiturasLocais.length;
    document.getElementById('variacao').innerText = '0%';

    const corpoTabela = document.getElementById('corpo-tabela');
    corpoTabela.innerHTML = '';
    ambientesMonitorados.forEach(ambiente => {
        const leiturasAmbiente = leiturasLocais.filter(leitura => leitura.ambiente_id === ambiente.id);
        const consumoAmbiente = leiturasAmbiente.reduce((total, leitura) => total + leitura.consumo_kwh, 0);
        const ultimaLeitura = leiturasAmbiente.at(-1);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${ambiente.id}</td>
            <td>${ambiente.nome}</td>
            <td>${ambiente.tipo}</td>
            <td>${consumoAmbiente.toFixed(2)}</td>
            <td>${ultimaLeitura ? ultimaLeitura.potencia_w.toFixed(2) : '0.00'}</td>
        `;
        corpoTabela.appendChild(row);
    });

    popularFiltroHeatmap();
    renderizarAnaliseTecnica(calcularAnaliseLocal());
    if (ambientesMonitorados.length > 0) {
        carregarGrafico(ambientesMonitorados[0].id);
    }
    carregarAnomalias();
    carregarHeatmap();
}

const TENSAO_NOMINAL = 127.0;
const TENSAO_TOLERANCIA_PCT = 0.05;
const FP_MINIMO = 0.85;
const FP_MONITORAR = 0.92;
const POTENCIA_ANOMALIA_FATOR = 1.6;

function formatarHora(ts) {
    return ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--';
}

function diagnosticarTensao(pico) {
    const limite = TENSAO_NOMINAL * (1 + TENSAO_TOLERANCIA_PCT);
    const sobretensao = pico > limite;
    return {
        picoTexto: `${pico.toFixed(1)} V ${sobretensao ? '⚠️ Sobretensão' : '✅ Normal'}`,
        diagnostico: sobretensao
            ? `⚠️ Sobretensão detectada (acima de ${limite.toFixed(1)} V) — verificar a instalação elétrica`
            : 'Tensão dentro da faixa adequada',
        status: sobretensao ? 'alerta' : 'ok'
    };
}

function diagnosticarPotencia(media, pico, horaPico) {
    const anomalia = media > 0 && pico > media * POTENCIA_ANOMALIA_FATOR;
    const hora = formatarHora(horaPico);
    return {
        picoTexto: `${pico.toFixed(2)} kW às ${hora}${anomalia ? ' ⚠️' : ''}`,
        diagnostico: anomalia
            ? `⚠️ Pico de demanda anômalo às ${hora} — verificar cargas simultâneas`
            : 'Consumo estável',
        status: anomalia ? 'alerta' : 'ok'
    };
}

function diagnosticarFatorPotencia(media, pico) {
    const mediaValida = media !== null && media !== undefined;
    const picoValido = pico !== null && pico !== undefined;

    if (!mediaValida && !picoValido) {
        return {
            picoTexto: '--',
            diagnostico: 'Sem dados de fator de potência',
            status: 'ok'
        };
    }

    const mediaAtual = mediaValida ? media : pico;
    const alerta = mediaAtual < FP_MINIMO;
    const monitorar = mediaAtual >= FP_MINIMO && mediaAtual < FP_MONITORAR;

    return {
        picoTexto: mediaValida
            ? `${mediaAtual.toFixed(2)} ${alerta ? '⚠️ Crítico' : monitorar ? '⚠️ Monitorar' : '✅ Normal'}`
            : `${pico.toFixed(2)} ${alerta ? '⚠️ Crítico' : '✅ Normal'}`,
        diagnostico: alerta
            ? '⚠️ Corrigir fator de potência — instalar banco de capacitores (carga indutiva)'
            : monitorar
                ? '⚠️ Fator de potência próximo do limite — acompanhar operação'
                : 'Fator de potência adequado',
        status: alerta ? 'alerta' : monitorar ? 'alerta' : 'ok'
    };
}

function renderizarAnaliseTecnica(lista) {
    const corpoTensao = document.getElementById('corpo-tensao');
    const corpoPotencia = document.getElementById('corpo-potencia');
    const corpoFp = document.getElementById('corpo-fp');

    if (!corpoTensao || !corpoPotencia || !corpoFp) return;

    corpoTensao.innerHTML = '';
    corpoPotencia.innerHTML = '';
    corpoFp.innerHTML = '';

    lista.forEach(item => {
        const tensao = diagnosticarTensao(item.tensaoPico);
        const linhaTensao = document.createElement('tr');
        linhaTensao.innerHTML = `
            <td>${item.nome}</td>
            <td>${item.tensaoMedia.toFixed(1)} V</td>
            <td>${tensao.picoTexto}</td>
            <td class="status-${tensao.status}">${tensao.diagnostico}</td>
        `;
        corpoTensao.appendChild(linhaTensao);

        const potencia = diagnosticarPotencia(item.potenciaMediaKw, item.potenciaPicoKw, item.potenciaPicoHora);
        const linhaPotencia = document.createElement('tr');
        linhaPotencia.innerHTML = `
            <td>${item.nome}</td>
            <td>${item.potenciaMediaKw.toFixed(2)} kW</td>
            <td>${potencia.picoTexto}</td>
            <td class="status-${potencia.status}">${potencia.diagnostico}</td>
        `;
        corpoPotencia.appendChild(linhaPotencia);

        const fp = diagnosticarFatorPotencia(item.fpMedia, item.fpPico);
        const linhaFp = document.createElement('tr');
        linhaFp.innerHTML = `
            <td>${item.nome}</td>
            <td>${item.fpMedia.toFixed(2)}</td>
            <td>${fp.picoTexto}</td>
            <td class="status-${fp.status}">${fp.diagnostico}</td>
        `;
        corpoFp.appendChild(linhaFp);
    });
}

async function carregarAnaliseTecnica() {
    const resTecnico = await fetch('/api/relatorio/tecnico?horas=24');
    const dados = await resTecnico.json();

    const lista = dados.map(d => ({
        nome: d.nome,
        tensaoMedia: d.tensao_media,
        tensaoPico: d.tensao_pico,
        potenciaMediaKw: d.potencia_media_kw,
        potenciaPicoKw: d.potencia_pico_kw,
        potenciaPicoHora: d.potencia_pico_hora,
        fpMedia: d.fp_media,
        fpPico: d.fp_pico
    }));

    renderizarAnaliseTecnica(lista);
}

function calcularAnaliseLocal() {
    return ambientesMonitorados.map(ambiente => {
        const leituras = leiturasLocais.filter(leitura => leitura.ambiente_id === ambiente.id);

        if (leituras.length === 0) {
            return {
                nome: ambiente.nome,
                tensaoMedia: 0, tensaoPico: 0,
                potenciaMediaKw: 0, potenciaPicoKw: 0, potenciaPicoHora: null,
                fpMedia: 0, fpPico: null
            };
        }

        const tensaoMedia = leituras.reduce((total, l) => total + l.tensao_v, 0) / leituras.length;
        const tensaoPico = Math.max(...leituras.map(l => l.tensao_v));

        const potenciaMediaKw = (leituras.reduce((total, l) => total + l.potencia_w, 0) / leituras.length) / 1000;
        const leituraPicoPotencia = leituras.reduce((maior, l) => l.potencia_w > maior.potencia_w ? l : maior, leituras[0]);

        const fpMedia = leituras.reduce((total, l) => total + l.fator_pot, 0) / leituras.length;
        const fpPico = Math.min(...leituras.map(l => l.fator_pot));

        return {
            nome: ambiente.nome,
            tensaoMedia, tensaoPico,
            potenciaMediaKw,
            potenciaPicoKw: leituraPicoPotencia.potencia_w / 1000,
            potenciaPicoHora: leituraPicoPotencia.ts,
            fpMedia, fpPico
        };
    });
}

const Z_SCORE_LIMITE = 2;

async function carregarAnomalias() {
    let anomalias;
    if (modoLocal) {
        anomalias = calcularAnomaliasLocais();
    } else {
        const resAnomalias = await fetch('/api/anomalias?dias=7');
        anomalias = await resAnomalias.json();
    }
    renderizarAnomalias(anomalias);
}

function calcularAnomaliasLocais() {
    const anomalias = [];

    ambientesMonitorados.forEach(ambiente => {
        const leituras = leiturasLocais.filter(l => l.ambiente_id === ambiente.id);
        if (leituras.length < 2) return;

        const valores = leituras.map(l => l.potencia_w);
        const media = valores.reduce((total, v) => total + v, 0) / valores.length;
        const variancia = valores.reduce((total, v) => total + (v - media) ** 2, 0) / valores.length;
        const desvio = Math.sqrt(variancia);
        if (desvio === 0) return;

        leituras.forEach(l => {
            const zScore = (l.potencia_w - media) / desvio;
            if (Math.abs(zScore) > Z_SCORE_LIMITE) {
                anomalias.push({
                    ambiente_nome: ambiente.nome,
                    ts: l.ts,
                    potencia_w: l.potencia_w,
                    z_score: Number(zScore.toFixed(2))
                });
            }
        });
    });

    return anomalias.sort((a, b) => new Date(b.ts) - new Date(a.ts));
}

function renderizarAnomalias(anomalias) {
    const corpoAnomalias = document.getElementById('corpo-anomalias');
    if (corpoAnomalias) {
        corpoAnomalias.innerHTML = '';
        if (anomalias.length === 0) {
            corpoAnomalias.innerHTML = '<tr><td colspan="4">Nenhuma anomalia detectada no período.</td></tr>';
        } else {
            anomalias.slice(0, 15).forEach(a => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${a.ambiente_nome}</td>
                    <td>${new Date(a.ts).toLocaleString('pt-BR')}</td>
                    <td>${a.potencia_w.toFixed(2)}</td>
                    <td class="status-alerta">z = ${a.z_score}</td>
                `;
                corpoAnomalias.appendChild(row);
            });
        }
    }

    const canvas = document.getElementById('graficoAnomalias');
    if (!canvas) return;

    const tema = obterTemaGrafico();
    const pontos = anomalias.map(a => ({ x: new Date(a.ts).getTime(), y: a.potencia_w }));

    if (graficoAnomalias) {
        graficoAnomalias.destroy();
    }

    graficoAnomalias = new Chart(canvas.getContext('2d'), {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Anomalias (|z| > 2)',
                data: pontos,
                backgroundColor: '#e74c3c',
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            scales: {
                x: {
                    type: 'linear',
                    ticks: {
                        color: tema.texto,
                        callback: (valor) => new Date(valor).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                    },
                    grid: { color: tema.grade }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Potência (W)', color: tema.texto },
                    ticks: { color: tema.texto },
                    grid: { color: tema.grade }
                }
            },
            plugins: {
                legend: { labels: { color: tema.texto } },
                tooltip: {
                    callbacks: {
                        title: (itens) => new Date(itens[0].parsed.x).toLocaleString('pt-BR')
                    }
                }
            }
        }
    });
}

const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

function popularFiltroHeatmap() {
    const select = document.getElementById('filtro-heatmap-ambiente');
    if (!select) return;

    const ambientes = ambientesMonitorados.length ? ambientesMonitorados : ambientesDemonstracao;
    const valorAnterior = ambienteHeatmapSelecionado;
    select.innerHTML = '<option value="todos">Todos</option>';

    ambientes.forEach(ambiente => {
        const option = document.createElement('option');
        option.value = String(ambiente.id);
        option.textContent = `${ambiente.nome} (${ambiente.tipo})`;
        select.appendChild(option);
    });

    if (ambientes.some(ambiente => String(ambiente.id) === String(valorAnterior))) {
        ambienteHeatmapSelecionado = String(valorAnterior);
    } else {
        ambienteHeatmapSelecionado = 'todos';
    }

    select.value = ambienteHeatmapSelecionado;
}

async function carregarHeatmap() {
    let matriz, diasSemana;
    const params = new URLSearchParams({ dias: '30' });
    if (ambienteHeatmapSelecionado && ambienteHeatmapSelecionado !== 'todos') {
        params.set('ambiente_id', ambienteHeatmapSelecionado);
    }

    try {
        if (modoLocal) {
            ({ matriz, diasSemana } = calcularHeatmapLocal());
        } else {
            const resHeatmap = await fetch(`/api/relatorio/heatmap?${params.toString()}`);
            if (!resHeatmap.ok) throw new Error('Resposta inválida do servidor');
            const dados = await resHeatmap.json();
            matriz = dados.matriz;
            diasSemana = dados.dias_semana;
        }
    } catch (err) {
        console.warn('Falha ao carregar heatmap do servidor — usando fallback local/exemplo:', err);

        if (leiturasLocais && leiturasLocais.length > 0) {
            ({ matriz, diasSemana } = calcularHeatmapLocal());
        } else {
            matriz = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => null));
            for (let d = 0; d < 7; d++) {
                for (let h = 7; h <= 20; h++) {
                    const base = 80 + Math.round((Math.sin((h - 6) / 14 * Math.PI) * 220) + Math.random() * 40);
                    matriz[d][h] = base + d * 8;
                }
            }
            diasSemana = DIAS_SEMANA;
        }
    }

    renderizarHeatmap(matriz, diasSemana);
}

function calcularHeatmapLocal() {
    const soma = Array.from({ length: 7 }, () => Array(24).fill(0));
    const contagem = Array.from({ length: 7 }, () => Array(24).fill(0));

    const leiturasFiltradas = ambienteHeatmapSelecionado !== 'todos'
        ? leiturasLocais.filter(l => String(l.ambiente_id) === String(ambienteHeatmapSelecionado))
        : leiturasLocais;

    leiturasFiltradas.forEach(l => {
        const data = new Date(l.ts);
        const diaSemana = (data.getDay() + 6) % 7;
        const hora = data.getHours();
        soma[diaSemana][hora] += l.potencia_w;
        contagem[diaSemana][hora] += 1;
    });

    const matriz = soma.map((linha, dia) =>
        linha.map((total, hora) => contagem[dia][hora] > 0 ? total / contagem[dia][hora] : null)
    );

    return { matriz, diasSemana: DIAS_SEMANA };
}

function corParaValor(valor, minVal, maxVal) {
    if (valor === null || valor === undefined) return null;
    if (maxVal === minVal) return 'hsl(200, 70%, 55%)';
    const t = (valor - minVal) / (maxVal - minVal);
    const matiz = 210 - t * 210;
    return `hsl(${matiz}, 78%, ${58 - t * 16}%)`;
}

function renderizarHeatmap(matriz, diasSemana) {
    const container = document.getElementById('heatmap-container');
    if (!container) return;

    const valores = matriz.flat().filter(v => v !== null && v !== undefined);
    const minVal = valores.length ? Math.min(...valores) : 0;
    const maxVal = valores.length ? Math.max(...valores) : 0;

    let html = '<table class="heatmap-tabela"><thead><tr><th>Hora</th>';
    for (let hora = 0; hora < 24; hora++) {
        html += `<th>${hora}h</th>`;
    }
    html += '</tr></thead><tbody>';

    matriz.forEach((linha, i) => {
        html += `<tr><th>${diasSemana[i]}</th>`;
        linha.forEach(valor => {
            const cor = corParaValor(valor, minVal, maxVal);
            if (cor === null) {
                html += '<td class="heatmap-celula vazia">—</td>';
            } else {
                const texto = Math.round(valor);
                html += `<td class="heatmap-celula" style="background-color:${cor}" title="${texto} W">${texto}</td>`;
            }
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function gerarLeituraAleatoria(ambienteId) {
    const ambiente = ambientesMonitorados.find(ambiente => ambiente.id === ambienteId) || { tipo: 'Acadêmico', nome: `Ambiente ${ambienteId}` };
    const hora = new Date().getHours();
    const padrao = {
        Acadêmico: { base: 260, pico: 520, variacao: 0.8 },
        Administrativo: { base: 180, pico: 330, variacao: 0.55 },
        Comercial: { base: 220, pico: 430, variacao: 0.7 },
        Industrial: { base: 320, pico: 620, variacao: 0.95 }
    };
    const perfil = padrao[ambiente.tipo] || padrao['Acadêmico'];

    const fatorHorario = hora >= 7 && hora <= 18
        ? 1 + (Math.sin(((hora - 7) / 11) * Math.PI) * 0.65)
        : (hora >= 19 || hora <= 6) ? 0.45 + Math.random() * 0.25 : 0.7 + Math.random() * 0.25;

    const potencia = Math.max(
        80,
        (perfil.base + (Math.random() * perfil.variacao * 200)) * fatorHorario + (Math.random() - 0.5) * 100
    );

    const tensao = 127 + (Math.random() - 0.5) * 3;
    const fatorPotencia = Math.random() < 0.1
        ? 0.84 + Math.random() * 0.08
        : 0.92 + Math.random() * 0.06;

    return {
        ambiente_id: ambienteId,
        tensao_v: Number(tensao.toFixed(2)),
        corrente_a: Number((potencia / tensao).toFixed(4)),
        potencia_w: Number(potencia.toFixed(2)),
        potencia_va: Number((potencia / fatorPotencia).toFixed(2)),
        fator_pot: Number(fatorPotencia.toFixed(3)),
        consumo_kwh: Number((potencia / 1000 * 10 / 3600).toFixed(6)),
        sensor: 'simulador-web'
    };
}

async function gerarDadosSimulados() {
    if (ambientesMonitorados.length === 0) {
        try {
            const respostaAmbientes = await fetch('/api/ambientes');
            if (!respostaAmbientes.ok) {
                throw new Error('Não foi possível carregar os ambientes');
            }
            ambientesMonitorados = await respostaAmbientes.json();
        } catch (error) {
            ambientesMonitorados = [];
        }

        if (ambientesMonitorados.length === 0) {
            ativarModoLocal();
        }
    }

    if (modoLocal) {
        ambientesMonitorados.forEach(ambiente => {
            leiturasLocais.push({
                ...gerarLeituraAleatoria(ambiente.id),
                ts: new Date().toISOString()
            });
        });
        renderizarDadosLocais();
        return;
    }

    await Promise.all(ambientesMonitorados.map(async (ambiente) => {
        const resposta = await fetch('/api/leituras', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...gerarLeituraAleatoria(ambiente.id),
                ts: new Date().toISOString()
            })
        });

        if (!resposta.ok) {
            throw new Error(`Falha ao simular ambiente ${ambiente.id}`);
        }
    }));

    await carregarDados();
}

function iniciarAtualizacaoTempoReal() {
    if (intervaloAtualizacaoDashboard) {
        clearInterval(intervaloAtualizacaoDashboard);
    }

    intervaloAtualizacaoDashboard = setInterval(async () => {
        try {
            await carregarDados();
        } catch (error) {
            console.error('Erro ao atualizar painel em tempo real:', error);
        }
    }, 5000);
}

function configurarSimulacao() {
    const botaoSimulacao = document.getElementById('alternar-simulacao');
    if (!botaoSimulacao) return;

    function atualizarBotao(simulando) {
        botaoSimulacao.classList.toggle('running', simulando);
        botaoSimulacao.setAttribute('aria-pressed', String(simulando));
        botaoSimulacao.textContent = simulando
            ? '■ Parar simulação'
            : '▶ Iniciar simulação';
    }

    botaoSimulacao.addEventListener('click', async () => {
        if (simulacaoAtiva) {
            simulacaoAtiva = false;
            clearInterval(intervaloSimulacao);
            intervaloSimulacao = undefined;
            atualizarBotao(false);
            return;
        }

        simulacaoAtiva = true;
        atualizarBotao(true);
        try {
            await gerarDadosSimulados();
            if (simulacaoAtiva) {
                intervaloSimulacao = setInterval(() => {
                    gerarDadosSimulados().catch((error) => {
                        console.error('Erro ao gerar dados simulados:', error);
                    });
                }, 10000);
            }
        } catch (error) {
            simulacaoAtiva = false;
            atualizarBotao(false);
            console.error('Erro ao iniciar simulação:', error);
            alert('Não foi possível iniciar a simulação. Verifique se o servidor está rodando.');
        }
    });
}

function obterTemaGrafico() {
    const modoNoturno = document.body.classList.contains('dark-mode');
    return {
        texto: modoNoturno ? '#d9e2e7' : '#333333',
        grade: modoNoturno ? '#40505c' : '#dddddd'
    };
}

function atualizarTemaGrafico() {
    const tema = obterTemaGrafico();

    if (meuGrafico) {
        meuGrafico.options.scales.x.ticks.color = tema.texto;
        meuGrafico.options.scales.y.ticks.color = tema.texto;
        meuGrafico.options.scales.x.grid.color = tema.grade;
        meuGrafico.options.scales.y.grid.color = tema.grade;
        meuGrafico.update();
    }

    if (graficoAnomalias) {
        graficoAnomalias.options.scales.x.ticks.color = tema.texto;
        graficoAnomalias.options.scales.y.ticks.color = tema.texto;
        graficoAnomalias.options.scales.x.grid.color = tema.grade;
        graficoAnomalias.options.scales.y.grid.color = tema.grade;
        graficoAnomalias.options.scales.y.title.color = tema.texto;
        graficoAnomalias.options.plugins.legend.labels.color = tema.texto;
        graficoAnomalias.update();
    }
}

async function carregarGrafico(ambienteId) {
    let dadosSerie;
    if (modoLocal) {
        dadosSerie = leiturasLocais
            .filter(leitura => leitura.ambiente_id === ambienteId)
            .map(leitura => ({ ts: leitura.ts, w: leitura.potencia_w }));
    } else {
        const resSerie = await fetch(`/api/ambientes/${ambienteId}/serie?horas=24`);
        dadosSerie = await resSerie.json();
    }

    if (!dadosSerie || dadosSerie.length === 0) {
        return;
    }

    const labels = dadosSerie.map(d => new Date(d.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    const valores = dadosSerie.map(d => d.w);

    const ctx = document.getElementById('graficoConsumo').getContext('2d');

    if (meuGrafico) {
        meuGrafico.destroy();
    }

    meuGrafico = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Potência (W)',
                data: valores,
                borderColor: '#3498db',
                backgroundColor: 'rgba(52, 152, 219, 0.2)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: obterTemaGrafico().texto },
                    grid: { color: obterTemaGrafico().grade }
                },
                x: {
                    ticks: { color: obterTemaGrafico().texto },
                    grid: { color: obterTemaGrafico().grade }
                }
            }
        }
    });
}

function atualizarRelogio() {
    const relogio = document.getElementById('relogio-atual');
    if (!relogio) {
        return;
    }

    const agora = new Date();
    relogio.textContent = agora.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function configurarTema() {
    const botaoTema = document.getElementById('alternar-tema');
    if (!botaoTema) return;

    const modoNoturnoSalvo = localStorage.getItem('modo-noturno') === 'true';

    function aplicarTema(modoNoturno) {
        document.body.classList.toggle('dark-mode', modoNoturno);
        botaoTema.setAttribute('aria-pressed', String(modoNoturno));
        botaoTema.innerHTML = modoNoturno
            ? '<span aria-hidden="true">☀</span> Modo claro'
            : '<span aria-hidden="true">☾</span> Modo noturno';
        localStorage.setItem('modo-noturno', String(modoNoturno));
        atualizarTemaGrafico();
    }

    aplicarTema(modoNoturnoSalvo);
    botaoTema.addEventListener('click', () => {
        aplicarTema(!document.body.classList.contains('dark-mode'));
    });
}

function configurarFiltroHeatmapUI() {
    const select = document.getElementById('filtro-heatmap-ambiente');
    if (!select) return;

    select.addEventListener('change', (event) => {
        ambienteHeatmapSelecionado = event.target.value;
        carregarHeatmap();
    });
}

function iniciarRelogioReal() {
    atualizarRelogio();
    setInterval(atualizarRelogio, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
    configurarTema();
    configurarSimulacao();
    configurarFiltroHeatmapUI();
    iniciarRelogioReal();
    iniciarAtualizacaoTempoReal();
    carregarDados();
});