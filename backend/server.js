'use strict';
// Servidor HTTP da Grade Solidária: API JSON em /api e arquivos do frontend.
// Sem dependências externas — usa apenas módulos nativos do Node (>= 22.13).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { abrir, conferirSenha, transacao, ARQUIVO } = require('./db');
const regras = require('./regras');

const PORTA = Number(process.env.PORT) || 3000;
const FRONTEND = path.resolve(__dirname, '..', 'frontend');
const SESSAO_MS = 12 * 60 * 60 * 1000;
const db = abrir();

class ErroHttp extends Error {
  constructor(status, mensagem, extra = {}) {
    super(mensagem);
    this.status = status;
    this.extra = extra;
  }
}


function texto(valor, campo, { obrigatorio = false, max = 120 } = {}) {
  if (valor == null || String(valor).trim() === '') {
    if (obrigatorio) throw new ErroHttp(400, `Informe ${campo}.`);
    return null;
  }
  const s = String(valor).trim();
  if (s.length > max) throw new ErroHttp(400, `O campo ${campo} aceita no máximo ${max} caracteres.`);
  return s;
}

function inteiro(valor, campo, { min = 0, max = 1e9, obrigatorio = true } = {}) {
  if (valor == null || valor === '') {
    if (obrigatorio) throw new ErroHttp(400, `Informe ${campo}.`);
    return null;
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) throw new ErroHttp(400, `O campo ${campo} deve ser um número inteiro entre ${min} e ${max}.`);
  return n;
}

function hora(valor, campo) {
  const s = texto(valor, campo, { obrigatorio: true, max: 5 });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new ErroHttp(400, `Use o formato HH:MM em ${campo}.`);
  return s;
}

function listaIds(valor, campo) {
  if (valor == null) return [];
  if (!Array.isArray(valor)) throw new ErroHttp(400, `O campo ${campo} deve ser uma lista.`);
  return [...new Set(valor.map((x) => inteiro(x, campo, { min: 1 })))];
}

function buscar(tabela, id, nome) {
  const linha = db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).get(id);
  if (!linha) throw new ErroHttp(404, `${nome} não encontrado(a).`);
  return { ...linha };
}


function registrar(usuario, tipo, descricao, { aulaId = null, antes = null, depois = null } = {}) {
  db.prepare('INSERT INTO historico (usuario, tipo, aula_id, descricao, valor_anterior, valor_novo) VALUES (?, ?, ?, ?, ?, ?)')
    .run(usuario?.nome ?? null, tipo, aulaId, descricao, antes, depois);
}

const localAula = (ctx, a) => `${ctx.turma.get(a.turma_id).nome} · ${ctx.hor.get(a.horario_id).rotulo}`;
const valorAula = (ctx, disciplinaId, voluntarioId) =>
  `${ctx.disc.get(disciplinaId).nome} · ${voluntarioId ? ctx.vol.get(voluntarioId).nome : 'sem professor'}`;


function lerCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((par) => {
    const i = par.indexOf('=');
    return [par.slice(0, i).trim(), decodeURIComponent(par.slice(i + 1).trim())];
  }));
}

function usuarioDaSessao(req) {
  const token = lerCookies(req).sid;
  if (!token) return null;
  const linha = db.prepare(
    `SELECT u.id, u.login, u.nome, u.cargo FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token = ? AND s.expira_em > ?`).get(token, Date.now());
  return linha ? { ...linha, token } : null;
}

const tentativasLogin = new Map(); 
function limitarTentativas(ip) {
  const agora = Date.now();
  const t = tentativasLogin.get(ip);
  if (!t || agora - t.desde > 60_000) return tentativasLogin.set(ip, { n: 1, desde: agora });
  if (++t.n > 8) throw new ErroHttp(429, 'Muitas tentativas. Aguarde um minuto e tente de novo.');
}


const rotas = [];
function rota(metodo, padrao, handler, { publica = false } = {}) {
  const chaves = [];
  const re = new RegExp(`^${padrao.replace(/:(\w+)/g, (_, k) => { chaves.push(k); return '(\\d+)'; })}$`);
  rotas.push({ metodo, re, chaves, handler, publica });
}

rota('POST', '/api/login', ({ req, res, corpo }) => {
  limitarTentativas(req.socket.remoteAddress);
  const login = texto(corpo.login, 'o usuário', { obrigatorio: true, max: 60 });
  const senha = texto(corpo.senha, 'a senha', { obrigatorio: true, max: 200 });
  const u = db.prepare('SELECT * FROM usuarios WHERE login = ?').get(login.toLowerCase());
  if (!u || !conferirSenha(senha, u.senha_hash)) throw new ErroHttp(401, 'Usuário ou senha incorretos.');
  db.prepare('DELETE FROM sessoes WHERE expira_em <= ?').run(Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?, ?, ?)').run(token, u.id, Date.now() + SESSAO_MS);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSAO_MS / 1000}`);
  return { id: u.id, login: u.login, nome: u.nome, cargo: u.cargo };
}, { publica: true });

rota('POST', '/api/logout', ({ res, usuario }) => {
  db.prepare('DELETE FROM sessoes WHERE token = ?').run(usuario.token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
});

rota('GET', '/api/me', ({ usuario }) => ({ id: usuario.id, login: usuario.login, nome: usuario.nome, cargo: usuario.cargo }));

rota('GET', '/api/estado', () => regras.montarEstado(regras.carregar(db)));

function dadosVoluntario(corpo) {
  const email = texto(corpo.email, 'e-mail', { max: 120 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroHttp(400, 'E-mail inválido.');
  const dados = {
    nome: texto(corpo.nome, 'o nome', { obrigatorio: true, max: 120 }),
    email,
    telefone: texto(corpo.telefone, 'telefone', { max: 30 }),
    observacoes: texto(corpo.observacoes, 'observações', { max: 300 }),
    limite_aulas: inteiro(corpo.limite_aulas ?? 4, 'o limite de aulas', { min: 1, max: 40 }),
    disciplinas: listaIds(corpo.disciplinas, 'disciplinas'),
    disponibilidade: listaIds(corpo.disponibilidade, 'disponibilidade'),
  };
  for (const id of dados.disciplinas) buscar('disciplinas', id, 'Disciplina');
  for (const id of dados.disponibilidade) buscar('horarios', id, 'Horário');
  return dados;
}

function gravarAssociacoes(id, dados) {
  db.prepare('DELETE FROM voluntario_disciplinas WHERE voluntario_id = ?').run(id);
  db.prepare('DELETE FROM disponibilidades WHERE voluntario_id = ?').run(id);
  const insD = db.prepare('INSERT INTO voluntario_disciplinas VALUES (?, ?)');
  const insH = db.prepare('INSERT INTO disponibilidades VALUES (?, ?)');
  for (const d of dados.disciplinas) insD.run(id, d);
  for (const h of dados.disponibilidade) insH.run(id, h);
}

rota('POST', '/api/voluntarios', ({ corpo, usuario }) => {
  const dados = dadosVoluntario(corpo);
  const id = transacao(db, () => {
    const novo = Number(db.prepare(
      'INSERT INTO voluntarios (nome, email, telefone, observacoes, limite_aulas) VALUES (?, ?, ?, ?, ?)')
      .run(dados.nome, dados.email, dados.telefone, dados.observacoes, dados.limite_aulas).lastInsertRowid);
    gravarAssociacoes(novo, dados);
    registrar(usuario, 'cadastro', `Voluntário(a) ${dados.nome} cadastrado(a)`);
    return novo;
  });
  return { id };
});

rota('PUT', '/api/voluntarios/:id', ({ params, corpo, usuario }) => {
  const atual = buscar('voluntarios', params.id, 'Voluntário');
  const dados = dadosVoluntario(corpo);
  transacao(db, () => {
    db.prepare('UPDATE voluntarios SET nome = ?, email = ?, telefone = ?, observacoes = ?, limite_aulas = ? WHERE id = ?')
      .run(dados.nome, dados.email, dados.telefone, dados.observacoes, dados.limite_aulas, atual.id);
    gravarAssociacoes(atual.id, dados);
    if (atual.limite_aulas !== dados.limite_aulas) {
      registrar(usuario, 'cadastro', `Limite semanal de ${dados.nome} alterado`, { antes: `${atual.limite_aulas} aulas`, depois: `${dados.limite_aulas} aulas` });
    }
  });
  const conflitos = regras.montarEstado(regras.carregar(db)).aulas
    .filter((a) => a.voluntario_id === atual.id && a.status === 'conflito').length;
  return { id: atual.id, conflitos };
});

// Ativar/desativar (RN06). Ao desativar, as aulas podem ser liberadas (ficam sem professor).
rota('PATCH', '/api/voluntarios/:id/situacao', ({ params, corpo, usuario }) => {
  const v = buscar('voluntarios', params.id, 'Voluntário');
  const ativo = !!corpo.ativo;
  const ctx = regras.carregar(db);
  const aulas = ctx.aulas.filter((a) => a.voluntario_id === v.id);
  transacao(db, () => {
    db.prepare('UPDATE voluntarios SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, v.id);
    if (!!v.ativo !== ativo) {
      const motivo = texto(corpo.motivo, 'motivo', { max: 200 });
      registrar(usuario, 'voluntario', `${v.nome} ${ativo ? 'reativado(a)' : 'desativado(a)'}${motivo ? ` — ${motivo}` : ''}`,
        { antes: v.ativo ? 'Ativo' : 'Inativo', depois: ativo ? 'Ativo' : 'Inativo' });
    }
    if (!ativo && corpo.liberar_aulas) {
      for (const a of aulas) {
        db.prepare("UPDATE aulas SET voluntario_id = NULL, atualizado_em = datetime('now', 'localtime') WHERE id = ?").run(a.id);
        registrar(usuario, 'remocao', `${localAula(ctx, a)}: professor liberado após saída`,
          { aulaId: a.id, antes: valorAula(ctx, a.disciplina_id, v.id), depois: valorAula(ctx, a.disciplina_id, null) });
      }
    }
  });
  return { ok: true, aulas_liberadas: !ativo && corpo.liberar_aulas ? aulas.length : 0 };
});

// ---- Disciplinas (RF02, RF05)
function dadosDisciplina(corpo) {
  return {
    nome: texto(corpo.nome, 'o nome da disciplina', { obrigatorio: true, max: 80 }),
    aulas_semanais: inteiro(corpo.aulas_semanais, 'aulas por semana', { min: 0, max: 40 }),
    duracao_min: inteiro(corpo.duracao_min, 'duração', { min: 10, max: 600, obrigatorio: false }),
  };
}

rota('POST', '/api/disciplinas', ({ corpo, usuario }) => {
  const d = dadosDisciplina(corpo);
  const id = Number(db.prepare('INSERT INTO disciplinas (nome, aulas_semanais, duracao_min) VALUES (?, ?, ?)')
    .run(d.nome, d.aulas_semanais, d.duracao_min).lastInsertRowid);
  registrar(usuario, 'cadastro', `Disciplina ${d.nome} cadastrada`, { depois: `${d.aulas_semanais} aula(s)/semana` });
  return { id };
});

rota('PUT', '/api/disciplinas/:id', ({ params, corpo, usuario }) => {
  const atual = buscar('disciplinas', params.id, 'Disciplina');
  const d = dadosDisciplina(corpo);
  db.prepare('UPDATE disciplinas SET nome = ?, aulas_semanais = ?, duracao_min = ? WHERE id = ?')
    .run(d.nome, d.aulas_semanais, d.duracao_min, atual.id);
  if (atual.aulas_semanais !== d.aulas_semanais) {
    registrar(usuario, 'cadastro', `Demanda semanal de ${d.nome} alterada`,
      { antes: `${atual.aulas_semanais} aula(s)`, depois: `${d.aulas_semanais} aula(s)` });
  }
  return { id: atual.id };
});

rota('DELETE', '/api/disciplinas/:id', ({ params, usuario }) => {
  const d = buscar('disciplinas', params.id, 'Disciplina');
  const n = db.prepare('SELECT COUNT(*) AS n FROM aulas WHERE disciplina_id = ?').get(d.id).n;
  if (n) throw new ErroHttp(409, `${d.nome} está em ${n} aula(s) da grade. Remova essas aulas antes de excluir.`);
  db.prepare('DELETE FROM disciplinas WHERE id = ?').run(d.id);
  registrar(usuario, 'cadastro', `Disciplina ${d.nome} excluída`);
});

// ---- Turmas
function dadosTurma(corpo) {
  return {
    nome: texto(corpo.nome, 'o nome da turma', { obrigatorio: true, max: 60 }),
    periodo: texto(corpo.periodo, 'o período letivo', { obrigatorio: true, max: 20 }),
    descricao: texto(corpo.descricao, 'descrição', { max: 120 }),
  };
}

rota('POST', '/api/turmas', ({ corpo, usuario }) => {
  const t = dadosTurma(corpo);
  const id = Number(db.prepare('INSERT INTO turmas (nome, periodo, descricao) VALUES (?, ?, ?)')
    .run(t.nome, t.periodo, t.descricao).lastInsertRowid);
  registrar(usuario, 'cadastro', `Turma ${t.nome} criada (${t.periodo})`);
  return { id };
});

rota('PUT', '/api/turmas/:id', ({ params, corpo }) => {
  const atual = buscar('turmas', params.id, 'Turma');
  const t = dadosTurma(corpo);
  db.prepare('UPDATE turmas SET nome = ?, periodo = ?, descricao = ? WHERE id = ?').run(t.nome, t.periodo, t.descricao, atual.id);
  return { id: atual.id };
});

rota('DELETE', '/api/turmas/:id', ({ params, usuario }) => {
  const t = buscar('turmas', params.id, 'Turma');
  const n = db.prepare('SELECT COUNT(*) AS n FROM aulas WHERE turma_id = ?').get(t.id).n;
  transacao(db, () => {
    db.prepare('DELETE FROM turmas WHERE id = ?').run(t.id);
    registrar(usuario, 'cadastro', `Turma ${t.nome} removida`, { antes: `${n} aula(s) na grade`, depois: null });
  });
});

// ---- Horários das aulas
function dadosHorario(corpo, ignorarId = null) {
  const h = {
    dia: inteiro(corpo.dia, 'o dia da semana', { min: 1, max: 7 }),
    inicio: hora(corpo.inicio, 'início'),
    fim: hora(corpo.fim, 'fim'),
  };
  if (h.fim <= h.inicio) throw new ErroHttp(400, 'O horário final deve ser depois do inicial.');
  const choque = db.prepare('SELECT * FROM horarios WHERE dia = ? AND id IS NOT ? AND inicio < ? AND ? < fim')
    .get(h.dia, ignorarId, h.fim, h.inicio);
  if (choque) throw new ErroHttp(409, `Esse horário se sobrepõe a ${regras.DIAS[h.dia]} ${choque.inicio}–${choque.fim}.`);
  return h;
}

rota('POST', '/api/horarios', ({ corpo, usuario }) => {
  const h = dadosHorario(corpo);
  const id = Number(db.prepare('INSERT INTO horarios (dia, inicio, fim) VALUES (?, ?, ?)').run(h.dia, h.inicio, h.fim).lastInsertRowid);
  registrar(usuario, 'horario', `Horário ${regras.DIAS[h.dia]} ${h.inicio}–${h.fim} criado`);
  return { id };
});

rota('PUT', '/api/horarios/:id', ({ params, corpo, usuario }) => {
  const atual = buscar('horarios', params.id, 'Horário');
  const h = dadosHorario(corpo, atual.id);
  db.prepare('UPDATE horarios SET dia = ?, inicio = ?, fim = ? WHERE id = ?').run(h.dia, h.inicio, h.fim, atual.id);
  registrar(usuario, 'horario', 'Horário de aula alterado',
    { antes: `${regras.DIAS[atual.dia]} ${atual.inicio}–${atual.fim}`, depois: `${regras.DIAS[h.dia]} ${h.inicio}–${h.fim}` });
  return { id: atual.id };
});

rota('DELETE', '/api/horarios/:id', ({ params, usuario }) => {
  const h = buscar('horarios', params.id, 'Horário');
  const n = db.prepare('SELECT COUNT(*) AS n FROM aulas WHERE horario_id = ?').get(h.id).n;
  transacao(db, () => {
    db.prepare('DELETE FROM horarios WHERE id = ?').run(h.id);
    registrar(usuario, 'horario', `Horário ${regras.DIAS[h.dia]} ${h.inicio}–${h.fim} removido`, { antes: `${n} aula(s)`, depois: null });
  });
});

// ---- Grade: montagem manual e atualização (RF06, RF09, RF16, RN01–RN03, RN06, RN10)
rota('PUT', '/api/aulas', ({ corpo, usuario }) => {
  const turmaId = inteiro(corpo.turma_id, 'a turma', { min: 1 });
  const horarioId = inteiro(corpo.horario_id, 'o horário', { min: 1 });
  const disciplinaId = inteiro(corpo.disciplina_id, 'a disciplina', { min: 1 });
  const voluntarioId = inteiro(corpo.voluntario_id, 'o professor', { min: 1, obrigatorio: false });
  buscar('turmas', turmaId, 'Turma');
  buscar('horarios', horarioId, 'Horário');
  buscar('disciplinas', disciplinaId, 'Disciplina');

  const ctx = regras.carregar(db);
  const atual = ctx.aulas.find((a) => a.turma_id === turmaId && a.horario_id === horarioId);
  let avaliacao = { impedimentos: [], avisos: [] };
  if (voluntarioId) {
    const v = ctx.vol.get(voluntarioId);
    if (!v) throw new ErroHttp(404, 'Voluntário não encontrado(a).');
    avaliacao = regras.avaliar(ctx, { voluntarioId, disciplinaId, horarioId, ignorarAulaId: atual?.id ?? null });
    if (!v.ativo && atual?.voluntario_id !== voluntarioId) {
      throw new ErroHttp(422, `${v.nome} está inativo(a) e não pode receber novas aulas (RN06).`, { impedimentos: avaliacao.impedimentos });
    }
    // RN10: o coordenador decide — mas só depois de ver o problema e confirmar.
    if (avaliacao.impedimentos.length && !corpo.forcar) {
      throw new ErroHttp(409, 'Esta alocação desrespeita regras da grade.', { ...avaliacao, pode_forcar: true });
    }
  }

  const aulaId = transacao(db, () => {
    const depois = valorAula(ctx, disciplinaId, voluntarioId);
    if (atual) {
      db.prepare("UPDATE aulas SET disciplina_id = ?, voluntario_id = ?, atualizado_em = datetime('now', 'localtime') WHERE id = ?")
        .run(disciplinaId, voluntarioId, atual.id);
      const antes = valorAula(ctx, atual.disciplina_id, atual.voluntario_id);
      if (antes !== depois) {
        const tipo = atual.disciplina_id === disciplinaId ? 'troca' : 'alteracao';
        const detalhe = avaliacao.impedimentos.length ? ' (mantida com conflito por decisão do coordenador)' : '';
        registrar(usuario, tipo, `${localAula(ctx, atual)}: ${tipo === 'troca' ? 'troca de professor' : 'aula alterada'}${detalhe}`,
          { aulaId: atual.id, antes, depois });
      }
      return atual.id;
    }
    const novo = Number(db.prepare('INSERT INTO aulas (turma_id, horario_id, disciplina_id, voluntario_id) VALUES (?, ?, ?, ?)')
      .run(turmaId, horarioId, disciplinaId, voluntarioId).lastInsertRowid);
    registrar(usuario, 'alocacao', `${localAula(ctx, { turma_id: turmaId, horario_id: horarioId })}: aula criada`,
      { aulaId: novo, depois });
    return novo;
  });
  return { aula_id: aulaId, conflito: avaliacao.impedimentos.length > 0, avisos: avaliacao.avisos };
});

rota('DELETE', '/api/aulas/:id', ({ params, usuario }) => {
  const ctx = regras.carregar(db);
  const aula = ctx.aula.get(params.id);
  if (!aula) throw new ErroHttp(404, 'Aula não encontrada.');
  transacao(db, () => {
    db.prepare('DELETE FROM aulas WHERE id = ?').run(aula.id);
    registrar(usuario, 'remocao', `${localAula(ctx, aula)}: aula removida da grade`,
      { aulaId: aula.id, antes: valorAula(ctx, aula.disciplina_id, aula.voluntario_id), depois: 'horário livre' });
  });
});

// Candidatos a professor/substituto (RF12, RF13)
rota('GET', '/api/candidatos', ({ query }) => {
  const ctx = regras.carregar(db);
  const aulaId = inteiro(query.get('aula_id'), 'a aula', { min: 1, obrigatorio: false });
  let disciplinaId = inteiro(query.get('disciplina_id'), 'a disciplina', { min: 1, obrigatorio: false });
  let horarioId = inteiro(query.get('horario_id'), 'o horário', { min: 1, obrigatorio: false });
  let ignorar = null;
  if (aulaId) {
    const aula = ctx.aula.get(aulaId);
    if (!aula) throw new ErroHttp(404, 'Aula não encontrada.');
    disciplinaId ??= aula.disciplina_id;
    horarioId ??= aula.horario_id;
    ignorar = aula.id;
  } else {
    const turmaId = inteiro(query.get('turma_id'), 'a turma', { min: 1, obrigatorio: false });
    ignorar = ctx.aulas.find((a) => a.turma_id === turmaId && a.horario_id === horarioId)?.id ?? null;
  }
  if (!disciplinaId || !ctx.disc.has(disciplinaId)) throw new ErroHttp(400, 'Informe a disciplina.');
  if (!horarioId || !ctx.hor.has(horarioId)) throw new ErroHttp(400, 'Informe o horário.');
  return regras.candidatos(ctx, { disciplinaId, horarioId, ignorarAulaId: ignorar });
});

// Substituição: só é efetivada se o candidato passar em todas as regras (RN07).
rota('POST', '/api/aulas/:id/substituir', ({ params, corpo, usuario }) => {
  const ctx = regras.carregar(db);
  const aula = ctx.aula.get(params.id);
  if (!aula) throw new ErroHttp(404, 'Aula não encontrada.');
  const voluntarioId = inteiro(corpo.voluntario_id, 'o substituto', { min: 1 });
  const v = ctx.vol.get(voluntarioId);
  if (!v) throw new ErroHttp(404, 'Voluntário não encontrado(a).');
  if (aula.voluntario_id === v.id) throw new ErroHttp(400, `${v.nome} já é o professor desta aula.`);
  const r = regras.avaliar(ctx, { voluntarioId, disciplinaId: aula.disciplina_id, horarioId: aula.horario_id, ignorarAulaId: aula.id });
  if (r.impedimentos.length) throw new ErroHttp(409, `${v.nome} não pode assumir esta aula.`, { impedimentos: r.impedimentos });
  transacao(db, () => {
    db.prepare("UPDATE aulas SET voluntario_id = ?, atualizado_em = datetime('now', 'localtime') WHERE id = ?").run(v.id, aula.id);
    registrar(usuario, 'substituicao', `${localAula(ctx, aula)}: substituição efetivada`,
      { aulaId: aula.id, antes: valorAula(ctx, aula.disciplina_id, aula.voluntario_id), depois: valorAula(ctx, aula.disciplina_id, v.id) });
  });
  return { ok: true, avisos: r.avisos };
});

// Histórico (RF17)
rota('GET', '/api/historico', ({ query }) => {
  const limite = inteiro(query.get('limite') ?? 200, 'limite', { min: 1, max: 2000 });
  return db.prepare('SELECT * FROM historico ORDER BY data DESC, id DESC LIMIT ?').all(limite).map((l) => ({ ...l }));
});

// Exportação CSV (RF20) — separador ";" e BOM para abrir direto no Excel/LibreOffice.
rota('GET', '/api/exportar.csv', ({ res, query }) => {
  const turmaId = inteiro(query.get('turma_id'), 'a turma', { min: 1, obrigatorio: false });
  const ctx = regras.carregar(db);
  const estado = regras.montarEstado(ctx);
  const situacao = { coberta: 'Coberta', descoberta: 'Sem professor', conflito: 'Conflito' };
  const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = estado.aulas
    .filter((a) => !turmaId || a.turma_id === turmaId)
    .map((a) => ({ a, t: ctx.turma.get(a.turma_id), h: ctx.hor.get(a.horario_id) }))
    .sort((x, y) => x.t.nome.localeCompare(y.t.nome) || x.h.dia - y.h.dia || x.h.inicio.localeCompare(y.h.inicio))
    .map(({ a, t, h }) => [t.nome, t.periodo, regras.DIAS[h.dia], h.inicio, h.fim, ctx.disc.get(a.disciplina_id).nome,
      a.voluntario_id ? ctx.vol.get(a.voluntario_id).nome : '', situacao[a.status]].map(cel).join(';'));
  const csv = '﻿' + ['Turma;Período;Dia;Início;Fim;Disciplina;Professor;Situação', ...linhas].join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="grade-semanal${turmaId ? `-${ctx.turma.get(turmaId)?.nome.replace(/\W+/g, '-').toLowerCase()}` : ''}.csv"`,
  });
  res.end(csv);
});

// ---------------------------------------------------------------- HTTP
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
};

function json(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}

function redirecionar(res, destino) {
  res.writeHead(302, { Location: destino });
  res.end();
}

function servirEstatico(req, res, caminho, usuario) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { erro: 'Método não permitido.' });
  if (caminho === '/') caminho = usuario ? '/painel.html' : '/login.html';
  const arquivo = path.normalize(path.join(FRONTEND, caminho));
  if (!arquivo.startsWith(FRONTEND + path.sep)) return json(res, 404, { erro: 'Não encontrado.' });
  const nome = path.basename(arquivo);
  // Páginas internas exigem login (RNF04/RNF05).
  if (arquivo.endsWith('.html') && nome !== 'login.html' && !usuario) return redirecionar(res, '/login.html');
  if (nome === 'login.html' && usuario) return redirecionar(res, '/painel.html');
  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro) return json(res, 404, { erro: 'Não encontrado.' });
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : conteudo);
  });
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (parte) => {
      tamanho += parte.length;
      if (tamanho > 100_000) {
        reject(new ErroHttp(413, 'Requisição grande demais.'));
        req.destroy();
      } else partes.push(parte);
    });
    req.on('end', () => {
      if (!tamanho) return resolve({});
      // Exigir JSON impede envio por formulários de outros sites (defesa contra CSRF).
      if (!String(req.headers['content-type']).startsWith('application/json')) return reject(new ErroHttp(415, 'Envie os dados em JSON.'));
      try {
        const dados = JSON.parse(Buffer.concat(partes).toString('utf8'));
        resolve(dados && typeof dados === 'object' ? dados : {});
      } catch {
        reject(new ErroHttp(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

const servidor = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  try {
    const url = new URL(req.url, 'http://localhost');
    const usuario = usuarioDaSessao(req);
    if (!url.pathname.startsWith('/api/')) return servirEstatico(req, res, decodeURIComponent(url.pathname), usuario);

    let params = null;
    const r = rotas.find((x) => {
      if (x.metodo !== req.method) return false;
      const m = x.re.exec(url.pathname);
      if (m) params = Object.fromEntries(x.chaves.map((k, i) => [k, Number(m[i + 1])]));
      return !!m;
    });
    if (!r) throw new ErroHttp(404, 'Rota não encontrada.');
    if (!r.publica && !usuario) throw new ErroHttp(401, 'Faça login para continuar.');
    const corpo = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await lerCorpo(req) : {};
    const resultado = await r.handler({ req, res, params, corpo, query: url.searchParams, usuario });
    if (!res.writableEnded) json(res, 200, resultado ?? { ok: true });
  } catch (erro) {
    if (erro instanceof ErroHttp) return json(res, erro.status, { erro: erro.message, ...erro.extra });
    if (/UNIQUE constraint/.test(erro.message)) return json(res, 409, { erro: 'Já existe um cadastro com esse nome.' });
    if (/FOREIGN KEY constraint/.test(erro.message)) return json(res, 409, { erro: 'Registro em uso por outros dados.' });
    console.error(erro);
    json(res, 500, { erro: 'Erro interno. Nenhuma alteração parcial foi salva.' });
  }
});

servidor.listen(PORTA, () => {
  console.log(`Grade Solidária rodando em http://localhost:${PORTA}`);
  console.log(`Banco de dados: ${ARQUIVO}`);
});
