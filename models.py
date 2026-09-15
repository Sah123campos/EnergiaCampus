from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class Campus(db.Model):
    __tablename__ = 'campus'
    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(100), nullable=False)
    cidade = db.Column(db.String(80))
    ambientes = db.relationship('Ambiente', backref='campus', lazy=True)

class Ambiente(db.Model):
    __tablename__ = 'ambiente'
    id = db.Column(db.Integer, primary_key=True)
    campus_id = db.Column(db.Integer, db.ForeignKey('campus.id'), nullable=False)
    nome = db.Column(db.String(100), nullable=False)
    tipo = db.Column(db.String(50))
    area_m2 = db.Column(db.Numeric(8,2))
    leituras = db.relationship('Leitura', backref='ambiente', lazy=True)

class Leitura(db.Model):
    __tablename__ = 'leitura'
    id = db.Column(db.Integer, primary_key=True)
    ambiente_id = db.Column(db.Integer, db.ForeignKey('ambiente.id'), nullable=False)
    tensao_v = db.Column(db.Numeric(8,2))
    corrente_a = db.Column(db.Numeric(8,4))
    potencia_w = db.Column(db.Numeric(10,2))
    potencia_va = db.Column(db.Numeric(10,2))
    fator_pot = db.Column(db.Numeric(4,3))
    consumo_kwh = db.Column(db.Numeric(12,6))
    sensor = db.Column(db.String(30), default='zmpt101b+sct013')
    data_hora = db.Column(db.TIMESTAMP, default=datetime.utcnow)