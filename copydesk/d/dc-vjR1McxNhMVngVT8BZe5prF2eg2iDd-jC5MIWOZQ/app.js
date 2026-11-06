(function () {
  const base = window.COPYDESK_BASE || './';
  const errEl = document.getElementById('err');
  const view = document.getElementById('view');
  const tabs = document.getElementById('tabs');
  const sheet = document.getElementById('sheet');
  const sheetBody = document.getElementById('sheet-body');
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let tab = 'home';
  let qTraders = '';
  let qActivity = '';
  let actFilter = 'all';
  let range = 'LIVE';
  let cache = { state: null, positions: null, activity: null, signals: null, charts: null };
  let lastBal = null;
  let pulseRaf = 0;
  let flowRaf = 0;
  let homeBuilt = false;

  function money(n) {
    if (n == null || isNaN(n)) return '—';
    return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }
  function shortAddr(a) { return a ? a.slice(0, 4) + '…' + a.slice(-4) : '—'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function friendlyReject(raw) {
    const map = {
      freeze_authority_set: 'Can freeze',
      mint_authority_set: 'Mint on',
      liq_low: 'Low liq',
      too_new: 'Too new',
      chase: 'Chase',
      pump_h1: '1h pump',
      score_low: 'Low score',
      age_sweet: 'Age',
    };
    if (!raw) return 'Skipped';
    return map[raw] || String(raw).replace(/_/g, ' ');
  }
  function friendlyReason(r) {
    if (!r) return '';
    if (r.startsWith('PASS')) return 'Pass';
    if (r.startsWith('liq_')) return 'Liq';
    if (r.startsWith('age_')) return 'Age';
    if (r.startsWith('flow_')) return 'Flow';
    if (r.startsWith('h1_')) return '1h';
    if (r === 'mint_renounced') return 'Mint off';
    if (r === 'freeze_off') return 'Freeze off';
    return r.replace(/_/g, ' ');
  }

  async function j(path) {
    const clean = path.replace(/\.json$/, '');
    const tries = ['/api/' + clean, base + path, './' + path];
    let last;
    for (const u of tries) {
      try {
        const r = await fetch(u, { cache: 'no-store' });
        if (r.ok) return await r.json();
        last = r.status;
      } catch (e) { last = e; }
    }
    throw new Error('fetch failed ' + last);
  }

  function following(state) {
    return (state.leaders || []).filter(L => L.enabled);
  }

  function openSheet(html) {
    sheetBody.innerHTML = html;
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
  }
  function closeSheet() {
    sheet.classList.remove('open');
    setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 200);
  }
  sheet.addEventListener('click', e => {
    if (e.target === sheet) closeSheet();
  });

  function balDigits(n) {
    const s = money(n);
    return s.split('').map((ch, i) => {
      if (!/[0-9]/.test(ch)) return `<span>${esc(ch)}</span>`;
      const digs = '0123456789'.split('').map(d => `<i>${d}</i>`).join('');
      return `<span class="d" data-i="${i}" data-v="${ch}"><span style="transform:translateY(-${ch}em)">${digs}</span></span>`;
    }).join('');
  }
  function setBal(el, n) {
    if (!el) return;
    if (reduce() || lastBal == null) {
      el.innerHTML = balDigits(n);
      lastBal = n;
      return;
    }
    if (Math.abs(n - lastBal) < 0.005 && el.childElementCount) return;
    el.innerHTML = balDigits(n);
    lastBal = n;
  }

  function chartFor() {
    const charts = cache.charts || {};
    if (charts[range]) return charts[range];
    if (charts.ranges && charts.ranges[range]) return charts.ranges[range];
    // chart.json may be {LIVE:...,1D:...,ALL:...}
    if (charts.LIVE || charts.ALL) return charts[range] || charts.LIVE || charts.ALL;
    return { points: [], marks: [], start: (cache.state && cache.state.startBalance) || 200 };
  }

  function startPulse() {
    cancelAnimationFrame(pulseRaf);
    if (reduce() || tab !== 'home') return;
    const tick = t => {
      const cv = view.querySelector('#line');
      if (cv && cache.charts) CopyCharts.line(cv, chartFor(), t);
      pulseRaf = requestAnimationFrame(tick);
    };
    pulseRaf = requestAnimationFrame(tick);
  }

  function startFlow() {
    cancelAnimationFrame(flowRaf);
    const cv = view.querySelector('#flow');
    if (!cv || reduce() || tab !== 'home') return;
    const ctx = cv.getContext('2d');
    const dots = Array.from({ length: 18 }, () => ({
      x: Math.random(), y: Math.random(), v: 0.0004 + Math.random() * 0.0012, r: 0.6 + Math.random() * 1.4
    }));
    const draw = () => {
      const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.round(r.width * d));
      cv.height = Math.max(1, Math.round(r.height * d));
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      const alive = cache.state && cache.state.alive;
      ctx.fillStyle = alive ? 'rgba(0,211,90,0.35)' : 'rgba(235,235,245,0.18)';
      dots.forEach(p => {
        p.x += p.v;
        if (p.x > 1.05) { p.x = -0.05; p.y = Math.random(); }
        ctx.beginPath();
        ctx.arc(p.x * r.width, p.y * r.height, p.r, 0, 7);
        ctx.fill();
      });
      flowRaf = requestAnimationFrame(draw);
    };
    flowRaf = requestAnimationFrame(draw);
  }

  function sparkVals(chart) {
    const pts = (chart && chart.points) || [];
    if (pts.length < 2) return [];
    const step = Math.max(1, Math.floor(pts.length / 24));
    return pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(p => p.v);
  }

  function renderHome(state, positions, activity) {
    const n = state.followingCount != null ? state.followingCount : following(state).length;
    const open = (positions.rows || []).filter(r => r.status === 'open');
    const pct = state.todayPct || 0;
    const latest = (activity.rows || [])[0];
    const watching = following(state).filter(L => L.bootstrapped).length;
    return `
      <div class="nav">
        <div class="title">Copy</div>
        <span class="pill paper">PAPER</span>
        <span class="pill live ${state.alive ? 'on' : 'off'}" id="alive">${state.alive ? 'LIVE' : 'STALE'}</span>
      </div>
      <section class="balwrap">
        <div class="flow"><canvas id="flow"></canvas></div>
        <div class="bal" id="bal">${balDigits(state.balance)}</div>
        <div class="delta ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</div>
      </section>
      <div class="chartwrap"><canvas id="line"></canvas></div>
      <div class="ranges" id="ranges">
        <button type="button" data-range="LIVE" class="${range === 'LIVE' ? 'on' : ''}">Live</button>
        <button type="button" data-range="1D" class="${range === '1D' ? 'on' : ''}">1D</button>
        <button type="button" data-range="ALL" class="${range === 'ALL' ? 'on' : ''}">All</button>
      </div>
      <div class="stats">
        <button class="stat" type="button" data-sheet="following"><span>Following</span><b id="stat-f">${n}</b><canvas id="spk-f"></canvas></button>
        <button class="stat" type="button" data-sheet="trades"><span>Trades</span><b id="stat-t">${state.trades || 0}</b><canvas id="spk-t"></canvas></button>
        <button class="stat" type="button" data-sheet="book"><span>${open.length ? 'In' : 'Watching'}</span><b id="stat-w">${open.length ? open.length : watching}</b><canvas id="spk-w"></canvas></button>
      </div>
      <div class="hlabel">Activity</div>
      <div class="list feed-slot" id="home-act">${latest ? `
        <button class="row" type="button" data-sheet="activity">
          <div class="m"><b>${esc(latest.title)}</b><span>${esc(latest.subtitle || latest.kind || '')}</span></div>
          <div class="v">${esc(latest.value || '')}</div>
          <span class="chev">›</span>
        </button>` : '<div class="empty-msg">Quiet</div>'}
      </div>`;
  }

  function traderSheet(L, st) {
    const last = st && st.last;
    let body = `<div class="rule"><span>Wallet</span><b class="mono">${esc(shortAddr(L.address))}</b></div>
      <div class="rule"><span>SOL</span><b>${L.sol != null ? L.sol.toFixed(2) : '—'}</b></div>
      <div class="rule"><span>Status</span><b>${L.bootstrapped ? 'Watching' : 'Starting'}</b></div>`;
    if (L.pnl_30d) body += `<div class="rule"><span>30d</span><b>${esc(L.pnl_30d)}</b></div>`;
    if (last) {
      body += `<div class="rule"><span>Last</span><b>${last.approve ? 'In' : 'Out'}</b></div>`;
      if (!last.approve) {
        let rej = [];
        try { rej = JSON.parse(last.rejects || '[]'); } catch (e) { rej = []; }
        body += `<div class="rule"><span>Why</span><b>${esc(friendlyReject(rej[0] || 'rule'))}</b></div>`;
      } else if (last.score != null) {
        body += `<div class="rule"><span>Score</span><b>${esc(last.score)}</b></div>`;
      }
    }
    return `<h3>${esc(L.name)}</h3><p class="sub">${esc(L.source || 'Public wallet')}</p><div class="card">${body}</div>
      <p class="t3">Tap outside to close · read-only</p>`;
  }

  function renderTraders(state, signals) {
    const rows = following(state);
    const q = qTraders.trim().toLowerCase();
    const filtered = rows.filter(L => {
      if (!q) return true;
      return (L.name || '').toLowerCase().includes(q) || (L.id || '').toLowerCase().includes(q) || (L.address || '').toLowerCase().includes(q);
    });
    const byLeader = {};
    (signals.rows || []).forEach(s => {
      const id = s.leader_id;
      if (!byLeader[id]) byLeader[id] = { ok: 0, skip: 0, last: s };
      if (s.approve) byLeader[id].ok++; else byLeader[id].skip++;
      if (!byLeader[id].last || (s.ts || '') > (byLeader[id].last.ts || '')) byLeader[id].last = s;
    });
    return `
      <div class="nav"><div class="title">Traders</div><span class="pill live on">${rows.length}</span></div>
      <input class="search" id="search-traders" placeholder="Search" value="${esc(qTraders)}">
      <div class="list">${filtered.length ? filtered.map(L => {
        const st = byLeader[L.id] || {};
        const last = st.last;
        let right = L.sol != null ? L.sol.toFixed(1) : '—';
        let sub = shortAddr(L.address);
        if (last) sub += last.approve ? ' · In' : ' · Out';
        return `<button class="row" type="button" data-trader="${esc(L.id)}">
          <i class="dot${L.bootstrapped ? '' : ' warn'}"></i>
          <div class="m"><b>${esc(L.name)}</b><span class="mono">${esc(sub)}</span></div>
          <div class="v">${esc(right)}</div>
          <span class="chev">›</span>
        </button>`;
      }).join('') : '<div class="empty-msg">None</div>'}</div>`;
  }

  function posSheet(p, openFlag) {
    const pnl = p.pnl_usd || 0;
    return `<h3>${esc(p.symbol || 'Coin')}</h3>
      <p class="sub">${esc(p.leader_id)} · ${openFlag ? 'Open' : 'Closed'}</p>
      <div class="card">
        <div class="rule"><span>Size</span><b>${money(openFlag ? p.mtm_usd : p.size_usd)}</b></div>
        <div class="rule"><span>PnL</span><b class="${pnl >= 0 ? 'up' : 'down'}">${pnl >= 0 ? '+' : ''}${money(pnl)}</b></div>
        <div class="rule"><span>Score</span><b>${p.entry_score != null ? p.entry_score : '—'}</b></div>
        <div class="rule"><span>${openFlag ? 'Trader sold' : 'Exit'}</span><b>${openFlag ? ((p.leader_sold_frac || 0) * 100).toFixed(0) + '%' : esc(String(p.exit_reason || '—').replace(/_/g, ' '))}</b></div>
      </div>`;
  }

  function renderPositions(positions) {
    const open = (positions.rows || []).filter(r => r.status === 'open');
    const closed = (positions.rows || []).filter(r => r.status !== 'open').slice(0, 20);
    function posRow(p, openFlag) {
      const pnl = p.pnl_usd || 0;
      const cls = pnl >= 0 ? 'up' : 'down';
      return `<button class="row" type="button" data-pos="${p.id}" data-open="${openFlag ? 1 : 0}">
        <div class="m"><b>${esc(p.symbol || (p.mint || '').slice(0, 8))}</b>
        <span>${esc(p.leader_id)}</span></div>
        <div class="v">${money(openFlag ? p.mtm_usd : p.size_usd)}
          <div class="${cls}" style="font-size:12px">${pnl >= 0 ? '+' : ''}${money(pnl)}</div></div>
        <span class="chev">›</span>
      </button>`;
    }
    return `
      <div class="nav"><div class="title">Positions</div></div>
      <div class="hlabel">Open</div>
      <div class="list">${open.length ? open.map(p => posRow(p, true)).join('') : '<div class="empty-msg">None</div>'}</div>
      <div class="hlabel">Out</div>
      <div class="list">${closed.length ? closed.map(p => posRow(p, false)).join('') : '<div class="empty-msg">None</div>'}</div>`;
  }

  function renderActivity(activity, signals) {
    const q = qActivity.trim().toLowerCase();
    let rows = (activity.rows || []).map(r => ({ ...r, _kind: 'act' }));
    const sigRows = (signals.rows || []).map(s => {
      let rejects = [];
      try { rejects = JSON.parse(s.rejects || '[]'); } catch (e) { rejects = []; }
      const title = s.approve ? `In · ${s.symbol || 'coin'}` : `Out · ${s.symbol || 'coin'}`;
      let reasons = [];
      try { reasons = JSON.parse(s.reasons || '[]'); } catch (e) { reasons = []; }
      if (!Array.isArray(reasons)) reasons = [];
      const subtitle = (s.leader_id || '') + ' · ' + (s.approve
        ? (reasons.slice(0, 2).map(friendlyReason).join(' · ') || 'Pass')
        : rejects.map(friendlyReject).join(' · ') || 'Skip');
      return { ts: s.ts, title, subtitle, value: s.score != null ? String(s.score) : '', leader_id: s.leader_id, mint: s.mint, kind: s.approve ? 'signal_ok' : 'signal_skip', _kind: 'sig', _raw: s };
    });
    rows = rows.concat(sigRows);
    rows.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
    if (actFilter === 'skipped') rows = rows.filter(r => /skip|reject|Out/i.test(r.kind || '') || /Out|Skipped/i.test(r.title || ''));
    if (actFilter === 'trades') rows = rows.filter(r => /buy|sell|trade|In/i.test(r.kind || '') || /buy|sell|In ·|Took/i.test(r.title || ''));
    if (q) rows = rows.filter(r => (r.title + ' ' + (r.subtitle || '') + ' ' + (r.leader_id || '') + ' ' + (r.mint || '')).toLowerCase().includes(q));
    rows = rows.slice(0, 40);
    return `
      <div class="nav"><div class="title">Activity</div></div>
      <input class="search" id="search-activity" placeholder="Search" value="${esc(qActivity)}">
      <div class="seg" id="act-seg">
        <button type="button" data-f="all" class="${actFilter === 'all' ? 'on' : ''}">All</button>
        <button type="button" data-f="trades" class="${actFilter === 'trades' ? 'on' : ''}">In</button>
        <button type="button" data-f="skipped" class="${actFilter === 'skipped' ? 'on' : ''}">Out</button>
      </div>
      <div class="list">${rows.length ? rows.map((r, i) => `
        <button class="row" type="button" data-act="${i}">
          <div class="m"><b>${esc(r.title)}</b><span>${esc(r.subtitle || r.kind || '')}</span></div>
          <div class="v">${esc(r.value || '')}</div>
          <span class="chev">›</span>
        </button>`).join('') : '<div class="empty-msg">None</div>'}</div>`;
  }

  function renderSettings(state) {
    const rules = state.rulesPlain || state.signalRules || {};
    const n = state.followingCount != null ? state.followingCount : following(state).length;
    return `
      <div class="nav"><div class="title">Settings</div><span class="pill paper">PAPER</span></div>
      <div class="note">Read-only. Change risk in Telegram.</div>
      <div class="hlabel">Risk</div>
      <div class="card">
        <div class="rule"><span>Start</span><b>${money(state.startBalance)}</b></div>
        <div class="rule"><span>Max / trade</span><b>${money(state.maxTradeUsd)}</b></div>
        <div class="rule"><span>Max in</span><b>${money(state.maxExposureUsd)}</b></div>
        <div class="rule"><span>Min</span><b>${money(state.minTradeUsd)}</b></div>
        <div class="rule"><span>Poll</span><b>${state.pollS || '—'}s</b></div>
        <div class="rule"><span>Following</span><b>${n}</b></div>
      </div>
      <div class="hlabel">In</div>
      <div class="card">
        <div class="rule"><span>Min liq</span><b>${money(rules.entryMinLiqUsd || (state.signalRules || {}).entryMinLiqUsd)}</b></div>
        <div class="rule"><span>Min age</span><b>${(rules.entryMinAgeMin || (state.signalRules || {}).entryMinAgeMin) || '—'}m</b></div>
        <div class="rule"><span>Score</span><b>${(rules.entryScoreMin || (state.signalRules || {}).entryScoreMin) || '—'}+</b></div>
        <div class="rule"><span>Max 1h</span><b>${(rules.entryMaxH1PumpPct || (state.signalRules || {}).entryMaxH1PumpPct) || '—'}%</b></div>
      </div>
      <div class="hlabel">Out</div>
      <div class="card">
        <div class="rule"><span>Stop</span><b>−${(rules.exitStopPct || (state.signalRules || {}).exitStopPct) || '—'}%</b></div>
        <div class="rule"><span>Trail</span><b>−${(rules.exitTrailPct || (state.signalRules || {}).exitTrailPct) || '—'}%</b></div>
        <div class="rule"><span>Hold</span><b>${(rules.exitMaxHoldH || (state.signalRules || {}).exitMaxHoldH) || '—'}h</b></div>
      </div>
      <p class="t3">${esc(state.mode || 'PAPER')} · ${esc(state.rpc || '—')}</p>`;
  }

  function bindHome() {
    const state = cache.state;
    const chart = chartFor();
    setBal(view.querySelector('#bal'), state.balance);
    const cv = view.querySelector('#line');
    if (cv) CopyCharts.line(cv, chart, performance.now());
    const vals = sparkVals(chart);
    const up = (state.todayPct || 0) >= 0;
    ['spk-f', 'spk-t', 'spk-w'].forEach(id => {
      const c = view.querySelector('#' + id);
      if (c && vals.length > 1) CopyCharts.spark(c, vals, up);
    });
    startPulse();
    startFlow();
  }

  function paint(opts) {
    const soft = opts && opts.soft;
    const { state, positions, activity, signals } = cache;
    if (!state) return;

    if (tab === 'home' && soft && homeBuilt && view.querySelector('#bal')) {
      // soft refresh: numbers + chart + latest row only
      const n = state.followingCount != null ? state.followingCount : following(state).length;
      const open = (positions.rows || []).filter(r => r.status === 'open');
      const watching = following(state).filter(L => L.bootstrapped).length;
      const sf = view.querySelector('#stat-f'); if (sf) sf.textContent = n;
      const st = view.querySelector('#stat-t'); if (st) st.textContent = state.trades || 0;
      const sw = view.querySelector('#stat-w'); if (sw) sw.textContent = open.length ? open.length : watching;
      const alive = view.querySelector('#alive');
      if (alive) {
        alive.textContent = state.alive ? 'LIVE' : 'STALE';
        alive.classList.toggle('on', !!state.alive);
        alive.classList.toggle('off', !state.alive);
      }
      const latest = (activity.rows || [])[0];
      const slot = view.querySelector('#home-act');
      if (slot && latest) {
        const key = latest.id + '|' + latest.title + '|' + (latest.value || '');
        if (slot.dataset.key !== key) {
          slot.dataset.key = key;
          slot.innerHTML = `<button class="row" type="button" data-sheet="activity">
            <div class="m"><b>${esc(latest.title)}</b><span>${esc(latest.subtitle || latest.kind || '')}</span></div>
            <div class="v">${esc(latest.value || '')}</div><span class="chev">›</span></button>`;
        }
      }
      bindHome();
      return;
    }

    if (tab === 'home') view.innerHTML = renderHome(state, positions || { rows: [] }, activity || { rows: [] });
    else if (tab === 'traders') view.innerHTML = renderTraders(state, signals || { rows: [] });
    else if (tab === 'positions') view.innerHTML = renderPositions(positions || { rows: [] });
    else if (tab === 'activity') view.innerHTML = renderActivity(activity || { rows: [] }, signals || { rows: [] });
    else view.innerHTML = renderSettings(state);
    homeBuilt = tab === 'home';

    const stEl = view.querySelector('#search-traders');
    if (stEl) stEl.addEventListener('input', e => { qTraders = e.target.value; paint(); });
    const sa = view.querySelector('#search-activity');
    if (sa) sa.addEventListener('input', e => { qActivity = e.target.value; paint(); });
    const seg = view.querySelector('#act-seg');
    if (seg) seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { actFilter = b.getAttribute('data-f'); paint(); }));
    const ranges = view.querySelector('#ranges');
    if (ranges) ranges.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      range = b.getAttribute('data-range');
      homeBuilt = false;
      paint();
    }));

    if (tab === 'home') bindHome();
    else {
      cancelAnimationFrame(pulseRaf);
      cancelAnimationFrame(flowRaf);
    }
  }

  view.addEventListener('click', e => {
    const trader = e.target.closest('[data-trader]');
    if (trader) {
      const id = trader.getAttribute('data-trader');
      const L = following(cache.state).find(x => x.id === id);
      if (!L) return;
      const byLeader = {};
      (cache.signals.rows || []).forEach(s => {
        if (!byLeader[s.leader_id] || (s.ts || '') > (byLeader[s.leader_id].last.ts || '')) byLeader[s.leader_id] = { last: s };
      });
      openSheet(traderSheet(L, byLeader[id]));
      return;
    }
    const pos = e.target.closest('[data-pos]');
    if (pos) {
      const id = Number(pos.getAttribute('data-pos'));
      const openFlag = pos.getAttribute('data-open') === '1';
      const p = (cache.positions.rows || []).find(r => r.id === id);
      if (p) openSheet(posSheet(p, openFlag));
      return;
    }
    const sheetBtn = e.target.closest('[data-sheet]');
    if (sheetBtn) {
      const kind = sheetBtn.getAttribute('data-sheet');
      const state = cache.state;
      if (kind === 'following') {
        openSheet(`<h3>Following</h3><p class="sub">${state.followingCount} traders</p>
          <div class="card"><div class="rule"><span>Enabled</span><b>${state.enabledLeaders}</b></div>
          <div class="rule"><span>Blind copy</span><b>Off</b></div>
          <div class="rule"><span>Signals</span><b>On</b></div></div>`);
      } else if (kind === 'trades') {
        openSheet(`<h3>Trades</h3><p class="sub">Paper fills</p>
          <div class="card"><div class="rule"><span>Count</span><b>${state.trades || 0}</b></div>
          <div class="rule"><span>Open</span><b>${state.openPositions || 0}</b></div>
          <div class="rule"><span>Max / trade</span><b>${money(state.maxTradeUsd)}</b></div></div>`);
      } else if (kind === 'book') {
        openSheet(`<h3>Book</h3><p class="sub">Cash vs in trades</p>
          <div class="card"><div class="rule"><span>Cash</span><b>${money(state.cash)}</b></div>
          <div class="rule"><span>In</span><b>${money(state.exposure)}</b></div>
          <div class="rule"><span>Balance</span><b>${money(state.balance)}</b></div></div>`);
      } else if (kind === 'activity') {
        tab = 'activity';
        tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.getAttribute('data-tab') === 'activity'));
        homeBuilt = false;
        paint();
      }
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act && tab === 'activity') {
      // rebuild row list same as render to open detail
      openSheet(`<h3>Detail</h3><p class="sub">Signal / activity</p>
        <div class="card"><div class="rule"><span>Title</span><b>${esc(act.querySelector('b').textContent)}</b></div>
        <div class="rule"><span>Info</span><b>${esc(act.querySelector('span').textContent)}</b></div>
        <div class="rule"><span>Value</span><b>${esc(act.querySelector('.v').textContent)}</b></div></div>
        <p class="t3">read-only</p>`);
    }
  });

  async function tick() {
    try {
      const [state, positions, activity, signals, charts] = await Promise.all([
        j('state.json'), j('positions.json'), j('activity.json'),
        j('signals.json').catch(() => ({ rows: [] })),
        j('chart.json').catch(() => ({})),
      ]);
      errEl.hidden = true;
      cache = { state, positions, activity, signals, charts };
      paint({ soft: tab === 'home' && homeBuilt });
    } catch (e) {
      errEl.hidden = false;
      errEl.textContent = 'Offline';
    }
  }

  tabs.addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.getAttribute('data-tab');
    tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    homeBuilt = false;
    closeSheet();
    paint();
  });

  window.addEventListener('resize', () => {
    if (tab === 'home' && cache.charts) {
      const cv = view.querySelector('#line');
      if (cv) CopyCharts.line(cv, chartFor(), performance.now());
    }
  });

  tick();
  setInterval(tick, 5000);
})();
