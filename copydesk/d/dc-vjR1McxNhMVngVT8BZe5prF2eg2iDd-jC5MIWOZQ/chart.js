/* Copy Desk charts — real balance points only. */
(function () {
  const C = {
    green: '#00d35a', red: '#ff453a', blue: '#0a84ff', orange: '#ff9f0a',
    t2: 'rgba(235,235,245,0.6)', t3: 'rgba(235,235,245,0.3)'
  };
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function prep(cv) {
    const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * d));
    cv.height = Math.max(1, Math.round(r.height * d));
    const x = cv.getContext('2d');
    x.setTransform(d, 0, 0, d, 0, 0);
    x.clearRect(0, 0, r.width, r.height);
    return [x, r.width, r.height];
  }

  function line(cv, data, pulseT) {
    const pts = (data && data.points) || [];
    const [x, W, H] = prep(cv);
    const top = 18, bot = H - 10;
    if (pts.length < 2) {
      x.setLineDash([4, 5]); x.strokeStyle = C.t3; x.lineWidth = 1;
      x.beginPath(); x.moveTo(0, H / 2); x.lineTo(W, H / 2); x.stroke();
      return;
    }
    const start = data.start;
    let vs = pts.map(p => p.v).concat(start != null ? [start] : []);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const t0 = pts[0].t, t1 = Math.max(pts[pts.length - 1].t, t0 + 1);
    const X = t => (t - t0) / (t1 - t0) * W;
    const Y = v => bot - (v - lo) / (hi - lo) * (bot - top);
    const up = pts[pts.length - 1].v >= (start != null ? start : pts[0].v);
    const col = up ? C.green : C.red;

    if (start != null) {
      x.setLineDash([4, 5]); x.strokeStyle = C.t3; x.lineWidth = 1;
      x.beginPath(); x.moveTo(0, Y(start)); x.lineTo(W, Y(start)); x.stroke(); x.setLineDash([]);
    }

    x.beginPath();
    pts.forEach((p, i) => i ? x.lineTo(X(p.t), Y(p.v)) : x.moveTo(X(p.t), Y(p.v)));
    x.strokeStyle = col; x.lineWidth = 2.2; x.lineJoin = 'round'; x.lineCap = 'round'; x.stroke();

    (data.marks || []).forEach(m => {
      if (m.t < t0 || m.t > t1) return;
      const mx = X(m.t);
      const near = pts.reduce((a, p) => Math.abs(p.t - m.t) < Math.abs(a.t - m.t) ? p : a, pts[0]);
      const my = Y(near.v);
      const mc = m.kind === 'bought' ? C.blue : (m.kind === 'gain' ? C.green : C.red);
      x.beginPath(); x.arc(mx, my, 3.2, 0, 7); x.fillStyle = mc; x.fill();
    });

    const last = pts[pts.length - 1];
    const lx = X(last.t), ly = Y(last.v);
    if (!reduce()) {
      const ph = 0.5 + 0.5 * Math.sin((pulseT || 0) / 420);
      x.beginPath(); x.arc(lx, ly, 4 + ph * 5, 0, 7);
      x.fillStyle = col.replace(')', ', ' + (0.18 + ph * 0.18) + ')').replace('rgb', 'rgba').replace('#00d35a', 'rgba(0,211,90,' + (0.18 + ph * 0.18) + ')').replace('#ff453a', 'rgba(255,69,58,' + (0.18 + ph * 0.18) + ')');
      // simpler pulse
      x.beginPath(); x.arc(lx, ly, 8 + ph * 6, 0, 7);
      x.fillStyle = up ? 'rgba(0,211,90,' + (0.12 + ph * 0.1) + ')' : 'rgba(255,69,58,' + (0.12 + ph * 0.1) + ')';
      x.fill();
    }
    x.beginPath(); x.arc(lx, ly, 3.5, 0, 7); x.fillStyle = col; x.fill();
    x.beginPath(); x.arc(lx, ly, 3.5, 0, 7); x.strokeStyle = '#000'; x.lineWidth = 1; x.stroke();
  }

  function spark(cv, values, up) {
    const [x, W, H] = prep(cv);
    if (!values || values.length < 2) return;
    let lo = Math.min(...values), hi = Math.max(...values);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const Y = v => H - 2 - (v - lo) / (hi - lo) * (H - 4);
    const X = i => i / (values.length - 1) * W;
    x.beginPath();
    values.forEach((v, i) => i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)));
    x.strokeStyle = up ? C.green : C.red; x.lineWidth = 1.5; x.stroke();
  }

  window.CopyCharts = { line, spark, reduce };
})();
