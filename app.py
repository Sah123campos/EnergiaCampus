from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from config import Config
from models import db, Leitura, Ambiente
from datetime import datetime, timedelta
from sqlalchemy import func
import os
import statistics

# Configurando o Flask para encontrar a pasta raiz
basedir = os.path.abspath(os.path.dirname(__file__))
app = Flask(__name__,
            static_folder=basedir,
            template_folder=basedir)

app.config.from_object(Config)
CORS(app)
db.init_app(app)

with app.app_context():
    db.create_all()
    print("✅ Banco de dados verificado/criado!")

# ----------------- ROTAS PARA SERVIR O FRONTEND -----------------

# 1. Rota da página inicial (index.html)
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

# 2. Rota para servir TODOS os arquivos estáticos (CSS, JS, imagens, etc)
@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory(app.static_folder, filename)

# ----------------- FIM DAS ROTAS DO FRONTEND -----------------


# ----------------- SUAS ROTAS DE API (Backend) -----------------

@app.route('/api/saude', methods=['GET'])
def health_check():
    return jsonify({'status': 'online', 'timestamp': datetime.now().isoformat()})

@app.route('/api/leituras', methods=['POST'])
def receber_leitura():
    try:
        dados = request.get_json()

        if not dados or 'ambiente_id' not in dados or 'potencia_w' not in dados:
            return jsonify({'erro': 'Payload inválido'}), 400

        nova_leitura = Leitura(
            ambiente_id=dados['ambiente_id'],
            tensao_v=dados.get('tensao_v', 0),
            corrente_a=dados.get('corrente_a', 0),
            potencia_w=dados['potencia_w'],
            potencia_va=dados.get('potencia_va', 0),
            fator_pot=dados.get('fator_pot', 0.85),
            consumo_kwh=dados.get('consumo_kwh', 0),
            sensor=dados.get('sensor', 'iot')
        )

        db.session.add(nova_leitura)
        db.session.commit()

        return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'erro': str(e)}), 500

@app.route('/api/ambientes', methods=['GET'])
def listar_ambientes():
    ambientes = Ambiente.query.all()
    resultado = []

    for amb in ambientes:
        consumo = db.session.query(func.sum(Leitura.consumo_kwh)).filter(
            Leitura.ambiente_id == amb.id,
            Leitura.data_hora >= datetime.now().replace(day=1)
        ).scalar() or 0

        ultima = Leitura.query.filter_by(ambiente_id=amb.id).order_by(Leitura.data_hora.desc()).first()

        resultado.append({
            'id': amb.id,
            'nome': amb.nome,
            'tipo': amb.tipo,
            'consumo_mes_kwh': float(consumo),
            'ultima_potencia': float(ultima.potencia_w) if ultima else 0
        })

    return jsonify(resultado)

@app.route('/api/ambientes/<int:ambiente_id>/serie', methods=['GET'])
def serie_temporal(ambiente_id):
    horas = int(request.args.get('horas', 24))
    leituras = Leitura.query.filter_by(ambiente_id=ambiente_id)\
        .filter(Leitura.data_hora >= datetime.now() - timedelta(hours=horas))\
        .order_by(Leitura.data_hora.asc()).all()

    return jsonify([{
        'ts': l.data_hora.isoformat(),
        'w': float(l.potencia_w),
        'v': float(l.tensao_v)
    } for l in leituras])

@app.route('/api/relatorio/ranking', methods=['GET'])
def ranking_consumo():
    mes_atual = datetime.now().replace(day=1)
    ranking = db.session.query(
        Ambiente.id, Ambiente.nome,
        func.sum(Leitura.consumo_kwh).label('total_kwh')
    ).join(Leitura).filter(Leitura.data_hora >= mes_atual)\
     .group_by(Ambiente.id).order_by(func.sum(Leitura.consumo_kwh).desc()).limit(10).all()

    return jsonify([{
        'id': r.id,
        'nome': r.nome,
        'consumo_kwh': float(r.total_kwh) if r.total_kwh else 0
    } for r in ranking])

@app.route('/api/relatorio/tecnico', methods=['GET'])
def analise_tecnica():
    horas = int(request.args.get('horas', 24))
    desde = datetime.now() - timedelta(hours=horas)
    ambientes = Ambiente.query.all()
    resultado = []

    for amb in ambientes:
        base = Leitura.query.filter(
            Leitura.ambiente_id == amb.id,
            Leitura.data_hora >= desde
        )

        tensao_media, tensao_pico, potencia_media, fp_media, fp_pico = base.with_entities(
            func.avg(Leitura.tensao_v),
            func.max(Leitura.tensao_v),
            func.avg(Leitura.potencia_w),
            func.avg(Leitura.fator_pot),
            func.min(Leitura.fator_pot)
        ).first()

        leitura_pico_potencia = base.order_by(Leitura.potencia_w.desc()).first()

        resultado.append({
            'id': amb.id,
            'nome': amb.nome,
            'tensao_media': float(tensao_media) if tensao_media is not None else 0,
            'tensao_pico': float(tensao_pico) if tensao_pico is not None else 0,
            'potencia_media_kw': float(potencia_media) / 1000 if potencia_media is not None else 0,
            'potencia_pico_kw': float(leitura_pico_potencia.potencia_w) / 1000 if leitura_pico_potencia else 0,
            'potencia_pico_hora': leitura_pico_potencia.data_hora.isoformat() if leitura_pico_potencia else None,
            'fp_media': float(fp_media) if fp_media is not None else 0,
            'fp_pico': float(fp_pico) if fp_pico is not None else None
        })

    return jsonify(resultado)

@app.route('/api/relatorio/mensal', methods=['GET'])
def resumo_mensal():
    mes_atual = datetime.now().replace(day=1)
    mes_passado = (mes_atual - timedelta(days=1)).replace(day=1)

    consumo_atual = db.session.query(func.sum(Leitura.consumo_kwh))\
        .filter(Leitura.data_hora >= mes_atual).scalar() or 0
    consumo_passado = db.session.query(func.sum(Leitura.consumo_kwh))\
        .filter(Leitura.data_hora >= mes_passado).filter(Leitura.data_hora < mes_atual).scalar() or 0
    total_leituras = Leitura.query.count()
    media_potencia = db.session.query(func.avg(Leitura.potencia_w)).scalar() or 0

    variacao = 0
    if consumo_passado > 0:
        variacao = ((consumo_atual - consumo_passado) / consumo_passado) * 100

    return jsonify({
        'consumo_atual_kwh': float(consumo_atual),
        'consumo_mes_passado_kwh': float(consumo_passado),
        'variacao_percentual': float(variacao),
        'media_potencia_w': float(media_potencia),
        'total_leituras': total_leituras,
        'meta_reducao': -10
    })

@app.route('/api/anomalias', methods=['GET'])
def detectar_anomalias():
    """
    Detecção estatística de anomalias por z-score, conforme descrito no artigo:
    desvio superior a 2 em relação à média de potência dos últimos N dias (padrão: 7).
    """
    dias = int(request.args.get('dias', 7))
    desde = datetime.now() - timedelta(days=dias)
    ambientes = Ambiente.query.all()
    anomalias = []

    for amb in ambientes:
        leituras = Leitura.query.filter(
            Leitura.ambiente_id == amb.id,
            Leitura.data_hora >= desde
        ).order_by(Leitura.data_hora.asc()).all()

        valores = [float(l.potencia_w) for l in leituras]
        if len(valores) < 2:
            continue

        media = statistics.mean(valores)
        desvio = statistics.pstdev(valores)
        if desvio == 0:
            continue

        for l in leituras:
            z_score = (float(l.potencia_w) - media) / desvio
            if abs(z_score) > 2:
                anomalias.append({
                    'ambiente_id': amb.id,
                    'ambiente_nome': amb.nome,
                    'ts': l.data_hora.isoformat(),
                    'potencia_w': float(l.potencia_w),
                    'media_periodo_w': round(media, 2),
                    'z_score': round(z_score, 2)
                })

    anomalias.sort(key=lambda a: a['ts'], reverse=True)
    return jsonify(anomalias)


@app.route('/api/relatorio/heatmap', methods=['GET'])
def matriz_calor():
    """
    Matriz de calor hora x dia da semana, citada no artigo como um dos
    endpoints GET consumidos pelo dashboard. Agrega a potência média (W)
    de todos os ambientes por hora (0-23) e dia da semana (0=Segunda ... 6=Domingo).
    """
    dias = int(request.args.get('dias', 30))
    desde = datetime.now() - timedelta(days=dias)

    leituras = db.session.query(
        Leitura.data_hora, Leitura.potencia_w
    ).filter(Leitura.data_hora >= desde).all()

    soma = [[0.0] * 24 for _ in range(7)]
    contagem = [[0] * 24 for _ in range(7)]

    for data_hora, potencia_w in leituras:
        dia_semana = data_hora.weekday()  # 0 = Segunda ... 6 = Domingo
        hora = data_hora.hour
        soma[dia_semana][hora] += float(potencia_w or 0)
        contagem[dia_semana][hora] += 1

    matriz = [
        [
            round(soma[dia][hora] / contagem[dia][hora], 2) if contagem[dia][hora] > 0 else None
            for hora in range(24)
        ]
        for dia in range(7)
    ]

    return jsonify({
        'matriz': matriz,
        'dias_semana': ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'],
        'unidade': 'W'
    })


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)