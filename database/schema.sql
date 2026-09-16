CREATE DATABASE IF NOT EXISTS energiacampus CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE energiacampus;

CREATE TABLE IF NOT EXISTS campus (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    cidade VARCHAR(80) NULL
);

CREATE TABLE IF NOT EXISTS ambiente (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campus_id INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    tipo VARCHAR(50) NULL,
    area_m2 DECIMAL(8,2) NULL,
    CONSTRAINT fk_ambiente_campus FOREIGN KEY (campus_id) REFERENCES campus(id)
);

CREATE TABLE IF NOT EXISTS leitura (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ambiente_id INT NOT NULL,
    tensao_v DECIMAL(8,2) NULL,
    corrente_a DECIMAL(8,4) NULL,
    potencia_w DECIMAL(10,2) NULL,
    potencia_va DECIMAL(10,2) NULL,
    fator_pot DECIMAL(4,3) NULL,
    consumo_kwh DECIMAL(12,6) NULL,
    sensor VARCHAR(30) DEFAULT 'zmpt101b+sct013',
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_leitura_ambiente FOREIGN KEY (ambiente_id) REFERENCES ambiente(id)
);

CREATE INDEX idx_leitura_ambiente_data_hora ON leitura (ambiente_id, data_hora DESC);
