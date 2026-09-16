// Função para buscar os dados da API
async function carregarDados() {
    try {
        // 1. Buscar resumo mensal
        const resMensal = await fetch('/api/relatorio/mensal');
        const dadosMensais = await resMensal.json();
        
        document.getElementById('consumo-mes').innerText = dadosMensais.consumo_atual_kwh.toFixed(2);
        document.getElementById('media-potencia').innerText = dadosMensais.media_potencia_w.toFixed(2);
        document.getElementById('total-leituras').innerText = dadosMensais.total_leituras;
        
        let variacao = dadosMensais.variacao_percentual;
        let elVariacao = document.getElementById('variacao');
        elVariacao.innerText = variacao.toFixed(2) + '%';
        // Mudar cor da variação se for negativa ou positiva
        if (variacao > 0) {
            elVariacao.style.color = '#e74c3c'; // Vermelho (gastou mais)
        } else {
            elVariacao.style.color = '#27ae60'; // Verde (economizou)
        }

        // 2. Buscar lista de ambientes
        const resAmbientes = await fetch('/api/ambientes');
        const ambientes = await resAmbientes.json();
        ambientesMonitorados = ambientes;
        
        const corpoTabela = document.getElementById('corpo-tabela');
        corpoTabela.innerHTML = ''; // Limpa a tabela antes de inserir

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

        // 3. Buscar série temporal do primeiro ambiente para o gráfico
        if (ambientes.length > 0) {
            const primeiroAmbienteId = ambientes[0].id;
            carregarGrafico(primeiroAmbienteId);
        }

        // 4. Buscar análise técnica (tensão, potência ativa, fator de potência)
        await carregarAnaliseTecnica();

    } catch (error) {
        console.error("Erro ao carregar dados:", error);
        ativarModoLocal();
        renderizarDadosLocais();
    }
}

// Função para desenhar o gráfico
let meuGrafico;
let intervaloSimulacao;
let intervaloAtualizacaoDashboard;
let simulacaoAtiva = false;
let ambientesMonitorados = [];
let modoLocal = false;
let leiturasLocais = [];

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

    renderizarAnaliseTecnica(calcularAnaliseLocal());
    carregarGrafico(ambientesMonitorados[0].id);
}

// ----------------- ANÁLISE TÉCNICA (Tensão, Potência Ativa, Fator de Potência) -----------------

const TENSAO_NOMINAL = 127.0;
const TENSAO_TOLERANCIA_PCT = 0.05; // faixa adequada: ±5% (ANEEL/Prodist, simplificado)
const FP_MINIMO = 0.85; // limite crítico para fator de potência
const FP_MONITORAR = 0.92; // faixa de atenção
const POTENCIA_ANOMALIA_FATOR = 1.6; // pico 60% acima da média = anomalia de demanda

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

function gerarLeituraAleatoria(ambienteId) {
    const tensao = 127 + (Math.random() - 0.5) * 3;
    const potencia = 100 + Math.random() * 700;
    const fatorPotencia = Math.random() < 0.15
        ? 0.85 + Math.random() * 0.06
        : 0.94 + Math.random() * 0.05;

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

        // Servidor sem ambientes cadastrados (banco vazio) é tratado como indisponível
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
    if (!meuGrafico) {
        return;
    }

    const tema = obterTemaGrafico();
    meuGrafico.options.scales.x.ticks.color = tema.texto;
    meuGrafico.options.scales.y.ticks.color = tema.texto;
    meuGrafico.options.scales.x.grid.color = tema.grade;
    meuGrafico.options.scales.y.grid.color = tema.grade;
    meuGrafico.update();
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

    const labels = dadosSerie.map(d => new Date(d.ts).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}));
    const valores = dadosSerie.map(d => d.w);

    const ctx = document.getElementById('graficoConsumo').getContext('2d');

    // Destruir gráfico antigo se existir
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

function iniciarRelogioReal() {
    atualizarRelogio();
    setInterval(atualizarRelogio, 1000);
}

// Chamar a função quando a página carregar
document.addEventListener('DOMContentLoaded', () => {
    configurarTema();
    configurarSimulacao();
    iniciarRelogioReal();
    iniciarAtualizacaoTempoReal();
    carregarDados();
});