/* Grade Solidária — shell (menu lateral + topo), acesso à API e componentes compartilhados. */
(function () {
  'use strict';

  const DIAS = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const DIAS_LONGOS = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

  const NAV = [
    { grupo: 'Visão Geral', itens: [{ href: 'painel.html', icone: 'monitoring', rotulo: 'Painel de Situação' }] },
    { grupo: 'Gestão de Pessoas', itens: [{ href: 'index.html', icone: 'volunteer_activism', rotulo: 'Professores Voluntários' }] },
    {
      grupo: 'Acadêmico & Demandas', itens: [
        { href: 'disciplinas.html', icone: 'menu_book', rotulo: 'Disciplinas & Cargas' },
        { href: 'turmas.html', icone: 'meeting_room', rotulo: 'Turmas & Horários' },
      ],
    },
    {
      grupo: 'Grade Semanal', itens: [
        { href: 'grade.html', icone: 'calendar_month', rotulo: 'Montagem da Grade' },
        { href: 'conflitos.html', icone: 'warning', rotulo: 'Visualização & Conflitos', contador: true },
        { href: 'substituicoes.html', icone: 'swap_horiz', rotulo: 'Substituições Inteligentes' },
      ],
    },
    {
      grupo: 'Monitoramento & Auditoria', itens: [
        { href: 'historico.html', icone: 'history', rotulo: 'Histórico de Trocas' },
        { href: 'exportar.html', icone: 'download', rotulo: 'Exportar Grade' },
      ],
    },
  ];

  // Classes reutilizadas (mesmo vocabulário visual do protótipo)
  const cls = {
    card: 'bg-surface-container-lowest rounded-xl shadow-sm',
    btnPrim: 'inline-flex items-center justify-center gap-space-xs px-space-md py-space-sm bg-primary-container hover:bg-primary text-on-primary font-title-md text-title-md font-medium rounded-lg shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed',
    btnSec: 'inline-flex items-center justify-center gap-space-xs px-space-md py-space-sm bg-surface-container-lowest text-on-surface font-title-md text-title-md rounded-lg shadow-sm hover:bg-surface-container transition-all disabled:opacity-50',
    btnNeutro: 'inline-flex items-center justify-center gap-space-xs px-space-md py-space-sm bg-surface-container rounded-lg font-title-md text-title-md text-on-surface hover:bg-surface-container-high transition-colors',
    btnPerigo: 'inline-flex items-center justify-center gap-space-xs px-space-md py-space-sm bg-error hover:bg-on-error-container text-on-error font-title-md text-title-md rounded-lg shadow-md transition-all',
    btnIcone: 'p-1.5 rounded hover:bg-surface-container text-on-surface-variant hover:text-primary transition-colors',
    input: 'h-10 px-space-md bg-surface-container-low rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:bg-surface-container-lowest focus:ring-1 focus:ring-primary shadow-inner w-full',
    label: 'font-label-md text-label-md text-on-surface-variant',
    filtro: 'flex items-center bg-surface-container-low rounded-lg px-space-sm py-1',
    filtroSelect: 'bg-transparent font-title-md text-title-md text-on-surface focus:outline-none py-1 cursor-pointer max-w-[180px]',
    th: 'py-space-sm px-space-md',
    chipRegra: 'font-code-sm text-code-sm px-1.5 py-0.5 rounded bg-primary-fixed text-primary font-bold',
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
  const params = new URLSearchParams(location.search);

  // ------------------------------------------------------------------ API
  async function api(metodo, url, corpo) {
    const opcoes = { method: metodo, headers: {}, credentials: 'same-origin' };
    if (corpo !== undefined) {
      opcoes.headers['Content-Type'] = 'application/json';
      opcoes.body = JSON.stringify(corpo);
    }
    let resp;
    try {
      resp = await fetch(url, opcoes);
    } catch {
      throw Object.assign(new Error('Sem conexão com o servidor. Verifique se ele está rodando.'), { status: 0 });
    }
    if (resp.status === 401 && url !== '/api/login') {
      location.href = 'login.html';
      throw new Error('Sessão expirada.');
    }
    const dados = (resp.headers.get('content-type') || '').includes('json') ? await resp.json() : null;
    if (!resp.ok) throw Object.assign(new Error(dados?.erro || `Erro ${resp.status}`), { status: resp.status, dados });
    return dados;
  }

  // ------------------------------------------------------------------ estado
  function indexar(e) {
    e.mapa = {
      vol: new Map(e.voluntarios.map((v) => [v.id, v])),
      disc: new Map(e.disciplinas.map((d) => [d.id, d])),
      turma: new Map(e.turmas.map((t) => [t.id, t])),
      hor: new Map(e.horarios.map((h) => [h.id, h])),
      aula: new Map(e.aulas.map((a) => [a.id, a])),
    };
    e.aulaEm = (turmaId, horarioId) => e.aulas.find((a) => a.turma_id === turmaId && a.horario_id === horarioId);
    return e;
  }

  /** Estrutura da grade: colunas = dias com horários, linhas = 1ª, 2ª, 3ª aula do dia. */
  function estrutura(e) {
    const dias = [...new Set(e.horarios.map((h) => h.dia))].sort((a, b) => a - b);
    const linhas = Math.max(0, ...e.horarios.map((h) => h.ordem));
    const celula = (dia, ordem) => e.horarios.find((h) => h.dia === dia && h.ordem === ordem) || null;
    return { dias, linhas, celula };
  }

  // ------------------------------------------------------------------ shell
  function montarShell(ativo, usuario) {
    const nav = NAV.map((g, i) => `
      <div class="px-space-sm ${i ? 'pt-space-md' : 'pt-space-xs'} pb-space-2xs font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold">${esc(g.grupo)}</div>
      ${g.itens.map((it) => {
        const atual = it.href === ativo;
        return `<a href="${it.href}" ${atual ? 'aria-current="page"' : ''}
          class="flex items-center gap-space-sm px-space-sm py-space-xs rounded-lg transition-all ${atual
            ? 'bg-primary-container text-on-primary font-title-md text-title-md font-semibold'
            : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface font-body-sm text-body-sm'}">
          <span class="material-symbols-outlined text-[20px]">${it.icone}</span><span class="flex-1">${esc(it.rotulo)}</span>
          ${it.contador ? '<span data-contador-alertas class="hidden min-w-[20px] h-5 px-1 rounded-full bg-error text-on-error font-label-sm text-label-sm flex items-center justify-center"></span>' : ''}
        </a>`;
      }).join('')}`).join('');

    const aside = document.createElement('aside');
    aside.id = 'sidebar';
    aside.className = 'fixed left-0 top-0 h-full w-64 bg-surface-container-lowest shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-50 flex flex-col justify-between overflow-y-auto -translate-x-full lg:translate-x-0 transition-transform duration-200';
    aside.innerHTML = `
      <div class="flex flex-col">
        <a href="painel.html" class="h-16 px-space-lg flex items-center gap-space-sm">
          <div class="w-9 h-9 rounded-lg bg-primary-container text-on-primary flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined text-[22px]">calendar_month</span>
          </div>
          <div class="flex flex-col">
            <span class="font-headline-sm text-headline-sm text-primary tracking-tight">Grade Solidária</span>
            <span class="font-label-sm text-label-sm text-on-surface-variant leading-none">EducaPop · Gestão Popular</span>
          </div>
        </a>
        <nav class="flex flex-col gap-space-xs px-space-md py-space-sm" aria-label="Menu principal">${nav}</nav>
      </div>
      <div class="p-space-md m-space-sm bg-surface-container-low rounded-xl flex items-center justify-between">
        <div class="flex flex-col"><span class="font-label-sm text-label-sm text-on-surface-variant">Cursinho Popular</span>
          <span class="font-title-md text-title-md text-primary font-semibold" id="periodoAtual">Comunitário</span></div>
        <span class="material-symbols-outlined text-secondary text-[20px]">verified</span>
      </div>`;

    const fundo = document.createElement('div');
    fundo.id = 'sidebarFundo';
    fundo.className = 'fixed inset-0 bg-on-surface/40 z-40 hidden lg:hidden';
    fundo.onclick = () => alternarMenu(false);

    const topo = document.createElement('header');
    topo.id = 'topo';
    topo.className = 'fixed top-0 left-0 lg:left-64 right-0 h-16 bg-surface/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-30 flex items-center justify-between px-space-lg gap-space-md';
    topo.innerHTML = `
      <div class="flex items-center gap-space-md min-w-0">
        <button type="button" class="lg:hidden p-space-xs rounded-lg hover:bg-surface-container-high" aria-label="Abrir menu" id="btnMenu">
          <span class="material-symbols-outlined text-[22px]">menu</span></button>
        <div class="hidden sm:flex items-center gap-space-xs bg-surface-container-lowest px-space-sm py-space-xs rounded-lg shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
          <span class="material-symbols-outlined text-primary text-[20px]">apartment</span>
          <div class="flex flex-col"><span class="font-label-sm text-label-sm text-on-surface-variant leading-none">Unidade Ativa</span>
            <span class="font-title-md text-title-md text-on-surface font-semibold leading-tight">Cursinho Popular</span></div>
        </div>
        <span id="resumoTopo" class="hidden md:inline-flex items-center gap-space-xs font-label-md text-label-md text-on-surface-variant truncate"></span>
      </div>
      <div class="flex items-center gap-space-md shrink-0">
        <a href="conflitos.html" title="Pendências da grade" class="relative p-space-xs rounded-lg bg-surface-container-lowest hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
          <span class="material-symbols-outlined text-[20px]">notifications</span>
          <span data-contador-alertas class="hidden absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-error text-on-error text-[10px] font-bold flex items-center justify-center"></span>
        </a>
        <div class="flex items-center gap-space-sm pl-space-sm">
          <div class="hidden sm:flex flex-col text-right"><span class="font-title-md text-title-md text-on-surface font-semibold leading-tight">${esc(usuario.nome)}</span>
            <span class="font-label-sm text-label-sm text-secondary font-medium leading-none">${esc(usuario.cargo)}</span></div>
          <div class="w-8 h-8 rounded-full bg-primary flex items-center justify-center"><span class="material-symbols-outlined text-on-primary text-[18px]">person</span></div>
          <button type="button" id="btnSair" title="Sair" class="p-space-xs rounded-lg text-on-surface-variant hover:text-error hover:bg-surface-container-high transition-colors">
            <span class="material-symbols-outlined text-[20px]">logout</span></button>
        </div>
      </div>`;

    const main = $('main');
    const wrap = document.createElement('div');
    wrap.id = 'conteudo';
    wrap.className = 'lg:pl-64';
    main.parentNode.insertBefore(wrap, main);
    wrap.append(topo, main);
    main.classList.add('relative', 'w-full', 'min-h-screen', 'pt-20', 'pb-space-2xl', 'px-space-lg');
    document.body.prepend(aside, fundo);

    $('#btnMenu').onclick = () => alternarMenu(true);
    $('#btnSair').onclick = async () => {
      await api('POST', '/api/logout').catch(() => { });
      location.href = 'login.html';
    };
    document.body.classList.add('pronto');
  }

  function alternarMenu(abrir) {
    $('#sidebar').classList.toggle('-translate-x-full', !abrir);
    $('#sidebarFundo').classList.toggle('hidden', !abrir);
  }

  function atualizarTopo(e) {
    const pendentes = e.indicadores.conflitos + e.indicadores.descobertas;
    for (const el of $$('[data-contador-alertas]')) {
      el.textContent = pendentes;
      el.classList.toggle('hidden', pendentes === 0);
    }
    const periodos = [...new Set(e.turmas.map((t) => t.periodo))];
    if (periodos.length) $('#periodoAtual').textContent = `Período ${periodos.join(' / ')}`;
    $('#resumoTopo').innerHTML = `<span class="material-symbols-outlined text-[16px] text-secondary">task_alt</span>
      ${e.indicadores.cobertas} de ${e.indicadores.demanda_total} aulas garantidas por semana`;
  }

  // ------------------------------------------------------------------ ciclo de vida da página
  const App = {
    DIAS, DIAS_LONGOS, cls, esc, $, $$, api, params, estrutura,
    estado: null,
    async start(cfg) {
      App.cfg = cfg;
      let usuario;
      try {
        usuario = await api('GET', '/api/me');
      } catch {
        return;
      }
      App.usuario = usuario;
      montarShell(cfg.ativo, usuario);
      try {
        await App.recarregar();
        cfg.depois?.(App.estado);
      } catch (erro) {
        App.toast(erro.message, 'erro');
      }
    },
    async recarregar() {
      const e = indexar(await api('GET', '/api/estado'));
      App.estado = e;
      atualizarTopo(e);
      App.cfg.render(e);
      return e;
    },
  };

  // ------------------------------------------------------------------ feedback
  App.toast = function (mensagem, tipo = 'ok') {
    let pilha = $('#toasts');
    if (!pilha) {
      pilha = document.createElement('div');
      pilha.id = 'toasts';
      pilha.className = 'fixed bottom-space-lg right-space-lg z-[80] flex flex-col gap-space-sm max-w-sm no-print';
      pilha.setAttribute('aria-live', 'polite');
      document.body.append(pilha);
    }
    const estilos = {
      ok: ['bg-primary-container text-on-primary', 'check_circle'],
      aviso: ['bg-warning-container text-on-warning-container', 'warning'],
      erro: ['bg-error-container text-on-error-container', 'error'],
    }[tipo];
    const el = document.createElement('div');
    el.className = `flex items-start gap-space-sm px-space-md py-space-sm rounded-xl shadow-lg font-body-md text-body-md ${estilos[0]} transition-all`;
    el.innerHTML = `<span class="material-symbols-outlined text-[20px] shrink-0">${estilos[1]}</span><span>${esc(mensagem)}</span>`;
    pilha.append(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, tipo === 'ok' ? 3500 : 6000);
  };

  /** Diálogo de confirmação. Retorna Promise<boolean>. */
  App.confirmar = function ({ titulo, mensagem, confirmar = 'Confirmar', perigo = false, icone = 'help' }) {
    return new Promise((resolve) => {
      const fundo = document.createElement('div');
      fundo.className = 'fixed inset-0 z-[70] bg-on-surface/40 flex items-center justify-center p-space-lg';
      fundo.innerHTML = `
        <div role="dialog" aria-modal="true" class="bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md p-space-xl flex flex-col gap-space-md">
          <div class="flex items-start gap-space-md">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${perigo ? 'bg-error-container text-error' : 'bg-primary-fixed text-primary'}">
              <span class="material-symbols-outlined">${icone}</span></div>
            <div class="flex flex-col gap-space-xs">
              <h2 class="font-headline-sm text-headline-sm text-on-surface">${esc(titulo)}</h2>
              <div class="font-body-md text-body-md text-on-surface-variant">${mensagem}</div>
            </div>
          </div>
          <div class="flex justify-end gap-space-sm pt-space-xs">
            <button type="button" data-r="0" class="${cls.btnNeutro}">Cancelar</button>
            <button type="button" data-r="1" class="${perigo ? cls.btnPerigo : cls.btnPrim}">${esc(confirmar)}</button>
          </div>
        </div>`;
      const fechar = (r) => { fundo.remove(); document.removeEventListener('keydown', tecla); resolve(r); };
      const tecla = (ev) => { if (ev.key === 'Escape') fechar(false); };
      fundo.addEventListener('click', (ev) => {
        if (ev.target === fundo) return fechar(false);
        const b = ev.target.closest('[data-r]');
        if (b) fechar(b.dataset.r === '1');
      });
      document.addEventListener('keydown', tecla);
      document.body.append(fundo);
      $('[data-r="1"]', fundo).focus();
    });
  };

  // ------------------------------------------------------------------ painel lateral (drawer)
  App.drawer = {
    abrir({ icone = 'badge', titulo, subtitulo = '', corpo = '', rodape = '', largura = 'max-w-2xl' }) {
      App.drawer.fechar(true);
      const fundo = document.createElement('div');
      fundo.id = 'drawerFundo';
      fundo.className = 'fixed inset-0 bg-on-surface/40 z-[60] transition-opacity opacity-0';
      fundo.onclick = () => App.drawer.fechar();
      const el = document.createElement('aside');
      el.id = 'drawer';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.className = `fixed top-0 right-0 h-full w-full ${largura} bg-surface-container-lowest shadow-2xl z-[60] transform translate-x-full transition-transform duration-300 flex flex-col overflow-hidden`;
      el.innerHTML = `
        <div class="px-space-lg py-space-md bg-surface-container-low flex items-center justify-between shrink-0 gap-space-md">
          <div class="flex flex-col min-w-0">
            <div class="flex items-center gap-space-xs"><span class="material-symbols-outlined text-primary text-[22px]">${icone}</span>
              <h2 class="font-headline-lg text-headline-lg text-primary truncate">${esc(titulo)}</h2></div>
            ${subtitulo ? `<p class="font-label-sm text-label-sm text-on-surface-variant">${esc(subtitulo)}</p>` : ''}
          </div>
          <button type="button" data-fechar class="p-space-xs rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors" aria-label="Fechar">
            <span class="material-symbols-outlined text-[24px]">close</span></button>
        </div>
        <div class="flex-1 overflow-y-auto px-space-lg py-space-lg flex flex-col gap-space-xl" data-corpo>${corpo}</div>
        ${rodape ? `<div class="px-space-lg py-space-md bg-surface-container-low flex items-center justify-between gap-space-sm shrink-0 flex-wrap" data-rodape>${rodape}</div>` : ''}`;
      $('[data-fechar]', el).onclick = () => App.drawer.fechar();
      document.body.append(fundo, el);
      App.drawer.tecla = (ev) => { if (ev.key === 'Escape' && !document.querySelector('[role=dialog][aria-modal][class*="max-w-md"]')) App.drawer.fechar(); };
      document.addEventListener('keydown', App.drawer.tecla);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fundo.classList.remove('opacity-0');
        el.classList.remove('translate-x-full');
      }));
      App.drawer.el = el;
      return el;
    },
    fechar(imediato = false) {
      const el = $('#drawer');
      const fundo = $('#drawerFundo');
      document.removeEventListener('keydown', App.drawer.tecla);
      if (!el) return;
      if (imediato) { el.remove(); fundo?.remove(); return; }
      el.classList.add('translate-x-full');
      fundo?.classList.add('opacity-0');
      setTimeout(() => { el.remove(); fundo?.remove(); }, 300);
    },
  };

  /** Executa uma ação com o botão travado e mostra erro amigável. */
  App.acao = async function (botao, fn) {
    if (botao) botao.disabled = true;
    try {
      return await fn();
    } catch (erro) {
      App.toast(erro.message, 'erro');
      return undefined;
    } finally {
      if (botao) botao.disabled = false;
    }
  };

  // ------------------------------------------------------------------ componentes
  App.iniciais = (nome) => String(nome).split(/\s+/).filter((p) => p.length > 2 || /^[A-Z]/.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  App.avatar = (v, tamanho = 'w-10 h-10') => {
    const cor = !v.ativo ? 'bg-surface-container-highest text-on-surface-variant'
      : v.situacao_carga === 'acima' ? 'bg-tertiary-container text-on-tertiary' : 'bg-primary-container text-on-primary';
    return `<div class="${tamanho} rounded-full ${cor} font-title-md text-title-md flex items-center justify-center font-bold shadow-sm shrink-0">${esc(App.iniciais(v.nome))}</div>`;
  };

  App.STATUS = {
    coberta: { rotulo: 'Coberta', chip: 'bg-primary-fixed/50 text-primary', borda: 'border-secondary', fundo: 'bg-surface-container-lowest', icone: 'check_circle', ponto: 'bg-secondary' },
    descoberta: { rotulo: 'Sem professor', chip: 'bg-warning-container text-on-warning-container', borda: 'border-warning', fundo: 'bg-warning-container/30', icone: 'person_off', ponto: 'bg-warning' },
    conflito: { rotulo: 'Conflito', chip: 'bg-error-container text-on-error-container', borda: 'border-error', fundo: 'bg-error-container/30', icone: 'error', ponto: 'bg-error' },
  };

  App.chipStatus = (status) => {
    const s = App.STATUS[status];
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${s.chip} font-label-sm text-label-sm font-semibold whitespace-nowrap">
      <span class="material-symbols-outlined text-[14px]">${s.icone}</span>${s.rotulo}</span>`;
  };

  App.CARGA = {
    acima: { rotulo: 'Acima do limite', texto: 'text-error', barra: 'bg-error' },
    no_limite: { rotulo: 'No limite', texto: 'text-tertiary-container', barra: 'bg-tertiary-container' },
    equilibrada: { rotulo: 'Equilibrada', texto: 'text-secondary', barra: 'bg-secondary' },
    baixa: { rotulo: 'Pode assumir mais', texto: 'text-surface-tint', barra: 'bg-secondary-fixed-dim' },
    inativo: { rotulo: 'Inativo', texto: 'text-on-surface-variant', barra: 'bg-outline-variant' },
  };

  App.barraCarga = (v, largura = 'w-36') => {
    const c = App.CARGA[v.situacao_carga];
    const pct = Math.min(100, Math.round((v.carga / v.limite_aulas) * 100));
    return `<div class="flex flex-col gap-1 ${largura}" title="${c.rotulo}">
      <div class="flex justify-between font-label-sm text-label-sm font-medium">
        <span class="${c.texto} font-semibold">${v.carga} / ${v.limite_aulas} aulas</span>
        <span class="text-on-surface-variant">${c.rotulo}</span></div>
      <div class="w-full bg-surface-container h-1.5 rounded-full overflow-hidden"><div class="${c.barra} h-full rounded-full" style="width:${pct}%"></div></div>
    </div>`;
  };

  App.chipRegra = (regra) => `<span class="font-code-sm text-code-sm px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-semibold">${esc(regra)}</span>`;

  App.listaProblemas = (lista, tom = 'error') => lista.length ? `<ul class="flex flex-col gap-1">${lista.map((p) => `
      <li class="flex items-start gap-space-xs font-body-sm text-body-sm text-${tom === 'error' ? 'error' : 'warning'}">
        <span class="material-symbols-outlined text-[16px] mt-px">${tom === 'error' ? 'block' : 'warning'}</span>
        <span class="flex-1">${esc(p.msg)}</span>${App.chipRegra(p.regra)}</li>`).join('')}</ul>` : '';

  App.vazio = (mensagem, icone = 'task_alt') => `
    <div class="flex flex-col items-center justify-center gap-space-xs py-space-2xl text-center text-on-surface-variant">
      <span class="material-symbols-outlined text-[36px] text-secondary">${icone}</span>
      <span class="font-body-md text-body-md">${esc(mensagem)}</span></div>`;

  App.kpi = ({ rotulo, valor, unidade = '', icone, cor = 'text-primary', rodape = '', destaque = false }) => `
    <div class="${cls.card} p-space-md flex flex-col justify-between relative overflow-hidden">
      ${destaque ? '<div class="absolute right-0 top-0 w-24 h-24 bg-primary-fixed/20 rounded-bl-full pointer-events-none"></div>' : ''}
      <div class="flex items-center justify-between gap-space-sm">
        <span class="font-label-sm text-label-sm uppercase tracking-wider ${cor === 'text-error' ? 'text-error' : 'text-on-surface-variant'}">${rotulo}</span>
        <span class="material-symbols-outlined ${cor} text-[22px]">${icone}</span>
      </div>
      <div class="mt-space-md">
        <div class="flex items-baseline gap-space-xs"><span class="font-display-lg text-display-lg ${cor} leading-none">${valor}</span>
          <span class="font-body-sm text-body-sm text-on-surface-variant">${unidade}</span></div>
        ${rodape ? `<div class="flex items-center gap-space-xs mt-space-xs flex-wrap">${rodape}</div>` : ''}
      </div>
    </div>`;

  App.cabecalho = ({ modulo, titulo, descricao, acoes = '' }) => `
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
      <div class="flex flex-col max-w-2xl">
        <div class="flex items-center gap-space-xs mb-space-2xs">
          <span class="px-space-xs py-0.5 rounded bg-surface-container-highest text-primary font-code-sm text-code-sm tracking-wide">${modulo}</span>
          <span class="text-on-surface-variant font-label-sm text-label-sm">• Gestão Comunitária</span>
        </div>
        <h1 class="font-display-lg text-display-lg text-primary tracking-tight">${titulo}</h1>
        <p class="font-body-md text-body-md text-on-surface-variant mt-space-2xs">${descricao}</p>
      </div>
      <div class="flex items-center flex-wrap gap-space-sm self-start md:self-auto no-print">${acoes}</div>
    </div>`;

  App.opcoes = (lista, selecionado, rotulo = (x) => x.nome) =>
    lista.map((x) => `<option value="${x.id}" ${String(x.id) === String(selecionado) ? 'selected' : ''}>${esc(rotulo(x))}</option>`).join('');

  App.dataHora = (s) => {
    const d = new Date(String(s).replace(' ', 'T'));
    return isNaN(d) ? s : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  App.localAula = (e, a) => {
    const t = e.mapa.turma.get(a.turma_id);
    const h = e.mapa.hor.get(a.horario_id);
    return `${t.nome} · ${DIAS_LONGOS[h.dia]}, ${h.ordem}ª aula (${h.inicio}–${h.fim})`;
  };

  window.App = App;
})();
