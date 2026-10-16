'use strict';
// Conexão SQLite, esquema do banco e utilitários de senha/transação.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ARQUIVO = process.env.DB_PATH || path.join(__dirname, 'data', 'grade.db');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY,
  login       TEXT NOT NULL UNIQUE,
  nome        TEXT NOT NULL,
  cargo       TEXT NOT NULL DEFAULT 'Coordenador',
  senha_hash  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessoes (
  token       TEXT PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voluntarios (
  id            INTEGER PRIMARY KEY,
  nome          TEXT NOT NULL,
  email         TEXT,
  telefone      TEXT,
  observacoes   TEXT,
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  limite_aulas  INTEGER NOT NULL DEFAULT 4 CHECK (limite_aulas BETWEEN 1 AND 40),
  criado_em     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS disciplinas (
  id              INTEGER PRIMARY KEY,
  nome            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  aulas_semanais  INTEGER NOT NULL DEFAULT 1 CHECK (aulas_semanais BETWEEN 0 AND 40),
  duracao_min     INTEGER CHECK (duracao_min IS NULL OR duracao_min BETWEEN 10 AND 600)
);

CREATE TABLE IF NOT EXISTS turmas (
  id         INTEGER PRIMARY KEY,
  nome       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  periodo    TEXT NOT NULL,
  descricao  TEXT
);

-- Horários-padrão das aulas (ex.: Seg 19:00–20:30). Dia: 1 = segunda … 7 = domingo.
CREATE TABLE IF NOT EXISTS horarios (
  id      INTEGER PRIMARY KEY,
  dia     INTEGER NOT NULL CHECK (dia BETWEEN 1 AND 7),
  inicio  TEXT NOT NULL,
  fim     TEXT NOT NULL,
  CHECK (fim > inicio),
  UNIQUE (dia, inicio)
);

CREATE TABLE IF NOT EXISTS voluntario_disciplinas (
  voluntario_id  INTEGER NOT NULL REFERENCES voluntarios(id) ON DELETE CASCADE,
  disciplina_id  INTEGER NOT NULL REFERENCES disciplinas(id) ON DELETE CASCADE,
  PRIMARY KEY (voluntario_id, disciplina_id)
);

CREATE TABLE IF NOT EXISTS disponibilidades (
  voluntario_id  INTEGER NOT NULL REFERENCES voluntarios(id) ON DELETE CASCADE,
  horario_id     INTEGER NOT NULL REFERENCES horarios(id) ON DELETE CASCADE,
  PRIMARY KEY (voluntario_id, horario_id)
);

-- Cada aula é uma ocorrência de horário vinculada a uma turma e a uma disciplina.
CREATE TABLE IF NOT EXISTS aulas (
  id             INTEGER PRIMARY KEY,
  turma_id       INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  horario_id     INTEGER NOT NULL REFERENCES horarios(id) ON DELETE CASCADE,
  disciplina_id  INTEGER NOT NULL REFERENCES disciplinas(id) ON DELETE RESTRICT,
  voluntario_id  INTEGER REFERENCES voluntarios(id) ON DELETE SET NULL,
  atualizado_em  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (turma_id, horario_id)
);

-- Histórico de alterações (RF17 / RNF10). Sem chave estrangeira para sobreviver a exclusões.
CREATE TABLE IF NOT EXISTS historico (
  id              INTEGER PRIMARY KEY,
  data            TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  usuario         TEXT,
  tipo            TEXT NOT NULL,
  aula_id         INTEGER,
  descricao       TEXT NOT NULL,
  valor_anterior  TEXT,
  valor_novo      TEXT
);

CREATE INDEX IF NOT EXISTS idx_aulas_voluntario ON aulas (voluntario_id);
CREATE INDEX IF NOT EXISTS idx_historico_data ON historico (data DESC);
`;

function hashSenha(senha, sal = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(senha, sal, 64).toString('hex');
  return `${sal}:${hash}`;
}

function conferirSenha(senha, armazenado) {
  const [sal, hash] = String(armazenado).split(':');
  if (!sal || !hash) return false;
  const calculado = crypto.scryptSync(String(senha), sal, 64);
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calculado.length && crypto.timingSafeEqual(calculado, esperado);
}

function transacao(db, fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}

function abrir() {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  const db = new DatabaseSync(ARQUIVO);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);
  const vazio = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n === 0;
  if (vazio) transacao(db, () => require('./seed')(db, hashSenha));
  return db;
}

module.exports = { abrir, hashSenha, conferirSenha, transacao, ARQUIVO };
