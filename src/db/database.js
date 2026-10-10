const path = require('path');
const fs = require('fs');
// Usa o módulo de SQLite que já vem embutido no Node (18+), sem precisar
// compilar nada nativo — evita depender de ferramentas de build no Windows/Mac.
const { DatabaseSync } = require('node:sqlite');
require('dotenv').config();

const dbPath = process.env.DB_PATH || './data/drivelink.db';
const resolvedPath = path.resolve(process.cwd(), dbPath);
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

const db = new DatabaseSync(resolvedPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Schema — ver README.md para o diagrama de entidades.
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('passageiro','motorista','admin')),
  data_cadastro TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS motoristas (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  cpf TEXT NOT NULL UNIQUE,
  cnh TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','bloqueado')),
  online INTEGER NOT NULL DEFAULT 0,
  latitude REAL,
  longitude REAL,
  atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS veiculos (
  id TEXT PRIMARY KEY,
  motorista_id TEXT NOT NULL UNIQUE REFERENCES motoristas(id) ON DELETE CASCADE,
  marca TEXT NOT NULL,
  modelo TEXT NOT NULL,
  cor TEXT NOT NULL,
  placa TEXT NOT NULL,
  documento TEXT
);

CREATE TABLE IF NOT EXISTS corridas (
  id TEXT PRIMARY KEY,
  passageiro_id TEXT NOT NULL REFERENCES usuarios(id),
  motorista_id TEXT REFERENCES motoristas(id),
  origem_endereco TEXT,
  destino_endereco TEXT,
  origem_lat REAL NOT NULL,
  origem_lng REAL NOT NULL,
  destino_lat REAL NOT NULL,
  destino_lng REAL NOT NULL,
  distancia_km REAL NOT NULL,
  valor_estimado REAL NOT NULL,
  valor_final REAL,
  forma_pagamento TEXT DEFAULT 'dinheiro' CHECK (forma_pagamento IN ('dinheiro','pix')),
  status TEXT NOT NULL DEFAULT 'SOLICITADA',
  data_solicitacao TEXT NOT NULL DEFAULT (datetime('now')),
  data_inicio TEXT,
  data_finalizacao TEXT
);

CREATE TABLE IF NOT EXISTS avaliacoes (
  id TEXT PRIMARY KEY,
  corrida_id TEXT NOT NULL REFERENCES corridas(id) ON DELETE CASCADE,
  avaliador_id TEXT NOT NULL REFERENCES usuarios(id),
  avaliado_id TEXT NOT NULL REFERENCES usuarios(id),
  nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario TEXT,
  data TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(corrida_id, avaliador_id)
);

CREATE TABLE IF NOT EXISTS configuracoes (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  taxa_base REAL NOT NULL DEFAULT 5.0,
  valor_por_km REAL NOT NULL DEFAULT 2.0,
  tarifa_minima REAL NOT NULL DEFAULT 8.0
);

INSERT OR IGNORE INTO configuracoes (id, taxa_base, valor_por_km, tarifa_minima)
VALUES (1, 5.0, 2.0, 8.0);
`);

module.exports = db;
