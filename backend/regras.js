'use strict';


const DIAS = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

const minutos = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const duracao = (h) => minutos(h.fim) - minutos(h.inicio);
const sobrepoe = (a, b) => a.dia === b.dia && a.inicio < b.fim && b.inicio < a.fim;

function carregar(db) {
  const todos = (sql) => db.prepare(sql).all().map((linha) => ({ ...linha }));
  const voluntarios = todos('SELECT * FROM voluntarios ORDER BY nome COLLATE NOCASE')
    .map((v) => ({ ...v, ativo: !!v.ativo, disciplinas: new Set(), disponibilidade: new Set() }));
  const disciplinas = todos('SELECT * FROM disciplinas ORDER BY nome COLLATE NOCASE');
  const turmas = todos('SELECT * FROM turmas ORDER BY nome COLLATE NOCASE');
  const horarios = todos('SELECT * FROM horarios ORDER BY dia, inicio');
  const aulas = todos('SELECT * FROM aulas');

  const ordemNoDia = {};
  for (const h of horarios) {
    ordemNoDia[h.dia] = (ordemNoDia[h.dia] || 0) + 1;
    h.ordem = ordemNoDia[h.dia];
    h.duracao_min = duracao(h);
    h.rotulo = `${DIAS[h.dia]} ${h.inicio}–${h.fim}`;
  }

  const vol = new Map(voluntarios.map((v) => [v.id, v]));
  for (const r of db.prepare('SELECT * FROM voluntario_disciplinas').all()) vol.get(r.voluntario_id)?.disciplinas.add(r.disciplina_id);
  for (const r of db.prepare('SELECT * FROM disponibilidades').all()) vol.get(r.voluntario_id)?.disponibilidade.add(r.horario_id);

  const carga = new Map();
  for (const a of aulas) if (a.voluntario_id) carga.set(a.voluntario_id, (carga.get(a.voluntario_id) || 0) + 1);

  return {
    voluntarios, disciplinas, turmas, horarios, aulas, carga, vol,
    disc: new Map(disciplinas.map((d) => [d.id, d])),
    turma: new Map(turmas.map((t) => [t.id, t])),
    hor: new Map(horarios.map((h) => [h.id, h])),
    aula: new Map(aulas.map((a) => [a.id, a])),
  };
}


function avaliar(ctx, { voluntarioId, disciplinaId, horarioId, ignorarAulaId = null }) {
  const v = ctx.vol.get(voluntarioId);
  const h = ctx.hor.get(horarioId);
  const d = ctx.disc.get(disciplinaId);
  const impedimentos = [];
  const avisos = [];

  if (!v.ativo) impedimentos.push({ regra: 'RN06', msg: 'Voluntário inativo — não pode receber aulas' });
  if (d && !v.disciplinas.has(d.id)) impedimentos.push({ regra: 'RN01', msg: `Não leciona ${d.nome}` });
  if (h && !v.disponibilidade.has(h.id)) impedimentos.push({ regra: 'RN02', msg: `Não está disponível em ${h.rotulo}` });
  for (const outra of ctx.aulas) {
    if (outra.id === ignorarAulaId || outra.voluntario_id !== v.id) continue;
    const h2 = ctx.hor.get(outra.horario_id);
    if (h && sobrepoe(h, h2)) {
      const t = ctx.turma.get(outra.turma_id);
      const d2 = ctx.disc.get(outra.disciplina_id);
      impedimentos.push({ regra: 'RN03', msg: `Já tem aula de ${d2.nome} na ${t.nome} neste horário (${h2.rotulo})` });
    }
  }

  const carga = ctx.carga.get(v.id) || 0;
  const jaContada = ignorarAulaId != null && ctx.aula.get(ignorarAulaId)?.voluntario_id === v.id;
  const cargaFinal = jaContada ? carga : carga + 1;
  if (v.ativo && cargaFinal > v.limite_aulas) {
    avisos.push({ regra: 'RF15', msg: `Passaria do limite de ${v.limite_aulas} aulas/semana (${cargaFinal}/${v.limite_aulas})` });
  }
  return { impedimentos, avisos, carga, carga_final: cargaFinal };
}

function statusAula(ctx, aula) {
  if (!aula.voluntario_id) return { status: 'descoberta', problemas: [] };
  const { impedimentos } = avaliar(ctx, {
    voluntarioId: aula.voluntario_id, disciplinaId: aula.disciplina_id,
    horarioId: aula.horario_id, ignorarAulaId: aula.id,
  });
  return { status: impedimentos.length ? 'conflito' : 'coberta', problemas: impedimentos };
}

function situacaoCarga(v, carga) {
  if (!v.ativo) return 'inativo';
  if (carga > v.limite_aulas) return 'acima';
  if (carga === v.limite_aulas) return 'no_limite';
  if (carga < Math.ceil(v.limite_aulas / 2) && v.disponibilidade.size > carga) return 'baixa';
  return 'equilibrada';
}

function candidatos(ctx, { disciplinaId, horarioId, ignorarAulaId = null }) {
  const aula = ignorarAulaId != null ? ctx.aula.get(ignorarAulaId) : null;
  const rank = (c) => (c.elegivel ? (c.avisos.length ? 1 : 0) : c.ativo ? 2 : 3);
  return ctx.voluntarios
    .map((v) => {
      const r = avaliar(ctx, { voluntarioId: v.id, disciplinaId, horarioId, ignorarAulaId });
      return {
        id: v.id, nome: v.nome, ativo: v.ativo, limite_aulas: v.limite_aulas,
        carga: r.carga, carga_final: r.carga_final,
        elegivel: r.impedimentos.length === 0,
        atual: aula?.voluntario_id === v.id,
        impedimentos: r.impedimentos, avisos: r.avisos,
      };
    })
    .sort((a, b) => rank(a) - rank(b)
      || a.impedimentos.length - b.impedimentos.length
      || a.carga / a.limite_aulas - b.carga / b.limite_aulas
      || a.nome.localeCompare(b.nome, 'pt-BR'));
}

function montarEstado(ctx) {
  const aulas = ctx.aulas.map((a) => {
    const { status, problemas } = statusAula(ctx, a);
    const h = ctx.hor.get(a.horario_id);
    const d = ctx.disc.get(a.disciplina_id);
    const avisos = d.duracao_min && h.duracao_min < d.duracao_min
      ? [{ regra: 'RF05', msg: `Horário de ${h.duracao_min} min é menor que a duração prevista (${d.duracao_min} min)` }]
      : [];
    return { ...a, status, problemas, avisos };
  });

  const voluntarios = ctx.voluntarios.map((v) => {
    const carga = ctx.carga.get(v.id) || 0;
    return {
      ...v, carga,
      disciplinas: [...v.disciplinas], disponibilidade: [...v.disponibilidade],
      situacao_carga: situacaoCarga(v, carga),
    };
  });

  const contar = (filtro) => aulas.filter(filtro).length;
  const disciplinas = ctx.disciplinas.map((d) => ({
    ...d,
    habilitados: voluntarios.filter((v) => v.ativo && v.disciplinas.includes(d.id)).map((v) => v.id),
    por_turma: ctx.turmas.map((t) => ({
      turma_id: t.id,
      alocadas: contar((a) => a.turma_id === t.id && a.disciplina_id === d.id),
      cobertas: contar((a) => a.turma_id === t.id && a.disciplina_id === d.id && a.status === 'coberta'),
    })),
  }));

  const demandaPorTurma = ctx.disciplinas.reduce((s, d) => s + d.aulas_semanais, 0);
  const turmas = ctx.turmas.map((t) => ({
    ...t,
    demanda: demandaPorTurma,
    na_grade: contar((a) => a.turma_id === t.id),
    cobertas: contar((a) => a.turma_id === t.id && a.status === 'coberta'),
    descobertas: contar((a) => a.turma_id === t.id && a.status === 'descoberta'),
    conflitos: contar((a) => a.turma_id === t.id && a.status === 'conflito'),
  }));

  const alertas = [];
  const local = (a) => `${ctx.turma.get(a.turma_id).nome} · ${ctx.hor.get(a.horario_id).rotulo}`;
  for (const a of aulas.filter((x) => x.status === 'conflito')) {
    alertas.push({
      tipo: 'conflito', gravidade: 'erro', titulo: local(a), aula_id: a.id, turma_id: a.turma_id,
      msg: `${ctx.disc.get(a.disciplina_id).nome} com ${ctx.vol.get(a.voluntario_id).nome}: ${a.problemas.map((p) => p.msg).join('; ')}`,
      regras: a.problemas.map((p) => p.regra),
    });
  }
  for (const a of aulas.filter((x) => x.status === 'descoberta')) {
    alertas.push({
      tipo: 'descoberta', gravidade: 'aviso', titulo: local(a), aula_id: a.id, turma_id: a.turma_id,
      msg: `${ctx.disc.get(a.disciplina_id).nome} está sem professor`, regras: ['RN04'],
    });
  }
  let faltando = 0;
  for (const t of turmas) {
    if (t.demanda > ctx.horarios.length) {
      alertas.push({
        tipo: 'capacidade', gravidade: 'erro', titulo: t.nome, turma_id: t.id, regras: ['RN05'],
        msg: `As disciplinas pedem ${t.demanda} aulas/semana, mas só existem ${ctx.horarios.length} horários`,
      });
    }
    for (const d of disciplinas) {
      const { alocadas } = d.por_turma.find((p) => p.turma_id === t.id);
      if (alocadas < d.aulas_semanais) {
        faltando += d.aulas_semanais - alocadas;
        alertas.push({
          tipo: 'demanda', gravidade: 'aviso', titulo: t.nome, turma_id: t.id, disciplina_id: d.id, regras: ['RF10'],
          msg: `${d.nome} pede ${d.aulas_semanais} aula(s) e tem ${alocadas} na grade`,
        });
      } else if (alocadas > d.aulas_semanais) {
        alertas.push({
          tipo: 'excesso', gravidade: 'info', titulo: t.nome, turma_id: t.id, disciplina_id: d.id, regras: ['RF10'],
          msg: `${d.nome} tem ${alocadas} aulas na grade, acima da demanda de ${d.aulas_semanais}`,
        });
      }
    }
  }
  for (const v of voluntarios.filter((x) => x.situacao_carga === 'acima')) {
    alertas.push({
      tipo: 'sobrecarga', gravidade: 'aviso', titulo: v.nome, voluntario_id: v.id, regras: ['RF15'],
      msg: `${v.carga} aulas atribuídas para um limite de ${v.limite_aulas}`,
    });
  }

  const ativos = voluntarios.filter((v) => v.ativo);
  const cobertas = contar((a) => a.status === 'coberta');
  const demandaTotal = demandaPorTurma * turmas.length;
  const indicadores = {
    demanda_total: demandaTotal,
    na_grade: aulas.length,
    cobertas,
    descobertas: contar((a) => a.status === 'descoberta'),
    conflitos: contar((a) => a.status === 'conflito'),
    faltando,
    cobertura_pct: demandaTotal ? Math.round((cobertas / demandaTotal) * 100) : 0,
    voluntarios_ativos: ativos.length,
    voluntarios_inativos: voluntarios.length - ativos.length,
    carga_media: ativos.length ? +(ativos.reduce((s, v) => s + v.carga, 0) / ativos.length).toFixed(1) : 0,
    sobrecarregados: voluntarios.filter((v) => v.situacao_carga === 'acima').length,
    horarios_por_semana: ctx.horarios.length,
  };

  return { horarios: ctx.horarios, turmas, disciplinas, voluntarios, aulas, alertas, indicadores };
}

module.exports = { DIAS, carregar, avaliar, statusAula, candidatos, montarEstado, sobrepoe };
