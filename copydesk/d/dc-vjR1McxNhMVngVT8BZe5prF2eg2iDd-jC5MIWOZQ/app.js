(function(){
  const base = window.COPYDESK_BASE || './';
  const errEl = document.getElementById('err');
  function money(n){ if(n==null||isNaN(n)) return '—'; return (n<0?'-':'')+'$'+Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:2,minimumFractionDigits:2}); }
  function shortAddr(a){ return a ? a.slice(0,4)+'…'+a.slice(-4) : '—'; }
  async function j(path){
    // Prefer local API when served from uvicorn; else Plan B JSON beside page
    const tries = ['/api/'+path.replace(/\.json$/,''), base+path, './'+path];
    let last;
    for (const u of tries){
      try{
        const r = await fetch(u, {cache:'no-store'});
        if(r.ok) return await r.json();
        last = r.status;
      }catch(e){ last = e; }
    }
    throw new Error('fetch failed '+last);
  }
  function renderLeaders(state){
    const el = document.getElementById('leaders');
    const rows = (state.leaders||[]).map(L=>{
      const on = L.enabled;
      const dot = on ? (L.bootstrapped ? 'dot' : 'dot warn') : 'dot off';
      const right = on ? (L.sol!=null ? L.sol.toFixed(3)+' SOL' : '…') : 'disabled';
      const sub = on
        ? shortAddr(L.address)+(L.sol_usd!=null ? ' · ~$'+Math.round(L.sol_usd).toLocaleString()+' SOL≈book' : '')
        : (L.note||'address unresolved');
      const pnl = L.pnl_30d ? ` <a href="${L.source}" target="_blank" rel="noopener" class="up" style="font-size:12px">30d ${L.pnl_30d}</a>` : '';
      return `<div class="row"><i class="${dot}"></i><div class="m"><b>${L.name}</b>${pnl}<span class="mono">${sub}</span></div><div class="v">${right}</div></div>`;
    }).join('');
    const n = (state.leaders||[]).filter(L=>L.enabled).length;
    const h = document.getElementById('leaders-h'); if(h) h.textContent = 'Leaders · '+n+' enabled';
    el.innerHTML = rows || '<div class="empty-msg">No leaders</div>';
  }
  function renderPositions(data){
    const el = document.getElementById('positions');
    const open = (data.rows||[]).filter(r=>r.status==='open');
    if(!open.length){ el.innerHTML = '<div class="empty-msg">None yet — waiting for leader swaps</div>'; return; }
    el.innerHTML = open.map(p=>{
      const pnl = p.pnl_usd||0;
      const cls = pnl>=0?'up':'down';
      return `<div class="row"><div class="m"><b>${p.symbol||p.mint.slice(0,8)}</b><span>${p.leader_id} · entry ${Number(p.entry_price).toPrecision(4)}</span></div><div class="v">${money(p.mtm_usd)}<div class="${cls}" style="font-size:12px">${pnl>=0?'+':''}${money(pnl)}</div></div></div>`;
    }).join('');
  }
  function renderActivity(data){
    const el = document.getElementById('activity');
    const rows = data.rows||[];
    if(!rows.length){ el.innerHTML = '<div class="empty-msg">No activity</div>'; return; }
    el.innerHTML = rows.slice(0,30).map(r=>{
      return `<div class="row"><div class="m"><b>${r.title}</b><span>${r.subtitle||r.kind||''}</span></div><div class="v">${r.value||''}</div></div>`;
    }).join('');
  }
  async function tick(){
    try{
      const [state, positions, activity] = await Promise.all([
        j('state.json'), j('positions.json'), j('activity.json')
      ]);
      errEl.hidden = true;
      document.getElementById('bal').textContent = money(state.balance);
      document.getElementById('sub').textContent = `cash ${money(state.cash)} · exposure ${money(state.exposure)}`;
      const pct = state.todayPct||0;
      const t = document.getElementById('today');
      t.textContent = (pct>=0?'+':'')+pct.toFixed(2)+'% vs $'+state.startBalance;
      t.className = 'today '+(pct>=0?'up':'down');
      const alive = document.getElementById('alive');
      alive.textContent = state.alive ? 'LIVE' : 'STALE';
      alive.className = 'pill cyan'+(state.alive?'':' off');
      renderLeaders(state);
      renderPositions(positions);
      renderActivity(activity);
      document.getElementById('meta').textContent =
        `poll ${state.pollS}s · rpc ${state.rpc} · trades ${state.trades} · updated ${state.updated||''}`;
    }catch(e){
      errEl.hidden = false;
      errEl.textContent = 'COPY DESK offline or JSON unreachable';
    }
  }
  tick();
  setInterval(tick, 5000);
})();
