(() => {
// Todas as leituras e gravações passam pela API em /api/db, que conversa com o Neon.
async function api(r, params) {
  const res = await fetch('/api/db?' + new URLSearchParams({ r, ...(params || {}) }), { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body.erro || 'Erro ' + res.status); e.status = res.status; throw e; }
  return body;
}
async function apiPost(acao, dados) {
  const res = await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao, ...dados }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body.erro || 'Erro ' + res.status); e.status = res.status; e.conflito = body.conflito; throw e; }
  return body;
}

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('pt-BR');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const label = p => p.join(' e ');
const QUICK = [100, 200, 300, 500];
const LIMITS = [1500, 2000, 3000, 5000];
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

let game = null;      // linha da tabela partidas
let rounds = [];      // rodadas da partida atual
let poll = null;      // atualização periódica da partida aberta
let lastVersion = null;
let busy = false;

/* ---------- utilidades ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
function fail(err, msg) { console.error(err); toast(err && err.status && err.status < 500 && err.message ? err.message : (msg || 'Sem conexão com o servidor. Tente de novo.')); }
const teamA = g => [g.a1, g.a2];
const teamB = g => [g.b1, g.b2];
const totals = () => rounds.reduce((t, r) => [t[0] + r.pontos_a, t[1] + r.pontos_b], [0, 0]);
const dateBR = d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

/* ---------- navegação ---------- */
const VIEWS = ['placar', 'historico', 'ranking'];
function route() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'placar';
  VIEWS.forEach(x => { $('view-' + x).hidden = x !== v; });
  document.querySelectorAll('.nav a').forEach(a => { if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (v === 'historico') loadHistory();
  if (v === 'ranking') loadRanking();
}
window.addEventListener('hashchange', route);

/* ---------- partida atual ---------- */
function setGame(data) {
  if (!data.partida || data.partida.status === 'cancelada') { closeGame(); return; }
  if (!game || game.id !== data.partida.id) resetCalc();
  game = data.partida; rounds = data.rodadas; lastVersion = game.updated_at;
  LS.set('partidaId', game.id);
  watch(game.id);
  renderGame();
}
function closeGame() {
  clearInterval(poll); poll = null;
  LS.del('partidaId'); game = null; rounds = []; lastVersion = null; renderGame();
}
async function openGame(id) {
  try { setGame(await api('partida', { id })); }
  catch (e) { if (e.status === 400) closeGame(); else fail(e); }
}

// Sem conexão permanente com o banco: o app pergunta a cada 3 segundos se a partida mudou
// e só baixa as rodadas quando algo mudou. Pausa quando o app está em segundo plano.
function setLive(ok) { $('liveTag').classList.toggle('off', !ok); $('liveTag').textContent = ok ? 'ao vivo' : 'reconectando'; }
function watch(id) {
  if (poll) return;
  poll = setInterval(async () => {
    if (busy || document.hidden || !game || game.id !== id) return;
    try {
      const v = await api('versao', { id });
      setLive(true);
      if (!v || v.status === 'cancelada') { closeGame(); toast('Esta partida foi cancelada em outro celular.'); return; }
      if (v.updated_at !== lastVersion && !busy) setGame(await api('partida', { id }));
    } catch (e) { setLive(false); }
  }, 3000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && game && !busy) openGame(game.id); });

async function renderNoGame() {
  $('noGame').hidden = false; $('gameArea').hidden = true;
  const ul = $('openGames');
  let data;
  try { data = await api('abertas'); }
  catch (e) { ul.innerHTML = '<li class="empty">Não foi possível carregar as partidas.</li>'; return; }
  ul.innerHTML = data.length ? data.map(g => `<li><span class="m"><b>${esc(label(teamA(g)))} × ${esc(label(teamB(g)))}</b><span class="sub num">${fmt(g.placar_a)} × ${fmt(g.placar_b)} · limite ${fmt(g.limite)} · ${dateBR(g.created_at)}</span></span>
    <button data-open="${g.id}">Entrar</button></li>`).join('') : '<li class="empty">Nenhuma partida em andamento.</li>';
}

function renderGame() {
  if (!game) return renderNoGame();
  $('noGame').hidden = true; $('gameArea').hidden = false;
  const g = game, [ta, tb] = totals(), A = teamA(g), B = teamB(g);
  const lead = ta === tb ? null : (ta > tb ? 0 : 1);
  const card = (names, score, i) => {
    const pct = Math.max(0, Math.min(100, score / g.limite * 100)), need = g.limite - score;
    return `<div class="team${lead === i ? ' lead' : ''}">
      <span class="names">${esc(label(names))}</span>
      <span class="score num${score < 0 ? ' neg' : ''}">${fmt(score)}</span>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <span class="need num">${need > 0 ? 'Faltam ' + fmt(need) : 'Bateu o limite'}</span></div>`;
  };
  $('board').innerHTML = card(A, ta, 0) + card(B, tb, 1) +
    `<div class="meta num"><span>Limite: ${fmt(g.limite)} pontos</span><span>${rounds.length} rodada${rounds.length === 1 ? '' : 's'}</span></div>`;
  $('whoA').innerHTML = `<span class="dot" style="background:var(--a)"></span>${esc(label(A))}`;
  $('whoB').innerHTML = `<span class="dot" style="background:var(--b)"></span>${esc(label(B))}`;
  $('roundTitle').textContent = 'Rodada ' + (rounds.length + 1);

  const w = $('winner');
  if (g.status === 'encerrada') {
    const win = g.vencedor === 'A' ? A : B;
    w.hidden = false; $('entryPanel').hidden = true;
    w.innerHTML = `<span class="label">Fim de partida</span><strong>${esc(label(win))} venceram!</strong>
      <span class="num">${fmt(Math.max(ta, tb))} × ${fmt(Math.min(ta, tb))}</span>
      <div class="row"><button class="btn-ghost" id="undoEnd">Desfazer última rodada</button><button class="btn-primary" id="rematch">Revanche</button></div>`;
    $('rematch').onclick = () => openSetup(true);
    $('undoEnd').onclick = () => ask('Desfazer a última rodada e reabrir a partida?', undo);
  } else if (ta >= g.limite && tb >= g.limite && ta === tb) {
    w.hidden = false; $('entryPanel').hidden = false;
    w.innerHTML = '<span class="label">Empate no limite</span><strong>Joguem mais uma rodada para desempatar</strong>';
  } else { w.hidden = true; $('entryPanel').hidden = false; }

  let run = [0, 0];
  const rows = rounds.map(r => { run = [run[0] + r.pontos_a, run[1] + r.pontos_b];
    const c = v => `class="${v < 0 ? 'neg' : ''}"`, s = v => (v > 0 ? '+' : '') + fmt(v);
    return `<tr><td>${r.numero}ª</td><td ${c(r.pontos_a)}>${s(r.pontos_a)}<div class="sub">${fmt(run[0])}</div></td><td ${c(r.pontos_b)}>${s(r.pontos_b)}<div class="sub">${fmt(run[1])}</div></td></tr>`;
  }).reverse().join('');
  $('hist').innerHTML = `<thead><tr><th>Rodada</th><th>${esc(A[0])} / ${esc(A[1])}</th><th>${esc(B[0])} / ${esc(B[1])}</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="empty">Nenhuma rodada lançada ainda.</td></tr>'}</tbody>`;
  $('undoBtn').disabled = !rounds.length;
}

// O servidor grava a rodada e recalcula o placar numa única operação.
async function addRound() {
  if (busy || !game) return;
  const a = read('A'), b = read('B');
  if (!a && !b) { $('ptsA').focus(); return; }
  busy = true; $('addBtn').disabled = true;
  try {
    const numero = (rounds.length ? rounds[rounds.length - 1].numero : 0) + 1;
    const data = await apiPost('rodada', { partida_id: game.id, numero, pontos_a: a, pontos_b: b });
    ['A', 'B'].forEach(t => { $('pts' + t).value = ''; $('sign' + t).setAttribute('aria-pressed', 'false'); });
    resetCalc();
    setGame(data);
  } catch (e) {
    if (e.conflito) { toast(e.message); busy = false; await openGame(game.id); return; }
    fail(e, 'Não foi possível lançar a rodada. Confira a internet e tente de novo.');
  }
  finally { busy = false; $('addBtn').disabled = false; }
}

async function undo() {
  if (busy || !game || !rounds.length) return;
  busy = true;
  try { setGame(await apiPost('desfazer', { partida_id: game.id })); }
  catch (e) { fail(e); }
  finally { busy = false; }
}

function read(t) { const v = parseInt($('pts' + t).value) || 0; return $('sign' + t).getAttribute('aria-pressed') === 'true' ? -v : v; }

/* ---------- histórico ---------- */
async function loadHistory() {
  const ul = $('historyList');
  let data;
  try { data = await api('historico'); }
  catch (e) { ul.innerHTML = '<li class="empty">Não foi possível carregar o histórico.</li>'; return; }
  if (!data.length) { ul.innerHTML = '<li class="empty">Nenhuma partida salva ainda.</li>'; return; }
  ul.innerHTML = data.map(g => {
    const A = label(teamA(g)), B = label(teamB(g)), done = g.status === 'encerrada';
    const winA = done && g.vencedor === 'A', winB = done && g.vencedor === 'B';
    return `<li><span class="m"><b>${winA ? '★ ' : ''}${esc(A)} <span class="sub">×</span> ${winB ? '★ ' : ''}${esc(B)}</b>
      <span class="sub num">${dateBR(g.created_at)} · limite ${fmt(g.limite)}</span></span>
      <span class="s"><span class="num"><b>${fmt(g.placar_a)}</b> × <b>${fmt(g.placar_b)}</b></span><br>
      ${done ? '<span class="pill">encerrada</span>' : `<button data-open="${g.id}">Continuar</button>`}</span></li>`;
  }).join('');
}

/* ---------- ranking ---------- */
const key = s => s.trim().toLocaleLowerCase('pt-BR');
async function loadRanking() {
  let data;
  try { data = await api('ranking'); }
  catch (e) { $('rankPlayers').innerHTML = '<tr><td class="empty">Não foi possível carregar o ranking.</td></tr>'; return; }
  const players = new Map(), pairs = new Map();
  const add = (map, k, name, won) => { const o = map.get(k) || { name, j: 0, v: 0 }; o.j++; if (won) o.v++; map.set(k, o); };
  data.forEach(g => {
    [['A', [g.a1, g.a2]], ['B', [g.b1, g.b2]]].forEach(([side, ps]) => {
      const won = g.vencedor === side;
      ps.forEach(p => add(players, key(p), p.trim(), won));
      const sorted = [...ps].map(p => p.trim()).sort((x, y) => key(x).localeCompare(key(y)));
      add(pairs, sorted.map(key).join('|'), label(sorted), won);
    });
  });
  const table = map => {
    const rows = [...map.values()].sort((x, y) => y.v - x.v || (y.v / y.j) - (x.v / x.j) || x.j - y.j);
    if (!rows.length) return '<tbody><tr><td class="empty" colspan="4">O ranking aparece quando a primeira partida terminar.</td></tr></tbody>';
    return `<thead><tr><th>Nome</th><th>Vitórias</th><th>Jogos</th><th>%</th></tr></thead><tbody>` +
      rows.map((r, i) => `<tr><td><span class="medal">${i < 3 ? ['1º', '2º', '3º'][i] : ''}</span>${esc(r.name)}</td><td>${r.v}</td><td>${r.j}</td><td>${Math.round(r.v / r.j * 100)}%</td></tr>`).join('') + '</tbody>';
  };
  $('rankPlayers').innerHTML = table(players);
  $('rankPairs').innerHTML = table(pairs);
  $('rankCount').textContent = data.length ? `${data.length} partida${data.length === 1 ? '' : 's'} encerrada${data.length === 1 ? '' : 's'}` : '';
}

/* ---------- entrar em partidas ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-open]'); if (!b) return;
  openGame(b.dataset.open).then(() => { location.hash = 'placar'; });
});

/* ---------- lançamento ---------- */
document.querySelectorAll('.chips').forEach(box => {
  const t = box.dataset.for;
  box.innerHTML = QUICK.map(v => `<button type="button" data-v="${v}">+${v}</button>`).join('') + '<button type="button" data-v="0">Limpar</button>';
  box.onclick = e => { const b = e.target.closest('button'); if (!b) return; const inp = $('pts' + t), v = +b.dataset.v;
    inp.value = v === 0 ? '' : String((parseInt(inp.value) || 0) + v); };
});
['A', 'B'].forEach(t => {
  $('sign' + t).onclick = e => { const b = e.currentTarget; b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); };
  $('pts' + t).addEventListener('input', e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); });
});
$('addBtn').onclick = addRound;
$('undoBtn').onclick = () => ask('Desfazer a última rodada?', undo);
$('cancelGame').onclick = () => ask('Cancelar esta partida? Ela sai do histórico e do ranking.', async () => {
  try { await apiPost('cancelar', { partida_id: game.id }); }
  catch (e) { return fail(e); }
  closeGame();
});

/* ---------- confirmação ---------- */
let onYes = null;
function ask(text, fn) { $('confirmText').textContent = text; onYes = fn; $('confirm').hidden = false; }
$('confirmNo').onclick = () => { $('confirm').hidden = true; };
$('confirmYes').onclick = () => { $('confirm').hidden = true; onYes && onYes(); };

/* ---------- nova partida ---------- */
$('limitChips').innerHTML = LIMITS.map(v => `<button type="button" data-v="${v}" aria-pressed="false">${fmt(v)}</button>`).join('');
function setLimit(v) { $('limit').value = v; $('limitChips').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.v === +v ? 'true' : 'false')); }
$('limitChips').onclick = e => { const b = e.target.closest('button'); if (b) setLimit(b.dataset.v); };
$('limit').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); setLimit(e.target.value); });

async function fillKnownPlayers() {
  let data = [];
  try { data = await api('jogadores'); } catch (e) { return; }
  const seen = new Map();
  (data || []).forEach(g => [g.a1, g.a2, g.b1, g.b2].forEach(n => { const k = key(n); if (!seen.has(k)) seen.set(k, n.trim()); }));
  $('knownPlayers').innerHTML = [...seen.values()].map(n => `<option value="${esc(n)}">`).join('');
}
function openSetup(keep) {
  const last = LS.get('ultimasDuplas', null);
  const n = keep && game ? [teamA(game), teamB(game)] : (last || [['', ''], ['', '']]);
  $('a1').value = n[0][0]; $('a2').value = n[0][1]; $('b1').value = n[1][0]; $('b2').value = n[1][1];
  setLimit(keep && game ? game.limite : LS.get('ultimoLimite', 3000));
  $('setup').hidden = false;
  fillKnownPlayers();
}
$('newBtn').onclick = $('newBtn2').onclick = () => {
  if (game && game.status === 'andamento' && rounds.length) ask('Deixar a partida atual em andamento e começar outra? Ela continua salva no histórico.', () => openSetup(false));
  else openSetup(false);
};
$('cancelSetup').onclick = () => { $('setup').hidden = true; };
$('setupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const limite = parseInt($('limit').value);
  if (!limite || limite < 100) { $('limit').focus(); return toast('O limite precisa ser de pelo menos 100 pontos.'); }
  const v = id => $(id).value.trim();
  const row = { a1: v('a1'), a2: v('a2'), b1: v('b1'), b2: v('b2'), limite };
  $('startBtn').disabled = true;
  let data;
  try { data = await apiPost('criar', row); }
  catch (e) { $('startBtn').disabled = false; return fail(e, 'Não foi possível criar a partida. Confira a internet.'); }
  $('startBtn').disabled = false;
  LS.set('ultimasDuplas', [[row.a1, row.a2], [row.b1, row.b2]]); LS.set('ultimoLimite', limite);
  $('setup').hidden = true;
  setGame({ partida: data, rodadas: [] });
  location.hash = 'placar';
});

/* ---------- calculadora ---------- */
const RULE_DEF = [['limpa', 'Canastra limpa', 200], ['suja', 'Canastra suja', 100], ['real', 'Canastra real (A a A)', 500], ['batida', 'Batida', 100], ['morto', 'Morto não pego', 100]];
const rules = Object.assign(Object.fromEntries(RULE_DEF.map(r => [r[0], r[2]])), LS.get('regras', {}));
const blank = () => ({ limpa: 0, suja: 0, real: 0, batida: false, morto: false, mesa: '', mao: '' });
let calc = { A: blank(), B: blank() }, tab = 'A';
const calcTotal = c => c.limpa * rules.limpa + c.suja * rules.suja + c.real * rules.real + (c.batida ? rules.batida : 0) - (c.morto ? rules.morto : 0) + (parseInt(c.mesa) || 0) - (parseInt(c.mao) || 0);
const stepRow = (k, t, h) => `<div class="crow"><span class="lbl"><b>${t}</b><span class="sub">${h}</span></span><span class="step"><button type="button" data-k="${k}" data-d="-1" aria-label="Menos">−</button><output>${calc[tab][k]}</output><button type="button" data-k="${k}" data-d="1" aria-label="Mais">+</button></span></div>`;
const toggleRow = (k, t, h) => `<div class="crow"><span class="lbl"><b>${t}</b><span class="sub">${h}</span></span><button type="button" class="toggle" data-t="${k}" aria-pressed="${calc[tab][k]}" aria-label="${t}"></button></div>`;
const numRow = (k, t, h) => `<div class="crow"><span class="lbl"><b>${t}</b><span class="sub">${h}</span></span><input id="calc-${k}" data-n="${k}" inputmode="numeric" pattern="[0-9]*" placeholder="0" value="${calc[tab][k]}"></div>`;
function renderCalc() {
  $('tabA').textContent = label(teamA(game)); $('tabB').textContent = label(teamB(game));
  $('tabA').setAttribute('aria-selected', tab === 'A'); $('tabB').setAttribute('aria-selected', tab === 'B');
  $('calcBody').innerHTML = stepRow('limpa', 'Canastras limpas', `${fmt(rules.limpa)} cada`) + stepRow('suja', 'Canastras sujas', `${fmt(rules.suja)} cada`) +
    stepRow('real', 'Canastras reais', `${fmt(rules.real)} cada`) + toggleRow('batida', 'Bateu', `+${fmt(rules.batida)}`) +
    toggleRow('morto', 'Não pegou o morto', `−${fmt(rules.morto)}`) + numRow('mesa', 'Cartas na mesa', 'Soma dos pontos das cartas baixadas') +
    numRow('mao', 'Cartas na mão', 'Pontos que sobraram na mão (subtrai)');
  updateSums();
}
function updateSums() {
  const a = calcTotal(calc.A), b = calcTotal(calc.B);
  $('calcWho').textContent = 'Total de ' + label(tab === 'A' ? teamA(game) : teamB(game));
  $('calcSum').textContent = fmt(tab === 'A' ? a : b);
  $('ctA').textContent = label(teamA(game)); $('ctB').textContent = label(teamB(game));
  $('cvA').textContent = fmt(a); $('cvB').textContent = fmt(b);
  $('cvA').classList.toggle('neg', a < 0); $('cvB').classList.toggle('neg', b < 0);
}
$('calcBody').addEventListener('click', e => {
  const s = e.target.closest('[data-k]'), t = e.target.closest('[data-t]');
  if (s) { const k = s.dataset.k; calc[tab][k] = Math.max(0, calc[tab][k] + +s.dataset.d); s.parentNode.querySelector('output').textContent = calc[tab][k]; updateSums(); }
  if (t) { const k = t.dataset.t; calc[tab][k] = !calc[tab][k]; t.setAttribute('aria-pressed', calc[tab][k]); if (k === 'batida' && calc[tab][k]) calc[tab === 'A' ? 'B' : 'A'].batida = false; updateSums(); }
});
$('calcBody').addEventListener('input', e => { const n = e.target.dataset.n; if (!n) return; e.target.value = e.target.value.replace(/[^0-9]/g, ''); calc[tab][n] = e.target.value; updateSums(); });
$('tabA').onclick = () => { tab = 'A'; renderCalc(); }; $('tabB').onclick = () => { tab = 'B'; renderCalc(); };
function renderRules() { $('rules').innerHTML = RULE_DEF.map(r => `<label>${r[1]}<input id="rule-${r[0]}" data-r="${r[0]}" inputmode="numeric" pattern="[0-9]*" value="${rules[r[0]]}"></label>`).join(''); }
$('rules').addEventListener('input', e => { const k = e.target.dataset.r; if (!k) return; e.target.value = e.target.value.replace(/[^0-9]/g, ''); rules[k] = parseInt(e.target.value) || 0; LS.set('regras', rules); renderCalc(); });
// A calculadora guarda o que foi marcado para cada dupla até a rodada ser lançada,
// e só escreve no campo da dupla que foi de fato preenchida nela.
const touched = c => c.limpa || c.suja || c.real || c.batida || c.morto || c.mesa !== '' || c.mao !== '';
function resetCalc() { calc = { A: blank(), B: blank() }; tab = 'A'; }
$('calcBtn').onclick = () => {
  if (!touched(calc.A) && !touched(calc.B)) tab = $('ptsA').value && !$('ptsB').value ? 'B' : 'A';
  else if (touched(calc.A) && !touched(calc.B)) tab = 'B';
  renderRules(); renderCalc(); $('calc').hidden = false;
};
$('calcClose').onclick = () => { $('calc').hidden = true; };
$('calcUse').onclick = () => {
  ['A', 'B'].forEach(t => {
    if (!touched(calc[t])) return;
    const v = calcTotal(calc[t]);
    $('pts' + t).value = v ? String(Math.abs(v)) : '';
    $('sign' + t).setAttribute('aria-pressed', v < 0 ? 'true' : 'false');
  });
  $('calc').hidden = true; $('addBtn').focus();
};

/* ---------- início ---------- */
route();
const saved = LS.get('partidaId', null);
if (saved) openGame(saved); else renderGame();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
