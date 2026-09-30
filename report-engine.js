/* ==========================================================================
   report-engine.js — ตัวประมวลผลรายงานประจำเดือน (ไม่ขึ้นกับหน้าจอ)
   - อ่านไฟล์ Export_CSV จากระบบของแขวง
   - สรุปตามรหัสงาน / กลุ่มงาน / แผน-ผลสะสม
   - ประมวลผลรูป: ย่อ, ภาพย่อ, หาจุดสำคัญ (smartcrop), ตรวจมืด/เบลอ, วันที่ถ่าย
   - ตัวจัดวางรูปอัตโนมัติ (เลือกแบบที่ครอปรูปน้อยที่สุด และคงลำดับเวลาถ่าย)
   - สร้าง "แบบร่างสไลด์" ที่ใช้ร่วมกันระหว่างหน้าตัวอย่างบนเว็บ และไฟล์ PowerPoint (PptxGenJS)
   หน่วยตำแหน่งบนสไลด์เป็นนิ้ว สไลด์ขนาด 20 × 11.25 นิ้ว (เท่าไฟล์รายงานเดิม)
   ========================================================================== */
(function () {
  'use strict';
  const RE = {};
  window.RE = RE;

  RE.SLIDE_W = 20;
  RE.SLIDE_H = 11.25;
  const FONT = 'Prompt';
  const NAVY = '001A6F';
  const RED = 'F7373E';
  const INK = '1A1A1A';

  RE.MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  RE.MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  RE.GROUPS = [
    { code: '21100', name: 'งานบำรุงรักษาผิวทางฯ', color: '1F7A8C' },
    { code: '21200', name: 'งานบำรุงรักษา ทางเท้าฯ', color: '3FA796' },
    { code: '21300', name: 'งานระบบระบายน้ำ สะพานฯ', color: '9BC53D' },
    { code: '21400', name: 'งานจราจรสงเคราะห์ฯ', color: '1F4E79' },
    { code: '21500', name: 'งานภูมิทัศน์ทางหลวง', color: 'B03A2E' },
    { code: '21600', name: 'งานสนับสนุนฯ', color: 'F4B400' }
  ];
  RE.groupOf = function (code) { return String(code).slice(0, 3) + '00'; };

  // หน่วยนับสำรอง — ใช้เฉพาะตอนอ่านฐานข้อมูลกลาง CN-Hub ไม่ได้
  // (ปกติหน่วยนับมาจากฐานข้อมูลกลาง แท็บรหัสงาน: CNMaster.unitsOf(code) ซึ่ง 1 รหัสงานอาจมีหลายหน่วย)
  RE.DEFAULT_UNITS = {
    '21112': 'ตร.ม.', '21114': 'ตร.ม.', '21131': 'ตร.ม.', '21311': 'ม.', '21322': 'ตร.ม.',
    '21422': 'ม.', '21521': 'ตร.ม.', '21522': 'ตร.ม.', '21530': 'ต้น', '21570': 'ตร.ม.', '21660': 'งาน'
  };
  // ชื่อตอนควบคุมสำรอง (ใช้เมื่ออ่านฐานข้อมูลกลาง CN-Hub ไม่ได้)
  const SECTION_FALLBACK = {
    '3/0503': 'ระยอง – กะเฉด', '36/0203': 'ทับมา – ปลวกเกตุ', '3139/0100': 'บ้านแลง – หาดใหญ่',
    '3574/0202': 'บ้านค่าย – ระยอง', '3575/0100': 'ทางเข้าบ้านค่าย'
  };

  /* ---------------- ตัวเลข / ข้อความ ---------------- */
  RE.fmt = function (n, d) {
    d = d === undefined ? 2 : d;
    const v = Number(n) || 0;
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  RE.fmtQty = function (n) {
    const v = Number(n) || 0;
    return RE.fmt(v, Math.round(v) === v ? 0 : 2);
  };
  RE.mkLabel = function (mk) {
    const p = String(mk || '').split('-');
    return p.length === 2 ? RE.MONTHS[Number(p[1]) - 1] + ' ' + p[0] : String(mk || '');
  };
  // เดือนถัดไป (ธ.ค. 2569 → ม.ค. 2570) — ใช้กับหน้าปก: รายงานเดือน ส.ค. นำเข้าประชุมเดือน ก.ย.
  RE.nextMk = function (mk) {
    const p = String(mk || '').split('-').map(Number);
    if (p.length !== 2 || !p[0] || !p[1]) return String(mk || '');
    return p[1] === 12 ? (p[0] + 1) + '-01' : p[0] + '-' + String(p[1] + 1).padStart(2, '0');
  };
  RE.mkShort = function (mk) {
    const p = String(mk || '').split('-');
    return p.length === 2 ? RE.MONTHS_SHORT[Number(p[1]) - 1] + ' ' + p[0].slice(2) : String(mk || '');
  };
  RE.fyOf = function (mk) { const p = mk.split('-').map(Number); return p[1] >= 10 ? p[0] + 1 : p[0]; };
  // ลำดับเดือนในปีงบ: ต.ค. = 0 ... ก.ย. = 11
  RE.fyIndex = function (mk) { const m = Number(mk.split('-')[1]); return m >= 10 ? m - 10 : m + 2; };
  RE.fyMonths = function (fy) {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const m = i < 3 ? i + 10 : i - 2;
      const y = i < 3 ? fy - 1 : fy;
      out.push(y + '-' + String(m).padStart(2, '0'));
    }
    return out;
  };
  RE.kmToM = function (s) {
    const m = String(s || '').trim().match(/^(\d*)\+(\d+)$/);
    if (!m) { const n = Number(s); return isFinite(n) ? n * 1000 : null; }
    return (Number(m[1] || 0) * 1000) + Number(m[2]);
  };
  RE.mToKm = function (m) {
    if (m == null) return '';
    const k = Math.floor(m / 1000), r = Math.round(m - k * 1000);
    return k + '+' + String(r).padStart(3, '0');
  };

  /* ---------------- อ่าน CSV ---------------- */
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map(function (r) { return r.map(function (x) { return x.trim(); }); });
  }
  RE.parseCsv = parseCsv;

  function num(v) {
    const n = Number(String(v == null ? '' : v).replace(/,/g, '').trim());
    return isFinite(n) ? n : 0;
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  RE.decodeFile = async function (file) {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (/�/.test(text)) {
      try { text = new TextDecoder('windows-874').decode(buf); } catch (e) { /* ใช้ utf-8 ต่อ */ }
    }
    return text.replace(/^﻿/, '');
  };

  // แยกชนิดไฟล์ CSV อัตโนมัติ: 'export' = ผลการปฏิบัติงาน (Export_CSV), 'plan' = รายงานแผน-ผล (report01.csv), '' = ไม่รู้จัก
  RE.detectCsv = function (text) {
    const rows = parseCsv(text);
    if (rows.some(function (r) { return r[0] === 'รหัสงาน' && /^\d{5}$/.test(r[1] || ''); })) return 'export';
    try { RE.parsePlanReport(text); return 'plan'; } catch (e) { return ''; }
  };

  // แปลงไฟล์ Export_CSV 1 ไฟล์ → ข้อมูลผลการปฏิบัติงาน 1 รายการ
  RE.parseExport = function (text, fileName) {
    const rows = parseCsv(text);
    const find = function (label) { return rows.find(function (r) { return r[0] === label; }); };
    const last = function (label) { let f = null; rows.forEach(function (r) { if (r[0] === label) f = r; }); return f; };
    const codeRow = find('รหัสงาน');
    if (!codeRow || !/^\d{5}$/.test(codeRow[1] || '')) throw new Error('ไม่ใช่ไฟล์ผลการปฏิบัติงานจากระบบของแขวง (ไม่พบรหัสงาน)');
    const plan = find('แผนปฏิบัติการ') || [];
    const route = find('หมายเลขสายทาง') || [];
    const km = find('กม.เริ่มต้น') || [];
    const dateRow = find('วันที่ปฏิบัติงาน') || [];
    const note = find('หมายเหตุ') || [];
    const unitRow = find('รหัสหน่วยงาน') || [];
    const fyRow = find('ปีงบประมาณ') || [];

    const dates = (String(dateRow[1] || '').match(/\d{2}-\d{2}-\d{4}/g) || []).map(function (d) {
      const p = d.split('-'); return p[2] + '-' + p[1] + '-' + p[0];      // → 2569-08-28
    }).sort();

    // ตารางย่อย: แรงงาน / วัสดุ / เครื่องจักร
    function section(headLabel, stop) {
      const start = rows.findIndex(function (r) { return r[0] === headLabel; });
      if (start < 0) return [];
      const out = [];
      for (let i = start + 1; i < rows.length; i++) {
        const r = rows[i];
        if (stop(r)) break;
        if (r.every(function (x) { return x === ''; })) break;
        out.push(r);
      }
      return out;
    }
    const labor = section('แรงงาน', function (r) { return r[0] === 'รวม'; }).map(function (r) {
      return { name: r[0], rate: num(r[1]), hours: num(r[2]), amount: num(r[3]), otHours: num(r[4]), comp: num(r[5]), allowance: num(r[6]) };
    });
    const materials = section('รายการวัสดุ', function (r) { return r[3] === 'รวม'; }).map(function (r) {
      return { name: r[0], spec: r[1], unit: String(r[2] || '').trim(), price: num(r[3]), qty: num(r[4]), amount: num(r[5]), note: r[6] || '' };
    });
    const machines = section('หมายเลขเครื่องจักร', function (r) { return r[1] === 'รวม'; }).map(function (r) {
      return { no: r[0], rate: num(r[1]), hours: num(r[2]), rent: num(r[3]), fuelType: r[4] || '', fuelQty: num(r[5]), fuelPrice: num(r[6]), fuelAmount: num(r[7]) };
    });

    const val = function (label) { const r = last(label); return r ? num(r[1]) : 0; };
    const mat = round2(val('ค่าวัสดุ')), lab = round2(val('ค่าแรงงาน')), rent = round2(val('ค่าเช่าเครื่องจักร')),
      fuel = round2(val('ค่าน้ำมันเชื้อเพลิง')), comp = round2(val('ค่าตอบแทน')), misc = round2(val('ค่าใช้สอย'));

    const kmFrom = String(km[1] || '').trim(), kmTo = String(km[3] || '').trim();
    const rec = {
      file: fileName || '',
      unitCode: unitRow[1] || '', unitName: unitRow[2] || '',
      sysFy: num(fyRow[1]) || null,
      code: codeRow[1], name: String(codeRow[2] || '').trim(),
      group: RE.groupOf(codeRow[1]),
      plan: String(plan[1] || '').trim(), qty: num(plan[3]),
      route: String(route[1] || '').trim(), ctrl: String(route[3] || '').trim(),
      kmFrom: kmFrom.replace(/^\+/, '0+'), kmTo: kmTo.replace(/^\+/, '0+'),
      kmFromM: RE.kmToM(kmFrom), kmToM: RE.kmToM(kmTo),
      note: String(note[1] || '').trim(),
      dates: dates, days: num(dateRow[3]) || dates.length,
      mat: mat, lab: lab, rent: rent, fuel: fuel, comp: comp, misc: misc,
      sysTotal: round2(val('รวมเป็นเงินทั้งหมด')),
      // ยอดรวมค่าใช้จ่าย = ค่าวัสดุ + ค่าแรงงาน + ค่าเช่าเครื่องจักร + ค่าน้ำมัน (ตามที่หมวดใช้รายงาน)
      total: round2(mat + lab + rent + fuel),
      labor: labor, materials: materials, machines: machines
    };
    // เดือนที่ปฏิบัติงาน = เดือนที่มีวันทำงานมากที่สุด
    const cnt = {};
    dates.forEach(function (d) { const k = d.slice(0, 7); cnt[k] = (cnt[k] || 0) + 1; });
    rec.mk = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0] || '';
    return rec;
  };

  // รหัสเอกสารที่คงที่ต่อไฟล์เดิม (นำเข้าไฟล์เดิมซ้ำ = เขียนทับ ไม่เกิดรายการซ้ำ)
  RE.recordId = function (mk, r) {
    return [mk, r.code, r.plan || 'x', r.route, r.ctrl, r.kmFrom, r.dates[0] || ''].join('_').replace(/[^0-9A-Za-z_\-+]/g, '');
  };

  /* ---------------- ตรวจความถูกต้องก่อนนำเข้า ----------------
     ระดับ: error = ห้ามบันทึก / warn = ต้องติ๊กยืนยันก่อนบันทึก / info = แจ้งให้ทราบ
     ctx = { mk: เดือนของรายงาน, unitCode, existing: [records ในฐานข้อมูล], batch: [records ชุดที่กำลังนำเข้า] } */
  RE.UNIT_CODE = '42604';
  RE.HIDDEN_WORK_CODES = ['21660'];   // งานบริหาร — ไม่ทำสไลด์รายรหัสงาน (แต่ยังนับในยอดรวม/แผน-ผล)
  RE.validate = function (rec, ctx) {
    const out = [];
    const E = function (m) { out.push({ level: 'error', msg: m }); };
    const W = function (m) { out.push({ level: 'warn', msg: m }); };
    const I = function (m) { out.push({ level: 'info', msg: m }); };
    const unitCode = ctx.unitCode || RE.UNIT_CODE;

    if (rec.unitCode && rec.unitCode !== unitCode) E('รหัสหน่วยงาน ' + rec.unitCode + ' (' + rec.unitName + ') ไม่ใช่ของหมวด (' + unitCode + ')');
    if (!rec.dates.length) E('ไม่พบวันที่ปฏิบัติงาน');
    else if (rec.mk !== ctx.mk) E('วันที่ปฏิบัติงานเป็นเดือน ' + RE.mkLabel(rec.mk) + ' — ไม่ใช่เดือนของรายงาน (' + RE.mkLabel(ctx.mk) + ')');
    const outMonth = rec.dates.filter(function (d) { return d.slice(0, 7) !== ctx.mk; });
    if (rec.dates.length && rec.mk === ctx.mk && outMonth.length) W('มีวันที่อยู่นอกเดือนรายงาน ' + outMonth.length + ' วัน: ' + outMonth.map(thDate).join(', '));
    if (rec.sysFy && ctx.mk && rec.sysFy !== RE.fyOf(ctx.mk)) W('ปีงบประมาณในไฟล์ (' + rec.sysFy + ') ไม่ตรงกับปีงบของรายงาน (' + RE.fyOf(ctx.mk) + ')');

    const id = RE.recordId(ctx.mk, rec);
    const dupBatch = (ctx.batch || []).filter(function (b) { return b !== rec && RE.recordId(ctx.mk, b) === id; });
    if (dupBatch.length) E('ไฟล์ซ้ำกับ "' + dupBatch[0].file + '" (ข้อมูลชุดเดียวกัน)');
    if ((ctx.existing || []).some(function (x) { return x.__id === id; })) W('เคยนำเข้ารายการนี้แล้ว — บันทึกอีกครั้งจะเขียนทับของเดิม');

    // สายทาง / กม.
    if (rec.kmFromM != null && rec.kmToM != null && rec.kmFromM > rec.kmToM) W('กม.เริ่มต้น (' + rec.kmFrom + ') มากกว่า กม.สิ้นสุด (' + rec.kmTo + ')');
    try {
      if (window.CNMaster && CNMaster.routes().length) {
        const mine = CNMaster.routes().filter(function (r) { return String(r.highway) === rec.route; });
        if (!mine.length) W('ทล.' + rec.route + ' ไม่อยู่ในรายชื่อสายทางของหมวด (ฐานข้อมูลกลาง)');
        else {
          if (mine.every(function (r) { return r.status === 'transferred'; })) W('ทล.' + rec.route + ' โอนให้หมวดอื่นแล้ว');
          [['เริ่มต้น', rec.kmFromM, rec.kmFrom], ['สิ้นสุด', rec.kmToM, rec.kmTo]].forEach(function (k) {
            if (k[1] != null && !CNMaster.findRoute(rec.route, k[1])) W('กม.' + k[0] + ' ' + k[2] + ' อยู่นอกช่วง กม. ที่หมวดรับผิดชอบของ ทล.' + rec.route);
          });
        }
      }
    } catch (e) { /* ข้ามถ้าฐานกลางยังไม่พร้อม */ }
    // รหัสงานต้องมีในฐานข้อมูลกลาง (ใช้กำหนดหน่วยนับ)
    try {
      if (window.CNMaster && CNMaster.workCodes && CNMaster.workCodes().length) {
        const wc = CNMaster.findWorkCode(rec.code);
        if (!wc) W('รหัสงาน ' + rec.code + ' ไม่มีในฐานข้อมูลกลาง (แท็บรหัสงาน) — หน่วยนับจะต้องพิมพ์เอง');
        else if (!(wc.units || []).length) W('รหัสงาน ' + rec.code + ' เป็นหัวข้อหมวดในฐานข้อมูลกลาง ไม่ใช่รหัสที่ลงผลงานได้');
      }
    } catch (e) { /* ข้ามถ้าฐานกลางยังไม่พร้อม */ }

    // ตัวเลข
    if (!rec.qty) W('ปริมาณงานเป็น 0');
    if (rec.dates.length && rec.days && rec.days !== rec.dates.length) W('จำนวนวัน (' + rec.days + ') ไม่ตรงกับวันที่ที่ระบุ (' + rec.dates.length + ' วัน)');
    const sysCalc = rec.lab + rec.rent + rec.fuel + rec.comp + rec.misc;
    if (rec.sysTotal && Math.abs(sysCalc - rec.sysTotal) > 1) W('ยอด "รวมเป็นเงินทั้งหมด" ในไฟล์ (' + RE.fmt(rec.sysTotal) + ') ไม่ตรงกับผลรวมค่าใช้จ่าย (' + RE.fmt(sysCalc) + ')');
    const sumLab = rec.labor.reduce(function (s, x) { return s + x.amount; }, 0);
    if (rec.labor.length && Math.abs(sumLab - rec.lab) > 1) W('ค่าแรงรายคนรวม ' + RE.fmt(sumLab) + ' ไม่ตรงกับยอดค่าแรงงาน ' + RE.fmt(rec.lab));
    rec.labor.forEach(function (p) {
      if (rec.days && p.hours > rec.days * 8) W(p.name + ' ทำงาน ' + RE.fmt(p.hours, 0) + ' ชม. เกิน ' + rec.days + ' วัน × 8 ชม.');
      if (Math.abs(p.rate * p.hours - p.amount) > 1) W(p.name + ': อัตรา × ชั่วโมง ไม่ตรงกับจำนวนเงิน');
    });
    const names = {};
    rec.labor.forEach(function (p) { names[p.name] = (names[p.name] || 0) + 1; });
    Object.keys(names).forEach(function (n) { if (names[n] > 1) W('ชื่อแรงงานซ้ำในไฟล์: ' + n); });
    const sumMat = rec.materials.reduce(function (s, x) { return s + x.amount; }, 0);
    if (rec.materials.length && Math.abs(sumMat - rec.mat) > 1) W('รายการวัสดุรวม ' + RE.fmt(sumMat) + ' ไม่ตรงกับยอดค่าวัสดุ ' + RE.fmt(rec.mat));
    rec.materials.forEach(function (m) { if (Math.abs(m.price * m.qty - m.amount) > 1) W('วัสดุ ' + m.name + ': ราคา × ปริมาณ ไม่ตรงกับจำนวนเงิน'); });
    let sumRent = 0, sumFuel = 0;
    rec.machines.forEach(function (m) {
      sumRent += m.rent; sumFuel += m.fuelAmount;
      if (Math.abs(m.fuelQty * m.fuelPrice - m.fuelAmount) > 1) W('เครื่องจักร ' + m.no + ': ปริมาณน้ำมัน × ราคา ไม่ตรงกับจำนวนเงิน');
      if (m.fuelPrice && (m.fuelPrice < 20 || m.fuelPrice > 60)) W('เครื่องจักร ' + m.no + ': ราคาน้ำมัน ' + RE.fmt(m.fuelPrice) + ' บาท/ลิตร ผิดปกติ');
      if (rec.days && m.hours > rec.days * 10) W('เครื่องจักร ' + m.no + ' ทำงาน ' + RE.fmt(m.hours, 0) + ' ชม. มากผิดปกติสำหรับ ' + rec.days + ' วัน');
    });
    if (rec.machines.length && Math.abs(sumRent - rec.rent) > 1) W('ค่าเช่าเครื่องจักรรายคันรวมไม่ตรงกับยอดค่าเช่า');
    if (rec.machines.length && Math.abs(sumFuel - rec.fuel) > 1) W('ค่าน้ำมันรายคันรวมไม่ตรงกับยอดค่าน้ำมัน');
    if (rec.comp || rec.misc) I('มีค่าตอบแทน/ค่าใช้สอย ' + RE.fmt(rec.comp + rec.misc) + ' บาท (ไม่นับในยอดรวมรายงาน)');

    // งานซ้อนกัน: รหัสงาน + สายทางเดียวกัน, กม. ทับกัน และมีวันที่ร่วมกัน
    const pool = (ctx.batch || []).filter(function (b) { return b !== rec; })
      .concat((ctx.existing || []).filter(function (x) { return x.__id !== id && x.mk === ctx.mk; }));
    pool.forEach(function (o) {
      if (o.code !== rec.code || o.route !== rec.route) return;
      const overlapKm = rec.kmFromM != null && o.kmFromM != null && rec.kmFromM <= o.kmToM && o.kmFromM <= rec.kmToM;
      const sameDay = rec.dates.filter(function (d) { return (o.dates || []).indexOf(d) >= 0; });
      if (overlapKm && sameDay.length) W('อาจบันทึกซ้ำกับ "' + (o.file || 'รายการเดิม') + '" (ทล.' + o.route + ' กม.ทับกัน วันที่ ' + sameDay.map(thDate).join(', ') + ')');
    });
    // คนเดียวกันลงงาน 2 ไฟล์ในวันเดียวกัน
    const myNames = rec.labor.map(function (p) { return p.name; });
    pool.forEach(function (o) {
      const sameDay = rec.dates.filter(function (d) { return (o.dates || []).indexOf(d) >= 0; });
      if (!sameDay.length || o.dates.length > 1 || rec.dates.length > 1) return;    // เทียบเฉพาะงานวันเดียวที่ชัดเจน
      const both = (o.labor || []).filter(function (p) { return myNames.indexOf(p.name) >= 0; })
        .filter(function (p) { const mine = rec.labor.find(function (x) { return x.name === p.name; }); return mine.hours + p.hours > 8; });
      if (both.length) W('แรงงาน ' + both.length + ' คน (เช่น ' + both[0].name + ') ลงเวลาใน "' + (o.file || 'รายการเดิม') + '" วันเดียวกัน รวมเกิน 8 ชม.');
    });

    // Unit Cost เทียบเดือนก่อน ๆ (รหัสงานเดียวกัน)
    const hist = (ctx.existing || []).filter(function (x) { return x.code === rec.code && x.mk !== ctx.mk && x.qty > 0; });
    if (hist.length >= 2 && rec.qty > 0) {
      const avg = hist.reduce(function (s, x) { return s + x.total; }, 0) / hist.reduce(function (s, x) { return s + x.qty; }, 0);
      const uc = rec.total / rec.qty;
      if (avg > 0 && (uc > avg * 2.5 || uc < avg / 2.5)) W('Unit Cost ' + RE.fmt(uc) + ' บาท/หน่วย ' + (uc > avg ? 'สูง' : 'ต่ำ') + 'ผิดปกติ (เฉลี่ยเดือนก่อน ๆ ' + RE.fmt(avg) + ')');
    }
    return out;
  };
  function thDate(iso) { const p = iso.split('-'); return Number(p[2]) + ' ' + RE.MONTHS_SHORT[Number(p[1]) - 1]; }
  RE.thDate = thDate;

  /* ---------------- สายทาง / ตอนควบคุม ---------------- */
  RE.sectionName = function (route, ctrl, kmM) {
    try {
      if (window.CNMaster && CNMaster.routes().length) {
        const cand = CNMaster.routes().filter(function (r) { return String(r.highway) === String(route); });
        let r = cand.find(function (x) { return String(x.controlNo || '').padStart(4, '0') === String(ctrl).padStart(4, '0'); });
        if (!r && kmM != null) r = CNMaster.findRoute(route, kmM);
        if (!r) r = cand[0];
        if (r && r.section) return String(r.section).replace(/\s*-\s*/g, ' – ');
      }
    } catch (e) { /* ใช้ค่าสำรอง */ }
    return SECTION_FALLBACK[route + '/' + ctrl] || ('ตอนควบคุม ' + ctrl);
  };

  /* ---------------- สรุปตามรหัสงาน ---------------- */
  // ชื่องานแบบย่อ (ใช้แทนชื่อเต็มจากไฟล์ CSV ที่ยาวเกินไปบนสไลด์/ตาราง)
  RE.SHORT_NAMES = {
    '21422': 'งานบำรุงรักษา ราวกันอันตรายฯ',
    '21660': 'งานบริหารอำนวยการฯ'
  };
  // unitOfRec(record) → หน่วยนับของไฟล์นั้น (ไฟล์ในรหัสงานเดียวกันหน่วยต่างกันได้)
  //   ส่งมา = ได้ qtyParts (ปริมาณ/ค่าใช้จ่าย/Unit Cost แยกตามหน่วย) + sameUnit, สายทางแยกบรรทัดตามหน่วย
  //   หลายหน่วย = บวกปริมาณข้ามหน่วยไม่ได้ → qty / unitCost / perDay เป็น 0 (แสดง "-")
  RE.aggregate = function (records, unitOfRec) {
    const by = {};
    records.forEach(function (r) {
      const a = by[r.code] = by[r.code] || { code: r.code, name: RE.SHORT_NAMES[r.code] || r.name, group: r.group, qty: 0, days: 0, mat: 0, lab: 0, rent: 0, fuel: 0, total: 0, count: 0, lineMap: {}, partMap: {}, records: [] };
      const u = unitOfRec ? unitOfRec(r) : '';
      a.qty += r.qty; a.days += r.days; a.mat += r.mat; a.lab += r.lab; a.rent += r.rent; a.fuel += r.fuel; a.total += r.total; a.count++;
      a.records.push(r);
      if (u) {
        const P = a.partMap[u] = a.partMap[u] || { unit: u, qty: 0, days: 0, total: 0 };
        P.qty += r.qty; P.days += r.days; P.total += r.total;
      }
      const k = r.route + '/' + r.ctrl + (u ? '/' + u : '');
      const L = a.lineMap[k] = a.lineMap[k] || { route: r.route, ctrl: r.ctrl, fromM: r.kmFromM, toM: r.kmToM, qty: 0, unit: u };
      if (r.kmFromM != null && (L.fromM == null || r.kmFromM < L.fromM)) L.fromM = r.kmFromM;
      if (r.kmToM != null && (L.toM == null || r.kmToM > L.toM)) L.toM = r.kmToM;
      L.qty += r.qty;
    });
    return Object.keys(by).sort().map(function (code) {
      const a = by[code];
      a.lines = Object.keys(a.lineMap).map(function (k) { return a.lineMap[k]; })
        .sort(function (x, y) { return (parseFloat(x.route) - parseFloat(y.route)) || (x.fromM - y.fromM); });
      delete a.lineMap;
      ['qty', 'mat', 'lab', 'rent', 'fuel', 'total'].forEach(function (k) { a[k] = round2(a[k]); });
      a.unitCost = a.qty ? a.total / a.qty : 0;
      a.perDay = a.days ? a.qty / a.days : 0;
      if (unitOfRec) {
        a.qtyParts = Object.keys(a.partMap).map(function (u) {
          const P = a.partMap[u];
          return { unit: u, qty: round2(P.qty), days: P.days, total: round2(P.total), unitCost: P.qty ? P.total / P.qty : 0, perDay: P.days ? P.qty / P.days : 0 };
        });
        a.sameUnit = a.qtyParts.length === 1;
        if (!a.sameUnit) { a.qty = 0; a.unitCost = 0; a.perDay = 0; }
      }
      delete a.partMap;
      return a;
    });
  };
  /* ---------------- รวมรหัสย่อยเป็นสไลด์เดียวตามกลุ่มงาน (21100 – 21600) ----------------
     subs: ผลสรุปรายรหัส (จาก RE.aggregate) ที่อยู่ในกลุ่มเดียวกัน, unitOf(code) → หน่วยนับ
     คืนผลสรุปแบบเดียวกับรหัสเดียว + merged, subs, units (หน่วยนับของแต่ละรหัส), qtyParts (ปริมาณรวมแยกตามหน่วย) */
  RE.groupName = function (gcode) {
    try {
      if (window.CNMaster && CNMaster.findWorkCode) {
        const wc = CNMaster.findWorkCode(gcode);
        if (wc && wc.name) return String(wc.name).trim();
      }
    } catch (e) { /* ใช้ชื่อสำรอง */ }
    const g = RE.GROUPS.find(function (x) { return x.code === gcode; });
    return g ? g.name : '';
  };
  RE.mergeAggs = function (gcode, subs, unitOf) {
    const m = { code: gcode, name: RE.groupName(gcode), group: gcode, merged: true, subs: subs.map(function (a) { return a.code; }),
      qty: 0, days: 0, mat: 0, lab: 0, rent: 0, fuel: 0, total: 0, count: 0, records: [], lines: [], units: {} };
    const byUnit = {};
    subs.forEach(function (a) {
      const u = unitOf(a.code);
      m.units[a.code] = u;
      ['days', 'mat', 'lab', 'rent', 'fuel', 'total', 'count'].forEach(function (k) { m[k] += a[k]; });
      m.records = m.records.concat(a.records);
      a.lines.forEach(function (L) { m.lines.push(Object.assign({ code: a.code }, L, { unit: L.unit || u })); });
      // รหัสย่อยที่แยกหน่วยตามไฟล์แล้ว (มี qtyParts) ใช้ปริมาณแยกหน่วยของมัน
      (a.qtyParts || [{ unit: u, qty: a.qty, days: a.days, total: a.total }]).forEach(function (q) {
        byUnit[q.unit] = byUnit[q.unit] || { unit: q.unit, qty: 0, days: 0, total: 0 };
        byUnit[q.unit].qty += q.qty; byUnit[q.unit].days += q.days; byUnit[q.unit].total += q.total;
      });
    });
    // เรียงรายสายทางให้สายเดียวกันอยู่ติดกัน แล้วตาม กม. และรหัสงาน
    m.lines.sort(function (x, y) { return (parseFloat(x.route) - parseFloat(y.route)) || (x.fromM - y.fromM) || x.code.localeCompare(y.code); });
    ['mat', 'lab', 'rent', 'fuel', 'total'].forEach(function (k) { m[k] = round2(m[k]); });
    m.qtyParts = Object.keys(byUnit).map(function (u) {
      const b = byUnit[u];
      return { unit: u, qty: round2(b.qty), days: b.days, total: round2(b.total), unitCost: b.qty ? b.total / b.qty : 0, perDay: b.days ? b.qty / b.days : 0 };
    });
    // หน่วยเดียวกันทั้งกลุ่ม = คิด Unit Cost / ผลงานเฉลี่ยได้ · หลายหน่วย = บวกปริมาณข้ามหน่วยไม่ได้
    m.sameUnit = m.qtyParts.length === 1;
    m.qty = m.sameUnit ? m.qtyParts[0].qty : 0;
    m.unitCost = m.sameUnit && m.qty ? m.total / m.qty : 0;
    m.perDay = m.sameUnit && m.days ? m.qty / m.days : 0;
    return m;
  };

  RE.sumBy = function (records, key) { return round2(records.reduce(function (s, r) { return s + (Number(r[key]) || 0); }, 0)); };

  /* ---------------- แผน-ผลสะสม ---------------- */
  // plan = { groups:{21100: บาท}, carryMk, carryGroups:{}, carryCum:[12] (ข้อมูลเก่า — ไม่มีก็ได้) }
  // คืนค่าผลสะสมตามกลุ่ม และผลสะสมรายเดือน ถึงเดือน mk
  RE.cumulative = function (plan, allRecords, mk) {
    plan = plan || {};
    const fy = RE.fyOf(mk);
    const months = RE.fyMonths(fy);
    const carryMk = plan.carryMk && months.indexOf(plan.carryMk) >= 0 ? plan.carryMk : '';
    const upto = RE.fyIndex(mk);
    const carryIdx = carryMk ? RE.fyIndex(carryMk) : -1;
    const groups = {};
    RE.GROUPS.forEach(function (g) { groups[g.code] = carryIdx >= 0 ? (Number((plan.carryGroups || {})[g.code]) || 0) : 0; });
    const monthly = new Array(12).fill(0);
    allRecords.forEach(function (r) {
      const i = months.indexOf(r.mk);
      if (i < 0 || i <= carryIdx || i > upto) return;
      monthly[i] += r.total;
      if (groups[r.group] === undefined) groups[r.group] = 0;
      groups[r.group] += r.total;
    });
    const cum = new Array(12).fill(null);
    let run = 0;
    for (let i = 0; i <= upto; i++) {
      if (i <= carryIdx) { run = Number((plan.carryCum || [])[i]) || (i === carryIdx ? sumObj(plan.carryGroups) : run); }
      else run += monthly[i];
      cum[i] = round2(run);
    }
    const planTotal = sumObj(plan.groups);
    const resultTotal = sumObj(groups);
    return { fy: fy, months: months, upto: upto, groups: groups, planTotal: planTotal, resultTotal: round2(resultTotal), cum: cum };
  };
  function sumObj(o) { return Object.keys(o || {}).reduce(function (s, k) { return s + (Number(o[k]) || 0); }, 0); }

  // อ่านไฟล์รายงานแผน-ผลจากระบบของแขวง (เช่น report01.csv) → แผน/ผลสะสม ตามกลุ่มงาน (คอลัมน์ "งบประมาณบำรุงปกติ")
  // ใช้ตารางสรุปตามกลุ่มงาน (21100…21600) ถ้ามี ไม่มีจึงรวมจากตารางรายรหัสงาน แล้วเทียบกับแถว "รวม" ในไฟล์
  RE.parsePlanReport = function (text) {
    const rows = parseCsv(text);
    const kind = function (v) { v = String(v || '').trim(); return v === 'แผน' ? 'plan' : v === 'ผล' ? 'result' : ''; };
    const out = { plan: {}, result: {}, source: '', fileTotal: { plan: null, result: null } };
    RE.GROUPS.forEach(function (g) { out.plan[g.code] = 0; out.result[g.code] = 0; });
    rows.forEach(function (r) {
      const k = kind(r[2]);
      if (k && /^21[1-6]00$/.test(r[0])) { out[k][r[0]] += num(r[4]); out.source = 'group'; }
    });
    if (!out.source) {
      rows.forEach(function (r) {
        const m = String(r[0] || '').match(/^(21\d{3})\s*:/), k = kind(r[2]);
        if (m && k && out[k][RE.groupOf(m[1])] !== undefined) { out[k][RE.groupOf(m[1])] += num(r[4]); out.source = 'code'; }
      });
    }
    if (!out.source) throw new Error('ไฟล์นี้ไม่ใช่รายงานแผน-ผล (ไม่พบแถวรหัสงาน/กลุ่มงานที่มี "แผน" และ "ผล")');
    rows.forEach(function (r) {
      if (String(r[0]).trim() !== 'รวม') return;
      const k = kind(r[1]) || kind(r[2]);
      if (k && out.fileTotal[k] == null) out.fileTotal[k] = num(r[4]);
    });
    ['plan', 'result'].forEach(function (k) { Object.keys(out[k]).forEach(function (c) { out[k][c] = round2(out[k][c]); }); });
    out.planTotal = round2(sumObj(out.plan));
    out.resultTotal = round2(sumObj(out.result));
    return out;
  };

  /* ======================================================================
     รูปภาพ
     ====================================================================== */
  const MAX_SIDE = 2560;
  const MAX_BYTES = 1000000;   // Firestore รับเอกสารละไม่เกิน 1 MiB

  function canvasBlob(cv, q) { return new Promise(function (res) { cv.toBlob(res, 'image/jpeg', q); }); }
  async function decode(src) {
    const blob = src instanceof Blob ? src : new Blob([src], { type: 'image/jpeg' });
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch (e) {
      return await new Promise(function (res, rej) {
        const url = URL.createObjectURL(blob);
        const im = new Image();
        im.onload = function () { URL.revokeObjectURL(url); res(im); };
        im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('เปิดไฟล์รูปไม่ได้ (รองรับ JPG / PNG / WEBP)')); };
        im.src = url;
      });
    }
  }
  RE.decodeImage = decode;
  function drawScaled(img, maxSide) {
    const w0 = img.width, h0 = img.height;
    const s = Math.min(1, maxSide / Math.max(w0, h0));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w0 * s)); cv.height = Math.max(1, Math.round(h0 * s));
    const g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, cv.width, cv.height);
    return cv;
  }

  // ตรวจรูปมืด / เบลอ จากภาพย่อ (ค่าประมาณ)
  function quality(cv) {
    const g = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    const d = g.getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) { gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; sum += gray[j]; }
    const mean = sum / (w * h);
    let lsum = 0, lsq = 0, n = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      lsum += lap; lsq += lap * lap; n++;
    }
    const variance = n ? lsq / n - (lsum / n) * (lsum / n) : 0;
    const flags = [];
    if (mean < 55) flags.push('มืด');
    if (mean > 235) flags.push('สว่างจ้า');
    if (variance < 60) flags.push('อาจเบลอ');
    return { brightness: Math.round(mean), sharpness: Math.round(variance), flags: flags };
  }

  // หาจุดสำคัญของรูป (คน เครื่องจักร วัตถุเด่น) ด้วย smartcrop → จุดกึ่งกลาง 0..1
  async function focusPoint(cv) {
    if (!window.smartcrop) return { x: 0.5, y: 0.5 };
    const side = Math.min(cv.width, cv.height);
    try {
      const r = await smartcrop.crop(cv, { width: side * 0.6, height: side * 0.6, minScale: 0.5 });
      const c = r.topCrop;
      return { x: (c.x + c.width / 2) / cv.width, y: (c.y + c.height / 2) / cv.height };
    } catch (e) { return { x: 0.5, y: 0.5 }; }
  }

  async function takenAt(file) {
    try {
      if (window.exifr) {
        const t = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
        const d = t && (t.DateTimeOriginal || t.CreateDate);
        if (d instanceof Date && !isNaN(d)) return d.toISOString();
      }
    } catch (e) { /* ไม่มี EXIF */ }
    return file.lastModified ? new Date(file.lastModified).toISOString() : '';
  }

  // ประมวลผลรูป 1 ไฟล์ → { bytes (JPEG ≤ 1 MB), w, h, thumb, focus, quality, takenAt }
  RE.processPhoto = async function (file) {
    const img = await decode(file);
    let side = MAX_SIDE, q = 0.86, blob, cv;
    for (let tries = 0; tries < 10; tries++) {
      cv = drawScaled(img, side);
      blob = await canvasBlob(cv, q);
      if (blob.size <= MAX_BYTES) break;
      if (q > 0.7) q -= 0.08; else side = Math.round(side * 0.85);
    }
    if (!blob || blob.size > MAX_BYTES) throw new Error('ย่อรูป "' + file.name + '" ให้เล็กพอไม่ได้ (เกิน 1 MB) — ลองใช้รูปอื่น');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const th = drawScaled(cv, 420);
    const thumb = th.toDataURL('image/jpeg', 0.72);
    const qa = quality(drawScaled(th, 320));
    const focus = await focusPoint(th);
    if (img.close) img.close();
    return { bytes: bytes, w: cv.width, h: cv.height, thumb: thumb, focus: focus, quality: qa, takenAt: await takenAt(file), size: bytes.length };
  };

  // พื้นที่ครอปของรูป (สัดส่วน 0..1) ให้พอดีกรอบ โดยให้จุดสำคัญอยู่กลางกรอบมากที่สุด
  RE.cropRect = function (pw, ph, cellAspect, fx, fy) {
    const pa = pw / ph;
    let sw = 1, sh = 1;
    if (pa > cellAspect) sw = cellAspect / pa; else sh = pa / cellAspect;
    const cx = fx == null ? 0.5 : fx, cy = fy == null ? 0.5 : fy;
    const sx = Math.min(Math.max(cx - sw / 2, 0), 1 - sw);
    const sy = Math.min(Math.max(cy - sh / 2, 0), 1 - sh);
    return { sx: sx, sy: sy, sw: sw, sh: sh };
  };

  // ครอปรูปจริงสำหรับใส่ในไฟล์ PowerPoint (ความละเอียดสูงสุดไม่เกิน ~220 จุด/นิ้วของกรอบ)
  // soft = ความกว้างขอบเบลอ (นิ้ว) — ไล่ขอบรูปเป็นสีขาวแบบ "ขอบนุ่ม" ของต้นฉบับ (พื้นหลังใต้รูปเป็นสีขาว จึงยังเป็น JPEG ได้)
  RE.cropForSlide = async function (bytes, cellWIn, cellHIn, fx, fy, soft) {
    const img = await decode(bytes);
    const c = RE.cropRect(img.width, img.height, cellWIn / cellHIn, fx, fy);
    const sw = c.sw * img.width, sh = c.sh * img.height;
    const outW = Math.round(Math.min(sw, cellWIn * 220));
    const outH = Math.round(outW * sh / sw);
    const cv = document.createElement('canvas');
    cv.width = outW; cv.height = outH;
    const g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, c.sx * img.width, c.sy * img.height, sw, sh, 0, 0, outW, outH);
    if (img.close) img.close();
    if (soft) {
      const f = soft * outW / cellWIn;
      [[0, 0, f, 0, 0, 0, f, outH], [outW, 0, outW - f, 0, outW - f, 0, f, outH],
       [0, 0, 0, f, 0, 0, outW, f], [0, outH, 0, outH - f, 0, outH - f, outW, f]].forEach(function (s) {
        const gr = g.createLinearGradient(s[0], s[1], s[2], s[3]);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(s[4], s[5], s[6], s[7]);
      });
    }
    return cv.toDataURL('image/jpeg', 0.9);
  };

  // แผ่นสีขาวขอบฟุ้ง (หลังข้อความหน้าปก ตามต้นฉบับ: เติมขาว + เรืองแสง + ขอบนุ่ม) — blur = ความกว้างขอบฟุ้ง (นิ้ว)
  RE.softBoxPng = function (wIn, hIn, blurIn, opacity) {
    const dpi = 120, cw = Math.round(wIn * dpi), ch = Math.round(hIn * dpi), b = blurIn * dpi;
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d');
    // วาดสี่เหลี่ยมไว้นอกผ้าใบ ให้เหลือแต่ "เงา" ที่เบลอแล้วตกลงมาในผ้าใบ (ใช้ได้ทุกเบราว์เซอร์)
    g.shadowColor = 'rgba(255,255,255,' + opacity + ')';
    g.shadowBlur = b;
    g.shadowOffsetX = cw;
    g.fillStyle = '#fff';
    g.fillRect(b - cw, b, cw - 2 * b, ch - 2 * b);
    return cv.toDataURL('image/png');
  };

  /* ======================================================================
     ตัวจัดวางรูปอัตโนมัติ
     แบบจัดวาง (สัดส่วน 0..1 ของพื้นที่) — เลือกแบบ + ลำดับรูปที่ "ครอปรูปทิ้งน้อยที่สุด"
     และเปลี่ยนลำดับเวลาถ่ายน้อยที่สุด
     ====================================================================== */
  const T = {
    1: [{ name: 'เต็มกรอบ', cells: [[0, 0, 1, 1]] }],
    2: [
      { name: 'ซ้าย-ขวา', cells: [[0, 0, .5, 1], [.5, 0, .5, 1]] },
      { name: 'บน-ล่าง', cells: [[0, 0, 1, .5], [0, .5, 1, .5]] }
    ],
    3: [
      { name: 'ใหญ่ซ้าย + 2 เล็ก', cells: [[0, 0, .6, 1], [.6, 0, .4, .5], [.6, .5, .4, .5]] },
      { name: 'ใหญ่บน + 2 เล็ก', cells: [[0, 0, 1, .58], [0, .58, .5, .42], [.5, .58, .5, .42]] },
      { name: '3 คอลัมน์', cells: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
      { name: '3 แถว', cells: [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]] }
    ],
    4: [
      { name: '2 × 2', cells: [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]] },
      { name: 'ใหญ่ซ้าย + 3 เล็ก', cells: [[0, 0, .64, 1], [.64, 0, .36, 1 / 3], [.64, 1 / 3, .36, 1 / 3], [.64, 2 / 3, .36, 1 / 3]] },
      { name: '4 คอลัมน์', cells: [[0, 0, .25, 1], [.25, 0, .25, 1], [.5, 0, .25, 1], [.75, 0, .25, 1]] }
    ],
    5: [
      { name: '2 บน + 3 ล่าง', cells: [[0, 0, .5, .55], [.5, 0, .5, .55], [0, .55, 1 / 3, .45], [1 / 3, .55, 1 / 3, .45], [2 / 3, .55, 1 / 3, .45]] },
      { name: 'ใหญ่ซ้าย + 4 เล็ก', cells: [[0, 0, .5, 1], [.5, 0, .25, .5], [.75, 0, .25, .5], [.5, .5, .25, .5], [.75, .5, .25, .5]] }
    ],
    6: [
      { name: '3 × 2', cells: [[0, 0, 1 / 3, .5], [1 / 3, 0, 1 / 3, .5], [2 / 3, 0, 1 / 3, .5], [0, .5, 1 / 3, .5], [1 / 3, .5, 1 / 3, .5], [2 / 3, .5, 1 / 3, .5]] },
      { name: '2 × 3', cells: [[0, 0, .5, 1 / 3], [.5, 0, .5, 1 / 3], [0, 1 / 3, .5, 1 / 3], [.5, 1 / 3, .5, 1 / 3], [0, 2 / 3, .5, 1 / 3], [.5, 2 / 3, .5, 1 / 3]] }
    ]
  };
  RE.MAX_PHOTOS = 6;
  RE.templates = function (n) { return T[Math.min(n, 6)] || []; };

  function permutations(n) {
    const out = [];
    const a = []; for (let i = 0; i < n; i++) a.push(i);
    (function rec(k) {
      if (k === n) { out.push(a.slice()); return; }
      for (let i = k; i < n; i++) { [a[k], a[i]] = [a[i], a[k]]; rec(k + 1); [a[k], a[i]] = [a[i], a[k]]; }
    })(0);
    return out;
  }
  const PERMS = {};
  function perms(n) { return PERMS[n] || (PERMS[n] = permutations(n)); }
  function inversions(p) { let c = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) c++; return c; }

  function cellRects(tpl, area, gap) {
    return tpl.cells.map(function (c) {
      const x0 = area.x + c[0] * area.w, y0 = area.y + c[1] * area.h;
      const x1 = area.x + (c[0] + c[2]) * area.w, y1 = area.y + (c[1] + c[3]) * area.h;
      const l = c[0] > 0.001 ? gap / 2 : 0, t = c[1] > 0.001 ? gap / 2 : 0;
      const r = c[0] + c[2] < 0.999 ? gap / 2 : 0, b = c[1] + c[3] < 0.999 ? gap / 2 : 0;
      return { x: x0 + l, y: y0 + t, w: (x1 - x0) - l - r, h: (y1 - y0) - t - b };
    });
  }

  // photos: [{w, h}] เรียงตามลำดับที่ต้องการแล้ว; choice: ลำดับแบบที่ผู้ใช้เลือก (ไม่ใส่ = อัตโนมัติ)
  // คืน { name, index, count, cells: [{x,y,w,h, photo: ลำดับรูป}] }
  RE.layout = function (photos, area, gap, choice) {
    const n = Math.min(photos.length, RE.MAX_PHOTOS);
    if (!n) return { cells: [], index: 0, count: 0, name: '' };
    const tpls = T[n];
    let best = null;
    tpls.forEach(function (tpl, ti) {
      if (choice != null && choice !== ti) return;
      const rects = cellRects(tpl, area, gap);
      perms(n).forEach(function (p) {
        let loss = 0;
        for (let i = 0; i < n; i++) {
          const ph = photos[p[i]], r = rects[i];
          const pa = ph.w / ph.h, ca = r.w / r.h;
          loss += (1 - Math.min(pa, ca) / Math.max(pa, ca)) * (r.w * r.h);
        }
        loss = loss / (area.w * area.h) + inversions(p) * 0.04;
        if (!best || loss < best.loss - 1e-9) best = { loss: loss, ti: ti, rects: rects, p: p };
      });
    });
    return {
      name: tpls[best.ti].name, index: best.ti, count: tpls.length,
      cells: best.rects.map(function (r, i) { return Object.assign({ photo: best.p[i] }, r); })
    };
  };

  /* ======================================================================
     แบบร่างสไลด์ (ใช้ร่วม: หน้าตัวอย่างบนเว็บ + PowerPoint)
     ชนิดชิ้นส่วน: bg, image, photo, text, rect, ellipse, line, chart, placeholder
     ====================================================================== */
  const A = function (name) { return 'assets/' + name; };

  // หัวเรื่องทุกหน้า: ชิดขอบบนพื้นที่สีขาวของกรอบ (ขอบขาวเริ่มที่ ~0.21 นิ้ว)
  const TITLE_Y = 0.3;
  function title(text, y, size) {
    return { type: 'text', x: 2.4, y: y || TITLE_Y, w: 17.3, h: 0.8, text: text, size: size || 26, bold: true, color: NAVY, align: 'center', valign: 'middle' };
  }

  // หน้าปก — ctx: { mk, meetingText, cover: {id, w, h, fx, fy} | null, logo: data URL ตรากรมที่อัปโหลด (ไม่มี = ใช้ตราเดิม) }
  RE.slideCover = function (ctx) {
    const area = { x: 2.583, y: 0.375, w: 17.083, h: 10.514 };
    const els = [{ type: 'bg', src: A('frame-title.jpg') }];
    // รูปปก: ขอบนุ่มตามต้นฉบับ (softEdge ~0.12 นิ้ว)
    if (ctx.cover) els.push(Object.assign({ type: 'photo', id: ctx.cover.id, pw: ctx.cover.w, ph: ctx.cover.h, fx: ctx.cover.fx, fy: ctx.cover.fy, soft: 0.14 }, area));
    else els.push(Object.assign({ type: 'image', src: A('cover-default.jpg'), pw: 2400, ph: 1599, soft: 0.14 }, area));
    els.push({ type: 'image', src: ctx.logo || A('cover-logo.png'), x: 9.833, y: 2.458, w: 2.167, h: 2.167 });
    els.push({ type: 'image', src: A('cover-badge.png'), x: 8.375, y: 5.153, w: 5.5, h: 1.389 });
    // ข้อความ 2 บรรทัด มีแผ่นขาวขอบฟุ้งรองหลังตามต้นฉบับ (กว้างตามความยาวข้อความ)
    [
      { type: 'text', x: 5.55, y: 7.0, w: 11.0, h: 1.15, text: ctx.orgText || 'แขวงทางหลวงระยอง', size: 42 },
      { type: 'text', x: 3.55, y: 8.25, w: 15.0, h: 1.1, text: ctx.meetingText || ('การประชุมประจำเดือน ' + RE.mkLabel(RE.nextMk(ctx.mk))), size: 38 }
    ].forEach(function (t) {
      const B = 0.2;
      const bw = Math.min(t.w, textWidthIn(t.text, t.size) * 1.05 + 0.3) + 2 * B, bh = t.size / 72 * 1.25 + 2 * B;
      els.push({ type: 'softbox', x: t.x + (t.w - bw) / 2, y: t.y + (t.h - bh) / 2, w: bw, h: bh, blur: B, opacity: 0.85 });
      els.push(Object.assign(t, { bold: true, color: NAVY, align: 'center', valign: 'middle' }));
    });
    return { kind: 'cover', title: 'หน้าปก', els: els };
  };

  // ความกว้างข้อความ (นิ้ว) ด้วยฟอนต์ Prompt — วัดจริงด้วย canvas ถ้าวัดไม่ได้ใช้ค่าประมาณ
  let measureCtx = null;
  function textWidthIn(s, sizePt) {
    try {
      if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
      measureCtx.font = '100px Prompt, sans-serif';
      return measureCtx.measureText(String(s)).width / 100 * sizePt / 72;
    } catch (e) {
      return String(s).replace(/[ัิ-ฺ็-๎]/g, '').length * 0.5 * sizePt / 72;
    }
  }

  // หน้ารายรหัสงาน — a: ผลสรุปรหัสงาน, unit: หน่วยนับ, photos: [{id, w, h, fx, fy}], choice: แบบจัดวางที่เลือก
  RE.PHOTO_AREA = { x: 2.75, y: 3.85, w: 10.5, h: 6.42 };
  RE.slideWork = function (a, unit, photos, choice) {
    const els = [{ type: 'bg', src: A('frame-work.jpg') }];
    els.push(title('รหัส ' + a.code + ' ' + a.name, TITLE_Y, a.name.length > 45 ? 20 : 26));

    // รายการสายทาง — แบบต้นฉบับ: สายละ 1 บรรทัด จัดกลาง
    //   "ทล.3139   ตอน บ้านแลง – หาดใหญ่   กม. 12+000 - กม. 13+000   ( 400 ตร.ม. )"
    // ≤ 4 สาย: คอลัมน์เดียวกลางสไลด์ / มากกว่านั้น: แบ่ง 2 ฝั่งซ้าย-ขวา มีเส้นคั่นกลาง
    const SP = '   ';
    // สไลด์รวมกลุ่มงาน: ขึ้นต้นบรรทัดด้วยรหัสย่อย และใช้หน่วยนับของรหัสนั้น
    const rowsL = a.lines.map(function (L) {
      const sec = RE.sectionName(L.route, L.ctrl, L.fromM);
      return (a.merged ? L.code + SP : '') + 'ทล.' + L.route + SP + (/^ตอน/.test(sec) ? sec : 'ตอน ' + sec) + SP +
        ((L.fromM === L.toM) ? 'กม. ' + RE.mToKm(L.fromM) : 'กม. ' + RE.mToKm(L.fromM) + ' - กม. ' + RE.mToKm(L.toM)) + SP +
        '( ' + RE.fmtQty(L.qty) + ' ' + (L.unit || unit) + ' )';
    });
    const n = rowsL.length;
    // พื้นที่ระหว่างหัวเรื่อง (ยกขึ้นบนแล้ว) กับเส้นคั่นยอดรวม — ตัวอักษรใหญ่พอให้อ่านจากท้ายห้องประชุมได้
    const top = 1.15, avail = 1.82;
    const twoCol = n > 4;
    const per = twoCol ? Math.ceil(n / 2) : n;
    const rowH = Math.min(0.5, avail / Math.max(per, 1));
    const colW = twoCol ? 8.5 : 17.3;
    // ขนาดตัวอักษร: ตามความสูงแถว แล้วลดลงถ้าบรรทัดยาวเกินกรอบ
    let size = Math.min(twoCol ? 16 : 20, rowH * 72 * 0.6);
    rowsL.forEach(function (t) {
      const fit = (colW - 0.3) / textWidthIn(t, 1);
      if (fit < size) size = fit;
    });
    size = Math.max(10, Math.round(size * 2) / 2);
    const x0s = twoCol ? [2.4, 11.2] : [2.4];
    const bandY = top + (avail - per * rowH) / 2;
    // ทั้งกลุ่มอยู่กลางคอลัมน์ แต่ทุกบรรทัดเริ่มที่แนวเดียวกัน (ชิดซ้ายตามบรรทัดที่ยาวที่สุดของฝั่งนั้น)
    x0s.forEach(function (x0, side) {
      const part = rowsL.slice(side * per, side * per + per);
      const widest = part.reduce(function (m, t) { return Math.max(m, textWidthIn(t, size)); }, 0);
      // เผื่อความกว้าง ~10% — ค่าที่วัดได้อาจแคบกว่าที่แสดงจริง (ฟอนต์ยังโหลดไม่เสร็จ / PowerPoint วาดกว้างกว่า)
      // ไม่งั้นท้ายบรรทัด เช่น " )" จะถูกตัดหาย — กล่องชิดซ้าย จึงขยายไปทางขวาได้โดยตัวอักษรไม่เลื่อน
      const bw = Math.min(colW, widest * 1.1 + 0.3);
      const bx = x0 + (colW - Math.min(colW, widest + 0.1)) / 2;
      part.forEach(function (t, i) {
        els.push({ type: 'text', x: bx, y: bandY + i * rowH, w: bw, h: rowH, text: t, size: size, color: INK, align: 'left', valign: 'middle', inset: 0, wrap: false });
      });
    });
    if (twoCol) els.push({ type: 'rect', x: 11.05, y: bandY, w: 0.02, h: per * rowH, fill: 'B8C4D6' });
    // เส้นคั่นก่อนยอดรวม
    els.push({ type: 'line', x: 6.4, y: 3.02, w: 9.3, color: 'B8C4D6', lineW: 0.75 });
    els.push({ type: 'text', x: 2.4, y: 3.04, w: 17.3, h: 0.6, runs: [
      { text: 'รวม   ', size: 20, bold: true, color: INK },
      { text: a.qtyParts ? a.qtyParts.map(function (q) { return RE.fmtQty(q.qty) + ' ' + q.unit; }).join('  +  ') : RE.fmtQty(a.qty) + ' ' + unit, size: 20, bold: true, color: INK }], align: 'center', valign: 'middle' });

    // รูป
    const lay = RE.layout(photos, RE.PHOTO_AREA, 0.1, choice);
    if (!photos.length) els.push(Object.assign({ type: 'placeholder', text: 'ยังไม่มีรูป — ลากรูปมาวางได้' }, RE.PHOTO_AREA));
    lay.cells.forEach(function (c) {
      const p = photos[c.photo];
      els.push({ type: 'photo', id: p.id, pw: p.w, ph: p.h, fx: p.fx, fy: p.fy, x: c.x, y: c.y, w: c.w, h: c.h });
    });

    // กล่องค่าใช้จ่าย — ตำแหน่ง/ขนาดตัวอักษรวัดจากต้นฉบับ (รายงานเดือน มิ.ย. 69):
    // Prompt 16pt, ระยะบรรทัดคงที่ 24.76pt, ระยะห่างตัวอักษร 1.06pt, ชิดบน ไม่มีขอบใน
    // (กล่องตัวเลขขยายไปทางซ้ายเผื่อยอดหลักล้าน — ขอบขวาตรงต้นฉบับ)
    const BLK = '000000';
    const T16 = { size: 16, color: BLK, lineSpacingPt: 24.76, charSpacing: 1.06, inset: 0 };
    const tx = function (o) { return Object.assign({ type: 'text' }, T16, o); };
    els.push({ type: 'rect', x: 13.667, y: 4.054, w: 5.665, h: 6.206, fill: 'FFFFFF', line: 'FAC02E', lineW: 9, radius: 0.15 });
    els.push({ type: 'rect', x: 14.551, y: 3.727, w: 3.943, h: 0.868, fill: 'FFE7B0', radius: 0.1, shadow: true });
    els.push({ type: 'text', x: 14.821, y: 3.958, w: 3.403, h: 0.5, text: 'ค่าใช้จ่ายในการปฏิบัติงาน', size: 20, color: BLK, align: 'center', lineSpacingPt: 31.89, inset: 0 });
    const rows = [['ค่าวัสดุ', a.mat], ['ค่าแรงงาน', a.lab], ['ค่าเช่าเครื่องจักร', a.rent], ['ค่าน้ำมันเชื้อเพลิง', a.fuel]];
    const rowY = [4.987, 5.707, 6.418, 7.074], valY = [5.01, 5.73, 6.444, 7.1], chkY = [4.971, 5.691, 6.402, 7.058];
    const lineY = [5.493, 6.204, 6.924, 7.576];
    rows.forEach(function (r, i) {
      els.push({ type: 'ellipse', x: 14.035, y: chkY[i], w: 0.32, h: 0.32, fill: 'FFFFFF', line: '555555', lineW: 1, text: '✓', size: 13, bold: true, color: RED });
      els.push(tx({ x: 14.594, y: rowY[i], w: 2.776, h: 0.4, text: r[0] }));
      els.push(tx({ x: 16.2, y: valY[i], w: 2.518, h: 0.4, text: RE.fmt(r[1]) + '  บาท', align: 'right' }));
      els.push({ type: 'line', x: 14.013, y: lineY[i], w: 4.942, color: '444444', lineW: 0.75 });
    });
    // สไลด์รวมที่มีหลายหน่วยนับ: Unit Cost / ผลงานเฉลี่ย คิดรวมไม่ได้ → แสดง "-"
    const noRate = a.sameUnit === false;
    if (a.qtyParts && a.sameUnit) unit = a.qtyParts[0].unit;
    const perDayTxt = noRate ? '-' : a.perDay >= 100 ? RE.fmt(a.perDay, 0) : RE.fmt(a.perDay, 2);
    // [หัวข้อ, ค่า, หน่วย, สีค่า, y หัวข้อ, y ค่า, y หน่วย, x หน่วย, หน่วยตัวหนา+เอียง]
    const tot = [
      ['รวม', RE.fmt(a.total), 'บาท', BLK, 7.884, 7.892, 7.875, 17.73, true],
      ['Unit Cost', noRate ? '-' : RE.fmt(a.unitCost), noRate ? '' : 'บาท/' + unit, RED, 8.371, 8.378, 8.378, 17.73, false],
      ['ผลงานเฉลี่ย', perDayTxt, noRate ? '' : unit + '/วัน', RED, 8.871, 8.868, 8.869, 17.734, false]
    ];
    els.push({ type: 'ellipse', x: 13.898, y: 7.784, w: 0.5, h: 0.5, fill: 'FAC02E', line: 'E09A00', lineW: 1.5, text: '★', size: 15, bold: true, color: 'FFFFFF' });
    tot.forEach(function (t) {
      els.push(tx({ x: 14.594, y: t[4], w: 2.591, h: 0.4, text: t[0], bold: true }));
      els.push(tx({ x: 15.2, y: t[5], w: 2.268, h: 0.4, text: t[1], bold: true, color: t[3], align: 'right' }));
      els.push(tx({ x: t[7], y: t[6], w: 1.6, h: 0.4, text: t[2], bold: t[8], italic: t[8] }));
    });
    return { kind: 'work', title: a.code + ' ' + a.name + (a.merged ? ' (รวม ' + a.subs.join(', ') + ')' : ''), els: els, layout: lay };
  };

  // สรุปผลงานประจำเดือน (กราฟวงกลม 2 รูป) — ใช้กรอบเมนู "รายงานผลการปฏิบัติงาน" ตามต้นฉบับ
  RE.slideMonthSummary = function (mk, aggs) {
    const els = [{ type: 'bg', src: A('frame-work.jpg') }];
    els.push({ type: 'text', x: 2.4, y: TITLE_Y, w: 17.3, h: 1.3, text: 'สรุปผลงานบำรุงปกติ\nประจำเดือน ' + RE.mkLabel(mk), size: 26, bold: true, color: NAVY, align: 'center', valign: 'middle', lineSpacing: 1.3 });
    const byGroup = {};
    aggs.forEach(function (a) { byGroup[a.group] = (byGroup[a.group] || 0) + a.total; });
    const gs = RE.GROUPS.filter(function (g) { return byGroup[g.code] > 0; });
    const cats = [['ค่าวัสดุ', 'mat', '5B9BD5'], ['ค่าแรงงาน', 'lab', 'BFBFBF'], ['ค่าเช่า', 'rent', '4472C4'], ['ค่าน้ำมันเชื้อเพลิง', 'fuel', 'C5E0B4']];
    const catVals = cats.map(function (c) { return aggs.reduce(function (s, a) { return s + a[c[1]]; }, 0); });
    [['แต่ละรหัสงาน', 3.0], ['ตามหมวดค่าใช้จ่าย', 11.2]].forEach(function (b) {
      els.push({ type: 'rect', x: b[1], y: 2.45, w: 7.2, h: 1.2, fill: 'FFFFFF', radius: 0.05, shadow: true });
      els.push({ type: 'text', x: b[1], y: 2.45, w: 7.2, h: 1.2, runs: [
        { text: 'กราฟแสดงสัดส่วนการใช้งบประมาณบำรุงปกติ\n', size: 20, bold: true, color: INK },
        { text: b[0], size: 20, bold: true, color: '010A81' }], align: 'center', valign: 'middle' });
    });
    // วงกลมไม่มีป้ายรอบนอก (ชิ้นเล็กติดกันทำให้ป้ายทับกัน) — ใช้คำอธิบายสีด้านขวาของวงกลมแทน:
    // ชื่อ (ตัวหนา) + ยอดเงินและร้อยละ บรรทัดละรายการ ปิดท้ายด้วยยอดรวม
    // D = เส้นผ่านศูนย์กลางวงกลม, SLOT = ช่องที่เว้นไว้ให้วงกลม (คำอธิบายสีอยู่ตำแหน่งเดิมเสมอ วงกลมอยู่กลางช่อง)
    const CY = 7.0, D = 2.6, SLOT = 3.2, ROW = 0.86;
    function pieBlock(x0, rows) {
      const tot = rows.reduce(function (s, r) { return s + r.v; }, 0);
      els.push({ type: 'chart', kind: 'pie', noLabels: true, x: x0 + (SLOT - D) / 2, y: CY - D / 2, w: D, h: D, plot: { x: 0.02, y: 0.02, w: 0.96, h: 0.96 },
        labels: rows.map(function (r) { return r.name; }), values: rows.map(function (r) { return r.v; }), colors: rows.map(function (r) { return r.color; }) });
      const lx = x0 + SLOT + 0.25, lw = 4.1;
      let y = CY - (rows.length * ROW + 0.55) / 2;
      rows.forEach(function (r) {
        els.push({ type: 'rect', x: lx, y: y + 0.1, w: 0.28, h: 0.28, fill: r.color, radius: 0.04 });
        els.push({ type: 'text', x: lx + 0.4, y: y, w: lw - 0.4, h: 0.46, text: r.name, size: 16, bold: true, color: INK, valign: 'middle', inset: 0, wrap: false });
        els.push({ type: 'text', x: lx + 0.4, y: y + 0.41, w: lw - 0.4, h: 0.4, runs: [
          { text: RE.fmt(r.v) + ' บาท   ', color: INK },
          { text: '(' + RE.fmt(tot ? r.v / tot * 100 : 0) + '%)', color: RED, bold: true }], size: 15, valign: 'middle', inset: 0, wrap: false });
        y += ROW;
      });
      els.push({ type: 'line', x: lx, y: y + 0.02, w: lw, color: 'B8C4D6', lineW: 0.75 });
      els.push({ type: 'text', x: lx + 0.4, y: y + 0.08, w: lw - 0.4, h: 0.48, text: 'รวม   ' + RE.fmt(tot) + ' บาท', size: 16, bold: true, color: NAVY, valign: 'middle', inset: 0, wrap: false });
    }
    pieBlock(3.0, gs.map(function (g) { return { name: g.code + ' ' + g.name, v: Math.round(byGroup[g.code] * 100) / 100, color: g.color }; }));
    const nz = cats.map(function (c, i) { return i; }).filter(function (i) { return catVals[i] > 0; });
    pieBlock(11.2, nz.map(function (i) { return { name: cats[i][0], v: Math.round(catVals[i] * 100) / 100, color: cats[i][2] }; }));
    return { kind: 'summary', title: 'สรุปผลงานประจำเดือน', els: els };
  };

  // สรุปแผนงาน - ผลงาน ตามรหัสงาน (6 กลุ่ม)
  RE.slidePlan = function (mk, plan, cum) {
    const els = [{ type: 'bg', src: A('frame-plan.jpg') }];
    els.push({ type: 'text', x: 2.4, y: TITLE_Y, w: 17.3, h: 1.3, text: 'สรุปแผนงาน - ผลงาน ตามรหัสงาน\nปีงบประมาณ ' + cum.fy, size: 26, bold: true, color: NAVY, align: 'center', valign: 'middle', lineSpacing: 1.3 });
    const planG = (plan && plan.groups) || {};
    const pTot = cum.planTotal || 0, rTot = cum.resultTotal || 0;
    RE.GROUPS.forEach(function (g, i) {
      const col = i % 3 === 0 ? 0 : (i % 3 === 1 ? 1 : 2);
      const order = [0, 3, 1, 4, 2, 5];   // เรียงตามต้นฉบับ: คอลัมน์ละ 2 กลุ่ม
      const k = order.indexOf(i);
      const cx = [3.85, 8.95, 14.2][Math.floor(k / 2)], cy = [2.55, 4.45][k % 2];
      void col;
      const pv = Number(planG[g.code]) || 0, rv = cum.groups[g.code] || 0;
      // ขนาดตัวอักษรใหญ่พอให้อ่านจากท้ายห้องประชุมได้
      els.push({ type: 'rect', x: cx - 0.1, y: cy, w: 1.2, h: 0.6, fill: g.color, text: g.code, size: 21, bold: true, color: 'FFFFFF' });
      els.push({ type: 'text', x: cx + 1.3, y: cy - 0.02, w: 4.1, h: 0.62, text: g.name, size: 20, bold: true, color: INK, valign: 'middle', wrap: false });
      els.push({ type: 'text', x: cx + 1.3, y: cy + 0.6, w: 4.1, h: 0.5, runs: [
        { text: 'แผน   ', bold: true, color: INK }, { text: pv ? RE.fmt(pv, 0) + ' ( ' + RE.fmt(pTot ? pv / pTot * 100 : 0) + '% )' : '-', color: INK }], size: 19, valign: 'middle', wrap: false });
      els.push({ type: 'text', x: cx + 1.3, y: cy + 1.1, w: 4.1, h: 0.5, runs: [
        { text: 'ผล     ', bold: true, color: INK }, { text: RE.fmt(rv, 0) + ' ( ', color: INK },
        { text: RE.fmt(rTot ? rv / rTot * 100 : 0) + '%', color: RED }, { text: ' )', color: INK }], size: 19, valign: 'middle', wrap: false });
    });
    els.push({ type: 'image', src: A('plan-banner.jpg'), x: 3.15, y: 6.55, w: 15.9, h: 3.43 });
    return { kind: 'plan', title: 'แผน-ผล ตามรหัสงาน', els: els };
  };

  // กราฟความก้าวหน้าการใช้งบประมาณ — ใช้รูปกราฟที่แคปจากระบบของกรม (img = photoSpec) วางเต็มกรอบโดยไม่ครอป
  // pct = { plan, result } — % แผน/ผลสะสม ที่อ่านจากรูปกราฟ (แก้เองได้)
  RE.slideBudget = function (mk, plan, cum, img, pct) {
    const els = [{ type: 'bg', src: A('frame-budget.jpg') }];
    els.push({ type: 'text', x: 2.4, y: TITLE_Y, w: 17.3, h: 1.3, text: 'กราฟแสดงความก้าวหน้า\nการใช้งบประมาณบำรุงปกติ', size: 26, bold: true, color: NAVY, align: 'center', valign: 'middle', lineSpacing: 1.3 });
    const box = { x: 3.1, y: 2.25, w: 15.9, h: 6.55 };
    if (img && img.w && img.h) {
      const ar = img.w / img.h;
      const w = ar > box.w / box.h ? box.w : box.h * ar, h = w / ar;
      els.push({ type: 'photo', id: img.id, pw: img.w, ph: img.h, fx: 0.5, fy: 0.5, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w: w, h: h });
    } else {
      els.push({ type: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, fill: 'F4F6FA', line: 'BBBBBB', lineW: 0.75, text: 'ยังไม่ได้ใส่รูปกราฟ (แท็บ ④ แผน-ผล → เพิ่มรูปกราฟ)', size: 18, color: '888888' });
    }
    // 2 บรรทัดใต้กราฟ จัดเป็นคอลัมน์ให้ตัวเลขตรงกัน:
    //   แผนงานบำรุงปกติ   5,706,614.44  บาท   คิดเป็น   100.00 %  ของงบประมาณที่ได้รับ
    //   ผลงานบำรุงปกติ   5,124,968.56  บาท   คิดเป็น    83.18 %  ( ผลน้อยกว่าแผน 9.44 % )
    // ยอดเงินจากแผน-ผลตามกลุ่มงาน, % จากรูปกราฟ (ไม่มี % ผล = คิดจากยอดเงิน)
    const num = function (v) { return v == null || v === '' || !isFinite(v) ? null : Number(v); };
    const pP = pct ? num(pct.plan) : null;
    let pR = pct ? num(pct.result) : null;
    if (pR == null && cum.planTotal) pR = cum.resultTotal / cum.planTotal * 100;
    const SZ = 19.5, BLK = '000000';
    const tail2 = [];
    if (pR != null && pP != null) {
      const d = Math.round((pR - pP) * 100) / 100;
      tail2.push({ text: '( ', color: BLK }, { text: 'ผล', bold: true, color: BLK },
        { text: d >= 0 ? 'มากกว่า' : 'น้อยกว่า', bold: true, color: RED }, { text: 'แผน ', bold: true, color: BLK },
        { text: RE.fmt(Math.abs(d)), bold: true, color: RED }, { text: ' % )', color: BLK });
    }
    const rowsB = [
      ['แผนงานบำรุงปกติ', RE.fmt(cum.planTotal || 0), 'บาท', 'คิดเป็น', '100.00 %', [{ text: 'ของงบประมาณที่ได้รับ', color: BLK }]],
      ['ผลงานบำรุงปกติ', RE.fmt(cum.resultTotal || 0), 'บาท', 'คิดเป็น', pR != null ? RE.fmt(pR) + ' %' : '-', tail2]
    ];
    const runsW = function (rs) { return rs.reduce(function (s, r) { return s + textWidthIn(r.text, SZ) * (r.bold ? 1.06 : 1); }, 0); };
    const colW = [0, 1, 2, 3, 4].map(function (c) { return Math.max(textWidthIn(rowsB[0][c], SZ), textWidthIn(rowsB[1][c], SZ)) * 1.05 + 0.05; });
    colW.push(Math.max(runsW(rowsB[0][5]), runsW(rowsB[1][5])) * 1.05 + 0.1);
    const GAP = [0.4, 0.25, 0.45, 0.3, 0.3];
    const totW = colW.reduce(function (s, w) { return s + w; }, 0) + GAP.reduce(function (s, g) { return s + g; }, 0);
    const colX = [];
    let cx = box.x + Math.max(0, (box.w - totW) / 2);
    colW.forEach(function (w, i) { colX.push(cx); cx += w + (GAP[i] || 0); });
    const ALIGN = ['left', 'right', 'left', 'left', 'right', 'left'];
    rowsB.forEach(function (r, ri) {
      const y = [8.95, 9.6][ri];
      r.forEach(function (v, c) {
        const base = { type: 'text', x: colX[c], y: y, w: colW[c], h: 0.6, size: SZ, color: BLK, align: ALIGN[c], valign: 'middle', inset: 0, wrap: false };
        if (Array.isArray(v)) { if (v.length) els.push(Object.assign(base, { runs: v })); }
        else els.push(Object.assign(base, { text: v }));
      });
    });
    return { kind: 'budget', title: 'ความก้าวหน้าการใช้งบ', els: els };
  };

  // อ่าน % แผน / % ผล จากรูปกราฟที่แคปจากระบบของกรม (อ่านตัวอักษรในรูปด้วย Tesseract — โหลดเมื่อใช้ครั้งแรก)
  // อ่านจากคำอธิบายกราฟแถวล่างสุด "แผน 92.62  ผล 83.18" (ซ้าย = แผน, ขวา = ผล) ไม่พบจึงอ่านทั้งรูป
  // คืน { plan, result } (ตัวเลข %) หรือ null ถ้าอ่านไม่ได้
  let tessLoading = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tessLoading) tessLoading = new Promise(function (res, rej) {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = function () { res(window.Tesseract); };
      s.onerror = function () { tessLoading = null; rej(new Error('โหลดตัวอ่านตัวเลขจากรูปไม่ได้ (ตรวจอินเทอร์เน็ต)')); };
      document.head.appendChild(s);
    });
    return tessLoading;
  }
  function cropScaled(img, y0, y1, scale) {
    const cv = document.createElement('canvas');
    const sh = Math.round((y1 - y0) * img.naturalHeight);
    cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(sh * scale);
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, Math.round(y0 * img.naturalHeight), img.naturalWidth, sh, 0, 0, cv.width, cv.height);
    return cv;
  }
  function pctWords(data) {
    return (data.words || []).map(function (w) {
      const m = String(w.text).replace(/,/g, '.').match(/(\d{1,3}\.\d{2})/);
      const v = m ? Number(m[1]) : NaN;
      return isFinite(v) && v >= 0 && v <= 150 ? { v: v, x: w.bbox.x0, y: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0 } : null;
    }).filter(Boolean);
  }
  RE.readBudgetChart = async function (file) {
    const T = await loadTesseract();
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise(function (res, rej) { const i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('เปิดรูปไม่ได้')); }; i.src = url; });
      const worker = await T.createWorker('eng');
      try {
        await worker.setParameters({ tessedit_pageseg_mode: '11' });   // ข้อความกระจัดกระจาย (เหมาะกับกราฟ)
        // รอบ 1: แถบล่าง 25% ของรูป (คำอธิบายกราฟ) ขยาย 3 เท่า
        let ws = pctWords((await worker.recognize(cropScaled(img, 0.75, 1, 3))).data);
        if (ws.length >= 2) {
          const maxY = Math.max.apply(null, ws.map(function (w) { return w.y; }));
          const row = ws.filter(function (w) { return maxY - w.y < Math.max(w.h, 10) * 1.2; }).sort(function (a, b) { return a.x - b.x; });
          if (row.length >= 2) return { plan: row[0].v, result: row[1].v };
        }
        // รอบ 2: ทั้งรูป ขยาย 2 เท่า — ใช้ 2 ค่าแรกตามลำดับการอ่าน (ป้ายแผนอยู่เหนือป้ายผล)
        ws = pctWords((await worker.recognize(cropScaled(img, 0, 1, 2))).data);
        return ws.length >= 2 ? { plan: ws[0].v, result: ws[1].v } : null;
      } finally { await worker.terminate(); }
    } finally { URL.revokeObjectURL(url); }
  };

  /* ---------------- ปัญหา อุปสรรค (แบบฟอร์มมีโครงสร้าง) ----------------
     pr = { kind: 'อุทกภัย' | ..., title (ข้อความหัวเรื่องเอง ถ้าไม่ใส่สร้างให้), route, ctrl, section,
            points: [{ km, side, object, damage, length, width, depth, extra }] }            */
  RE.PROBLEM_KINDS = ['อุทกภัย', 'ดินสไลด์ / ดินทรุด', 'ต้นไม้ล้มขวางทาง', 'ผิวทางชำรุดเสียหาย', 'อุบัติเหตุทำทรัพย์สินเสียหาย', 'อื่น ๆ'];
  RE.problemTitles = function (pr) {
    const t1 = pr.title || (pr.kind === 'อุทกภัย' ? 'รายงานปัญหา ความเสียหายของพื้นที่จากเหตุอุทกภัย'
      : pr.kind && pr.kind !== 'อื่น ๆ' ? 'รายงานปัญหา ' + pr.kind : 'รายงานปัญหา อุปสรรค');
    let t2 = '';
    if (pr.route) t2 = 'ทางหลวงหมายเลข ' + pr.route + (pr.section ? ' ตอน ' + pr.section : '');
    return [t1, t2];
  };
  function m2(v) { const n = Number(v); return v === '' || v == null || !isFinite(n) ? '' : RE.fmt(n, 2); }
  RE.problemCaption = function (pt) {
    const l1 = [pt.km ? 'กม.' + pt.km : '', pt.side || ''].filter(Boolean).join(' ');
    const l2 = [pt.object || '', pt.damage || ''].filter(Boolean).join(' ');
    const dims = [];
    if (m2(pt.length)) dims.push('ความยาว ' + m2(pt.length) + ' ม.');
    if (m2(pt.width)) dims.push('กว้าง ' + m2(pt.width) + ' ม.');
    if (m2(pt.depth)) dims.push('ลึก ' + m2(pt.depth) + ' ม.');
    return [l1, l2, dims.join(' / '), pt.extra || ''].filter(Boolean).join('\n');
  };

  // pr: ปัญหา 1 เรื่อง, pts: จุดที่อยู่ในสไลด์นี้ (ไม่เกิน 3), photosByPoint: [[{id,w,h,fx,fy}]]
  RE.slideProblem = function (pr, pts, photosByPoint, choices, pageNo, pageCount) {
    const els = [{ type: 'bg', src: A('frame-problem.jpg') }];
    const tt = RE.problemTitles(pr);
    if (pageCount > 1) tt[0] += ' (' + pageNo + '/' + pageCount + ')';
    els.push({ type: 'text', x: 2.4, y: TITLE_Y - 0.05, w: 17.3, h: 1.3, text: tt.filter(Boolean).join('\n'), size: 22, bold: true, color: NAVY, align: 'center', valign: 'middle', lineSpacing: 1.35 });
    pts = (pts && pts.length ? pts : [{}]).slice(0, 3).map(function (p) { return { caption: RE.problemCaption(p) }; });
    const n = pts.length, X0 = 2.65, W = 16.8, gap = 0.35;
    const cw = (W - gap * (n - 1)) / n;
    const layouts = [];
    pts.forEach(function (pt, i) {
      const x = X0 + i * (cw + gap);
      els.push({ type: 'text', x: x, y: 1.95, w: cw, h: 1.3, text: pt.caption || '', size: n === 1 ? 18 : 16, bold: true, color: INK, align: 'center', valign: 'middle', lineSpacing: 1.2 });
      const area = { x: x, y: 3.45, w: cw, h: 6.75 };
      const ph = (photosByPoint[i] || []);
      const lay = RE.layout(ph, area, 0.1, choices ? choices[i] : null);
      layouts.push(lay);
      if (!ph.length) els.push(Object.assign({ type: 'placeholder', text: 'ยังไม่มีรูป' }, area));
      lay.cells.forEach(function (c) {
        const p = ph[c.photo];
        els.push({ type: 'photo', id: p.id, pw: p.w, ph: p.h, fx: p.fx, fy: p.fy, x: c.x, y: c.y, w: c.w, h: c.h });
      });
    });
    return { kind: 'problem', title: tt[0], els: els, layouts: layouts };
  };

  // ตรากรมขนาดเล็กมุมซ้ายบน — อยู่ในภาพกรอบทุกแบบ (วัดจากภาพ 1920×1080: กลาง 123.5,84.5 px กว้าง ~101 px)
  // มีตราที่อัปโหลด: ปิดตราเดิมด้วยวงกลมสีพื้นของกรอบ แล้ววางตราใหม่ทับ (ใส่ต่อจากพื้นหลัง ให้อยู่ใต้ชิ้นอื่น)
  const FRAME_LOGO_BG = { 'frame-title.jpg': 'F5FAFF', 'frame-end.jpg': 'F5FAFF' };   // นอกนั้นแถบเมนูสีน้ำเงิน
  RE.withLogo = function (spec, logo) {
    if (!logo || !spec.els.length || spec.els[0].type !== 'bg') return spec;
    const fill = FRAME_LOGO_BG[spec.els[0].src.replace(/^.*\//, '')] || '010A81';
    const els = spec.els.slice();
    els.splice(1, 0,
      { type: 'ellipse', x: 0.724, y: 0.318, w: 1.125, h: 1.125, fill: fill },
      { type: 'image', src: logo, x: 0.7605, y: 0.354, w: 1.052, h: 1.052 });
    return Object.assign({}, spec, { els: els });
  };

  RE.slideEnd = function () {
    return { kind: 'end', title: 'จบการนำเสนอ', els: [{ type: 'bg', src: A('frame-end.jpg') }] };
  };

  /* ======================================================================
     สร้างไฟล์ PowerPoint จากแบบร่าง
     getPhotoBytes(id) → Promise<Uint8Array>; progress(ข้อความ)
     ====================================================================== */
  RE.buildPptx = async function (slides, getPhotoBytes, progress) {
    if (!window.PptxGenJS) throw new Error('โหลดตัวสร้างไฟล์ PowerPoint ไม่สำเร็จ (ตรวจสอบอินเทอร์เน็ต)');
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'CN20', width: RE.SLIDE_W, height: RE.SLIDE_H });
    pptx.layout = 'CN20';
    pptx.author = 'หมวดทางหลวงเชิงเนิน';
    pptx.title = 'รายงานผลการปฏิบัติงานประจำเดือน';

    const assetCache = {};
    async function asset(src) {
      if (assetCache[src]) return assetCache[src];
      const r = await fetch(src);
      if (!r.ok) throw new Error('โหลดไฟล์ ' + src + ' ไม่สำเร็จ');
      const b = await r.blob();
      const d = await new Promise(function (res) { const fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(b); });
      assetCache[src] = d;
      return d;
    }
    async function assetCropped(src, pw, ph, w, h, soft) {
      const key = src + '|' + w + 'x' + h + '|' + (soft || 0);
      if (assetCache[key]) return assetCache[key];
      const r = await fetch(src);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const d = await RE.cropForSlide(bytes, w, h, 0.5, 0.5, soft);
      assetCache[key] = d;
      return d;
    }

    const textOpts = function (e) {
      const o = { x: e.x, y: e.y, w: e.w, h: e.h, fontFace: FONT, fontSize: e.size || 16, color: e.color || INK,
        bold: !!e.bold, italic: !!e.italic, align: e.align || 'left', valign: e.valign || 'top', margin: e.inset != null ? e.inset : 0.04, fit: 'none' };
      if (e.lineSpacing) o.lineSpacingMultiple = e.lineSpacing;
      if (e.lineSpacingPt) o.lineSpacing = e.lineSpacingPt;   // ระยะบรรทัดคงที่ (pt)
      if (e.charSpacing) o.charSpacing = e.charSpacing;       // ระยะห่างตัวอักษร (pt)
      if (e.wrap === false) o.wrap = false;                   // ไม่ตัดขึ้นบรรทัดใหม่
      if (e.glow) o.glow = { size: 12, opacity: 0.85, color: 'FFFFFF' };
      return o;
    };

    for (let si = 0; si < slides.length; si++) {
      const spec = slides[si];
      if (progress) progress('กำลังสร้างสไลด์ ' + (si + 1) + '/' + slides.length + ' — ' + spec.title);
      const s = pptx.addSlide();
      for (const e of spec.els) {
        if (e.type === 'bg') {
          s.background = { data: await asset(e.src) };
        } else if (e.type === 'image') {
          const data = e.pw ? await assetCropped(e.src, e.pw, e.ph, e.w, e.h, e.soft) : await asset(e.src);
          s.addImage({ data: data, x: e.x, y: e.y, w: e.w, h: e.h });
        } else if (e.type === 'photo') {
          const bytes = await getPhotoBytes(e.id);
          const data = await RE.cropForSlide(bytes, e.w, e.h, e.fx, e.fy, e.soft);
          s.addImage({ data: data, x: e.x, y: e.y, w: e.w, h: e.h });
        } else if (e.type === 'softbox') {
          s.addImage({ data: RE.softBoxPng(e.w, e.h, e.blur, e.opacity), x: e.x, y: e.y, w: e.w, h: e.h });
        } else if (e.type === 'text') {
          if (e.runs) {
            // ขึ้นบรรทัดใหม่ = ตั้ง breakLine ที่ชิ้นก่อนหน้า (ห้ามมีชิ้นข้อความว่าง — PowerPoint เปิดไฟล์ไม่ได้)
            const runs = [];
            e.runs.forEach(function (r) {
              String(r.text).split('\n').forEach(function (t, i) {
                if (i > 0 && runs.length) runs[runs.length - 1].options.breakLine = true;
                if (t === '') return;
                runs.push({ text: t, options: { fontFace: FONT, fontSize: r.size || e.size || 16, bold: !!r.bold, color: r.color || e.color || INK } });
              });
            });
            s.addText(runs, textOpts(e));
          } else {
            s.addText(String(e.text || ''), textOpts(e));
          }
        } else if (e.type === 'rect' || e.type === 'ellipse') {
          const shape = e.type === 'ellipse' ? pptx.ShapeType.ellipse : (e.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect);
          const o = { x: e.x, y: e.y, w: e.w, h: e.h, fill: { color: e.fill || 'FFFFFF' } };
          o.line = e.line ? { color: e.line, width: e.lineW || 1 } : { type: 'none' };
          if (e.radius) o.rectRadius = e.radius;
          if (e.shadow) o.shadow = { type: 'outer', angle: 90, blur: 6, offset: 2, color: '000000', opacity: 0.22 };
          if (e.text) {
            s.addText(e.text, Object.assign(o, { shape: shape, fontFace: FONT, fontSize: e.size || 16, bold: !!e.bold, color: e.color || INK, align: 'center', valign: 'middle', margin: 0 }));
          } else s.addShape(shape, o);
        } else if (e.type === 'line') {
          s.addShape(pptx.ShapeType.line, { x: e.x, y: e.y, w: e.w, h: 0, line: { color: e.color || '444444', width: e.lineW || 1 } });
        } else if (e.type === 'chart') {
          if (e.kind === 'pie') {
            if (!e.values.length) continue;
            // ร้อยละใส่ไว้ในชื่อรายการ (รูปแบบตัวเลขของ PowerPoint ใช้ร่วมกันทั้งค่าและร้อยละ จึงแสดงคู่กันไม่ได้)
            const tot = e.values.reduce(function (a, b) { return a + b; }, 0);
            const labels = e.labels.map(function (l, i) { return l + ' (' + RE.fmt(tot ? e.values[i] / tot * 100 : 0) + '%)'; });
            s.addChart(pptx.ChartType.pie, [{ name: 'งบประมาณ', labels: labels, values: e.values }], {
              x: e.x, y: e.y, w: e.w, h: e.h, chartColors: e.colors, showLegend: false,
              showLabel: !e.noLabels, showValue: !e.noLabels, showPercent: false, dataLabelPosition: 'outEnd',
              dataLabelFormatCode: '#,##0" บาท"', dataLabelColor: '404040', dataLabelFontSize: e.labelSize || 16, dataLabelFontFace: FONT,
              showLeaderLines: true, firstSliceAng: 0, dataBorder: { pt: 1.5, color: 'FFFFFF' },
              layout: e.plot || { x: 0.22, y: 0.2, w: 0.56, h: 0.6 }
            });
          } else if (e.kind === 'line') {
            s.addChart(pptx.ChartType.line, e.series.map(function (sr) { return { name: sr.name, labels: e.labels, values: sr.values }; }), {
              x: e.x, y: e.y, w: e.w, h: e.h, chartColors: e.series.map(function (sr) { return sr.color; }),
              lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 8, displayBlanksAs: 'gap',
              showLegend: true, legendPos: 'b', legendFontFace: FONT, legendFontSize: 16,
              valAxisMinVal: 0, valAxisMaxVal: 120, valAxisMajorUnit: 20, valAxisLabelFormatCode: '0"%"',
              valAxisLabelFontFace: FONT, catAxisLabelFontFace: FONT, valAxisLabelFontSize: 14, catAxisLabelFontSize: 14,
              valGridLine: { color: 'E3E3E3', size: 0.75 }, catGridLine: { color: 'EFEFEF', size: 0.75 },
              showValue: false,
              plotArea: { fill: { color: 'FFFFFF' } }
            });
          }
        }
      }
    }
    return pptx;
  };
})();
