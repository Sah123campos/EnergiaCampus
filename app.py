from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from config import Config
from models import db, Leitura, Ambiente
from datetime import datetime, timedelta
from sqlalchemy import func
import os

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

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)