(function () {
  const base = window.COPYDESK_BASE || './';
  const errEl = document.getElementById('err');
  const view = document.getElementById('view');
  const tabs = document.getElementById('tabs');
  let tab = 'home';
  let qTraders = '';
  let qActivity = '';
  let actFilter = 'all';
  let cache = { state: null, positions: null, activity: null, signals: null };

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
      freeze_authority_set: 'Token can still be frozen',
      mint_authority_set: 'Mint authority still on',
      liq_low: 'Liquidity too low',
      too_new: 'Coin too new',
      chase: 'Looks like a chase',
      pump_h1: 'Pumped too hard in last hour',
      score_low: 'Score below your bar',
      age_sweet: 'Outside preferred age window',
    };
    if (!raw) return 'Skipped';
    return map[raw] || String(raw).replace(/_/g, ' ');
  }
  function friendlyReason(r) {
    if (!r) return '';
    if (r.startsWith('PASS')) return 'Passed checks';
    if (r.startsWith('liq_strong')) return 'Solid liquidity';
    if (r.startsWith('liq_ok')) return 'OK liquidity';
    if (r.startsWith('age_')) return 'Age check: ' + r.split(':').slice(1).join(':');
    if (r.startsWith('flow_')) return 'Buy flow: ' + r.split(':').slice(1).join(':');
    if (r.startsWith('h1_')) return '1h move: ' + r.split(':').slice(1).join(':');
    if (r === 'mint_renounced') return 'Mint renounced';
    if (r === 'freeze_off') return 'Freeze off';
    if (r === 'mint_risk') return 'Mint risk flagged';
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

  function renderHome(state, positions, activity) {
    const n = state.followingCount != null ? state.followingCount : following(state).length;
    const open = (positions.rows || []).filter(r => r.status === 'open');
    const pct = state.todayPct || 0;
    const recent = (activity.rows || []).slice(0, 6);
    return `
      <div class="nav"><div class="title">Copy Desk</div>
        <span class="pill paper">PAPER</span>
        <span class="pill cyan${state.alive ? '' : ' off'}" id="alive">${state.alive ? 'LIVE' : 'STALE'}</span>
      </div>
      <section class="balwrap">
        <div class="label">Your paper money</div>
        <div class="bal">${money(state.balance)}</div>
        <div class="sub">Available ${money(state.cash)} · In trades ${money(state.exposure)}</div>
        <div class="today ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% vs starting ${money(state.startBalance)}</div>
      </section>
      <div class="stats">
        <div><span>Following</span><b>${n} traders</b></div>
        <div><span>Open positions</span><b>${open.length}</b></div>
        <div><span>Paper trades</span><b>${state.trades || 0}</b></div>
        <div><span>Max per trade</span><b>${money(state.maxTradeUsd)}</b></div>
      </div>
      <h2>How it works</h2>
      <div class="card">
        <h3>Signals, not blind copy</h3>
        <p>When a followed trader buys, Copy Desk scores the coin first. Bad liquidity, freeze risk, or a chase get skipped. Exits use your own stop, trail, and time limits — they don’t wait for the trader to sell.</p>
      </div>
      <h2>Latest</h2>
      <div class="list">${recent.length ? recent.map(r => `
        <div class="row"><div class="m"><b>${esc(r.title)}</b><span>${esc(r.subtitle || r.kind || '')}</span></div>
        <div class="v">${esc(r.value || '')}</div></div>`).join('') : '<div class="empty-msg">Quiet so far — watching followed traders</div>'}
      </div>
      <p class="t3" style="margin:14px 0 0">PAPER only · no wallet keys · updates every few seconds</p>`;
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
      <div class="nav"><div class="title">Copied traders</div><span class="pill greenpill">${rows.length}</span></div>
      <input class="search" id="search-traders" placeholder="Search trader or wallet" value="${esc(qTraders)}">
      <div class="list">${filtered.length ? filtered.map(L => {
        const st = byLeader[L.id] || {};
        const last = st.last;
        let right = L.sol != null ? L.sol.toFixed(2) + ' SOL' : 'Watching';
        let sub = shortAddr(L.address) + (L.bootstrapped ? ' · Watching' : ' · Starting up');
        if (last) {
          if (last.approve) sub += ' · last signal OK';
          else {
            let rej = [];
            try { rej = JSON.parse(last.rejects || '[]'); } catch (e) { rej = []; }
            sub += ' · skipped: ' + friendlyReject(rej[0] || 'rule');
          }
        }
        const pnl = L.pnl_30d ? ` · 30d ${esc(L.pnl_30d)}` : '';
        return `<div class="row"><i class="dot${L.bootstrapped ? '' : ' warn'}"></i>
          <div class="m"><b>${esc(L.name)}${pnl}</b><span class="mono">${esc(sub)}</span></div>
          <div class="v">${esc(right)}</div></div>`;
      }).join('') : '<div class="empty-msg">No traders match</div>'}</div>
      <p class="t3" style="margin-top:12px">Disabled placeholders (like Topshotfund) stay hidden until a wallet is confirmed.</p>`;
  }

  function renderPositions(positions) {
    const open = (positions.rows || []).filter(r => r.status === 'open');
    const closed = (positions.rows || []).filter(r => r.status !== 'open').slice(0, 20);
    function posRow(p, openFlag) {
      const pnl = p.pnl_usd || 0;
      const cls = pnl >= 0 ? 'up' : 'down';
      const why = openFlag
        ? (p.entry_score != null ? `Score ${p.entry_score}` : 'Open') + (p.leader_sold_frac ? ` · trader sold ${(p.leader_sold_frac * 100).toFixed(0)}%` : '')
        : (p.exit_reason ? ('Exit: ' + String(p.exit_reason).replace(/_/g, ' ')) : 'Closed');
      return `<div class="row"><div class="m"><b>${esc(p.symbol || (p.mint || '').slice(0, 8))}</b>
        <span>${esc(p.leader_id)} · ${esc(why)}</span></div>
        <div class="v">${money(openFlag ? p.mtm_usd : p.size_usd)}
          <div class="${cls}" style="font-size:12px">${pnl >= 0 ? '+' : ''}${money(pnl)}</div></div></div>`;
    }
    return `
      <div class="nav"><div class="title">My positions</div></div>
      <h2>Open</h2>
      <div class="list">${open.length ? open.map(p => posRow(p, true)).join('') : '<div class="empty-msg">None open — waiting for a signal that passes</div>'}</div>
      <h2>Recently closed</h2>
      <div class="list">${closed.length ? closed.map(p => posRow(p, false)).join('') : '<div class="empty-msg">No closed paper trades yet</div>'}</div>`;
  }

  function renderActivity(activity, signals) {
    const q = qActivity.trim().toLowerCase();
    let rows = (activity.rows || []).map(r => ({ ...r, _kind: 'act' }));
    const sigRows = (signals.rows || []).map(s => {
      let rejects = [];
      try { rejects = JSON.parse(s.rejects || '[]'); } catch (e) { rejects = []; }
      const title = s.approve ? `Took signal · ${s.symbol || 'coin'}` : `Skipped · ${s.symbol || 'coin'}`;
      let reasons = [];
      try { reasons = JSON.parse(s.reasons || '[]'); } catch (e) { reasons = []; }
      if (!Array.isArray(reasons)) reasons = [];
      const subtitle = (s.leader_id || '') + ' · ' + (s.approve
        ? (reasons.slice(0, 2).map(friendlyReason).join(' · ') || 'Passed')
        : rejects.map(friendlyReject).join(' · ') || 'Did not pass');
      return { ts: s.ts, title, subtitle, value: s.score != null ? ('score ' + s.score) : '', leader_id: s.leader_id, mint: s.mint, kind: s.approve ? 'signal_ok' : 'signal_skip', _kind: 'sig' };
    });
    // merge unique-ish
    rows = rows.concat(sigRows);
    rows.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
    if (actFilter === 'skipped') rows = rows.filter(r => /skip|reject|skipped/i.test(r.kind || '') || /Skipped/i.test(r.title || ''));
    if (actFilter === 'trades') rows = rows.filter(r => /buy|sell|trade/i.test(r.kind || '') || /buy|sell|Took/i.test(r.title || ''));
    if (q) rows = rows.filter(r => (r.title + ' ' + (r.subtitle || '') + ' ' + (r.leader_id || '') + ' ' + (r.mint || '')).toLowerCase().includes(q));
    rows = rows.slice(0, 40);
    return `
      <div class="nav"><div class="title">Activity</div></div>
      <input class="search" id="search-activity" placeholder="Filter by trader or coin" value="${esc(qActivity)}">
      <div class="seg" id="act-seg">
        <button type="button" data-f="all" class="${actFilter === 'all' ? 'on' : ''}">All</button>
        <button type="button" data-f="trades" class="${actFilter === 'trades' ? 'on' : ''}">Trades</button>
        <button type="button" data-f="skipped" class="${actFilter === 'skipped' ? 'on' : ''}">Skipped</button>
      </div>
      <div class="list">${rows.length ? rows.map(r => `
        <div class="row"><div class="m"><b>${esc(r.title)}</b><span>${esc(r.subtitle || r.kind || '')}</span></div>
        <div class="v">${esc(r.value || '')}</div></div>`).join('') : '<div class="empty-msg">Nothing matches</div>'}</div>`;
  }

  function renderSettings(state) {
    const rules = state.rulesPlain || state.signalRules || {};
    const n = state.followingCount != null ? state.followingCount : following(state).length;
    return `
      <div class="nav"><div class="title">Settings</div><span class="pill paper">PAPER</span></div>
      <div class="note">This phone screen is read-only. Changing risk, traders, or size needs a message in Telegram to your bot — the public page cannot move money or rewrite the desk.</div>
      <h2>Paper risk</h2>
      <div class="card">
        <div class="rule"><span>Starting paper money</span><b>${money(state.startBalance)}</b></div>
        <div class="rule"><span>Max per trade</span><b>${money(state.maxTradeUsd)} (8%)</b></div>
        <div class="rule"><span>Max total in trades</span><b>${money(state.maxExposureUsd)}</b></div>
        <div class="rule"><span>Min trade</span><b>${money(state.minTradeUsd)}</b></div>
        <div class="rule"><span>Check every</span><b>${state.pollS || '—'}s</b></div>
        <div class="rule"><span>Following</span><b>${n} traders</b></div>
      </div>
      <h2>When it gets in</h2>
      <div class="card">
        <div class="rule"><span>Min liquidity</span><b>${money(rules.entryMinLiqUsd || (state.signalRules || {}).entryMinLiqUsd)}</b></div>
        <div class="rule"><span>Min coin age</span><b>${(rules.entryMinAgeMin || (state.signalRules || {}).entryMinAgeMin) || '—'} min</b></div>
        <div class="rule"><span>Score needed</span><b>${(rules.entryScoreMin || (state.signalRules || {}).entryScoreMin) || '—'}+</b></div>
        <div class="rule"><span>Max 1h pump</span><b>${(rules.entryMaxH1PumpPct || (state.signalRules || {}).entryMaxH1PumpPct) || '—'}%</b></div>
      </div>
      <h2>When it gets out</h2>
      <div class="card">
        <div class="rule"><span>Stop loss</span><b>−${(rules.exitStopPct || (state.signalRules || {}).exitStopPct) || '—'}%</b></div>
        <div class="rule"><span>Trail from peak</span><b>−${(rules.exitTrailPct || (state.signalRules || {}).exitTrailPct) || '—'}%</b></div>
        <div class="rule"><span>Max hold</span><b>${(rules.exitMaxHoldH || (state.signalRules || {}).exitMaxHoldH) || '—'}h</b></div>
      </div>
      <p class="t3">Mode ${esc(state.mode || 'PAPER')} · RPC ${esc(state.rpc || '—')} · no private key on this desk</p>`;
  }

  function paint() {
    const { state, positions, activity, signals } = cache;
    if (!state) return;
    if (tab === 'home') view.innerHTML = renderHome(state, positions || { rows: [] }, activity || { rows: [] });
    else if (tab === 'traders') view.innerHTML = renderTraders(state, signals || { rows: [] });
    else if (tab === 'positions') view.innerHTML = renderPositions(positions || { rows: [] });
    else if (tab === 'activity') view.innerHTML = renderActivity(activity || { rows: [] }, signals || { rows: [] });
    else view.innerHTML = renderSettings(state);

    const st = view.querySelector('#search-traders');
    if (st) st.addEventListener('input', e => { qTraders = e.target.value; paint(); });
    const sa = view.querySelector('#search-activity');
    if (sa) sa.addEventListener('input', e => { qActivity = e.target.value; paint(); });
    const seg = view.querySelector('#act-seg');
    if (seg) seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { actFilter = b.getAttribute('data-f'); paint(); }));
  }

  async function tick() {
    try {
      const [state, positions, activity, signals] = await Promise.all([
        j('state.json'), j('positions.json'), j('activity.json'),
        j('signals.json').catch(() => ({ rows: [] })),
      ]);
      errEl.hidden = true;
      cache = { state, positions, activity, signals };
      paint();
    } catch (e) {
      errEl.hidden = false;
      errEl.textContent = 'Copy Desk offline or data unreachable';
    }
  }

  tabs.addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.getAttribute('data-tab');
    tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    paint();
  });

  tick();
  setInterval(tick, 5000);
})();
