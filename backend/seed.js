'use strict';
// Dados de demonstração: duas turmas, 13 horários semanais e alguns problemas
// propositais (conflito, aula sem professor, voluntário inativo, sobrecarga).

module.exports = function semear(db, hashSenha) {
  const senha = process.env.ADMIN_SENHA || 'grade2026';
  db.prepare('INSERT INTO usuarios (login, nome, cargo, senha_hash) VALUES (?, ?, ?, ?)')
    .run((process.env.ADMIN_LOGIN || 'rosivaldo').toLowerCase(), 'Rosivaldo', 'Coordenador Geral', hashSenha(senha));

  // Horários: Seg–Sex com 2 aulas à noite, sábado com 3 aulas pela manhã.
  const insHorario = db.prepare('INSERT INTO horarios (dia, inicio, fim) VALUES (?, ?, ?)');
  const slot = {}; // "dia-ordem" -> id
  for (let dia = 1; dia <= 5; dia++) {
    slot[`${dia}-1`] = Number(insHorario.run(dia, '19:00', '20:30').lastInsertRowid);
    slot[`${dia}-2`] = Number(insHorario.run(dia, '20:40', '22:10').lastInsertRowid);
  }
  slot['6-1'] = Number(insHorario.run(6, '08:00', '09:30').lastInsertRowid);
  slot['6-2'] = Number(insHorario.run(6, '09:40', '11:10').lastInsertRowid);
  slot['6-3'] = Number(insHorario.run(6, '11:20', '12:50').lastInsertRowid);

  const insTurma = db.prepare('INSERT INTO turmas (nome, periodo, descricao) VALUES (?, ?, ?)');
  const turmaA = Number(insTurma.run('Turma A', '2026.2', 'Preparatório Enem').lastInsertRowid);
  const turmaB = Number(insTurma.run('Turma B', '2026.2', 'Vestibulares estaduais').lastInsertRowid);

  const insDisc = db.prepare('INSERT INTO disciplinas (nome, aulas_semanais, duracao_min) VALUES (?, ?, 90)');
  const disc = {};
  for (const [nome, qtd] of [
    ['Matemática', 3], ['Português', 2], ['Física', 1], ['Química', 1], ['Biologia', 1],
    ['História', 1], ['Geografia', 1], ['Redação', 1], ['Filosofia', 1], ['Inglês', 1],
  ]) disc[nome] = Number(insDisc.run(nome, qtd).lastInsertRowid);

  const insVol = db.prepare(
    'INSERT INTO voluntarios (nome, email, telefone, observacoes, ativo, limite_aulas) VALUES (?, ?, ?, ?, ?, ?)');
  const vol = {};
  const voluntarios = [
    ['Ana Beatriz Souza', 'ana.souza@email.com', '(81) 98877-1201', 'Licenciatura em Matemática', 1, 4, ['Matemática', 'Física'], ['3-1', '6-1']],
    ['Bruno Lima', 'bruno.lima@email.com', '(81) 99712-3344', 'Engenharia Civil', 1, 3, ['Matemática'], ['1-1', '4-1']],
    ['Camila Rocha', 'camila.rocha@email.com', '(81) 98123-4455', 'Letras — UFPE', 1, 3, ['Português', 'Redação'], ['3-2', '6-3']],
    ['Diego Martins', 'diego.martins@email.com', '(81) 99654-0090', 'Ciências Sociais', 1, 4, ['História', 'Filosofia', 'Geografia'], ['6-3', '4-1']],
    ['Elisa Fernandes', 'elisa.f@email.com', '(81) 98540-7721', 'Biomedicina', 1, 3, ['Biologia', 'Química'], ['5-2', '1-1']],
    ['Felipe Andrade', 'felipe.andrade@email.com', '(81) 99300-1122', 'Saiu do projeto em setembro', 0, 3, ['Física', 'Química'], ['3-2', '5-2']],
    ['Gabriela Nunes', 'gabi.nunes@email.com', '(81) 98765-4321', 'Letras/Inglês', 1, 2, ['Português', 'Redação', 'Inglês'], ['1-2']],
    ['Henrique Alves', 'henrique.alves@email.com', '(81) 99887-6655', 'Geografia — UFRPE', 1, 3, ['História', 'Geografia'], ['4-1']],
    ['João Pedro Santos', 'joao.pedro@email.com', '(81) 98234-5678', 'Física — UFPE', 1, 3, ['Física', 'Matemática'], ['3-1', '1-2', '5-2']],
    ['Larissa Costa', 'larissa.costa@email.com', '(81) 99123-8899', 'Relações Internacionais', 1, 2, ['Inglês', 'Filosofia'], ['6-3']],
    ['Marcos Oliveira', 'marcos.oliveira@email.com', '(81) 98444-3322', 'Farmácia', 1, 3, ['Química', 'Biologia'], ['5-2']],
  ];
  const extras = {};
  for (const [nome, email, tel, obs, ativo, limite, discs, livres] of voluntarios) {
    const id = Number(insVol.run(nome, email, tel, obs, ativo, limite).lastInsertRowid);
    vol[nome] = id;
    extras[id] = livres;
    for (const d of discs) db.prepare('INSERT INTO voluntario_disciplinas VALUES (?, ?)').run(id, disc[d]);
  }

  // [turma, slot, disciplina, voluntário | null, semDisponibilidade?]
  const grade = [
    [turmaA, '1-1', 'Matemática', 'Ana Beatriz Souza'],
    [turmaA, '1-2', 'Português', 'Camila Rocha'],
    [turmaA, '2-1', 'Matemática', 'Bruno Lima'],
    [turmaA, '2-2', 'Redação', 'Gabriela Nunes'],
    [turmaA, '3-1', 'Física', 'Felipe Andrade'],
    [turmaA, '3-2', 'História', 'Diego Martins'],
    [turmaA, '4-1', 'Biologia', 'Elisa Fernandes'],
    [turmaA, '4-2', 'Matemática', 'Ana Beatriz Souza', true],
    [turmaA, '5-1', 'Química', 'Marcos Oliveira'],
    [turmaA, '5-2', 'Geografia', 'Henrique Alves'],
    [turmaA, '6-1', 'Inglês', 'Larissa Costa'],
    [turmaA, '6-2', 'Português', 'Gabriela Nunes'],
    [turmaB, '1-1', 'Matemática', 'Ana Beatriz Souza'],
    [turmaB, '1-2', 'Biologia', 'Marcos Oliveira'],
    [turmaB, '2-1', 'Português', 'Camila Rocha'],
    [turmaB, '2-2', 'Matemática', 'João Pedro Santos'],
    [turmaB, '3-1', 'História', 'Henrique Alves'],
    [turmaB, '3-2', 'Física', 'João Pedro Santos'],
    [turmaB, '4-1', 'Geografia', null],
    [turmaB, '4-2', 'Matemática', 'Bruno Lima'],
    [turmaB, '5-1', 'Filosofia', 'Diego Martins'],
    [turmaB, '5-2', 'Química', null],
    [turmaB, '6-1', 'Redação', 'Camila Rocha'],
    [turmaB, '6-2', 'Inglês', 'Larissa Costa'],
    [turmaB, '6-3', 'Português', 'Gabriela Nunes'],
  ];

  // Disponibilidade = horários onde a pessoa já dá aula + alguns horários livres extras.
  const disponivel = new Map(Object.entries(extras).map(([id, livres]) => [Number(id), new Set(livres)]));
  for (const [, s, , nome, semDisp] of grade) if (nome && !semDisp) disponivel.get(vol[nome]).add(s);
  const insDisp = db.prepare('INSERT INTO disponibilidades VALUES (?, ?)');
  for (const [id, slots] of disponivel) for (const s of slots) insDisp.run(id, slot[s]);

  const insAula = db.prepare(
    `INSERT INTO aulas (turma_id, horario_id, disciplina_id, voluntario_id, atualizado_em)
     VALUES (?, ?, ?, ?, datetime('now', 'localtime', '-3 days'))`);
  for (const [t, s, d, nome] of grade) insAula.run(t, slot[s], disc[d], nome ? vol[nome] : null);

  const insHist = db.prepare(
    `INSERT INTO historico (data, usuario, tipo, descricao, valor_anterior, valor_novo)
     VALUES (datetime('now', 'localtime', ?), 'Rosivaldo', ?, ?, ?, ?)`);
  insHist.run('-6 days', 'cadastro', 'Grade 2026.2 montada a partir da planilha do semestre', null, '25 aulas');
  insHist.run('-4 days', 'voluntario', 'Felipe Andrade desativado(a) — saiu do projeto', 'Ativo', 'Inativo');
  insHist.run('-3 days', 'remocao', 'Turma B · Sex 20:40–22:10: professor liberado', 'Química · Felipe Andrade', 'Química · sem professor');
};
