# Grade Solidária

Sistema de apoio à montagem da grade semanal de um cursinho popular (Desafio 4 — *Grade fechada, aula garantida!*).
O coordenador cadastra voluntários, disciplinas, turmas e horários, monta a grade, vê conflitos e aulas sem professor
na hora e encontra substitutos que respeitam todas as regras de negócio.

## Como rodar

Requisito: **Node.js 22.13 ou superior** (usa o SQLite nativo do Node — não há dependências para instalar).

```bash
cd backend
npm start          # http://localhost:3000
```

Acesso de demonstração: usuário **rosivaldo**, senha **grade2026**.

| Comando           | O que faz                                                        |
| ----------------- | ---------------------------------------------------------------- |
| `npm start`       | Sobe o servidor (API + páginas)                                   |
| `npm run dev`     | Sobe com recarga automática ao editar o back-end                  |
| `npm run reset`   | Apaga o banco e recria com os dados de demonstração              |

Variáveis opcionais: `PORT`, `DB_PATH`, `ADMIN_LOGIN` e `ADMIN_SENHA` (as duas últimas valem na criação do banco).

## Estrutura

```
backend/
  server.js    servidor HTTP: rotas da API, sessão/login e arquivos estáticos
  regras.js    regras de negócio (RN01–RN09), candidatos, alertas e indicadores
  db.js        esquema SQLite, senhas (scrypt) e transações
  seed.js      dados de demonstração (2 turmas, 11 voluntários, problemas propositais)
  data/        banco grade.db (criado na primeira execução, fora do git)
frontend/
  assets/      app.js (menu, topo, API, componentes), tailwind-config.js, estilo.css
  login.html   painel.html  index.html (voluntários)  disciplinas.html  turmas.html
  grade.html   conflitos.html  substituicoes.html  historico.html  exportar.html
```

## Onde cada requisito está

| Requisito | Onde |
| --- | --- |
| RF01, RF03, RF04 — voluntários, disciplinas que domina, disponibilidade | `index.html` (ficha lateral com matriz de horários) |
| RF02, RF05, RF10 — disciplinas, demanda semanal e comparação com a grade | `disciplinas.html` |
| Turmas e horários das aulas | `turmas.html` |
| RF06, RF07, RF08, RF16, RF19 — montagem manual, grade semanal, cobertura, edição, filtros | `grade.html` |
| RF09, RF11 — conflitos e alertas | `conflitos.html`, painel lateral da grade e sino no topo |
| RF12, RF13, RN07 — busca e validação de substitutos | `substituicoes.html` e ao editar uma aula na grade |
| RF14, RF15 — carga por voluntário e equilíbrio | `index.html`, `painel.html` |
| RF17, RNF10 — histórico de alterações | `historico.html` |
| RF18 — painel de situação | `painel.html` |
| RF20 — exportar/imprimir | `exportar.html` (impressão/PDF) e `/api/exportar.csv` |
| RNF04, RNF05 — autenticação e privacidade | login com sessão em cookie HttpOnly; páginas e API exigem login |
| RNF06, RNF09 — persistência e confiabilidade | SQLite com chaves estrangeiras e transações |

### Como as regras são aplicadas

- **RN01, RN02, RN03:** cada alocação é conferida (disciplina habilitada, disponibilidade e aula simultânea em outra turma).
  Se houver problema, o sistema **bloqueia e mostra o motivo**. O coordenador pode salvar mesmo assim (**RN10**), e a aula
  fica marcada como **conflito** até ser resolvida.
- **RN06:** voluntário inativo nunca recebe aula nova. Ao inativar alguém, as aulas da pessoa ficam sem professor.
- **RN07:** a substituição é sempre bloqueada se o candidato falhar em alguma regra; não existe opção de forçar.
- **RN09:** "sem professor" (amarelo) e "conflito" (vermelho) são estados diferentes em toda a interface.
- **RF15:** passar do limite individual de aulas gera aviso, mas não bloqueia.

### Decisões tomadas sobre as questões em aberto (seção 9 dos requisitos)

- **Várias turmas** compartilham os mesmos horários-padrão (configuráveis em *Turmas & Horários*).
- A **demanda** é definida por disciplina e vale para cada turma.
- A **duração** vem do horário; a disciplina pode ter uma duração prevista, e o sistema avisa quando ela não cabe no horário.
- Na **substituição**, o sistema lista todos os candidatos válidos com uma **recomendação** (menor carga relativa) e a coordenação escolhe.
- A disponibilidade é registrada por horário-padrão (dia + início/fim), o que simplifica a marcação na interface.
