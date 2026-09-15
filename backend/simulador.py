import random
import requests
import time
import math
from datetime import datetime

API_URL = 'http://localhost:5000/api/leituras'
AMBIENTES = [1, 2, 3]

def consumo_realista(hora):
    """Simula consumo baseado no horário"""
    if 7 <= hora <= 22:
        if 10 <= hora <= 16:
            base = 500 + 200 * math.sin(math.pi * (hora - 10) / 6)
        else:
            base = 300 + 150 * math.sin(math.pi * (hora - 7) / 15)
    else:
        base = 50
    
    return max(20, base + random.gauss(0, base * 0.1))

def gerar_leitura(ambiente_id):
    hora = datetime.now().hour
    w = consumo_realista(hora)
    v = random.gauss(127.0, 1.5)
    i = w / v if v > 0 else 0
    fp = 0.85 + random.gauss(0, 0.02)
    fp = max(0.7, min(0.95, fp))
    
    return {
        'ambiente_id': ambiente_id,
        'tensao_v': round(v, 2),
        'corrente_a': round(i, 4),
        'potencia_w': round(w, 2),
        'potencia_va': round(w / fp, 2),
        'fator_pot': round(fp, 3),
        'consumo_kwh': round(w / 1000 * (1/60), 6),
        'sensor': 'simulador'
    }

def executar_simulador():
    print(f"🚀 Simulador iniciado em {datetime.now()}")
    print(f"📡 Enviando dados para {API_URL}")
    print(f"🏢 Ambientes: {AMBIENTES}")
    print("=" * 50)
    
    contador = 0
    while True:
        try:
            for amb_id in AMBIENTES:
                dados = gerar_leitura(amb_id)
                print(f"📤 Enviando: Ambiente {amb_id} - {dados['potencia_w']}W")
                
                resposta = requests.post(API_URL, json=dados, timeout=5)
                
                if resposta.status_code == 201:
                    contador += 1
                    print(f"✅ #{contador} | Ambiente {amb_id} | {dados['potencia_w']}W | {dados['tensao_v']}V")
                else:
                    print(f"❌ Erro: {resposta.status_code} - {resposta.text}")
                
                time.sleep(2)
            
            print(f"⏳ Total: {contador} leituras | Aguardando 30s...")
            time.sleep(30)
            
        except KeyboardInterrupt:
            print("\n🛑 Simulador interrompido!")
            break
        except Exception as e:
            print(f"⚠️ Erro: {e}")
            time.sleep(5)

if __name__ == '__main__':
    executar_simulador()