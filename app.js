/* ==========================================================================
   app.js — หน้าจอระบบสรุปรายงานประจำเดือน หมวดทางหลวงเชิงเนิน
   ข้อมูล: reports (รายงานรายเดือน) / records (ผลงานจาก CSV) / photos + photoData (รูปชั่วคราว) / plans (แผนงบรายปี)
   ========================================================================== */
(function () {
  'use strict';

  const S = { reports: [], records: [], photos: [], plans: [], config: [], mk:'', tab: 'import', pending: null, probDraft: null, exporting: false };
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function debounce(fn, ms) { let t; const d = function () { const a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; d.flush = function () { clearTimeout(t); }; return d; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ข้าม */ } }

  /* ---------------- แจ้งเตือน / หน้าต่าง ---------------- */
  function toast(msg, kind, ms) {
    const d = document.createElement('div');
    d.className = 'toast ' + (kind || '');
    d.textContent = msg;
    $('#toast').appendChild(d);
    setTimeout(function () { d.remove(); }, ms || (kind === 'err' ? 6000 : 3000));
    return d;
  }
  function modal(o) {
    return new Promise(function (resolve) {
      const bg = document.createElement('div');
      bg.className = 'modal-bg';
      bg.innerHTML = '<div class="modal ' + (o.wide ? 'wide' : '') + '"><div class="modal-h"><h3>' + esc(o.title) + '</h3><button class="btn btn-icon" data-x>✕</button></div>' +
        '<div class="modal-b">' + (o.html || '') + '</div><div class="modal-f">' +
        (o.cancel === false ? '' : '<button class="btn" data-x>' + esc(o.cancel || 'ยกเลิก') + '</button>') +
        (o.alt ? '<button class="btn" data-alt>' + esc(o.alt) + '</button>' : '') +
        (o.ok === false ? '' : '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-ok>' + esc(o.ok || 'ตกลง') + '</button>') + '</div></div>';
      document.body.appendChild(bg);
      const close = function (v) { bg.remove(); resolve(v); };
      $$('[data-x]', bg).forEach(function (b) { b.onclick = function () { close(false); }; });
      if ($('[data-alt]', bg)) $('[data-alt]', bg).onclick = function () { close('alt'); };
      if ($('[data-ok]', bg)) $('[data-ok]', bg).onclick = function () { close(o.read ? o.read(bg) : true); };
      if (o.onOpen) o.onOpen(bg, close);
    });
  }
  const confirmBox = function (title, html, ok, danger) { return modal({ title: title, html: html, ok: ok || 'ยืนยัน', danger: danger }); };
  function run(fn, okMsg) {
    return Promise.resolve().then(fn).then(function (r) { if (okMsg) toast(okMsg, 'ok'); return r; })
      .catch(function (e) { console.error(e); toast(e.message || String(e), 'err'); });
  }

  /* ---------------- ข้อมูลที่ใช้บ่อย ---------------- */
  function rep() { return S.reports.find(function (r) { return r.__id === S.mk; }) || {}; }
  function monthRecords() { return S.records.filter(function (r) { return r.mk === S.mk; }); }
  function photosOf(slot) {
    return S.photos.filter(function (p) { return p.mk === S.mk && p.slot === slot; })
      .sort(function (a, b) { return (a.order - b.order) || String(a.takenAt).localeCompare(String(b.takenAt)); });
  }
  // หน่วยนับที่ใช้ได้ของรหัสงาน จากฐานข้อมูลกลาง CN-Hub (1 รหัสงานอาจมีหลายหน่วย) — อ่านไม่ได้/ไม่มีรหัสนี้ คืน []
  function unitChoices(code) {
    try { if (window.CNMaster && CNMaster.unitsOf) return CNMaster.unitsOf(code); } catch (e) { /* ใช้ค่าสำรอง */ }
    return [];
  }
  // หน่วยที่เลือกไว้ในรายงานเดือนนี้ (ต้องเป็นหน่วยในฐานข้อมูลกลาง) ไม่ได้เลือก = หน่วยหลักของรหัสงาน
  function unitOf(code) {
    const picked = (rep().units || {})[code], ch = unitChoices(code);
    if (picked && (!ch.length || ch.indexOf(picked) >= 0)) return picked;
    return ch[0] || RE.DEFAULT_UNITS[code] || 'หน่วย';
  }
  // การตั้งค่าที่ใช้ทุกเดือน (config/settings) เช่น ตรากรมทางหลวงบนหน้าปก
  function settings() { return S.config.find(function (c) { return c.__id === 'settings'; }) || {}; }
  function planOf(fy) { return S.plans.find(function (p) { return p.__id === String(fy); }) || null; }
  function validChoice(c, n) { return n > 0 && c != null && c !== '' && Number(c) < RE.templates(n).length ? Number(c) : null; }
  function photoSpec(p) { return { id: p.id || p.__id, w: p.w, h: p.h, fx: p.fx, fy: p.fy }; }
  function problems() { return S.probDraft || rep().problems || []; }
  // รายการสไลด์รายรหัสงาน — กลุ่มงาน (21100 – 21600) ที่ติ๊ก "รวมเป็นสไลด์เดียว" ไว้ในรายงานเดือนนี้ (rep().merge)
  // และมีรหัสย่อย ≥ 2 รหัส จะรวมเป็น 1 สไลด์ (รหัส = รหัสกลุ่ม, ช่องรูป = work:<รหัสกลุ่ม>) ไม่รวมงานที่ไม่ทำสไลด์
  function slideAggs(aggs) {
    const mg = rep().merge || {};
    const shown = aggs.filter(function (a) { return RE.HIDDEN_WORK_CODES.indexOf(a.code) < 0; });
    const done = {}, out = [];
    shown.forEach(function (a) {
      const subs = shown.filter(function (x) { return x.group === a.group; });
      if (!mg[a.group] || subs.length < 2) { out.push(a); return; }
      if (done[a.group]) return;
      done[a.group] = true;
      out.push(RE.mergeAggs(a.group, subs, unitOf));
    });
    return out;
  }
  async function saveReport(patch) {
    await FBL.set('reports', S.mk, Object.assign({}, patch, { updatedAt: FBL.nowIso(), updatedBy: FBL.user.name }), true);
  }

  /* ======================================================================
     ตัวแสดงตัวอย่างสไลด์ (HTML) — ใช้แบบร่างเดียวกับไฟล์ PowerPoint
     ====================================================================== */
  const W = RE.SLIDE_W, H = RE.SLIDE_H;
  function pos(e) { return 'left:' + (e.x / W * 100) + '%;top:' + (e.y / H * 100) + '%;width:' + (e.w / W * 100) + '%;height:' + (e.h / H * 100) + '%;'; }
  function fs(pt) { return (pt / 72 / W * 100).toFixed(3) + 'cqw'; }
  function textHtml(e) {
    const inner = e.runs
      ? e.runs.map(function (r) { return '<span style="color:#' + (r.color || e.color || '1A1A1A') + ';' + (r.bold ? 'font-weight:600;' : '') + (r.size ? 'font-size:' + fs(r.size) + ';' : '') + '">' + esc(r.text) + '</span>'; }).join('')
      : esc(e.text);
    const jc = e.align === 'center' ? 'center' : (e.align === 'right' ? 'flex-end' : 'flex-start');
    const ai = e.valign === 'middle' ? 'center' : (e.valign === 'bottom' ? 'flex-end' : 'flex-start');
    const st = 'justify-content:' + jc + ';align-items:' + ai + ';font-size:' + fs(e.size || 16) + ';color:#' + (e.color || '1A1A1A') + ';' +
      (e.bold ? 'font-weight:600;' : '') + (e.italic ? 'font-style:italic;' : '') + (e.lineSpacing ? 'line-height:' + (1.2 * e.lineSpacing) + ';' : '') +
      (e.lineSpacingPt ? 'line-height:' + fs(e.lineSpacingPt) + ';' : '') + (e.charSpacing ? 'letter-spacing:' + fs(e.charSpacing) + ';' : '') +
      (e.glow ? 'text-shadow:0 0 .5cqw #fff,0 0 1cqw #fff,0 0 1.6cqw #fff;' : '') + (e.wrap === false ? 'white-space:pre;' : '');
    return '<div class="el-text" style="' + pos(e) + st + '"><div style="text-align:' + (e.align || 'left') + ';width:100%">' + inner + '</div></div>';
  }
  function photoBg(url, pw, ph, e) {
    const c = RE.cropRect(pw, ph, e.w / e.h, e.fx, e.fy);
    const bx = c.sw >= 0.9999 ? 0 : c.sx / (1 - c.sw) * 100, by = c.sh >= 0.9999 ? 0 : c.sy / (1 - c.sh) * 100;
    return 'background-image:url(' + url + ');background-size:' + (100 / c.sw) + '% ' + (100 / c.sh) + '%;background-position:' + bx + '% ' + by + '%;';
  }
  function chartSvg(e) {
    if (e.kind === 'pie') {
      // หน่วยใน SVG = pt (1/72 นิ้ว) ของกรอบกราฟ — วงกลมอยู่ในพื้นที่ e.plot แบบเดียวกับใน PowerPoint
      const VW = e.w * 72, VH = e.h * 72, fsz = e.labelSize || 16;
      const tot = e.values.reduce(function (s, v) { return s + v; }, 0);
      if (!tot) return '<svg viewBox="0 0 ' + VW + ' ' + VH + '"><text x="' + VW / 2 + '" y="' + VH / 2 + '" text-anchor="middle" font-size="' + fsz + '" fill="#888">ไม่มีข้อมูล</text></svg>';
      const pl = e.plot || { x: 0.22, y: 0.2, w: 0.56, h: 0.6 };
      const cx = (pl.x + pl.w / 2) * VW, cy = (pl.y + pl.h / 2) * VH, r = Math.min(pl.w * VW, pl.h * VH) / 2;
      let a = -Math.PI / 2, out = '';
      e.values.forEach(function (v, i) {
        const ang = v / tot * Math.PI * 2, a2 = a + ang, mid = a + ang / 2;
        const x1 = cx + r * Math.cos(a), y1 = cy + r * Math.sin(a), x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
        out += e.values.length === 1 ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#' + e.colors[i] + '"/>' :
          '<path d="M' + cx + ' ' + cy + ' L' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 ' + (ang > Math.PI ? 1 : 0) + ' 1 ' + x2 + ' ' + y2 + ' Z" fill="#' + e.colors[i] + '" stroke="#fff" stroke-width="1.5"/>';
        const lr = r + fsz * 1.6, lx = cx + lr * Math.cos(mid), ly = cy + lr * Math.sin(mid) - fsz * 0.6;
        const anc = Math.cos(mid) > 0.3 ? 'start' : (Math.cos(mid) < -0.3 ? 'end' : 'middle');
        out += '<text x="' + lx + '" y="' + ly + '" text-anchor="' + anc + '" font-size="' + fsz + '" fill="#404040">' + esc(e.labels[i]) + ' (' + RE.fmt(v / tot * 100) + '%)' +
          '<tspan x="' + lx + '" dy="' + (fsz * 1.2) + '">' + RE.fmt(v, 0) + ' บาท</tspan></text>';
        a = a2;
      });
      return '<svg viewBox="0 0 ' + VW + ' ' + VH + '" width="100%" height="100%" overflow="visible">' + out + '</svg>';
    }
    const n = e.labels.length, X0 = 10, X1 = 96, Y0 = 6, Y1 = 50;
    const px = function (i) { return X0 + (X1 - X0) * i / (n - 1); }, py = function (v) { return Y1 - (Y1 - Y0) * v / 120; };
    let out = '';
    for (let v = 0; v <= 120; v += 20) out += '<line x1="' + X0 + '" x2="' + X1 + '" y1="' + py(v) + '" y2="' + py(v) + '" stroke="#e5e5e5" stroke-width=".2"/><text x="' + (X0 - 1) + '" y="' + (py(v) + 1) + '" font-size="2.4" text-anchor="end" fill="#555">' + v + '%</text>';
    e.labels.forEach(function (l, i) { out += '<text x="' + px(i) + '" y="' + (Y1 + 4) + '" font-size="2.3" text-anchor="middle" fill="#555">' + esc(l) + '</text>'; });
    e.series.forEach(function (s) {
      const pts = s.values.map(function (v, i) { return v == null ? null : [px(i), py(v)]; }).filter(Boolean);
      if (pts.length) out += '<polyline points="' + pts.map(function (p) { return p.join(','); }).join(' ') + '" fill="none" stroke="#' + s.color + '" stroke-width=".5"/>';
      pts.forEach(function (p) { out += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r=".8" fill="#' + s.color + '"/>'; });
    });
    out += '<rect x="38" y="' + (Y1 + 7) + '" width="3" height="1" fill="#FF6600"/><text x="42" y="' + (Y1 + 8) + '" font-size="2.4">แผน</text>' +
      '<rect x="52" y="' + (Y1 + 7) + '" width="3" height="1" fill="#1E7B1E"/><text x="56" y="' + (Y1 + 8) + '" font-size="2.4">ผล</text>';
    return '<svg viewBox="0 0 100 60" width="100%" height="100%" preserveAspectRatio="none">' + out + '</svg>';
  }
  function slideHtml(spec) {
    spec = RE.withLogo(spec, settings().logo);   // ตรามุมซ้ายบนของกรอบ (ถ้าอัปโหลดตราไว้)
    const thumbs = {};
    S.photos.forEach(function (p) { thumbs[p.__id] = p.thumb; });
    let h = '';
    let bg = '';
    spec.els.forEach(function (e) {
      if (e.type === 'bg') bg = 'background:url(' + e.src + ') center/100% 100% no-repeat;';
      else if (e.type === 'image') {
        h += e.pw ? '<div style="' + pos(e) + photoBg(e.src, e.pw, e.ph, Object.assign({ fx: .5, fy: .5 }, e)) + '"></div>'
          : '<img src="' + e.src + '" style="' + pos(e) + '" alt="">';
      } else if (e.type === 'photo') {
        h += '<div class="el-photo" data-photo="' + esc(e.id) + '" title="คลิกเพื่อเลือกจุดกึ่งกลางของรูป" style="cursor:pointer;' + pos(e) + photoBg(thumbs[e.id] || '', e.pw, e.ph, e) + '"></div>';
      } else if (e.type === 'placeholder') {
        h += '<div class="el-ph" style="' + pos(e) + 'font-size:1.3cqw">' + esc(e.text) + '</div>';
      } else if (e.type === 'text') h += textHtml(e);
      else if (e.type === 'rect' || e.type === 'ellipse') {
        const r = e.type === 'ellipse' ? '50%' : (e.radius ? (e.radius / W * 100) + 'cqw' : '0');
        h += '<div style="' + pos(e) + 'background:#' + (e.fill || 'fff') + ';border-radius:' + r + ';' +
          (e.line ? 'border:' + ((e.lineW || 1) / 72 / W * 100) + 'cqw solid #' + e.line + ';' : '') +
          (e.shadow ? 'box-shadow:0 .2cqw .6cqw rgba(0,0,0,.2);' : '') + 'box-sizing:border-box"></div>';
        if (e.text) h += textHtml(Object.assign({}, e, { align: 'center', valign: 'middle' }));
      } else if (e.type === 'line') {
        h += '<div style="left:' + (e.x / W * 100) + '%;top:' + (e.y / H * 100) + '%;width:' + (e.w / W * 100) + '%;border-top:' + ((e.lineW || 1) / 72 / W * 100) + 'cqw solid #' + (e.color || '444') + '"></div>';
      } else if (e.type === 'chart') {
        h += '<div class="el-chart" style="' + pos(e) + (e.kind === 'pie' ? 'background:transparent' : '') + '">' + chartSvg(e) + '</div>';
      }
    });
    return '<div class="slide" style="' + bg + '">' + h + '</div>';
  }
  function bindSlideClicks(root) {
    $$('.el-photo[data-photo]', root).forEach(function (el) {
      el.onclick = function () { focusModal(el.getAttribute('data-photo')); };
    });
  }

  /* ---------------- ปุ่มรูปตา แสดง/ซ่อนรหัสผ่าน (ใส่ให้ทุกช่องรหัสผ่านอัตโนมัติ รวมช่องที่สร้างทีหลัง) ---------------- */
  function wrapPasswords(root) {
    $$('input[type="password"]', root).forEach(function (inp) {
      if (inp.parentNode.classList.contains('pw-wrap')) return;
      const w = document.createElement('div');
      w.className = 'pw-wrap';
      if (inp.style.maxWidth) { w.style.maxWidth = inp.style.maxWidth; inp.style.maxWidth = ''; }
      inp.parentNode.insertBefore(w, inp);
      w.appendChild(inp);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pw-toggle'; b.title = 'แสดง/ซ่อนรหัสผ่าน'; b.textContent = '👁';
      b.onclick = function () {
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        b.textContent = show ? '🙈' : '👁';
        inp.focus();
      };
      w.appendChild(b);
    });
  }
  wrapPasswords(document);
  new MutationObserver(function (list) {
    list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) wrapPasswords(n); }); });
  }).observe(document.body, { childList: true, subtree: true });

  /* ======================================================================
     ล็อกอิน
     ====================================================================== */
  let teamReady = false;    // ยังโหลดรายชื่อไม่เสร็จ = ยังกดเข้าสู่ระบบไม่ได้
  function resetLoginBtn() { $('#loginBtn').disabled = !teamReady; $('#loginBtn').textContent = 'เข้าสู่ระบบ'; }
  function loginWait(msg) { $('#loginWait').textContent = msg; $('#loginScreen').classList.add('checking'); }

  async function initLogin() {
    if (FBL.demo) { $('#demoNote').classList.remove('hidden'); $('#loginPwWrap').classList.add('hidden'); }
    resetLoginBtn();
    try {
      const team = await FBL.loadTeam();
      // เหมือนระบบงานอุบัติเหตุ: ขึ้น "— เลือกชื่อของคุณ —" ไว้ก่อน ไม่เลือกชื่อใครไว้ให้ล่วงหน้า
      $('#loginName').innerHTML = '<option value="">— เลือกชื่อของคุณ —</option>' +
        team.map(function (t) { return '<option value="' + esc(t.name) + '">' + esc(t.name) + '</option>'; }).join('');
      if (!FBL.demo && await FBL.needsBootstrap()) { $('#loginForm').classList.add('hidden'); $('#bootForm').classList.remove('hidden'); }
    } catch (e) { $('#loginErr').textContent = FBL.errorText(e); }
    finally { teamReady = true; if (!$('#loginBtn').textContent.startsWith('กำลัง')) resetLoginBtn(); }
    $('#loginForm').onsubmit = async function (ev) {
      ev.preventDefault();
      $('#loginErr').textContent = '';
      if (!$('#loginName').value) { $('#loginErr').textContent = 'เลือกชื่อของคุณก่อน'; return; }
      if (!FBL.demo && !$('#loginPw').value) { $('#loginErr').textContent = 'กรอกรหัสผ่าน'; return; }
      // สำเร็จแล้วปุ่มยังล็อกไว้ จนกว่า onAuth จะเปิดระบบหรือแจ้งข้อผิดพลาด (กันกดซ้ำระหว่างรอ)
      $('#loginBtn').disabled = true;
      $('#loginBtn').textContent = 'กำลังเข้าสู่ระบบ…';
      try { await FBL.login($('#loginName').value, $('#loginPw').value); }
      catch (e) { $('#loginErr').textContent = e.message; resetLoginBtn(); }
    };
    $('#bootForm').onsubmit = async function (ev) {
      ev.preventDefault();
      $('#bootErr').textContent = '';
      try { await FBL.bootstrapOwner($('#bootName').value, $('#bootPw').value); startApp(); }
      catch (e) { $('#bootErr').textContent = e.message; }
    };
  }

  let started = false, session = 0, masterHooked = false;
  FBL.onError = function (m) { toast(m, 'err'); };
  FBL.onAuth(function (user, err) {
    if (user) { startApp(); return; }
    session++;
    started = false;
    $('#app').classList.add('hidden');
    $('#loginScreen').classList.remove('hidden', 'checking');
    $('#loginPw').value = '';
    resetLoginBtn();
    if (err) $('#loginErr').textContent = err;
  });

  async function startApp() {
    if (started) return;
    started = true;
    const my = ++session;
    // โหลดข้อมูลให้เสร็จก่อนค่อยสลับหน้า — ไม่ให้เห็นหน้าระบบว่าง ๆ แล้วค่อยกระโดดเป็นข้อมูล
    loginWait('กำลังโหลดข้อมูล…');
    const onChange = function (col, docs) { S[col] = docs; if (col === 'photos') S.photos.forEach(function (p) { p.id = p.__id; }); scheduleRender(col); };
    const got = await Promise.all(['reports', 'records', 'photos', 'plans', 'config'].map(function (c) { return FBL.watch(c, onChange); }));
    if (my !== session || !FBL.user) return;   // ออกจากระบบไประหว่างโหลด
    S.reports = got[0]; S.records = got[1]; S.photos = got[2]; S.plans = got[3]; S.config = got[4];
    S.photos.forEach(function (p) { p.id = p.__id; });
    const last = lsGet('cn-monthly-mk');
    const ids = S.reports.map(function (r) { return r.__id; }).sort();
    S.mk = ids.indexOf(last) >= 0 ? last : (ids[ids.length - 1] || '');
    // แบบเดียวกับระบบควบคุมงานโครงการ: ผู้บันทึก: ชื่อ 👑 (เจ้าของระบบ) / 🛡️ (ผู้ดูแลระบบ)
    $('#whoName').textContent = 'ผู้บันทึก: ' + FBL.user.name + (FBL.user.isOwner ? ' 👑' : FBL.user.isAdmin ? ' 🛡️' : '');
    $('#whoName').title = FBL.user.isOwner ? 'เจ้าของระบบ' : (FBL.user.isAdmin ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน');
    // ผูกกับฐานข้อมูลกลางครั้งเดียวพอ — ถ้าผูกทุกครั้งที่ล็อกอิน ออก-เข้าหลายรอบจะวาดหน้าซ้ำหลายเท่า
    if (!masterHooked && window.CNMaster && CNMaster.ready) {
      masterHooked = true;
      CNMaster.ready.then(function () { if (started) renderAll(); }).catch(function () {});
      CNMaster.onChange(function (w) { if (started && (w === 'routes' || w === 'workcodes')) renderAll(); });
    }
    $('#loginPw').value = '';
    resetLoginBtn();
    $('#loginScreen').classList.add('hidden');
    $('#loginScreen').classList.remove('checking');
    $('#app').classList.remove('hidden');
    renderAll();
  }

  // ข้อมูลเปลี่ยนจากเครื่องอื่น: วาดใหม่ แต่ไม่วาดทับช่องที่กำลังพิมพ์อยู่
  const scheduleRender = debounce(function () {
    const ae = document.activeElement;
    const panel = $('[data-panel="' + S.tab + '"]');
    if (ae && panel && panel.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) { renderHeader(); refreshPreviews(); return; }
    if (S.tab === 'cover' && !savingProblems) S.probDraft = null;
    renderAll();
  }, 120);

  /* ======================================================================
     ส่วนหัว / แท็บ / เดือน
     ====================================================================== */
  $('#tabs').onclick = function (ev) {
    const b = ev.target.closest('button[data-tab]');
    if (!b) return;
    S.tab = b.getAttribute('data-tab');
    renderAll();
    window.scrollTo(0, 0);
  };
  $('#monthSel').onchange = function () { S.mk = this.value; lsSet('cn-monthly-mk', S.mk); S.pending = null; S.probDraft = null; renderAll(); };
  $('#newMonthBtn').onclick = newMonth;
  $('#firstMonthBtn').onclick = newMonth;
  $('#logoutBtn').onclick = function () { FBL.logout().catch(function (e) { toast(FBL.errorText(e), 'err'); }); };

  function renderHeader() {
    const ids = S.reports.map(function (r) { return r.__id; }).sort().reverse();
    $('#monthSel').innerHTML = ids.map(function (id) { return '<option value="' + id + '"' + (id === S.mk ? ' selected' : '') + '>รายงานเดือน ' + esc(RE.mkLabel(id)) + '</option>'; }).join('');
    $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === S.tab); });
    const recs = monthRecords();
    $('#bImport').textContent = recs.length;
    const aggs = slideAggs(RE.aggregate(recs));
    const missing = aggs.filter(function (a) { return !photosOf('work:' + a.code).length && !(rep().exclude || {})[a.code]; }).length;
    $('#bWork').textContent = missing ? missing + ' ไม่มีรูป' : aggs.length;
    $('#bWork').classList.toggle('warn', !!missing);
  }

  function renderAll() {
    renderHeader();
    const has = !!S.mk && S.reports.some(function (r) { return r.__id === S.mk; });
    $('#noReport').classList.toggle('hidden', has || S.tab === 'settings');
    $$('[data-panel]').forEach(function (p) { p.classList.toggle('hidden', p.getAttribute('data-panel') !== S.tab || (!has && S.tab !== 'settings')); });
    if (!has && S.tab !== 'settings') return;
    ({ import: renderImport, work: renderWork, cover: renderCover, plan: renderPlan, export: renderExport, settings: renderSettings })[S.tab]();
  }
  function refreshPreviews() {
    if (S.tab === 'cover') { renderCoverPreview(); renderProblemPreviews(); }
    else if (S.tab === 'plan') renderPlanPreview();
  }

  async function newMonth() {
    const now = new Date();
    const ids = S.reports.map(function (r) { return r.__id; }).sort();
    let y, m;
    if (ids.length) { const p = ids[ids.length - 1].split('-').map(Number); m = p[1] + 1; y = p[0]; if (m > 12) { m = 1; y++; } }
    else { m = now.getMonth(); y = now.getFullYear() + 543; if (m === 0) { m = 12; y--; } }
    const years = [];
    for (let yy = now.getFullYear() + 544; yy >= now.getFullYear() + 541; yy--) years.push(yy);
    const html = '<div class="grid2"><div><label class="f">เดือน</label><select id="nmM">' +
      RE.MONTHS.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === m ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
      '</select></div><div><label class="f">ปี (พ.ศ.)</label><select id="nmY">' + years.map(function (yy) { return '<option' + (yy === y ? ' selected' : '') + '>' + yy + '</option>'; }).join('') + '</select></div></div>' +
      '<p class="small muted">หน่วยนับของแต่ละรหัสงานอ้างอิงจากฐานข้อมูลกลาง (รหัสงาน) — รหัสงานที่มีหลายหน่วย เลือกหน่วยของเดือนนี้ได้ที่แท็บรายรหัสงาน</p>';
    const r = await modal({ title: 'เริ่มรายงานเดือนใหม่', html: html, ok: 'สร้างรายงาน', read: function (bg) { return $('#nmY', bg).value + '-' + String($('#nmM', bg).value).padStart(2, '0'); } });
    if (!r) return;
    const mk = r;
    if (S.reports.some(function (x) { return x.__id === mk; })) { S.mk = mk; lsSet('cn-monthly-mk', mk); renderAll(); toast('มีรายงานเดือนนี้อยู่แล้ว — เปิดให้แล้ว'); return; }
    await run(async function () {
      await FBL.set('reports', mk, { mk: mk, units: {}, meetingText: '', problems: [], layouts: {}, exclude: {}, createdAt: FBL.nowIso(), createdBy: FBL.user.name, updatedAt: FBL.nowIso(), updatedBy: FBL.user.name });
      S.mk = mk; lsSet('cn-monthly-mk', mk); S.tab = 'import';
    }, 'สร้างรายงานเดือน ' + RE.mkLabel(mk) + ' แล้ว');
    renderAll();
    // ล้างรูปของเดือนก่อน (รูปต้นฉบับเจ้าหน้าที่เก็บไว้แล้ว)
    const old = S.photos.filter(function (p) { return p.mk !== mk; });
    if (old.length) {
      const months = Array.from(new Set(old.map(function (p) { return p.mk; }))).map(RE.mkLabel).join(', ');
      const ok = await confirmBox('ล้างรูปของเดือนก่อน?', '<p>ในระบบยังมีรูปของเดือน <b>' + esc(months) + '</b> อยู่ <b>' + old.length + ' รูป</b></p><p>เริ่มเดือนใหม่แล้ว แนะนำให้ลบรูปเดือนก่อนออกเพื่อประหยัดพื้นที่ (รูปต้นฉบับยังอยู่ในโฟลเดอร์ของเจ้าหน้าที่)</p><p class="small muted">ตัวเลขผลงานของเดือนก่อนไม่ถูกลบ</p>', 'ลบรูปเดือนก่อน', true);
      if (ok) await run(function () { return FBL.deletePhotos(old.map(function (p) { return p.__id; })); }, 'ลบรูปเดือนก่อนแล้ว ' + old.length + ' รูป');
    }
  }

  /* ======================================================================
     ① นำเข้าข้อมูล
     ====================================================================== */
  function pickFiles(accept, multiple, cb) {
    const inp = $('#filePick');
    inp.value = ''; inp.accept = accept; inp.multiple = !!multiple;
    inp.onchange = function () { cb(Array.prototype.slice.call(inp.files)); };
    inp.click();
  }
  function bindDrop(el, accept, multiple, cb) {
    el.onclick = function () { pickFiles(accept, multiple, cb); };
    el.ondragover = function (e) { e.preventDefault(); el.classList.add('over'); };
    el.ondragleave = function () { el.classList.remove('over'); };
    el.ondrop = function (e) { e.preventDefault(); el.classList.remove('over'); cb(Array.prototype.slice.call(e.dataTransfer.files)); };
  }

  function renderImport() {
    const p = $('[data-panel="import"]');
    const recs = monthRecords().sort(function (a, b) { return a.code.localeCompare(b.code) || String(a.dates[0]).localeCompare(String(b.dates[0])); });
    let h = '<div class="card"><div class="card-head"><h2>นำเข้าไฟล์ผลการปฏิบัติงาน · เดือน ' + esc(RE.mkLabel(S.mk)) + '</h2></div>' +
      '<div class="drop" id="csvDrop"><b>เลือกไฟล์ Export_CSV ทั้งหมดของเดือนมาวางที่นี่</b></div>';
    if (S.pending) h += pendingHtml();
    h += '</div>';

    const aggs = RE.aggregate(recs);
    h += '<div class="card"><div class="card-head"><h2>สรุปตามรหัสงาน</h2><span class="muted">ยอดรวม = ค่าวัสดุ + ค่าแรงงาน + ค่าเช่าเครื่องจักร + ค่าน้ำมัน</span></div>';
    if (!aggs.length) h += '<div class="empty">ยังไม่มีข้อมูลของเดือนนี้ — นำเข้าไฟล์ CSV ด้านบน</div>';
    else {
      h += '<div class="tbl-wrap"><table class="tbl"><tr><th>รหัสงาน</th><th>ชื่องาน</th><th class="num">ไฟล์</th><th class="num">ปริมาณ</th><th>หน่วย</th><th class="num">วัน</th><th class="num">ค่าวัสดุ</th><th class="num">ค่าแรงงาน</th><th class="num">ค่าเช่า</th><th class="num">ค่าน้ำมัน</th><th class="num">รวม</th><th class="num">Unit Cost</th><th class="num">ผลงาน/วัน</th></tr>';
      const T = { mat: 0, lab: 0, rent: 0, fuel: 0, total: 0 };
      aggs.forEach(function (a) {
        ['mat', 'lab', 'rent', 'fuel', 'total'].forEach(function (k) { T[k] += a[k]; });
        const hid = RE.HIDDEN_WORK_CODES.indexOf(a.code) >= 0;
        h += '<tr><td><b>' + a.code + '</b></td><td>' + esc(a.name) + (hid ? ' <span class="pill info">ไม่ทำสไลด์</span>' : '') + '</td><td class="num">' + a.count + '</td><td class="num">' + RE.fmtQty(a.qty) + '</td><td>' + esc(unitOf(a.code)) + '</td><td class="num">' + a.days + '</td>' +
          '<td class="num">' + RE.fmt(a.mat) + '</td><td class="num">' + RE.fmt(a.lab) + '</td><td class="num">' + RE.fmt(a.rent) + '</td><td class="num">' + RE.fmt(a.fuel) + '</td><td class="num"><b>' + RE.fmt(a.total) + '</b></td><td class="num">' + RE.fmt(a.unitCost) + '</td><td class="num">' + RE.fmt(a.perDay, a.perDay >= 100 ? 0 : 2) + '</td></tr>';
      });
      h += '<tr class="tot"><td colspan="6">รวมทั้งเดือน (' + aggs.length + ' รหัสงาน)</td><td class="num">' + RE.fmt(T.mat) + '</td><td class="num">' + RE.fmt(T.lab) + '</td><td class="num">' + RE.fmt(T.rent) + '</td><td class="num">' + RE.fmt(T.fuel) + '</td><td class="num">' + RE.fmt(T.total) + '</td><td colspan="2"></td></tr></table></div>';
    }
    h += '</div>';

    h += '<div class="card"><div class="card-head"><h2>รายการที่บันทึกแล้ว (' + recs.length + ' ไฟล์)</h2></div>';
    if (recs.length) {
      h += '<div class="tbl-wrap"><table class="tbl"><tr><th>ไฟล์</th><th>รหัสงาน</th><th>สายทาง / กม.</th><th>วันที่ปฏิบัติงาน</th><th class="num">ปริมาณ</th><th class="num">รวม (บาท)</th><th>นำเข้าโดย</th><th></th></tr>';
      recs.forEach(function (r) {
        h += '<tr><td class="small">' + esc(r.file) + '</td><td><b>' + r.code + '</b> ' + esc(r.name.length > 30 ? r.name.slice(0, 30) + '…' : r.name) + '</td><td>ทล.' + esc(r.route) + ' ตอน ' + esc(r.ctrl) + '<br><span class="small muted">กม. ' + esc(r.kmFrom) + ' – ' + esc(r.kmTo) + '</span></td>' +
          '<td class="small">' + r.dates.map(RE.thDate).join(', ') + ' <span class="muted">(' + r.days + ' วัน)</span></td><td class="num">' + RE.fmtQty(r.qty) + '</td><td class="num">' + RE.fmt(r.total) + '</td>' +
          '<td class="small muted">' + esc(r.importedBy || '') + '</td><td><button class="btn btn-icon btn-danger" data-delrec="' + esc(r.__id) + '">ลบ</button></td></tr>';
      });
      h += '</table></div>';
    } else h += '<div class="muted">—</div>';
    h += '</div>';
    p.innerHTML = h;

    bindDrop($('#csvDrop'), '.csv,text/csv', true, importFiles);
    $$('[data-delrec]', p).forEach(function (b) {
      b.onclick = async function () {
        const id = b.getAttribute('data-delrec');
        const r = S.records.find(function (x) { return x.__id === id; });
        if (await confirmBox('ลบรายการนี้?', '<p>' + esc(r.file) + ' — รหัส ' + r.code + ' ทล.' + esc(r.route) + '</p><p class="small muted">นำเข้าไฟล์เดิมใหม่ได้ภายหลัง</p>', 'ลบ', true))
          run(function () { return FBL.del('records', id); }, 'ลบแล้ว');
      };
    });
    if (S.pending) bindPending(p);
  }

  function pendingHtml() {
    const rows = S.pending;
    const nErr = rows.filter(function (r) { return r.level === 'error'; }).length;
    const nWarn = rows.filter(function (r) { return r.level === 'warn'; }).length;
    const nUndec = rows.filter(function (r) { return r.level === 'warn' && r.confirmed == null; }).length;
    const ok = rows.filter(canSave).length;
    let h = '<div style="margin-top:16px"><div class="row" style="margin-bottom:10px"><h3>ผลการตรวจสอบ ' + rows.length + ' ไฟล์</h3>' +
      '<span class="pill ok">ผ่าน ' + rows.filter(function (r) { return r.level === 'ok' || r.level === 'info'; }).length + '</span>' +
      (nWarn ? '<span class="pill warn">ต้องตัดสินใจ ' + nWarn + '</span>' : '') + (nErr ? '<span class="pill err">ผิดพลาด (ไม่บันทึก) ' + nErr + '</span>' : '') + '</div>' +
      '<div class="tbl-wrap"><table class="tbl pend">' +
      '<colgroup><col style="width:92px"><col style="width:26%"><col style="width:24%"><col style="width:15%"><col style="width:14%"><col style="width:80px"><col style="width:100px"><col style="width:92px"></colgroup><tr><th>สถานะ</th><th>ไฟล์ / ผลตรวจ</th><th>รหัสงาน</th><th>สายทาง / กม.</th><th>วันที่</th><th class="num">ปริมาณ</th><th class="num">รวม (บาท)</th><th class="c">ใช้ข้อมูล</th></tr>';
    rows.forEach(function (x, i) {
      const r = x.rec;
      const pill = x.level === 'error' ? '<span class="pill err">ผิดพลาด</span>' : x.level === 'warn' ? '<span class="pill warn">ตรวจสอบ</span>' : '<span class="pill ok">ผ่าน</span>';
      h += '<tr class="' + (x.level === 'error' ? 'bad' : x.confirmed === false ? 'skip' : '') + '"><td>' + pill + '</td><td class="small">' + esc(x.file) +
        (x.issues.length ? '<ul class="issues">' + x.issues.map(function (s) { return '<li class="' + s.level + '">' + esc(s.msg) + '</li>'; }).join('') + '</ul>' : '') + '</td>' +
        (r ? '<td><b>' + r.code + '</b><div class="nm" title="' + esc(r.name) + '">' + esc(r.name) + '</div></td><td>ทล.' + esc(r.route) + '<br><span class="small muted"><span class="km">กม. ' + esc(r.kmFrom) + '</span> <span class="km">– ' + esc(r.kmTo) + '</span></span></td><td class="small dt">' + compactDates(r.dates) + '</td><td class="num">' + RE.fmtQty(r.qty) + '</td><td class="num">' + RE.fmt(r.total) + '</td>'
          : '<td colspan="5"></td>') +
        '<td class="c">' + (x.level === 'warn'
          ? '<div class="dec"><button type="button" class="yes' + (x.confirmed === true ? ' on' : '') + '" data-dec="' + i + '" data-v="1" title="ใช้ข้อมูล (ตรวจแล้ว ถูกต้อง)">✓</button>' +
            '<button type="button" class="no' + (x.confirmed === false ? ' on' : '') + '" data-dec="' + i + '" data-v="0" title="ไม่ใช้ข้อมูล (ไม่บันทึกไฟล์นี้)">✕</button></div>'
          : x.level === 'error' ? '<span class="small muted">ข้าม</span>' : '<span class="ok-mark">✓</span>') + '</td></tr>';
    });
    h += '</table></div><div class="row" style="margin-top:12px;justify-content:flex-end;align-items:center">' +
      (nUndec ? '<span class="small" style="color:var(--amber)">ยังไม่ได้ตัดสินใจ ' + nUndec + ' ไฟล์ — กด ✓ ใช้ข้อมูล หรือ ✕ ไม่ใช้ข้อมูล</span>' : '') +
      '<button class="btn" id="pendCancel">ยกเลิก</button><button class="btn btn-primary" id="pendSave"' + (ok && !nUndec ? '' : ' disabled') + '>บันทึก ' + ok + ' รายการ</button></div>' +
      (nErr ? '<p class="small muted" style="text-align:right">ไฟล์ที่ผิดพลาดจะไม่ถูกบันทึก ให้เจ้าหน้าที่แก้ในระบบของแขวงแล้วส่งออกไฟล์ใหม่</p>' : '') + '</div>';
    return h;
  }
  function canSave(x) { return x.level === 'ok' || x.level === 'info' || (x.level === 'warn' && x.confirmed === true); }
  // ย่อรายการวันที่: วันติดกันรวมเป็นช่วง ชื่อเดือนแสดงครั้งเดียว เช่น "1, 3–8, 10–15 ส.ค. (14 วัน)"
  function compactDates(dates) {
    const ds = dates.slice().sort();
    const parts = [];
    let i = 0;
    while (i < ds.length) {
      const ym = ds[i].slice(0, 7), grp = [];
      while (i < ds.length && ds[i].slice(0, 7) === ym) grp.push(Number(ds[i++].slice(8, 10)));
      const rs = [];
      for (let j = 0; j < grp.length; j++) {
        let k = j;
        while (k + 1 < grp.length && grp[k + 1] === grp[k] + 1) k++;
        rs.push(k > j ? grp[j] + '–' + grp[k] : String(grp[j]));
        j = k;
      }
      parts.push(rs.join(', ') + ' ' + RE.MONTHS_SHORT[Number(ym.slice(5, 7)) - 1]);
    }
    return esc(parts.join(' · ')) + (ds.length > 1 ? ' <span class="muted">(' + ds.length + ' วัน)</span>' : '');
  }
  function bindPending(p) {
    $$('[data-dec]', p).forEach(function (b) {
      b.onclick = function () {
        const x = S.pending[Number(b.getAttribute('data-dec'))], v = b.getAttribute('data-v') === '1';
        x.confirmed = x.confirmed === v ? null : v; // กดซ้ำ = ยกเลิกการเลือก
        renderImport();
      };
    });
    $('#pendCancel').onclick = function () { S.pending = null; renderImport(); };
    $('#pendSave').onclick = function () {
      const rows = S.pending.filter(canSave);
      run(async function () {
        await FBL.commit(rows.map(function (x) {
          const d = Object.assign({}, x.rec, { mk: S.mk, importedBy: FBL.user.name, importedAt: FBL.nowIso(),
            confirmedWarnings: x.issues.filter(function (s) { return s.level === 'warn'; }).map(function (s) { return s.msg; }) });
          return { op: 'set', col: 'records', id: RE.recordId(S.mk, x.rec), data: d };
        }));
        S.pending = null;
      }, 'บันทึกแล้ว ' + rows.length + ' รายการ').then(renderAll);
    };
  }

  async function importFiles(files) {
    files = files.filter(function (f) { return /\.csv$/i.test(f.name); });
    if (!files.length) { toast('ไม่พบไฟล์ .csv', 'err'); return; }
    const rows = [];
    for (const f of files) {
      try { rows.push({ file: f.name, rec: RE.parseExport(await RE.decodeFile(f), f.name), issues: [] }); }
      catch (e) { rows.push({ file: f.name, rec: null, issues: [{ level: 'error', msg: e.message }] }); }
    }
    const batch = rows.filter(function (r) { return r.rec; }).map(function (r) { return r.rec; });
    rows.forEach(function (r) {
      if (r.rec) r.issues = RE.validate(r.rec, { mk: S.mk, existing: S.records, batch: batch });
      r.level = r.issues.some(function (s) { return s.level === 'error'; }) ? 'error' : r.issues.some(function (s) { return s.level === 'warn'; }) ? 'warn' : r.issues.length ? 'info' : 'ok';
    });
    rows.sort(function (a, b) { const o = { error: 0, warn: 1, info: 2, ok: 3 }; return o[a.level] - o[b.level]; });
    S.pending = rows;
    renderImport();
  }

  /* ======================================================================
     รูปภาพ (ใช้ร่วมทุกหน้า)
     ====================================================================== */
  let photoBusy = false;
  async function addPhotos(files, slot, opts) {
    opts = opts || {};
    files = files.filter(function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name); });
    if (!files.length) { toast('ไม่พบไฟล์รูปภาพ', 'err'); return; }
    if (photoBusy) { toast('กำลังประมวลผลรูปชุดก่อนอยู่ รอสักครู่', 'err'); return; }
    const existing = photosOf(slot);
    if (opts.single) files = files.slice(0, 1);
    else if (existing.length + files.length > RE.MAX_PHOTOS) {
      toast('สไลด์หนึ่งใส่ได้สูงสุด ' + RE.MAX_PHOTOS + ' รูป — ใช้ ' + Math.max(0, RE.MAX_PHOTOS - existing.length) + ' รูปแรก', 'err');
      files = files.slice(0, Math.max(0, RE.MAX_PHOTOS - existing.length));
      if (!files.length) return;
    }
    photoBusy = true;
    const t = toast('กำลังเตรียมรูป…', '', 600000);
    try {
      const done = [];
      for (let i = 0; i < files.length; i++) {
        t.textContent = 'กำลังย่อรูปและหาจุดสำคัญ ' + (i + 1) + '/' + files.length + ' …';
        const r = await RE.processPhoto(files[i]);
        done.push({ file: files[i], r: r });
      }
      done.sort(function (a, b) { return String(a.r.takenAt).localeCompare(String(b.r.takenAt)); });
      let order = existing.reduce(function (m, p) { return Math.max(m, p.order || 0); }, 0);
      for (let i = 0; i < done.length; i++) {
        t.textContent = 'กำลังบันทึกรูป ' + (i + 1) + '/' + done.length + ' …';
        const r = done[i].r, id = FBL.randomId(20);
        await FBL.savePhoto(id, {
          mk: S.mk, slot: slot, order: ++order, thumb: r.thumb, w: r.w, h: r.h, fx: r.focus.x, fy: r.focus.y,
          takenAt: r.takenAt, flags: r.quality.flags, name: done[i].file.name, size: r.size, by: FBL.user.name, at: FBL.nowIso()
        }, r.bytes);
      }
      if (opts.single && existing.length) await FBL.deletePhotos(existing.map(function (p) { return p.__id; }));
      const flagged = done.filter(function (d) { return d.r.quality.flags.length; });
      toast('เพิ่มรูปแล้ว ' + done.length + ' รูป' + (flagged.length ? ' — มี ' + flagged.length + ' รูปที่อาจมืด/เบลอ ลองตรวจดู' : ''), flagged.length ? '' : 'ok', 5000);
    } catch (e) { console.error(e); toast(e.message || String(e), 'err'); }
    finally { t.remove(); photoBusy = false; }
  }

  function thumbsHtml(slot) {
    const ph = photosOf(slot);
    return '<div class="thumbs">' + ph.map(function (p, i) {
      return '<div class="thumb"><div class="im" data-focus="' + p.__id + '" style="background-image:url(' + p.thumb + ')" title="คลิกบนรูปเพื่อเลือกจุดที่ต้องการให้อยู่กลางกรอบ">' +
        '<span class="no">' + (i + 1) + '</span><span class="fp" style="left:' + (p.fx * 100) + '%;top:' + (p.fy * 100) + '%"></span></div>' +
        '<div class="flags">' + esc((p.flags || []).join(' · ')) + '</div>' +
        '<div class="bar"><button class="btn btn-icon" data-mv="-1" data-id="' + p.__id + '" data-slot="' + esc(slot) + '"' + (i ? '' : ' disabled') + ' title="เลื่อนไปก่อน">◀</button>' +
        '<span class="muted">' + esc(p.takenAt ? RE.thDate(p.takenAt.slice(0, 10).replace(/^(\d{4})/, function (y) { return String(Number(y) + 543); })) : '') + '</span>' +
        '<button class="btn btn-icon" data-mv="1" data-id="' + p.__id + '" data-slot="' + esc(slot) + '"' + (i < ph.length - 1 ? '' : ' disabled') + ' title="เลื่อนไปหลัง">▶</button>' +
        '<button class="btn btn-icon btn-danger" data-rm="' + p.__id + '" title="ลบรูป">✕</button></div></div>';
    }).join('') + '</div>';
  }
  function bindThumbs(root) {
    $$('.im[data-focus]', root).forEach(function (el) {
      el.onclick = function (ev) {
        const r = el.getBoundingClientRect();
        const fx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), fy = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
        run(function () { return FBL.set('photos', el.getAttribute('data-focus'), { fx: fx, fy: fy }, true); });
      };
    });
    $$('[data-mv]', root).forEach(function (b) {
      b.onclick = function () {
        const ph = photosOf(b.getAttribute('data-slot'));
        const i = ph.findIndex(function (p) { return p.__id === b.getAttribute('data-id'); });
        const j = i + Number(b.getAttribute('data-mv'));
        if (j < 0 || j >= ph.length) return;
        const ops = ph.map(function (p, k) { return { op: 'set', col: 'photos', id: p.__id, data: { order: k === i ? j + 1 : k === j ? i + 1 : k + 1 }, merge: true }; });
        run(function () { return FBL.commit(ops); });
      };
    });
    $$('[data-rm]', root).forEach(function (b) {
      b.onclick = async function () {
        if (await confirmBox('ลบรูปนี้?', '<p>ลบออกจากรายงาน (รูปต้นฉบับในเครื่องเจ้าหน้าที่ไม่ได้รับผลกระทบ)</p>', 'ลบรูป', true))
          run(function () { return FBL.deletePhotos([b.getAttribute('data-rm')]); });
      };
    });
  }
  function focusModal(id) {
    const p = S.photos.find(function (x) { return x.__id === id; });
    if (!p) return;
    modal({ title: 'เลือกจุดกึ่งกลางของรูป', ok: false, cancel: 'ปิด', wide: true,
      html: '<p class="small muted">คลิกตรงจุดที่ต้องการให้อยู่กลางกรอบ (เช่น คนงาน เครื่องจักร หรือจุดที่ซ่อม) — ระบบตั้งให้อัตโนมัติไว้แล้วที่วงกลมสีเหลือง</p>' +
        '<div id="fcBox" style="position:relative;cursor:crosshair;display:inline-block;max-width:100%"><img src="' + p.thumb + '" style="max-width:100%;max-height:60vh;display:block;border-radius:6px">' +
        '<span id="fcDot" style="position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 3px #FAC02E;left:' + (p.fx * 100) + '%;top:' + (p.fy * 100) + '%"></span></div>' +
        '<div class="small muted" style="margin-top:8px">' + esc(p.name || '') + ' · ' + p.w + '×' + p.h + ' px' + ((p.flags || []).length ? ' · <b style="color:var(--amber)">' + esc(p.flags.join(', ')) + '</b>' : '') + '</div>',
      onOpen: function (bg, close) {
        $('#fcBox', bg).onclick = function (ev) {
          const r = $('#fcBox img', bg).getBoundingClientRect();
          const fx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), fy = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
          $('#fcDot', bg).style.left = fx * 100 + '%'; $('#fcDot', bg).style.top = fy * 100 + '%';
          run(function () { return FBL.set('photos', id, { fx: fx, fy: fy }, true); }).then(function () { setTimeout(function () { close(true); }, 250); });
        };
      } });
  }
  function layoutSelectHtml(slot, n, lay) {
    if (n < 2) return '';
    const cur = validChoice((rep().layouts || {})[slot], n);
    return '<label class="f" style="margin-top:6px">แบบจัดวางรูป</label><select data-layout="' + esc(slot) + '">' +
      '<option value="">อัตโนมัติ (แนะนำ) — ' + esc(cur == null ? lay.name : RE.templates(n)[lay.index] ? '' : '') + (cur == null ? '' : 'ตอนนี้เลือกเอง') + '</option>' +
      RE.templates(n).map(function (t, i) { return '<option value="' + i + '"' + (cur === i ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select>';
  }
  function bindLayoutSelects(root) {
    $$('[data-layout]', root).forEach(function (s) {
      s.onchange = function () {
        const layouts = Object.assign({}, rep().layouts || {});
        layouts[s.getAttribute('data-layout')] = s.value === '' ? null : Number(s.value);
        run(function () { return saveReport({ layouts: layouts }); });
      };
    });
  }

  /* ======================================================================
     ② รายรหัสงาน & รูป
     ====================================================================== */
  function workSpec(a) {
    const slot = 'work:' + a.code;
    const ph = photosOf(slot).map(photoSpec);
    return RE.slideWork(a, a.merged ? '' : unitOf(a.code), ph, validChoice((rep().layouts || {})[slot], ph.length));
  }
  // ช่องหน่วยนับ: มีหลายหน่วยในฐานข้อมูลกลาง = เลือกจากรายการ · หน่วยเดียว = แสดงอย่างเดียว
  // อ่านฐานข้อมูลกลางไม่ได้ / ไม่มีรหัสนี้ = พิมพ์เองได้ (สำรอง)
  function unitFieldHtml(code) {
    const ch = unitChoices(code), cur = unitOf(code);
    if (ch.length > 1) return '<select data-unit="' + code + '">' + ch.map(function (u) { return '<option' + (u === cur ? ' selected' : '') + '>' + esc(u) + '</option>'; }).join('') + '</select>';
    if (ch.length === 1) return '<input type="text" value="' + esc(cur) + '" readonly title="หน่วยนับจากฐานข้อมูลกลาง (รหัสงานนี้มีหน่วยเดียว)">';
    return '<input type="text" list="unitList" data-unit="' + code + '" value="' + esc(cur) + '">';
  }
  function unitNoteHtml(code) {
    const ch = unitChoices(code);
    const link = window.CNMaster && CNMaster.editUrl ? ' <a href="' + esc(CNMaster.editUrl('workcodes')) + '" target="_blank" rel="noopener">แก้ไขที่ฐานข้อมูลกลาง</a>' : '';
    if (ch.length > 1) return '<p class="small muted" style="margin:4px 0 0">รหัสงานนี้มี ' + ch.length + ' หน่วย (' + ch.map(esc).join(' / ') + ') เลือกหน่วยที่ตรงกับปริมาณงานของเดือนนี้' + link + '</p>';
    if (ch.length === 1) return '';
    let hubReady = false;
    try { hubReady = !!(window.CNMaster && CNMaster.workCodes && CNMaster.workCodes().length); } catch (e) { /* ข้าม */ }
    return '<p class="small" style="margin:4px 0 0;color:#b45309">' + (hubReady ? 'ไม่พบรหัสงาน ' + code + ' (หรือยังไม่ได้กำหนดหน่วยนับ) ในฐานข้อมูลกลาง — พิมพ์หน่วยเองชั่วคราว' : 'ยังเชื่อมต่อฐานข้อมูลกลางไม่ได้ — ใช้หน่วยนับสำรอง') + link + '</p>';
  }
  function renderWork() {
    const p = $('[data-panel="work"]');
    const aggs = RE.aggregate(monthRecords());
    const shown = slideAggs(aggs);
    const hidden = aggs.filter(function (a) { return RE.HIDDEN_WORK_CODES.indexOf(a.code) >= 0; });
    if (!aggs.length) { p.innerHTML = '<div class="card empty"><h2>ยังไม่มีข้อมูลผลงานของเดือนนี้</h2><p>ไปที่แท็บ ① นำเข้าข้อมูล ก่อน</p></div>'; return; }
    const ex = rep().exclude || {};
    const mg = rep().merge || {};
    // กลุ่มงานที่เดือนนี้มีรหัสย่อย ≥ 2 รหัส = เลือกรวมเป็นสไลด์เดียวได้
    const mergeable = RE.GROUPS.map(function (g) {
      return { g: g, subs: aggs.filter(function (a) { return a.group === g.code && RE.HIDDEN_WORK_CODES.indexOf(a.code) < 0; }) };
    }).filter(function (x) { return x.subs.length >= 2; });
    let h = '<div class="card"><div class="row"><h2 style="flex:1">รายรหัสงาน · ' + shown.length + ' สไลด์</h2>' +
      '<span class="muted small">ลากรูปมาวางในแต่ละรหัสงาน ระบบจัดวาง ครอป และเรียงตามเวลาถ่ายให้อัตโนมัติ · คลิกรูปเพื่อเลือกจุดกึ่งกลาง</span></div>' +
      (mergeable.length ? '<div style="margin:10px 0 0"><b class="small">รวมรหัสย่อยเป็นสไลด์เดียว (ตามกลุ่มงาน)</b>' +
        mergeable.map(function (x) {
          return '<div class="small" style="margin-top:4px"><label><input type="checkbox" data-merge="' + x.g.code + '"' + (mg[x.g.code] ? ' checked' : '') + '> ' +
            '<b>' + x.g.code + '</b> ' + esc(RE.groupName(x.g.code)) + ' — รวม ' + x.subs.map(function (a) { return a.code; }).join(', ') + ' (' + x.subs.length + ' สไลด์ → 1 สไลด์)</label></div>';
        }).join('') +
        '<p class="small muted" style="margin:4px 0 0">สไลด์รวมแสดงรายสายทางของทุกรหัสย่อย (ขึ้นต้นบรรทัดด้วยรหัสงาน) และรวมค่าใช้จ่าย · ถ้าหน่วยนับต่างกัน จะแสดงปริมาณแยกตามหน่วย และไม่คิด Unit Cost · รูปของสไลด์รวมแยกจากรูปรายรหัส</p></div>' : '') +
      (hidden.length ? '<p class="small muted" style="margin:8px 0 0">ไม่ทำสไลด์: ' + hidden.map(function (a) { return a.code + ' ' + esc(a.name.slice(0, 40)); }).join(', ') + ' (งานบริหาร — ยังนับในยอดรวม กราฟ และแผน-ผล)</p>' : '') + '</div>';
    shown.forEach(function (a) {
      const slot = 'work:' + a.code;
      const spec = workSpec(a);
      const n = photosOf(slot).length;
      const unitHtml = a.merged
        ? a.subs.map(function (c) { return '<div class="row" style="margin-bottom:4px"><div style="width:70px" class="small"><b>' + c + '</b></div><div style="width:130px">' + unitFieldHtml(c) + '</div></div>' + unitNoteHtml(c); }).join('') +
          '<div class="muted small">' + a.count + ' ไฟล์ · ' + a.days + ' วันทำงาน · ' + a.lines.length + ' รายการสายทาง</div>'
        : '<div class="row"><div style="width:130px"><label class="f">หน่วยนับ</label>' + unitFieldHtml(a.code) + '</div>' +
          '<div class="muted small" style="flex:1">' + a.count + ' ไฟล์ · ' + a.days + ' วันทำงาน · ' + a.lines.length + ' สายทาง</div></div>' + unitNoteHtml(a.code);
      const qtyTxt = a.merged ? a.qtyParts.map(function (q) { return RE.fmtQty(q.qty) + ' ' + esc(q.unit); }).join(' + ') : RE.fmtQty(a.qty) + ' ' + esc(unitOf(a.code));
      const ucTxt = a.merged ? (a.sameUnit ? RE.fmt(a.unitCost) + ' บาท/' + esc(a.qtyParts[0].unit) : '- (หน่วยนับต่างกัน)') : RE.fmt(a.unitCost) + ' บาท/' + esc(unitOf(a.code));
      // รูปที่อยู่ในสไลด์รายรหัสย่อยเดิม — ดึงมาใช้ในสไลด์รวมได้
      const subPh = a.merged ? a.subs.reduce(function (s, c) { return s.concat(photosOf('work:' + c)); }, []) : [];
      h += '<div class="card" id="w-' + a.code + '"><div class="card-head"><h3>รหัส ' + a.code + ' ' + esc(a.name) + (a.merged ? ' <span class="pill info">รวม ' + a.subs.join(', ') + '</span>' : '') + '</h3><div class="sp"></div>' +
        (ex[a.code] ? '<span class="pill info">ไม่ใส่ในไฟล์</span>' : n ? '<span class="pill ok">' + n + ' รูป</span>' : '<span class="pill warn">ยังไม่มีรูป</span>') +
        '<label class="small"><input type="checkbox" data-excl="' + a.code + '"' + (ex[a.code] ? ' checked' : '') + '> ไม่ใส่สไลด์นี้</label></div>' +
        '<div class="work"><div data-prev="' + a.code + '">' + slideHtml(spec) + '</div><div>' +
        unitHtml +
        '<div class="kv" style="margin:12px 0"><div>ปริมาณรวม</div><div>' + qtyTxt + '</div><div>ค่าใช้จ่ายรวม</div><div><b>' + RE.fmt(a.total) + '</b> บาท</div>' +
        '<div>Unit Cost</div><div>' + ucTxt + '</div></div>' +
        (subPh.length && n < RE.MAX_PHOTOS ? '<button class="btn btn-sm" style="margin-bottom:8px" data-pullsub="' + a.code + '">ดึงรูปจากสไลด์รายรหัสย่อย (' + subPh.length + ' รูป)</button>' : '') +
        '<div class="drop small" data-pdrop="' + slot + '"><b>+ เพิ่มรูป</b> ลากมาวาง หรือคลิกเลือก (แนะนำ 4 รูป สูงสุด 6)</div>' +
        thumbsHtml(slot) + layoutSelectHtml(slot, n, spec.layout) + '</div></div></div>';
    });
    h += '<datalist id="unitList"><option>ตร.ม.</option><option>ม.</option><option>ต้น</option><option>จุด</option><option>แห่ง</option><option>ลบ.ม.</option><option>ตัน</option><option>ชุด</option><option>ป้าย</option><option>งาน</option></datalist>';
    p.innerHTML = h;
    bindSlideClicks(p);
    bindThumbs(p);
    bindLayoutSelects(p);
    $$('[data-pdrop]', p).forEach(function (d) { bindDrop(d, 'image/*', true, function (files) { addPhotos(files, d.getAttribute('data-pdrop')); }); });
    $$('[data-excl]', p).forEach(function (c) {
      c.onchange = function () { const e2 = Object.assign({}, rep().exclude || {}); e2[c.getAttribute('data-excl')] = c.checked; run(function () { return saveReport({ exclude: e2 }); }); };
    });
    $$('[data-merge]', p).forEach(function (c) {
      c.onchange = function () {
        const m2 = Object.assign({}, rep().merge || {});
        m2[c.getAttribute('data-merge')] = c.checked;
        run(function () { return saveReport({ merge: m2 }); }, c.checked ? 'รวมเป็นสไลด์เดียวแล้ว' : 'แยกสไลด์รายรหัสแล้ว');
      };
    });
    // ย้ายรูปจากสไลด์รายรหัสย่อยมาไว้สไลด์รวม (ตามลำดับเดิม ไม่เกินจำนวนรูปสูงสุด)
    $$('[data-pullsub]', p).forEach(function (b) {
      b.onclick = function () {
        const a = shown.find(function (x) { return x.code === b.getAttribute('data-pullsub'); });
        if (!a) return;
        const slot = 'work:' + a.code, cur = photosOf(slot);
        const room = RE.MAX_PHOTOS - cur.length;
        const src = a.subs.reduce(function (s, c) { return s.concat(photosOf('work:' + c)); }, []).slice(0, room);
        if (!src.length) return;
        let order = cur.reduce(function (m, x) { return Math.max(m, x.order || 0); }, 0);
        const ops = src.map(function (x) { return { op: 'set', col: 'photos', id: x.__id, data: { slot: slot, order: ++order }, merge: true }; });
        run(function () { return FBL.commit(ops); }, 'ย้ายรูปมาไว้สไลด์รวมแล้ว ' + src.length + ' รูป');
      };
    });
    $$('[data-unit]', p).forEach(function (inp) {
      inp.onchange = function () {
        const u = Object.assign({}, rep().units || {});
        u[inp.getAttribute('data-unit')] = inp.value.trim();
        run(function () { return saveReport({ units: u }); });
      };
    });
  }

  /* ======================================================================
     ③ ปก & ปัญหาอุปสรรค
     ====================================================================== */
  function coverSpec() {
    const c = photosOf('cover')[0];
    return RE.slideCover({ mk: S.mk, meetingText: rep().meetingText, orgText: rep().orgText, cover: c ? photoSpec(c) : null, logo: settings().logo });
  }
  // ตรากรมทางหลวง: ย่อให้ไม่เกิน 600 px วางกลางผืนสี่เหลี่ยมจัตุรัสพื้นโปร่งใส (กรอบบนปกเป็นจัตุรัส รูปไม่ถูกยืด)
  // เก็บเป็น PNG (คงพื้นโปร่งใส) — ถ้าใหญ่เกินที่เอกสาร Firestore รับได้ (~1 MB) ย่อลงอีก
  function logoDataUrl(file) {
    return new Promise(function (res, rej) {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        let side = Math.min(600, Math.max(im.naturalWidth, im.naturalHeight));
        for (let i = 0; i < 5; i++) {
          const c = document.createElement('canvas');
          c.width = c.height = side;
          const k = side / Math.max(im.naturalWidth, im.naturalHeight);
          const w = im.naturalWidth * k, h = im.naturalHeight * k;
          c.getContext('2d').drawImage(im, (side - w) / 2, (side - h) / 2, w, h);
          const d = c.toDataURL('image/png');
          if (d.length < 700000) { res(d); return; }
          side = Math.round(side * 0.75);
        }
        rej(new Error('ไฟล์ตรามีรายละเอียดมากเกินไป — ลองใช้ไฟล์ PNG/JPG ที่เล็กลง'));
      };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('เปิดไฟล์รูปนี้ไม่ได้ — ใช้ไฟล์ PNG หรือ JPG')); };
      im.src = url;
    });
  }
  // ช่องตรากรมทางหลวง (หน้า ③) — เปลี่ยนได้เฉพาะเจ้าของระบบ/ผู้ดูแลระบบ (กฎ config/settings)
  function logoHtml() {
    const st = settings();
    const img = '<img src="' + esc(st.logo || 'assets/cover-logo.png') + '" alt="ตรากรมทางหลวง" style="width:64px;height:64px;object-fit:contain;flex:none">';
    const info = st.logo
      ? 'ใช้ตราที่อัปโหลด' + (st.logoName ? ' (' + esc(st.logoName) + ')' : '') + (st.logoBy ? '<br>โดย ' + esc(st.logoBy) : '')
      : 'ใช้ตราเดิม (จากรายงานเดือน มิ.ย. 69)';
    let h = '<label class="f" style="margin-top:14px">ตรากรมทางหลวง (หน้าปก + มุมซ้ายบนทุกสไลด์ ใช้ทุกเดือน)</label>' +
      '<div class="row" style="align-items:center;gap:10px;flex-wrap:nowrap">' + img + '<div class="small muted">' + info + '</div></div>';
    if (!FBL.isPrivileged()) return h + '<p class="small muted">เปลี่ยนตราได้เฉพาะเจ้าของระบบหรือผู้ดูแลระบบ</p>';
    h += '<div class="drop small" id="logoDrop" style="margin-top:8px"><b>อัปโหลดตรากรมทางหลวง</b> — ลากไฟล์มาวาง หรือคลิกเลือก (แนะนำ PNG พื้นโปร่งใส)</div>';
    if (st.logo) h += '<button class="btn btn-sm" id="logoReset">ใช้ตราเดิม</button>';
    return h;
  }
  function uploadLogo(files) {
    const f = files.filter(function (x) { return /^image\//.test(x.type); })[0];
    if (!f) { toast('เลือกไฟล์รูปภาพ (PNG หรือ JPG)', 'err'); return; }
    run(async function () {
      const d = await logoDataUrl(f);
      await FBL.set('config', 'settings', { logo: d, logoName: f.name, logoAt: FBL.nowIso(), logoBy: FBL.user.name }, true);
    }, 'บันทึกตรากรมทางหลวงแล้ว — ใช้กับทุกสไลด์ทุกเดือน');
  }
  function problemSpecs(pr) {
    const pts = pr.points || [];
    const pages = Math.max(1, Math.ceil(pts.length / 3));
    const out = [];
    for (let k = 0; k < pages; k++) {
      const sub = pts.slice(k * 3, k * 3 + 3);
      const phs = sub.map(function (pt) { return photosOf('prob:' + pr.id + ':' + pt.id).map(photoSpec); });
      const ch = sub.map(function (pt, i) { return validChoice((rep().layouts || {})['prob:' + pr.id + ':' + pt.id], phs[i].length); });
      out.push(RE.slideProblem(pr, sub, phs, ch, k + 1, pages));
    }
    return out;
  }
  function routeOptions(sel) {
    let list = [];
    try { if (window.CNMaster) list = CNMaster.routes(); } catch (e) { /* ข้าม */ }
    const seen = {};
    let h = '<option value="">— ไม่ระบุสายทาง —</option>';
    list.slice().sort(function (a, b) { return parseFloat(a.highway) - parseFloat(b.highway); }).forEach(function (r) {
      const v = r.highway + '|' + (r.controlNo || '');
      if (seen[v]) return; seen[v] = 1;
      h += '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>ทล.' + esc(r.highway) + ' ตอน ' + esc(r.section || r.controlNo) + (r.status === 'transferred' ? ' (โอนแล้ว)' : '') + '</option>';
    });
    if (sel && !seen[sel]) h += '<option value="' + esc(sel) + '" selected>ทล.' + esc(sel.split('|')[0]) + '</option>';
    return h;
  }
  function renderCover() {
    const p = $('[data-panel="cover"]');
    const r = rep();
    let h = '<div class="card"><div class="card-head"><h2>หน้าปก</h2></div><div class="work"><div id="coverPrev"></div><div>' +
      '<label class="f">ข้อความบรรทัดล่าง</label><input type="text" id="meetingText" placeholder="การประชุมประจำเดือน ' + esc(RE.mkLabel(S.mk)) + '" value="' + esc(r.meetingText || '') + '">' +
      '<label class="f" style="margin-top:10px">ข้อความบรรทัดบน</label><input type="text" id="orgText" placeholder="แขวงทางหลวงระยอง" value="' + esc(r.orgText || '') + '">' +
      '<label class="f" style="margin-top:14px">รูปหน้าปก</label><div class="drop small" data-pdrop-cover="1"><b>เปลี่ยนรูปปก</b> — ลากรูปมาวาง หรือคลิกเลือก (ใช้รูปแนวนอน)</div>' +
      (photosOf('cover').length ? thumbsHtml('cover') + '<button class="btn btn-sm" id="coverReset">ใช้รูปปกเริ่มต้น</button>' : '<p class="small muted">ตอนนี้ใช้รูปปกเริ่มต้น (ภาพถนนจากรายงานเดิม)</p>') +
      logoHtml() + '</div></div></div>';

    h += '<div class="card"><div class="card-head"><h2>ปัญหา อุปสรรค</h2><div class="sp"></div><button class="btn btn-primary" id="addProb">+ เพิ่มเรื่องปัญหา/ความเสียหาย</button></div>' +
      '<p class="small muted" style="margin-top:0">กรอกเป็นช่อง ระบบเรียงข้อความบนสไลด์ให้ เช่น "กม.14+100 ด้านขวาทาง / ไหล่ทาง ถูกน้ำกัดเซาะ / ความยาว 12.00 ม. / ลึก 3.00 ม." — สไลด์ละ 3 จุด เกินกว่านั้นแยกสไลด์ให้อัตโนมัติ</p>';
    const probs = problems();
    if (!probs.length) h += '<div class="empty small">เดือนนี้ยังไม่มีเรื่องปัญหาอุปสรรค (ถ้าไม่มี จะไม่มีสไลด์หน้านี้ในไฟล์)</div>';
    probs.forEach(function (pr, pi) {
      const t = RE.problemTitles(pr);
      h += '<div class="prob" data-pid="' + pr.id + '"><div class="row" style="margin-bottom:10px"><h3 style="flex:1">เรื่องที่ ' + (pi + 1) + ': ' + esc(t[0]) + '</h3>' +
        '<button class="btn btn-sm btn-danger" data-delprob="' + pr.id + '">ลบเรื่องนี้</button></div>' +
        '<div class="fgrid"><div><label class="f">ประเภท</label><select data-pf="kind">' + RE.PROBLEM_KINDS.map(function (k) { return '<option' + (k === pr.kind ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></div>' +
        '<div class="w2"><label class="f">สายทาง</label><select data-pf="routeSel">' + routeOptions(pr.route ? pr.route + '|' + (pr.ctrl || '') : '') + '</select></div>' +
        '<div class="w2"><label class="f">ชื่อตอน (เติมให้อัตโนมัติ แก้ได้)</label><input type="text" data-pf="section" value="' + esc(pr.section || '') + '"></div>' +
        '<div class="w2" style="grid-column:1/-1"><label class="f">หัวเรื่อง (เว้นว่าง = ใช้ตามประเภท)</label><input type="text" data-pf="title" placeholder="' + esc(RE.problemTitles(Object.assign({}, pr, { title: '' }))[0]) + '" value="' + esc(pr.title || '') + '"></div></div>';
      (pr.points || []).forEach(function (pt, k) {
        const slot = 'prob:' + pr.id + ':' + pt.id;
        const n = photosOf(slot).length;
        h += '<div class="pt" data-ptid="' + pt.id + '"><div class="row"><b style="flex:1">จุดที่ ' + (k + 1) + '</b><button class="btn btn-icon btn-danger" data-delpt="' + pt.id + '">ลบจุดนี้</button></div>' +
          '<div class="fgrid" style="margin-top:6px">' +
          '<div><label class="f">กม.</label><input type="text" data-tf="km" placeholder="14+100" value="' + esc(pt.km || '') + '"></div>' +
          '<div><label class="f">ตำแหน่ง</label><select data-tf="side">' + ['ด้านซ้ายทาง', 'ด้านขวาทาง', 'ทั้งสองด้าน', 'กลางทาง', ''].map(function (s) { return '<option value="' + s + '"' + (s === (pt.side || '') ? ' selected' : '') + '>' + (s || '— ไม่ระบุ —') + '</option>'; }).join('') + '</select></div>' +
          '<div><label class="f">สิ่งที่เสียหาย</label><input type="text" list="objList" data-tf="object" placeholder="ไหล่ทาง" value="' + esc(pt.object || '') + '"></div>' +
          '<div><label class="f">ลักษณะความเสียหาย</label><input type="text" list="dmgList" data-tf="damage" placeholder="ถูกน้ำกัดเซาะ" value="' + esc(pt.damage || '') + '"></div>' +
          '<div><label class="f">ความยาว (ม.)</label><input type="number" step="0.01" min="0" data-tf="length" value="' + esc(pt.length == null ? '' : pt.length) + '"></div>' +
          '<div><label class="f">ความกว้าง (ม.)</label><input type="number" step="0.01" min="0" data-tf="width" value="' + esc(pt.width == null ? '' : pt.width) + '"></div>' +
          '<div><label class="f">ความลึก (ม.)</label><input type="number" step="0.01" min="0" data-tf="depth" value="' + esc(pt.depth == null ? '' : pt.depth) + '"></div>' +
          '<div class="w2"><label class="f">หมายเหตุเพิ่มเติม</label><input type="text" data-tf="extra" value="' + esc(pt.extra || '') + '"></div></div>' +
          '<div class="drop small" style="margin-top:8px" data-pdrop="' + slot + '"><b>+ รูปของจุดนี้</b> (แนะนำ 2 รูป: ภาพรวม + ภาพระยะใกล้)</div>' + thumbsHtml(slot) + layoutSelectHtml(slot, n, { name: '' }) + '</div>';
      });
      h += '<div style="margin-top:12px"><button class="btn btn-sm" data-addpt="' + pr.id + '">+ เพิ่มจุดความเสียหาย</button></div>' +
        '<div class="grid2" style="margin-top:14px" data-probprev="' + pr.id + '"></div></div>';
    });
    h += '<datalist id="objList"><option>ไหล่ทาง</option><option>ผิวจราจร</option><option>ลาดคันทาง</option><option>สะพาน</option><option>คอสะพาน</option><option>ท่อลอดเหลี่ยม</option><option>ท่อกลม</option><option>รางระบายน้ำ</option><option>ราวกันอันตราย</option><option>เกาะกลาง</option><option>ทางเท้า</option></datalist>' +
      '<datalist id="dmgList"><option>ถูกน้ำกัดเซาะ</option><option>ทรุดตัว</option><option>ดินสไลด์</option><option>น้ำท่วมขัง</option><option>พังเสียหาย</option><option>แตกร้าว</option><option>ต้นไม้ล้มทับ</option></datalist></div>';
    p.innerHTML = h;
    renderCoverPreview();
    renderProblemPreviews();

    const saveCoverText = debounce(function () { run(function () { return saveReport({ meetingText: $('#meetingText').value.trim(), orgText: $('#orgText').value.trim() }); }); }, 700);
    $('#meetingText').oninput = function () { liveCover(); saveCoverText(); };
    $('#orgText').oninput = function () { liveCover(); saveCoverText(); };
    bindDrop($('[data-pdrop-cover]', p), 'image/*', false, function (files) { addPhotos(files, 'cover', { single: true }); });
    if ($('#coverReset')) $('#coverReset').onclick = function () { run(function () { return FBL.deletePhotos(photosOf('cover').map(function (x) { return x.__id; })); }); };
    if ($('#logoDrop')) bindDrop($('#logoDrop'), 'image/*', false, uploadLogo);
    if ($('#logoReset')) $('#logoReset').onclick = async function () {
      if (await confirmBox('กลับไปใช้ตรากรมทางหลวงเดิม?', '<p>ตราที่อัปโหลดไว้จะถูกลบ มีผลกับหน้าปกทุกเดือน</p>', 'ใช้ตราเดิม'))
        run(function () { return FBL.set('config', 'settings', { logo: '', logoName: '', logoAt: FBL.nowIso(), logoBy: FBL.user.name }, true); }, 'กลับไปใช้ตราเดิมแล้ว');
    };
    $$('[data-pdrop]', p).forEach(function (d) { bindDrop(d, 'image/*', true, function (files) { addPhotos(files, d.getAttribute('data-pdrop')); }); });
    bindThumbs(p);
    bindLayoutSelects(p);

    $('#addProb').onclick = function () {
      const list = problems().slice();
      list.push({ id: FBL.randomId(8), kind: 'อุทกภัย', route: '', ctrl: '', section: '', title: '', points: [{ id: FBL.randomId(6), side: 'ด้านขวาทาง', damage: 'ถูกน้ำกัดเซาะ' }] });
      saveProblems(list, true);
    };
    $$('[data-delprob]', p).forEach(function (b) {
      b.onclick = async function () {
        const pid = b.getAttribute('data-delprob');
        if (!await confirmBox('ลบเรื่องปัญหานี้?', '<p>รวมถึงรูปทั้งหมดของเรื่องนี้</p>', 'ลบ', true)) return;
        const ids = S.photos.filter(function (x) { return x.mk === S.mk && String(x.slot).indexOf('prob:' + pid + ':') === 0; }).map(function (x) { return x.__id; });
        if (ids.length) await run(function () { return FBL.deletePhotos(ids); });
        saveProblems(problems().filter(function (x) { return x.id !== pid; }), true);
      };
    });
    $$('[data-addpt]', p).forEach(function (b) {
      b.onclick = function () {
        const list = clone(problems());
        const pr = list.find(function (x) { return x.id === b.getAttribute('data-addpt'); });
        const last = (pr.points || [])[pr.points.length - 1] || {};
        pr.points.push({ id: FBL.randomId(6), side: last.side || 'ด้านขวาทาง', object: last.object || '', damage: last.damage || '' });
        saveProblems(list, true);
      };
    });
    $$('[data-delpt]', p).forEach(function (b) {
      b.onclick = async function () {
        const pid = b.closest('[data-pid]').getAttribute('data-pid'), ptid = b.getAttribute('data-delpt');
        const ids = photosOf('prob:' + pid + ':' + ptid).map(function (x) { return x.__id; });
        if (ids.length && !await confirmBox('ลบจุดนี้?', '<p>รูปของจุดนี้ ' + ids.length + ' รูปจะถูกลบด้วย</p>', 'ลบ', true)) return;
        if (ids.length) await run(function () { return FBL.deletePhotos(ids); });
        const list = clone(problems());
        const pr = list.find(function (x) { return x.id === pid; });
        pr.points = pr.points.filter(function (x) { return x.id !== ptid; });
        saveProblems(list, true);
      };
    });
    // แก้ไขช่องต่าง ๆ: เก็บร่างไว้ในเครื่อง อัปเดตตัวอย่างทันที แล้วบันทึกเมื่อหยุดพิมพ์
    p.addEventListener('input', onProbField);
    p.addEventListener('change', onProbField);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function onProbField(ev) {
    const el = ev.target;
    const box = el.closest('[data-pid]');
    if (!box || !(el.hasAttribute('data-pf') || el.hasAttribute('data-tf'))) return;
    const list = clone(problems());
    const pr = list.find(function (x) { return x.id === box.getAttribute('data-pid'); });
    if (!pr) return;
    if (el.hasAttribute('data-pf')) {
      const f = el.getAttribute('data-pf');
      if (f === 'routeSel') {
        const parts = el.value.split('|');
        pr.route = parts[0] || ''; pr.ctrl = parts[1] || '';
        pr.section = pr.route ? RE.sectionName(pr.route, pr.ctrl, null) : '';
        const sec = $('[data-pf="section"]', box); if (sec) sec.value = pr.section;
      } else pr[f] = el.value;
    } else {
      const pt = pr.points.find(function (x) { return x.id === el.closest('[data-ptid]').getAttribute('data-ptid'); });
      const f = el.getAttribute('data-tf');
      pt[f] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
    }
    S.probDraft = list;
    renderProblemPreviews();
    const h3 = $('h3', box);
    if (h3) h3.textContent = 'เรื่องที่ ' + (list.indexOf(pr) + 1) + ': ' + RE.problemTitles(pr)[0];
    saveProblemsLater();
  }
  let savingProblems = false;
  const saveProblemsLater = debounce(function () { saveProblems(S.probDraft, false); }, 800);
  function saveProblems(list, rerender) {
    S.probDraft = list;
    savingProblems = true;
    saveProblemsLater.flush();
    return run(function () { return saveReport({ problems: list }); }).then(function () {
      savingProblems = false;
      if (rerender) { S.probDraft = null; renderCover(); }
    });
  }
  function liveCover() {
    const spec = RE.slideCover({ mk: S.mk, meetingText: $('#meetingText').value.trim(), orgText: $('#orgText').value.trim(), cover: photosOf('cover')[0] ? photoSpec(photosOf('cover')[0]) : null, logo: settings().logo });
    $('#coverPrev').innerHTML = slideHtml(spec);
  }
  function renderCoverPreview() { const el = $('#coverPrev'); if (el) { el.innerHTML = slideHtml(coverSpec()); bindSlideClicks(el); } }
  function renderProblemPreviews() {
    problems().forEach(function (pr) {
      const el = $('[data-probprev="' + pr.id + '"]');
      if (!el) return;
      el.innerHTML = problemSpecs(pr).map(slideHtml).join('');
      bindSlideClicks(el);
    });
  }

  /* ======================================================================
     ④ แผน-ผล
     ====================================================================== */
  function readPlanForm(fy) {
    const base = clone(planOf(fy) || {});
    const p = $('[data-panel="plan"]');
    if (!$('[data-pg]', p)) return base;
    base.groups = {}; base.carryGroups = {}; base.pct = []; base.carryCum = [];
    $$('[data-pg]', p).forEach(function (i) { base.groups[i.getAttribute('data-pg')] = numIn(i.value); });
    $$('[data-cg]', p).forEach(function (i) { base.carryGroups[i.getAttribute('data-cg')] = numIn(i.value); });
    $$('[data-pct]', p).forEach(function (i) { base.pct[Number(i.getAttribute('data-pct'))] = i.value === '' ? null : Number(i.value); });
    $$('[data-cc]', p).forEach(function (i) { base.carryCum[Number(i.getAttribute('data-cc'))] = i.value === '' ? null : numIn(i.value); });
    base.carryMk = $('#carryMk').value;
    return base;
  }
  function numIn(v) { const n = Number(String(v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function renderPlan() {
    const p = $('[data-panel="plan"]');
    const fy = RE.fyOf(S.mk);
    const plan = planOf(fy) || {};
    const can = FBL.isPrivileged();
    const dis = can ? '' : ' disabled';
    const months = RE.fyMonths(fy);
    const carryIdx = plan.carryMk ? RE.fyIndex(plan.carryMk) : -1;
    const cum = RE.cumulative(plan, S.records, S.mk);
    let h = '<div class="card"><div class="card-head"><h2>แผนงบประมาณบำรุงปกติ ปีงบประมาณ ' + fy + '</h2><div class="sp"></div>' +
      (can ? '<button class="btn btn-primary" id="savePlan">บันทึกแผน</button>' : '<span class="pill info">แก้ไขได้เฉพาะเจ้าของระบบ/ผู้ดูแลระบบ</span>') + '</div>' +
      (can ? '<div class="drop" id="planDrop" style="margin-bottom:14px"><b>นำเข้าไฟล์รายงานแผน-ผลจากระบบของแขวง (เช่น report01.csv)</b><br><span class="small muted">ระบบจะกรอกแผน และผลสะสมถึงเดือน ' + esc(RE.mkLabel(S.mk)) + ' ตามกลุ่มงานให้อัตโนมัติ</span></div>' : '') +
      '<div class="grid2"><div><h3 style="margin-bottom:8px">แผนและผลตามกลุ่มงาน</h3><div class="tbl-wrap"><table class="tbl"><tr><th>กลุ่มงาน</th><th class="num">แผน (บาท)</th><th class="num">ผลสะสมยกมา</th><th class="num">ผลสะสม ณ ' + esc(RE.mkShort(S.mk)) + '</th></tr>';
    RE.GROUPS.forEach(function (g) {
      h += '<tr><td><span class="pill" style="background:#' + g.color + ';color:#fff">' + g.code + '</span> ' + esc(g.name) + '</td>' +
        '<td><input type="text" inputmode="decimal" class="num" data-pg="' + g.code + '" value="' + esc(fmtIn((plan.groups || {})[g.code])) + '"' + dis + '></td>' +
        '<td><input type="text" inputmode="decimal" class="num" data-cg="' + g.code + '" value="' + esc(fmtIn((plan.carryGroups || {})[g.code])) + '"' + (can && carryIdx >= 0 ? '' : ' disabled') + '></td>' +
        '<td class="num" data-res="' + g.code + '">' + RE.fmt(cum.groups[g.code] || 0) + '</td></tr>';
    });
    h += '<tr class="tot"><td>รวม</td><td class="num" id="planTot">' + RE.fmt(cum.planTotal) + '</td><td></td><td class="num" id="resTot">' + RE.fmt(cum.resultTotal) + '</td></tr></table></div>' +
      '<div style="margin-top:14px"><label class="f">ข้อมูลก่อนเริ่มใช้ระบบนี้: มีผลสะสมจากระบบแขวงถึงเดือน</label><select id="carryMk"' + dis + '><option value="">ไม่มี — เริ่มใช้ระบบตั้งแต่ ต.ค. (ต้นปีงบ)</option>' +
      months.map(function (m) { return '<option value="' + m + '"' + (m === plan.carryMk ? ' selected' : '') + '>' + RE.mkLabel(m) + '</option>'; }).join('') + '</select>' +
      '<p class="small muted">ถ้าเริ่มใช้ระบบกลางปีงบ ให้เลือกเดือนสุดท้ายที่ยังไม่ได้นำเข้า CSV แล้วกรอก "ผลสะสมยกมา" รายกลุ่ม และผลสะสมรายเดือน (จากระบบของแขวง) — เดือนหลังจากนั้นระบบคำนวณจาก CSV ที่นำเข้าเอง</p></div></div>' +
      '<div><h3 style="margin-bottom:8px">แผน-ผลสะสมรายเดือน (ใช้ทำกราฟความก้าวหน้า)</h3><div class="tbl-wrap"><table class="tbl"><tr><th>เดือน</th><th class="num">แผนสะสม (%)</th><th class="num">ผลสะสม (บาท)</th><th class="num">ผล (%)</th></tr>';
    months.forEach(function (m, i) {
      const manual = i <= carryIdx;
      const v = cum.cum[i];
      h += '<tr><td>' + esc(RE.mkShort(m)) + '</td><td><input type="number" step="0.01" class="num" style="width:110px" data-pct="' + i + '" value="' + esc(((plan.pct || [])[i] == null ? '' : plan.pct[i])) + '"' + dis + '></td>' +
        '<td class="num">' + (manual ? '<input type="text" inputmode="decimal" class="num" data-cc="' + i + '" value="' + esc(fmtIn((plan.carryCum || [])[i])) + '"' + dis + '>' : (v == null ? '<span class="muted">—</span>' : RE.fmt(v))) + '</td>' +
        '<td class="num">' + (v == null || !cum.planTotal ? '—' : RE.fmt(v / cum.planTotal * 100)) + '</td></tr>';
    });
    h += '</table></div><p class="small muted">แผนสะสม (%) ให้กรอกตามแผนการใช้จ่ายของแขวง (เส้นสีส้มในกราฟ)</p></div></div></div>' +
      '<div class="grid2"><div class="card"><h3 style="margin-bottom:10px">ตัวอย่าง: แผน-ผล ตามรหัสงาน</h3><div id="planPrev1"></div></div>' +
      '<div class="card"><h3 style="margin-bottom:10px">ตัวอย่าง: ความก้าวหน้าการใช้งบประมาณ</h3><div id="planPrev2"></div>' +
      '<div class="drop small" style="margin-top:10px" data-pdrop-budget="1"><b>+ เพิ่มรูปกราฟ</b> — แคปกราฟจากระบบของกรมแล้วลากมาวาง หรือคลิกเลือก (รูปใหม่จะแทนรูปเดิม)</div>' +
      (photosOf('budget').length ? thumbsHtml('budget') : '') +
      '<label class="f" style="margin-top:12px">ข้อความใต้กราฟ บรรทัดที่ 1 (ระบบอ่านจากรูปให้ แก้ได้)</label><input type="text" id="budgetLine1" value="' + esc(rep().budgetLine1 || '') + '">' +
      '<label class="f" style="margin-top:8px">บรรทัดที่ 2</label><input type="text" id="budgetLine2" value="' + esc(rep().budgetLine2 || '') + '">' +
      '</div></div>';
    p.innerHTML = h;
    bindThumbs(p);
    bindDrop($('[data-pdrop-budget]', p), 'image/*', false, addBudgetImage);
    const saveLines = debounce(function () { run(function () { return saveReport({ budgetLine1: $('#budgetLine1').value.trim(), budgetLine2: $('#budgetLine2').value.trim() }); }); }, 700);
    $('#budgetLine1').addEventListener('input', saveLines);
    $('#budgetLine2').addEventListener('input', saveLines);
    renderPlanPreview();
    p.oninput = function () { renderPlanPreview(); };
    $('#carryMk').onchange = function () {
      const d = readPlanForm(fy);
      run(function () { return FBL.set('plans', String(fy), Object.assign(d, { fy: fy, updatedAt: FBL.nowIso(), updatedBy: FBL.user.name })); }).then(renderPlan);
    };
    if ($('#savePlan')) $('#savePlan').onclick = function () {
      const d = readPlanForm(fy);
      run(function () { return FBL.set('plans', String(fy), Object.assign(d, { fy: fy, updatedAt: FBL.nowIso(), updatedBy: FBL.user.name })); }, 'บันทึกแผนแล้ว').then(renderPlan);
    };
    if ($('#planDrop')) bindDrop($('#planDrop'), '.csv,text/csv', false, importPlanReport);
  }
  // นำเข้ารายงานแผน-ผลของแขวง: แผน → แผนรายกลุ่ม, ผล → "ผลสะสมยกมา" ถึงเดือนที่เลือกอยู่
  // (เดือนถัดไประบบคำนวณต่อจาก Export_CSV ที่นำเข้าในแท็บ ①)
  async function importPlanReport(files) {
    const f = files.filter(function (x) { return /\.csv$/i.test(x.name); })[0];
    if (!f) { toast('ไม่พบไฟล์ .csv', 'err'); return; }
    let r;
    try { r = RE.parsePlanReport(await RE.decodeFile(f)); } catch (e) { toast(e.message || String(e), 'err'); return; }
    const fy = RE.fyOf(S.mk), upto = RE.fyIndex(S.mk);
    const warn = [];
    ['plan', 'result'].forEach(function (k) {
      const t = r.fileTotal[k], mine = k === 'plan' ? r.planTotal : r.resultTotal;
      if (t != null && Math.abs(t - mine) > 1) warn.push('ยอด' + (k === 'plan' ? 'แผน' : 'ผล') + 'รวมกลุ่มงาน ' + RE.fmt(mine) + ' ไม่ตรงกับแถว "รวม" ในไฟล์ ' + RE.fmt(t));
    });
    const csvMonths = RE.fyMonths(fy).slice(0, upto + 1).filter(function (m) { return S.records.some(function (x) { return x.mk === m; }); });
    let h = '<p>ไฟล์ <b>' + esc(f.name) + '</b> — ผลในไฟล์จะถือเป็น <b>ผลสะสมตั้งแต่ ต.ค. ถึง ' + esc(RE.mkLabel(S.mk)) + '</b> (ปีงบ ' + fy + ')</p>' +
      '<div class="tbl-wrap"><table class="tbl"><tr><th>กลุ่มงาน</th><th class="num">แผน (บาท)</th><th class="num">ผลสะสม (บาท)</th><th class="num">ผล/แผน</th></tr>';
    RE.GROUPS.forEach(function (g) {
      const pv = r.plan[g.code], rv = r.result[g.code];
      h += '<tr><td>' + g.code + ' ' + esc(g.name) + '</td><td class="num">' + RE.fmt(pv) + '</td><td class="num">' + RE.fmt(rv) + '</td><td class="num">' + (pv ? RE.fmt(rv / pv * 100) + '%' : '—') + '</td></tr>';
    });
    h += '<tr class="tot"><td>รวม</td><td class="num">' + RE.fmt(r.planTotal) + '</td><td class="num">' + RE.fmt(r.resultTotal) + '</td><td class="num">' + (r.planTotal ? RE.fmt(r.resultTotal / r.planTotal * 100) + '%' : '—') + '</td></tr></table></div>';
    if (warn.length) h += '<p class="small" style="color:#B03A2E">⚠ ' + warn.map(esc).join('<br>⚠ ') + '</p>';
    h += '<p class="small muted">ถ้าไฟล์นี้ไม่ใช่ข้อมูลถึงเดือน ' + esc(RE.mkLabel(S.mk)) + ' ให้กดยกเลิก แล้วเปลี่ยนเดือนด้านบนก่อน · แผนสะสม (%) รายเดือนที่กรอกไว้จะคงเดิม</p>';
    if (csvMonths.length) h += '<p class="small muted">เดือน ' + csvMonths.map(RE.mkShort).join(', ') + ' มีผลงานจาก Export_CSV อยู่แล้ว — ยอดแผน-ผลจะใช้ตัวเลขจากไฟล์นี้แทน (ข้อมูลผลงานรายไฟล์ไม่ถูกลบ)</p>';
    if (!await modal({ title: 'นำเข้ารายงานแผน-ผล', html: h, ok: 'บันทึกแผน-ผล', wide: true })) return;
    const d = readPlanForm(fy);
    d.groups = r.plan;
    d.carryMk = S.mk;
    d.carryGroups = r.result;
    // Firestore ไม่รับช่องว่าง (undefined) ในอาร์เรย์ — เติม null ให้ครบทุกเดือนถึงเดือนนี้
    const oldCum = d.carryCum || [];
    d.carryCum = [];
    for (let i = 0; i <= upto; i++) d.carryCum.push(i === upto ? r.resultTotal : (oldCum[i] == null ? null : oldCum[i]));
    d.pct = (d.pct || []).slice(0, 12);
    for (let i = 0; i < 12; i++) if (d.pct[i] === undefined || (typeof d.pct[i] === 'number' && !isFinite(d.pct[i]))) d.pct[i] = null;
    d.planSource = { file: f.name, mk: S.mk, importedAt: FBL.nowIso(), importedBy: FBL.user.name };
    run(function () { return FBL.set('plans', String(fy), Object.assign(d, { fy: fy, updatedAt: FBL.nowIso(), updatedBy: FBL.user.name })); }, 'อัปเดตแผน-ผลจากไฟล์แล้ว').then(renderPlan);
  }
  function budgetImg() { const b = photosOf('budget')[0]; return b ? photoSpec(b) : null; }
  // ข้อความ 2 บรรทัดใต้กราฟ (เก็บในรายงานของเดือน) — ช่องที่กำลังแก้อยู่มาก่อนค่าที่บันทึกไว้
  function budgetLines() {
    const r = rep();
    return [$('#budgetLine1') ? $('#budgetLine1').value : (r.budgetLine1 || ''), $('#budgetLine2') ? $('#budgetLine2').value : (r.budgetLine2 || '')];
  }
  // ใส่รูปกราฟ: บันทึกรูป + อ่าน % แผน/ผลจากรูปแล้วกรอก 2 บรรทัดให้ (อ่านจากไฟล์ต้นฉบับที่คมกว่ารูปที่ย่อแล้ว)
  function addBudgetImage(files) {
    const f = files.filter(function (x) { return /^image\//.test(x.type) || /\.(jpe?g|png|webp)$/i.test(x.name); })[0];
    if (!f) { toast('ไม่พบไฟล์รูปภาพ', 'err'); return; }
    addPhotos([f], 'budget', { single: true });
    const t = toast('กำลังอ่านตัวเลขจากรูปกราฟ…', '', 120000);
    RE.readBudgetChart(f).then(function (v) {
      t.remove();
      if (!v) { toast('อ่านตัวเลข % แผน/ผล จากรูปไม่ได้ — พิมพ์ 2 บรรทัดใต้กราฟเองได้', 'err', 7000); return; }
      const l = RE.budgetLinesFrom(S.mk, v);
      if ($('#budgetLine1')) { $('#budgetLine1').value = l[0]; $('#budgetLine2').value = l[1]; renderPlanPreview(); }
      return saveReport({ budgetLine1: l[0], budgetLine2: l[1] }).then(function () {
        toast('อ่านได้: แผน ' + RE.fmt(v.plan) + '% · ผล ' + RE.fmt(v.result) + '% — ตรวจตัวเลขเทียบกับรูปอีกครั้ง', 'ok', 7000);
      });
    }).catch(function (e) { t.remove(); console.error(e); toast(e.message || String(e), 'err'); });
  }
  function fmtIn(v) { return v == null || v === '' ? '' : RE.fmt(v); }
  function renderPlanPreview() {
    const fy = RE.fyOf(S.mk);
    const plan = readPlanForm(fy);
    const cum = RE.cumulative(plan, S.records, S.mk);
    if ($('#planTot')) $('#planTot').textContent = RE.fmt(cum.planTotal);
    if ($('#resTot')) $('#resTot').textContent = RE.fmt(cum.resultTotal);
    RE.GROUPS.forEach(function (g) { const c = $('[data-res="' + g.code + '"]'); if (c) c.textContent = RE.fmt(cum.groups[g.code] || 0); });
    if ($('#planPrev1')) $('#planPrev1').innerHTML = slideHtml(RE.slidePlan(S.mk, plan, cum));
    if ($('#planPrev2')) $('#planPrev2').innerHTML = slideHtml(RE.slideBudget(S.mk, plan, cum, budgetImg(), budgetLines()));
  }

  /* ======================================================================
     ⑤ ส่งออก PowerPoint
     ====================================================================== */
  function buildSpecs() {
    const r = rep();
    const aggs = RE.aggregate(monthRecords());
    const fy = RE.fyOf(S.mk);
    const plan = planOf(fy);
    const cum = RE.cumulative(plan || {}, S.records, S.mk);
    const specs = [coverSpec()];
    slideAggs(aggs).forEach(function (a) {
      if ((r.exclude || {})[a.code]) return;
      specs.push(workSpec(a));
    });
    if (aggs.length) specs.push(RE.slideMonthSummary(S.mk, aggs));
    if (plan && cum.planTotal > 0) specs.push(RE.slidePlan(S.mk, plan, cum));
    if (budgetImg()) specs.push(RE.slideBudget(S.mk, plan || {}, cum, budgetImg(), budgetLines()));
    (r.problems || []).forEach(function (pr) { problemSpecs(pr).forEach(function (s) { specs.push(s); }); });
    specs.push(RE.slideEnd());
    return specs;
  }
  function defaultFileName() {
    const p = S.mk.split('-');
    return 'ม.เชิงเนิน รายงานเดือน ' + RE.MONTHS_SHORT[Number(p[1]) - 1] + ' ' + p[0].slice(2) + '.pptx';
  }
  function renderExport() {
    const p = $('[data-panel="export"]');
    const r = rep();
    const recs = monthRecords();
    const aggs = slideAggs(RE.aggregate(recs)).filter(function (a) { return !(r.exclude || {})[a.code]; });
    const noPhoto = aggs.filter(function (a) { return !photosOf('work:' + a.code).length; });
    const fy = RE.fyOf(S.mk);
    const plan = planOf(fy);
    const planOk = plan && RE.cumulative(plan, S.records, S.mk).planTotal > 0;
    const probPts = (r.problems || []).reduce(function (s, pr) { return s + (pr.points || []).length; }, 0);
    const monthPhotos = S.photos.filter(function (x) { return x.mk === S.mk; });
    const ck = function (ok, txt, warn) { return '<li>' + (ok ? '✅' : warn ? '⚠️' : '⬜') + ' ' + txt + '</li>'; };
    const specs = buildSpecs();
    let h = '<div class="card"><div class="card-head"><h2>ส่งออกไฟล์ PowerPoint · เดือน ' + esc(RE.mkLabel(S.mk)) + '</h2></div><div class="grid2"><div><ul class="check" style="list-style:none;padding:0;margin:0">' +
      ck(recs.length, 'นำเข้าผลงาน ' + recs.length + ' ไฟล์') +
      ck(!noPhoto.length, noPhoto.length ? 'รหัสงานที่ยังไม่มีรูป: ' + noPhoto.map(function (a) { return a.code; }).join(', ') : 'ทุกรหัสงานมีรูปครบ', true) +
      ck(true, photosOf('cover').length ? 'หน้าปก: ใช้รูปที่เลือก' : 'หน้าปก: ใช้รูปเริ่มต้น') +
      ck(planOk, planOk ? 'มีแผนงบประมาณปี ' + fy + ' (ใส่สไลด์สรุปแผน-ผล)' : 'ยังไม่มีแผนงบปี ' + fy + ' — ข้ามสไลด์แผน-ผล (นำเข้าได้ที่แท็บ ④)', true) +
      ck(!!budgetImg(), budgetImg() ? 'กราฟความก้าวหน้า: ใช้รูปที่ใส่ไว้' : 'ยังไม่ได้ใส่รูปกราฟความก้าวหน้า — ข้ามสไลด์นี้ (เพิ่มได้ที่แท็บ ④)', true) +
      ck(true, (r.problems || []).length ? 'ปัญหาอุปสรรค ' + r.problems.length + ' เรื่อง / ' + probPts + ' จุด' : 'ไม่มีปัญหาอุปสรรค (ไม่มีสไลด์หน้านี้)') +
      '</ul></div><div><label class="f">ชื่อไฟล์</label><input type="text" id="outName" value="' + esc(defaultFileName()) + '">' +
      '<div class="row" style="margin-top:12px"><button class="btn btn-gold" id="doExport"' + (recs.length ? '' : ' disabled') + '>⬇ ส่งออก PowerPoint (' + specs.length + ' สไลด์)</button></div>' +
      '<div id="expProg" class="hidden" style="margin-top:12px"><div class="progress"><div style="width:0"></div></div><div class="small muted" id="expTxt"></div></div>' +
      '<p class="small muted">ไฟล์ใช้ฟอนต์ Prompt เหมือนรายงานเดิม — เครื่องที่ใช้นำเสนอควรติดตั้งฟอนต์ Prompt ไว้ · กราฟในไฟล์เป็นกราฟของ PowerPoint แก้ตัวเลขต่อได้</p></div></div></div>' +
      '<div class="card"><div class="card-head"><h2>ตัวอย่างสไลด์ทั้งหมด</h2></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">' +
      specs.map(function (s, i) { return '<div><div class="small muted" style="margin-bottom:4px">' + (i + 1) + '. ' + esc(s.title) + '</div>' + slideHtml(s) + '</div>'; }).join('') + '</div></div>' +
      '<div class="card"><div class="card-head"><h2>ล้างรูปของเดือนนี้</h2></div><p>ในระบบมีรูปของเดือนนี้ <b>' + monthPhotos.length + '</b> รูป ' +
      '(ประมาณ ' + RE.fmt(monthPhotos.reduce(function (s, x) { return s + (x.size || 0); }, 0) / 1048576, 1) + ' MB) — เมื่อส่งออกและนำเสนอเรียบร้อยแล้วลบได้ หรือระบบจะถามให้ลบตอนเริ่มเดือนใหม่</p>' +
      '<button class="btn btn-danger" id="clearPhotos"' + (monthPhotos.length ? '' : ' disabled') + '>ลบรูปทั้งหมดของเดือนนี้</button></div>';
    p.innerHTML = h;
    $('#doExport').onclick = doExport;
    $('#clearPhotos').onclick = async function () {
      if (await confirmBox('ลบรูปทั้งหมดของเดือนนี้?', '<p>' + monthPhotos.length + ' รูปจะถูกลบจากระบบ — ส่งออกไฟล์ PowerPoint เก็บไว้แล้วใช่ไหม?</p><p class="small muted">ตัวเลขผลงานไม่ถูกลบ</p>', 'ลบรูป', true))
        run(function () { return FBL.deletePhotos(monthPhotos.map(function (x) { return x.__id; })); }, 'ลบรูปแล้ว');
    };
  }
  async function doExport() {
    if (S.exporting) return;
    S.exporting = true;
    const btn = $('#doExport');
    btn.disabled = true;
    $('#expProg').classList.remove('hidden');
    const specs = buildSpecs();
    const bar = $('#expProg .progress>div');
    let step = 0;
    try {
      const ids = [];
      specs.forEach(function (s) { (s.els || []).forEach(function (e) { if (e.type === 'photo' && ids.indexOf(e.id) < 0) ids.push(e.id); }); });
      if (ids.length && FBL.photoStore === 'drive') {
        $('#expTxt').textContent = 'กำลังโหลดรูป ' + ids.length + ' รูปจาก Google Drive…';
        await FBL.prefetchPhotos(ids);
      }
      const logo = settings().logo;
      const pptx = await RE.buildPptx(specs.map(function (s) { return RE.withLogo(s, logo); }), FBL.photoBytes, function (msg) {
        step++; bar.style.width = Math.min(95, step / specs.length * 95) + '%'; $('#expTxt').textContent = msg;
      });
      $('#expTxt').textContent = 'กำลังรวมไฟล์…';
      let name = $('#outName').value.trim() || defaultFileName();
      if (!/\.pptx$/i.test(name)) name += '.pptx';
      await pptx.writeFile({ fileName: name, compression: true });
      bar.style.width = '100%';
      $('#expTxt').textContent = 'เสร็จแล้ว — ไฟล์ "' + name + '" อยู่ในโฟลเดอร์ดาวน์โหลด';
      toast('ส่งออกไฟล์เรียบร้อย', 'ok');
    } catch (e) {
      console.error(e);
      $('#expTxt').textContent = 'ส่งออกไม่สำเร็จ: ' + (e.message || e);
      toast(e.message || String(e), 'err');
    } finally { S.exporting = false; btn.disabled = false; }
  }

  /* ======================================================================
     ตั้งค่า (ทีม / พื้นที่รูป)
     ====================================================================== */
  function renderSettings() {
    const p = $('[data-panel="settings"]');
    const team = FBL.team();
    const own = FBL.user.isOwner;
    let h = '<div class="card"><div class="card-head"><h2>เจ้าหน้าที่ที่ใช้ระบบ</h2></div>';
    if (FBL.demo) h += '<div class="demo-note">โหมดทดลอง — จัดการทีมได้หลังเชื่อมต่อ Firebase (ดูไฟล์ คู่มือติดตั้ง-อ่านก่อน.md)</div>';
    h += '<div class="tbl-wrap"><table class="tbl"><tr><th>ชื่อ</th><th>สิทธิ์</th><th></th></tr>' + team.map(function (t) {
      return '<tr><td>' + esc(t.name) + '</td><td>' + (t.isOwner ? '<span class="pill ok">เจ้าของระบบ</span>' : t.isAdmin ? '<span class="pill info">ผู้ดูแลระบบ</span>' : 'เจ้าหน้าที่') + '</td><td class="row" style="justify-content:flex-end">' +
        (own && !FBL.demo ? (t.isOwner ? '' : '<button class="btn btn-sm" data-adm="' + esc(t.name) + '">' + (t.isAdmin ? 'ถอดผู้ดูแล' : 'ตั้งเป็นผู้ดูแล') + '</button>') +
          '<button class="btn btn-sm" data-rpw="' + esc(t.name) + '">ตั้งรหัสผ่านใหม่</button>' + (t.isOwner ? '' : '<button class="btn btn-sm btn-danger" data-rmm="' + esc(t.name) + '">ลบ</button>') : '') + '</td></tr>';
    }).join('') + '</table></div>';
    if (own && !FBL.demo) h += '<div class="row" style="margin-top:12px"><input type="text" id="nmName" placeholder="ชื่อ-นามสกุล" style="max-width:260px"><input type="password" id="nmPw" placeholder="รหัสผ่านเริ่มต้น (6 ตัวขึ้นไป)" style="max-width:220px"><label class="small"><input type="checkbox" id="nmAdm"> ผู้ดูแลระบบ</label><button class="btn btn-primary" id="nmAdd">+ เพิ่มเจ้าหน้าที่</button></div>';
    h += '</div>';
    const byMonth = {};
    S.photos.forEach(function (x) { const m = byMonth[x.mk] = byMonth[x.mk] || { n: 0, size: 0 }; m.n++; m.size += x.size || 0; });
    h += '<div class="card"><div class="card-head"><h2>พื้นที่เก็บรูปชั่วคราว</h2></div>' +
      (Object.keys(byMonth).length ? '<table class="tbl" style="max-width:520px"><tr><th>เดือน</th><th class="num">รูป</th><th class="num">ขนาด</th><th></th></tr>' + Object.keys(byMonth).sort().map(function (m) {
        return '<tr><td>' + esc(RE.mkLabel(m)) + '</td><td class="num">' + byMonth[m].n + '</td><td class="num">' + RE.fmt(byMonth[m].size / 1048576, 1) + ' MB</td><td>' + (m === S.mk ? '<span class="small muted">เดือนปัจจุบัน</span>' : '<button class="btn btn-sm btn-danger" data-clr="' + m + '">ลบ</button>') + '</td></tr>';
      }).join('') + '</table>' : '<p class="muted">ไม่มีรูปในระบบ</p>') +
      (FBL.photoStore === 'drive'
        ? '<p class="small muted">ตัวรูปเก็บใน Google Drive (โฟลเดอร์ "ระบบรายงานประจำเดือน - รูปภาพ" แยกตามเดือน) — ลบแล้วอยู่ในถังขยะของ Drive กู้คืนได้ 30 วัน</p></div>'
        : '<p class="small muted">Firebase แผนฟรีเก็บข้อมูลได้ 1 GB — รูปเดือนละ ~50 รูป ใช้ประมาณ 25–40 MB</p></div>');
    h += '<div class="card"><div class="card-head"><h2>เกี่ยวกับระบบ</h2></div><div class="small">งานรายงานประจำเดือน หมวดทางหลวงเชิงเนิน · รุ่น 1.0 (26 ก.ย. 2569)<br>' +
      'ฐานข้อมูล: ' + (FBL.demo ? '<b>โหมดทดลอง (เก็บในเครื่องนี้)</b>' : 'Firebase Firestore') + ' · ที่เก็บรูป: ' + (FBL.photoStore === 'drive' ? 'Google Drive' : 'Firestore') + ' · สายทางจากฐานข้อมูลกลาง CN-Hub: ' + (window.CNMaster && CNMaster.routes && CNMaster.routes().length ? 'เชื่อมต่อแล้ว (' + CNMaster.routes().length + ' สาย)' : 'ยังไม่เชื่อมต่อ — ใช้ชื่อตอนสำรอง') + '</div></div>';
    p.innerHTML = h;
    $$('[data-clr]', p).forEach(function (b) {
      b.onclick = async function () {
        const m = b.getAttribute('data-clr');
        if (await confirmBox('ลบรูปของเดือน ' + RE.mkLabel(m) + '?', '', 'ลบ', true))
          run(function () { return FBL.deletePhotos(S.photos.filter(function (x) { return x.mk === m; }).map(function (x) { return x.__id; })); }, 'ลบแล้ว').then(renderSettings);
      };
    });
    if (!own || FBL.demo) return;
    $('#nmAdd').onclick = function () {
      run(function () { return FBL.addMember($('#nmName').value, $('#nmPw').value, $('#nmAdm').checked); }, 'เพิ่มเจ้าหน้าที่แล้ว').then(renderSettings);
    };
    $$('[data-adm]', p).forEach(function (b) {
      b.onclick = function () { const t = team.find(function (x) { return x.name === b.getAttribute('data-adm'); }); run(function () { return FBL.setMemberAdmin(t.name, !t.isAdmin); }, 'บันทึกแล้ว').then(renderSettings); };
    });
    $$('[data-rmm]', p).forEach(function (b) {
      b.onclick = async function () { if (await confirmBox('ลบ ' + b.getAttribute('data-rmm') + ' ออกจากทีม?', '', 'ลบ', true)) run(function () { return FBL.removeMember(b.getAttribute('data-rmm')); }, 'ลบแล้ว').then(renderSettings); };
    });
    $$('[data-rpw]', p).forEach(function (b) {
      b.onclick = async function () {
        const pw = await modal({ title: 'ตั้งรหัสผ่านใหม่ให้ ' + b.getAttribute('data-rpw'), html: '<input type="password" id="rpw" placeholder="รหัสผ่านใหม่ (6 ตัวขึ้นไป)">', ok: 'บันทึก', read: function (bg) { return $('#rpw', bg).value; } });
        if (pw) run(function () { return FBL.resetMemberPassword(b.getAttribute('data-rpw'), pw); }, 'ตั้งรหัสผ่านใหม่แล้ว');
      };
    });
  }

  initLogin();
})();
