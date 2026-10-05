/* ==========================================================================
   firebase-layer.js — ชั้นเชื่อมต่อ Firebase (Authentication + Firestore)
   ระบบสรุปรายงานประจำเดือน หมวดทางหลวงเชิงเนิน

   - ล็อกอินด้วยชื่อ + รหัสผ่าน (อีเมลสังเคราะห์) และจัดการทีม — วิธีเดียวกับระบบงานอุบัติเหตุ
   - อ่านข้อมูลแบบ realtime + แคชในเครื่อง
   - รูปภาพ (ย่อแล้ว ไม่เกิน ~1 MB): ข้อมูลรูป/รูปย่อใน Firestore คอลเลกชัน photos
     ตัวรูปเก็บใน Google Drive ผ่าน drive-bridge.gs (ถ้าตั้ง DRIVE_BRIDGE_URL) ไม่งั้นเก็บใน Firestore คอลเลกชัน photoData
     รูปเก็บชั่วคราวเฉพาะเดือนที่กำลังทำรายงาน เริ่มเดือนใหม่แล้วลบของเดือนก่อน (ใน Drive = ย้ายเข้าถังขยะ กู้คืนได้ 30 วัน)

   โหมดทดลอง: ถ้ายังไม่ได้ใส่ค่า firebaseConfig (apiKey ว่าง) ระบบทำงานแบบเก็บข้อมูลในเครื่องนี้เท่านั้น
   ใช้ทดลองหน้าจอ/ส่งออกไฟล์ได้ครบ แต่ไม่มีการล็อกอินจริงและเครื่องอื่นมองไม่เห็นข้อมูล

   หมายเหตุ: ค่า firebaseConfig เป็นค่าสาธารณะโดยออกแบบ (ไม่ใช่รหัสลับ) ความปลอดภัยจริงอยู่ที่ firestore.rules
   ========================================================================== */
(function () {
  'use strict';

  // ใส่ค่าจาก Firebase Console → Project settings → Your apps → SDK setup and configuration (Config)
  const firebaseConfig = {
    apiKey: "AIzaSyBtT374sbs4pqjSW3E2YxCv9l3xTdcK5QY",
    authDomain: "choengnoen-monthly.firebaseapp.com",
    projectId: "choengnoen-monthly",
    storageBucket: "choengnoen-monthly.firebasestorage.app",
    messagingSenderId: "396498809334",
    appId: "1:396498809334:web:4ca212b79db672eebe97d7"
  };

  // ▼▼▼ วาง URL ของ drive-bridge (Apps Script → Deploy → Web app ลงท้ายด้วย /exec) ▼▼▼
  //     ว่างไว้ = เก็บรูปใน Firestore (photoData) แบบเดิม
  const DRIVE_BRIDGE_URL = 'https://script.google.com/macros/s/AKfycbzLYR_FCTZBcPRzMDXiRGkxOjKQHHEXGmOnsYJZE6vp4lE3PSHftOq6gpMT3cNV_K1u/exec';

  const EMAIL_DOMAIN = 'monthly.invalid';
  const FBL = {};
  window.FBL = FBL;
  FBL.demo = !firebaseConfig.apiKey;
  FBL.user = null;          // { uid, name, isOwner, isAdmin }
  FBL.onError = null;
  let team = [];

  function nowIso() { return new Date().toISOString(); }
  FBL.nowIso = nowIso;
  function randomId(n) {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, n);
  }
  FBL.randomId = randomId;
  function clean(o) {
    if (o === null || typeof o !== 'object' || o instanceof Uint8Array) return o;
    if (Array.isArray(o)) return o.map(clean);
    const out = {};
    Object.keys(o).forEach(function (k) {
      let v = o[k];
      if (v === undefined) return;
      if (typeof v === 'number' && !isFinite(v)) v = null;
      out[k] = (v && typeof v === 'object') ? clean(v) : v;
    });
    return out;
  }

  function thErr(e) {
    const code = (e && e.code) || '';
    const map = {
      'auth/invalid-credential': 'รหัสผ่านไม่ถูกต้อง',
      'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
      'auth/invalid-login-credentials': 'รหัสผ่านไม่ถูกต้อง',
      'auth/user-not-found': 'ไม่พบบัญชีนี้ในระบบ',
      'auth/too-many-requests': 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
      'auth/network-request-failed': 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่',
      'auth/weak-password': 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร',
      'auth/password-does-not-meet-requirements': 'รหัสผ่านไม่ตรงตามเงื่อนไขความปลอดภัยของระบบ (ยาวอย่างน้อย 8 ตัวอักษร)',
      'auth/requires-recent-login': 'กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่ก่อนเปลี่ยนรหัสผ่าน',
      'auth/operation-not-allowed': 'ยังไม่ได้เปิดการเข้าสู่ระบบแบบ Email/Password ใน Firebase Console',
      'auth/unauthorized-domain': 'โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase (Authentication → Settings → Authorized domains)',
      'permission-denied': 'ไม่มีสิทธิ์ทำรายการนี้ (ตรวจสอบว่าได้วางกฎ firestore.rules แล้ว และล็อกอินด้วยบัญชีที่มีสิทธิ์)',
      'unavailable': 'เชื่อมต่อฐานข้อมูลไม่ได้ในขณะนี้ กรุณาลองใหม่',
      'resource-exhausted': 'ใช้โควตาฐานข้อมูลของวันนี้หมดแล้ว (แผนฟรี) กรุณาลองใหม่พรุ่งนี้',
      'invalid-argument': 'ข้อมูลใหญ่เกินกว่าที่ฐานข้อมูลรับได้'
    };
    return map[code] || ((e && e.message) ? e.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
  }
  FBL.errorText = thErr;
  function requireOwner() { if (!FBL.user || !FBL.user.isOwner) throw new Error('เฉพาะเจ้าของระบบเท่านั้น'); }
  FBL.isPrivileged = function () { return !!(FBL.user && (FBL.user.isOwner || FBL.user.isAdmin)); };
  function requirePrivileged() { if (!FBL.isPrivileged()) throw new Error('เฉพาะเจ้าของระบบหรือผู้ดูแลระบบเท่านั้น'); }
  // รหัสผ่านที่ตั้ง/เปลี่ยนใหม่ ต้องยาวอย่างน้อย 8 ตัว (คนที่ใช้รหัสเดิมอยู่ไม่ถูกบังคับ — ตรวจเฉพาะตอนตั้งใหม่)
  const MIN_PASSWORD = 8;
  function requireNewPassword(p) {
    if (String(p || '').length < MIN_PASSWORD) throw new Error('รหัสผ่านต้องยาวอย่างน้อย ' + MIN_PASSWORD + ' ตัวอักษร');
  }
  FBL.minPassword = MIN_PASSWORD;

  /* ======================================================================
     ที่เก็บข้อมูล 2 แบบ ที่มีหน้าตาเหมือนกัน: Firestore (ใช้งานจริง) / IndexedDB (โหมดทดลอง)
     ====================================================================== */
  let store;

  if (!FBL.demo) {
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();
    try { db.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) { /* ไม่มีแคช */ }
    FBL._auth = auth;
    FBL._db = db;

    store = {
      watch: function (col, onSnap, onErr) { return db.collection(col).onSnapshot(function (snap) {
        onSnap(snap.docs.map(function (d) { return Object.assign({}, d.data(), { __id: d.id }); }));
      }, onErr); },
      get: async function (col, id) { const d = await db.collection(col).doc(id).get(); return d.exists ? d.data() : null; },
      commit: async function (ops) {
        const CHUNK = 20; // เอกสารรูปใหญ่ ~1 MB — แบ่งเป็นชุดเล็กเพื่อไม่ให้คำขอเกินขนาด
        for (let i = 0; i < ops.length; i += CHUNK) {
          const b = db.batch();
          ops.slice(i, i + CHUNK).forEach(function (o) {
            const ref = db.collection(o.col).doc(o.id);
            if (o.op === 'delete') b.delete(ref);
            else if (o.op === 'update') b.update(ref, o.data);
            else b.set(ref, o.data, o.merge ? { merge: true } : {});
          });
          await b.commit();
        }
      },
      toBytes: function (u8) { return firebase.firestore.Blob.fromUint8Array(u8); },
      fromBytes: function (v) { return v && v.toUint8Array ? v.toUint8Array() : v; }
    };
  } else {
    /* ---- โหมดทดลอง: IndexedDB ในเครื่อง ---- */
    const DBN = 'cn-monthly-demo';
    let idbP = null;
    function idb() {
      if (idbP) return idbP;
      idbP = new Promise(function (res, rej) {
        const r = indexedDB.open(DBN, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('docs'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
      return idbP;
    }
    function tx(mode, fn) {
      return idb().then(function (d) {
        return new Promise(function (res, rej) {
          const t = d.transaction('docs', mode);
          const out = fn(t.objectStore('docs'));
          t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
          t.onerror = function () { rej(t.error); };
        });
      });
    }
    const watchers = {};
    function readCol(col) {
      return idb().then(function (d) {
        return new Promise(function (res, rej) {
          const out = [];
          const range = IDBKeyRange.bound(col + '/', col + '/￿');
          const r = d.transaction('docs').objectStore('docs').openCursor(range);
          r.onsuccess = function () {
            const c = r.result;
            if (!c) { res(out); return; }
            out.push(Object.assign({}, c.value, { __id: String(c.key).slice(col.length + 1) }));
            c.continue();
          };
          r.onerror = function () { rej(r.error); };
        });
      });
    }
    function notify(cols) {
      cols.forEach(function (col) {
        (watchers[col] || []).forEach(function (w) { readCol(col).then(w); });
      });
    }
    store = {
      watch: function (col, onSnap) {
        (watchers[col] = watchers[col] || []).push(onSnap);
        readCol(col).then(onSnap);
        return function () { watchers[col] = (watchers[col] || []).filter(function (w) { return w !== onSnap; }); };
      },
      get: function (col, id) {
        return idb().then(function (d) {
          return new Promise(function (res) {
            const r = d.transaction('docs').objectStore('docs').get(col + '/' + id);
            r.onsuccess = function () { res(r.result || null); };
            r.onerror = function () { res(null); };
          });
        });
      },
      commit: async function (ops) {
        const current = {};
        for (const o of ops) {
          if (o.op === 'update' || o.merge) current[o.col + '/' + o.id] = await store.get(o.col, o.id);
        }
        await tx('readwrite', function (s) {
          ops.forEach(function (o) {
            const key = o.col + '/' + o.id;
            if (o.op === 'delete') { s.delete(key); return; }
            let data = o.data;
            if (o.op === 'update' || o.merge) data = Object.assign({}, current[key] || {}, data);
            current[key] = data;
            s.put(data, key);
          });
        });
        notify(Array.from(new Set(ops.map(function (o) { return o.col; }))));
      },
      toBytes: function (u8) { return u8; },
      fromBytes: function (v) { return v; }
    };
  }

  /* ======================================================================
     ทีม / ล็อกอิน
     ====================================================================== */
  const DEMO_USER = { uid: 'demo', name: 'ผู้ทดลองระบบ (โหมดทดลอง)', isOwner: true, isAdmin: false };

  /* ---------- สมุดชื่อล็อกอิน (login_directory) — แผน 6 ----------
     หน้าล็อกอินต้องอ่านรายชื่อได้ก่อนล็อกอิน จึงแยกเก็บเฉพาะ ชื่อ → อีเมลสังเคราะห์ (ไม่มีสถานะเจ้าของ/ผู้ดูแล) ไว้ที่ login_directory/{uid}
     ส่วนตาราง team (มีสถานะเจ้าของ/ผู้ดูแล) อ่านได้เฉพาะสมาชิก — หลังเจ้าของกดย้ายแล้ว (มีเอกสาร login_directory/_ready)
     ก่อนย้าย: ทุกอย่างทำงานแบบเดิม (อ่านรายชื่อจาก team) จึงไม่มีใครล็อกอินไม่ได้ระหว่างเปลี่ยน */
  const DIR_READY_ID = '_ready';
  function dirRef(uid) { return FBL._db.collection('login_directory').doc(uid); }
  function sortTeam(t) {
    t.sort(function (a, b) { return (b.isOwner ? 1 : 0) - (a.isOwner ? 1 : 0) || String(a.name).localeCompare(String(b.name), 'th'); });
    return t;
  }
  async function readLoginDirectory() {
    const snap = await FBL._db.collection('login_directory').get();
    let ready = false;
    const list = [];
    snap.docs.forEach(function (d) {
      if (d.id === DIR_READY_ID) { ready = true; return; }
      const v = d.data();
      if (v && v.name && v.email) list.push({ uid: d.id, name: v.name, email: v.email });
    });
    return { ready: ready, list: list };
  }
  // ก่อนล็อกอิน: อ่านสมุดชื่อ (ไม่มีสถานะเจ้าของ/ผู้ดูแล) · หลังล็อกอิน: อ่านตาราง team เต็ม
  FBL.loadTeam = async function () {
    if (FBL.demo) { team = [Object.assign({ email: '' }, DEMO_USER)]; return team.slice(); }
    let list = null;
    if (!FBL.user) {
      try {
        const dir = await readLoginDirectory();
        if (dir.ready) list = dir.list;
      } catch (e) { /* ยังไม่ได้ประกาศกฎชุดใหม่ — อ่านจาก team แบบเดิม */ }
    }
    if (!list) {
      const snap = await FBL._db.collection('team').get();
      list = snap.docs.map(function (d) { return Object.assign({ uid: d.id }, d.data()); });
    }
    team = sortTeam(list);
    return team.slice();
  };
  FBL.team = function () { return team.slice(); };

  // เจ้าของระบบ: สถานะสมุดชื่อล็อกอิน — ready = ย้ายแล้ว (ปิดไม่ให้คนนอกอ่านตาราง team), missing/extra = ชื่อที่สมุดไม่ตรงกับ team
  FBL.loginDirStatus = async function () {
    const dir = await readLoginDirectory();
    const tsnap = await FBL._db.collection('team').get();
    const inDir = {}; dir.list.forEach(function (e) { inDir[e.uid] = e.email; });
    const inTeam = {};
    const missing = [];
    tsnap.docs.forEach(function (d) {
      const v = d.data(); inTeam[d.id] = true;
      if (inDir[d.id] !== v.email) missing.push(v.name);
    });
    const extra = dir.list.filter(function (e) { return !inTeam[e.uid]; }).map(function (e) { return e.name; });
    return { ready: dir.ready, total: tsnap.size, missing: missing, extra: extra };
  };
  // เจ้าของระบบกดครั้งเดียว: คัดลอก ชื่อ→อีเมล จาก team เข้าสมุดชื่อ แล้วเปิดธง _ready (ทั้งหมดในคำสั่งเดียว สำเร็จทั้งชุดหรือไม่ทำเลย)
  // กดซ้ำได้ปลอดภัย (ใช้ซิงก์สมุดชื่อให้ตรงกับ team อีกครั้ง)
  FBL.migrateLoginDirectory = async function () {
    requireOwner();
    try {
      const tsnap = await FBL._db.collection('team').get();
      const dir = await readLoginDirectory();
      const b = FBL._db.batch();
      const ids = {};
      tsnap.docs.forEach(function (d) {
        const v = d.data(); ids[d.id] = true;
        b.set(dirRef(d.id), { name: v.name, email: v.email });
      });
      dir.list.forEach(function (e) { if (!ids[e.uid]) b.delete(dirRef(e.uid)); });
      b.set(dirRef(DIR_READY_ID), { at: nowIso(), by: FBL.user.uid });
      await b.commit();
      return { total: tsnap.size };
    } catch (e) { throw new Error(thErr(e)); }
  };
  FBL.needsBootstrap = async function () {
    if (FBL.demo) return false;
    const d = await FBL._db.collection('config').doc('bootstrap').get();
    return !d.exists;
  };

  let suppressAuthEvents = false;
  let authSeq = 0;          // นับเหตุการณ์ล็อกอิน/ออก — ผลที่มาช้ากว่าเหตุการณ์ล่าสุดทิ้งไป
  let teamUnsub = null;     // เฝ้าดูรายชื่อของผู้ที่ล็อกอินอยู่ (ถูกลบ/ตั้งรหัสใหม่ = ออกจากระบบ)
  let kickMsg = null;
  function stopTeamWatch() { if (teamUnsub) { teamUnsub(); teamUnsub = null; } }
  FBL.onAuth = function (cb) {
    if (FBL.demo) {
      let on = false;
      try { on = sessionStorage.getItem('cn-monthly-demo-login') === '1'; } catch (e) { /* ข้าม */ }
      FBL.user = on ? Object.assign({}, DEMO_USER) : null;
      FBL._demoCb = cb;
      setTimeout(function () { cb(FBL.user); }, 0);
      return;
    }
    FBL._auth.onAuthStateChanged(async function (u) {
      if (suppressAuthEvents) return;
      const seq = ++authSeq;
      stopTeamWatch();
      if (!u) { FBL.user = null; const m = kickMsg; kickMsg = null; cb(null, m); return; }
      try {
        const d = await FBL._db.collection('team').doc(u.uid).get();
        if (seq !== authSeq) return;
        if (!d.exists) {
          FBL.user = null;
          await FBL._auth.signOut();
          cb(null, 'บัญชีนี้ไม่ได้อยู่ในรายชื่อเจ้าหน้าที่ กรุณาติดต่อเจ้าของระบบ');
          return;
        }
        FBL.user = { uid: u.uid, name: d.data().name, isOwner: !!d.data().isOwner, isAdmin: !!d.data().isAdmin };
        try { await FBL.loadTeam(); } catch (e) { /* ข้าม — หน้าตั้งค่าจะแสดงรายชื่อเท่าที่มี */ }   // ล็อกอินแล้วอ่านตาราง team เต็มได้ (มีสถานะเจ้าของ/ผู้ดูแล)
        if (seq !== authSeq) return;
        teamUnsub = FBL._db.collection('team').doc(u.uid).onSnapshot(function (s) {
          if (s.exists || s.metadata.fromCache || !FBL.user || FBL.user.uid !== u.uid) return;
          kickMsg = 'บัญชีนี้ถูกลบหรือถูกตั้งรหัสผ่านใหม่ กรุณาเข้าสู่ระบบอีกครั้ง';
          FBL.logout();
        }, function () { /* ข้าม */ });
        cb(FBL.user);
      } catch (e) {
        if (seq !== authSeq) return;
        FBL.user = null;
        // ต้องออกจาก Firebase Auth ด้วย: ถ้าค้างไว้ ล็อกอินชื่อเดิมซ้ำ Firebase จะไม่แจ้งเหตุการณ์ (uid เดิม) ปุ่มเข้าสู่ระบบจะเงียบ
        try { await FBL._auth.signOut(); } catch (_) { /* ข้าม */ }
        cb(null, thErr(e));
      }
    });
  };

  FBL.login = async function (name, password) {
    if (FBL.demo) {
      try { sessionStorage.setItem('cn-monthly-demo-login', '1'); } catch (e) { /* ข้าม */ }
      FBL.user = Object.assign({}, DEMO_USER);
      if (FBL._demoCb) FBL._demoCb(FBL.user);
      return;
    }
    name = String(name || '').trim();
    const find = function () { return team.find(function (x) { return x.name === name; }); };
    const reload = function () { return FBL.loadTeam().then(find, function () { return null; }); };
    const m = find() || await reload();
    if (!m) throw new Error('ไม่พบชื่อนี้ในระบบ');
    try { await FBL._auth.signInWithEmailAndPassword(m.email, password); }
    catch (e) {
      // รายชื่อในหน้านี้อาจเก่า (เจ้าของระบบเพิ่งตั้งรหัสผ่านใหม่ = บัญชีล็อกอินใหม่) — โหลดใหม่แล้วลองอีกครั้ง
      const again = await reload();
      if (!again || again.email === m.email) throw new Error(thErr(e));
      try { await FBL._auth.signInWithEmailAndPassword(again.email, password); }
      catch (e2) { throw new Error(thErr(e2)); }
    }
  };

  FBL.logout = async function () {
    stopTeamWatch();
    FBL.stopAll();
    if (FBL.demo) {
      try { sessionStorage.removeItem('cn-monthly-demo-login'); } catch (e) { /* ข้าม */ }
      FBL.user = null;
      if (FBL._demoCb) FBL._demoCb(null);
      return;
    }
    await FBL._auth.signOut();
  };

  /* ==== IDLE-GUARD v1 — ออกจากระบบอัตโนมัติเมื่อไม่ได้ใช้งาน + ล้างข้อมูลแคชในเครื่อง (โค้ดชุดเดียวกันทุกระบบ ห้ามแก้เฉพาะระบบ) ====
     - นับเวลาจากเมาส์/แป้นพิมพ์/แตะจอ รวมทุกแท็บของระบบเดียวกัน (แชร์ผ่าน localStorage)
     - เตือนก่อนออก (ไม่ขัดจังหวะ ไม่ดึงโฟกัสจากช่องที่กำลังพิมพ์) แล้วออกจากระบบ: signOut → terminate → clearPersistence → โหลดหน้าใหม่
     - ทดสอบ: ตั้ง localStorage 'fbl_idle_test' = "วินาทีออก,วินาทีเตือน" (ใช้ได้เฉพาะ "ลดเวลา" ลง ไม่ทำให้ยาวขึ้น) */
  if (!FBL.demo) (function (FBL, auth, db, pid) {
    var IDLE_MIN = 60, WARN_MIN = 5;
    var idleMs = IDLE_MIN * 60000, warnMs = WARN_MIN * 60000;
    try {
      var tst = String(localStorage.getItem('fbl_idle_test') || '').split(',');
      if (+tst[0] > 0) { idleMs = Math.min(idleMs, +tst[0] * 1000); warnMs = Math.min(warnMs, (+tst[1] > 0 ? +tst[1] : +tst[0] / 3) * 1000, idleMs - 1000); }
    } catch (e) { /* ข้าม */ }
    var K_ACT = 'fbl_idle_act_' + pid, K_OUT = 'fbl_idle_out_' + pid, K_DONE = 'fbl_idle_done_' + pid;
    var lastLocal = 0, lastWrite = 0, warnEl = null, shield = null, leaving = false, inFlight = null, leader = false;

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function lsGet(k) { try { return +localStorage.getItem(k) || 0; } catch (e) { return 0; } }
    function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* ข้าม */ } }
    function lastActive() { return Math.max(lastLocal, lsGet(K_ACT)); }
    function touch() {
      var n = Date.now(); lastLocal = n;
      if (n - lastWrite > 3000) { lastWrite = n; lsSet(K_ACT, n); }
      if (warnEl) hideWarn();
    }
    var staleOnLoad = lsGet(K_ACT) > 0 && Date.now() - lsGet(K_ACT) >= idleMs; // เปิดหน้าขึ้นมาตอนที่ค้างไม่ได้ใช้งานเกินกำหนดแล้ว
    if (!lsGet(K_ACT)) lsSet(K_ACT, Date.now()); // ครั้งแรกที่ใช้ระบบนี้ในเครื่อง — ยังไม่มีบันทึก ถือว่าเริ่มนับจากตอนนี้

    /* ---------- กล่องเตือน ---------- */
    function dirtyCount() {
      var n = 0;
      try {
        var els = document.querySelectorAll('input:not([type=password]):not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea');
        for (var i = 0; i < els.length; i++) { var el = els[i]; if (el.offsetParent !== null && !el.readOnly && !el.disabled && el.value !== el.defaultValue) n++; }
      } catch (e) { /* ข้าม */ }
      return n;
    }
    function fmt(ms) { var s = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(s / 60); return m + ':' + ('0' + (s % 60)).slice(-2); }
    function showWarn(left) {
      if (!warnEl) {
        warnEl = document.createElement('div');
        warnEl.setAttribute('role', 'alert');
        warnEl.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;max-width:340px;background:#fff8e1;color:#4a3300;border:2px solid #f59e0b;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.35);padding:14px 16px;font:14px/1.5 system-ui,"Sarabun","Noto Sans Thai",sans-serif';
        warnEl.innerHTML = '<div style="font-weight:700;margin-bottom:4px">⏱ ไม่มีการใช้งานสักครู่</div>' +
          '<div>ระบบจะออกจากระบบอัตโนมัติใน <b data-idle-left></b> เพื่อความปลอดภัยของข้อมูล</div>' +
          '<div data-idle-dirty style="display:none;margin-top:6px;color:#b45309;font-weight:600"></div>' +
          '<button type="button" data-idle-stay style="margin-top:10px;width:100%;padding:8px;border:0;border-radius:8px;background:#f59e0b;color:#fff;font:inherit;font-weight:700;cursor:pointer">ยังใช้งานอยู่ — อยู่ต่อ</button>';
        warnEl.querySelector('[data-idle-stay]').onclick = function () { touch(); };
        // ไม่ดึงโฟกัสออกจากช่องที่กำลังพิมพ์: กดปุ่มนี้ด้วยเมาส์ไม่ย้ายโฟกัส
        warnEl.addEventListener('mousedown', function (e) { e.preventDefault(); });
        (document.body || document.documentElement).appendChild(warnEl);
      }
      warnEl.querySelector('[data-idle-left]').textContent = fmt(left);
      var d = dirtyCount(), dEl = warnEl.querySelector('[data-idle-dirty]');
      if (d > 0) { dEl.style.display = 'block'; dEl.textContent = 'อาจมีข้อมูลที่กรอกค้างอยู่ ' + d + ' ช่อง — กดบันทึกก่อนครบเวลา ไม่เช่นนั้นข้อมูลจะหาย'; }
      else dEl.style.display = 'none';
    }
    function hideWarn() { if (warnEl) { warnEl.remove(); warnEl = null; } }
    function showShield() {
      if (shield) return;
      shield = document.createElement('div');
      shield.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:#0b2540;color:#fff;display:flex;align-items:center;justify-content:center;font:600 18px system-ui,"Sarabun","Noto Sans Thai",sans-serif';
      shield.textContent = 'กำลังออกจากระบบและล้างข้อมูลในเครื่อง...';
      (document.body || document.documentElement).appendChild(shield);
    }

    /* ---------- ออกจากระบบ + ล้างแคช ---------- */
    async function wipe() {
      try { await db.terminate(); } catch (e) { /* ข้าม */ }
      for (var i = 0; i < 8; i++) {
        try { await db.clearPersistence(); return true; } catch (e) { await sleep(500); }
      }
      console.warn('ล้างแคชในเครื่องไม่สำเร็จ (อาจมีแท็บอื่นเปิดระบบนี้ค้างอยู่)');
      return false;
    }
    var origLogout = FBL.logout;
    FBL.logout = function () {
      if (inFlight) return inFlight;
      var args = arguments;
      leaving = true; leader = true; FBL._leaving = true;
      hideWarn(); showShield();
      inFlight = (async function () {
        setTimeout(function () { location.reload(); }, 25000); // กันค้าง
        lsSet(K_OUT, Date.now());                    // บอกแท็บอื่นของระบบนี้ให้ปิดฐานข้อมูล (ไม่งั้นล้างแคชไม่ได้)
        // ส่งข้อมูลที่ค้างรอส่งขึ้นเซิร์ฟเวอร์ให้เสร็จก่อน ไม่งั้นการล้างแคชจะทำให้ข้อมูลที่เพิ่งบันทึกตอนออฟไลน์หาย
        try { await Promise.race([db.waitForPendingWrites(), sleep(5000)]); } catch (e) { /* ข้าม */ }
        try { await origLogout.apply(FBL, args); } catch (e) { /* ข้าม */ }
        try { await auth.signOut(); } catch (e) { /* ข้าม */ }
        await wipe();
        lsSet(K_DONE, Date.now());
        location.reload();
        await new Promise(function () { });          // ไม่ให้โค้ดหลังปุ่มออกจากระบบทำงานต่อระหว่างโหลดหน้าใหม่
      })();
      return inFlight;
    };

    // แท็บอื่นของระบบเดียวกัน: ปิดฐานข้อมูลแล้วรอแท็บที่กดออกล้างเสร็จ จึงโหลดใหม่
    window.addEventListener('storage', function (e) {
      if (e.key === K_OUT && e.newValue && !leader && !leaving) {
        leaving = true; FBL._leaving = true; showShield();
        try { db.terminate().catch(function () { }); } catch (x) { /* ข้าม */ }
        setTimeout(function () { location.reload(); }, 15000);
      } else if (e.key === K_DONE && e.newValue && !leader && leaving) {
        location.reload();
      }
    });

    /* ---------- นับเวลาไม่ใช้งาน ---------- */
    ['mousemove', 'mousedown', 'pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll', 'click'].forEach(function (t) {
      window.addEventListener(t, touch, { passive: true, capture: true });
    });
    // เหตุการณ์ล็อกอินครั้งแรกหลังเปิดหน้า: ถ้าเป็นเซสชันเก่าที่ค้างมานานเกินกำหนด ให้ออกจากระบบทันที (ไม่ให้แค่ขยับเมาส์แล้วเข้าได้เลย)
    auth.onAuthStateChanged(function (u) { if (u && staleOnLoad && !leaving) FBL.logout(); staleOnLoad = false; });
    function tick() {
      if (leaving || !auth.currentUser) { if (!auth.currentUser) hideWarn(); return; }
      var idle = Date.now() - lastActive();
      if (idle >= idleMs) FBL.logout();
      else if (idle >= idleMs - warnMs) showWarn(idleMs - idle);
      else if (warnEl) hideWarn();
    }
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  })(FBL, FBL._auth, FBL._db, firebaseConfig.projectId);

  function newEmail() { return 'm-' + randomId(12) + '@' + EMAIL_DOMAIN; }

  FBL.bootstrapOwner = async function (name, password) {
    name = String(name || '').trim();
    if (!name) throw new Error('กรอกชื่อ-นามสกุลก่อน');
    requireNewPassword(password);
    suppressAuthEvents = true;
    try {
      const email = newEmail();
      const cred = await FBL._auth.createUserWithEmailAndPassword(email, password);
      const uid = cred.user.uid;
      try {
        const b = FBL._db.batch();
        b.set(FBL._db.collection('team').doc(uid), { name: name, email: email, isOwner: true, isAdmin: false, createdAt: nowIso() });
        b.set(FBL._db.collection('config').doc('bootstrap'), { uid: uid, at: nowIso() });
        b.set(dirRef(uid), { name: name, email: email });
        b.set(dirRef(DIR_READY_ID), { at: nowIso(), by: uid });   // ระบบใหม่ใช้สมุดชื่อตั้งแต่แรก
        await b.commit();
      } catch (e) {
        try { await cred.user.delete(); } catch (_) { /* ล้างบัญชีที่ค้าง */ }
        throw e;
      }
      FBL.user = { uid: uid, name: name, isOwner: true, isAdmin: false };
      team = [{ uid: uid, name: name, email: email, isOwner: true, isAdmin: false }];
      return FBL.user;
    } catch (e) { throw new Error(thErr(e)); }
    finally { suppressAuthEvents = false; }
  };

  async function createAuthUserSecondary(email, password) {
    const sec = firebase.apps.find(function (a) { return a.name === 'secondary'; }) || firebase.initializeApp(firebaseConfig, 'secondary');
    const cred = await sec.auth().createUserWithEmailAndPassword(email, password);
    const uid = cred.user.uid;
    await sec.auth().signOut();
    return uid;
  }
  function demoTeamBlock() { if (FBL.demo) throw new Error('โหมดทดลองจัดการทีมไม่ได้ — ต้องเชื่อมต่อ Firebase ก่อน'); }

  FBL.addMember = async function (name, password, isAdmin) {
    demoTeamBlock(); requireOwner();
    name = String(name || '').trim();
    if (!name) throw new Error('กรอกชื่อ-นามสกุลก่อน');
    if (team.some(function (t) { return t.name === name; })) throw new Error('มีชื่อนี้เป็นเจ้าหน้าที่อยู่แล้ว');
    requireNewPassword(password);
    try {
      const email = newEmail();
      const uid = await createAuthUserSecondary(email, password);
      const b = FBL._db.batch();
      b.set(FBL._db.collection('team').doc(uid), { name: name, email: email, isOwner: false, isAdmin: !!isAdmin, createdAt: nowIso() });
      b.set(dirRef(uid), { name: name, email: email });
      await b.commit();
      team.push({ uid: uid, name: name, email: email, isOwner: false, isAdmin: !!isAdmin });
    } catch (e) { throw new Error(thErr(e)); }
  };
  FBL.removeMember = async function (name) {
    demoTeamBlock(); requireOwner();
    const m = team.find(function (t) { return t.name === name; });
    if (!m) return;
    if (m.isOwner) throw new Error('ลบเจ้าของระบบไม่ได้');
    try {
      const b = FBL._db.batch();
      b.delete(FBL._db.collection('team').doc(m.uid));
      b.delete(dirRef(m.uid));
      await b.commit();
      team = team.filter(function (t) { return t.uid !== m.uid; });
    }
    catch (e) { throw new Error(thErr(e)); }
  };
  FBL.setMemberAdmin = async function (name, makeAdmin) {
    demoTeamBlock(); requireOwner();
    const m = team.find(function (t) { return t.name === name; });
    if (!m) throw new Error('ไม่พบชื่อนี้ในรายชื่อ');
    if (m.isOwner) throw new Error('เจ้าของระบบมีสิทธิ์ครบอยู่แล้ว');
    try { await FBL._db.collection('team').doc(m.uid).update({ isAdmin: !!makeAdmin }); m.isAdmin = !!makeAdmin; }
    catch (e) { throw new Error(thErr(e)); }
  };
  // ตั้งรหัสผ่านใหม่ให้คนอื่น = สร้างบัญชีล็อกอินใหม่แล้วสลับรายชื่อ (ข้อจำกัดของ Firebase ฝั่งเบราว์เซอร์)
  FBL.resetMemberPassword = async function (name, newPassword) {
    demoTeamBlock(); requireOwner();
    const m = team.find(function (t) { return t.name === name; });
    if (!m) throw new Error('ไม่พบชื่อนี้ในรายชื่อ');
    requireNewPassword(newPassword);
    try {
      if (FBL.user && m.uid === FBL.user.uid) { await FBL._auth.currentUser.updatePassword(newPassword); return; }
      const email = newEmail();
      const uid = await createAuthUserSecondary(email, newPassword);
      const b = FBL._db.batch();
      b.delete(FBL._db.collection('team').doc(m.uid));
      b.set(FBL._db.collection('team').doc(uid), { name: m.name, email: email, isOwner: !!m.isOwner, isAdmin: !!m.isAdmin, createdAt: nowIso() });
      b.delete(dirRef(m.uid));
      b.set(dirRef(uid), { name: m.name, email: email });
      await b.commit();
      team = team.filter(function (t) { return t.uid !== m.uid; });
      team.push({ uid: uid, name: m.name, email: email, isOwner: !!m.isOwner, isAdmin: !!m.isAdmin });
    } catch (e) { throw new Error(thErr(e)); }
  };

  /* ======================================================================
     อ่าน / เขียนข้อมูล
     ====================================================================== */
  // บอกว่าไม่มีสิทธิ์ที่คอลเลกชันไหน — ใช้เทียบกับกฎใน Firebase Console
  function where(e, act, cols) {
    if (!e || e.code !== 'permission-denied') return '';
    return ' [' + act + ': ' + Array.from(new Set(cols)).join(', ') + ']';
  }
  const subs = {};
  FBL.watch = function (col, onChange) {
    if (subs[col]) { subs[col].onChange = onChange || subs[col].onChange; return subs[col].first; }
    const s = subs[col] = { docs: [], firstDone: false, onChange: onChange };
    s.first = new Promise(function (resolve) {
      s.unsub = store.watch(col, function (docs) {
        s.docs = docs;
        if (!s.firstDone) { s.firstDone = true; resolve(docs); }
        else if (s.onChange) { try { s.onChange(col, docs); } catch (e) { console.error(e); } }
      }, function (err) {
        console.error('watch ' + col + ' failed', err);
        if (FBL.onError) FBL.onError(thErr(err) + where(err, 'อ่าน', [col]));
        if (!s.firstDone) { s.firstDone = true; resolve([]); }
      });
    });
    return s.first;
  };
  FBL.docs = function (col) { return subs[col] ? subs[col].docs : []; };
  FBL.stopAll = function () {
    Object.keys(subs).forEach(function (k) { if (subs[k].unsub) subs[k].unsub(); delete subs[k]; });
  };

  FBL.get = async function (col, id) {
    try { return await store.get(col, String(id)); } catch (e) { throw new Error(thErr(e) + where(e, 'อ่าน', [col])); }
  };
  // ops: [{ op: 'set'|'update'|'delete', col, id, data, merge }]
  FBL.commit = async function (ops) {
    const list = ops.map(function (o) { return Object.assign({}, o, { id: String(o.id), data: o.data ? clean(o.data) : o.data }); });
    try { await store.commit(list); } catch (e) { throw new Error(thErr(e) + where(e, 'บันทึก', list.map(function (o) { return o.col; }))); }
  };
  FBL.set = function (col, id, data, merge) { return FBL.commit([{ op: 'set', col: col, id: id, data: data, merge: !!merge }]); };
  FBL.del = function (col, id) { return FBL.commit([{ op: 'delete', col: col, id: id }]); };

  /* ---------- รูปภาพ: ข้อมูลรูป/รูปย่อใน photos · ตัวรูปใน Google Drive หรือ photoData (ไม่โหลดจนกว่าจะใช้) ---------- */
  const DRIVE = !FBL.demo && /^https:\/\/script\.google\.com\/.+\/exec$/.test(DRIVE_BRIDGE_URL);
  FBL.photoStore = DRIVE ? 'drive' : 'firestore';

  async function bridge(body, timeoutMs) {
    if (!FBL._auth.currentUser) throw new Error('ยังไม่ได้ล็อกอิน');
    body.idToken = await FBL._auth.currentUser.getIdToken();
    let r, j;
    const ac = timeoutMs && window.AbortController ? new AbortController() : null;
    const tm = ac ? setTimeout(function () { ac.abort(); }, timeoutMs) : null;
    try {
      // text/plain = ไม่ต้องมีคำขอ preflight (Apps Script ไม่รองรับ OPTIONS)
      try { r = await fetch(DRIVE_BRIDGE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ac ? ac.signal : undefined }); }
      catch (e) { throw new Error(ac && ac.signal.aborted ? 'Google Drive ตอบช้าเกินไป กรุณาลองใหม่' : 'เชื่อมต่อ Google Drive ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'); }
      try { j = await r.json(); } catch (e) { throw new Error(ac && ac.signal.aborted ? 'Google Drive ตอบช้าเกินไป กรุณาลองใหม่' : 'ตัวกลาง Google Drive ตอบกลับผิดรูปแบบ (ตรวจสอบการ Deploy ของ drive-bridge ว่าเลือก Who has access = Anyone)'); }
    } finally { if (tm) clearTimeout(tm); }
    if (!j.ok) throw new Error(j.error || 'Google Drive ทำรายการไม่สำเร็จ');
    return j;
  }
  function toB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(s) {
    const bin = atob(s), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function driveName(id) { return id + '.jpg'; }

  // เก็บตัวรูปไว้ในเครื่อง (IndexedDB) — ส่งออกครั้งต่อไป/รูปที่อัปโหลดจากเครื่องนี้ ไม่ต้องโหลดจาก Drive ซ้ำ
  let idbP = null;
  function idb() {
    if (!idbP) idbP = new Promise(function (resolve) {
      try {
        const rq = indexedDB.open('cn-monthly-photos', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('b'); };
        rq.onsuccess = function () { resolve(rq.result); };
        rq.onerror = rq.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return idbP;
  }
  function idbDo(mode, fn) {
    return idb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          const tx = db.transaction('b', mode), rq = fn(tx.objectStore('b'));
          tx.oncomplete = function () { resolve(rq && rq.result); };
          tx.onerror = tx.onabort = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }
  function idbGet(id) { return idbDo('readonly', function (s) { return s.get(id); }).then(function (v) { return v instanceof Uint8Array ? v : v ? new Uint8Array(v) : null; }); }
  function idbPut(id, u8) { return idbDo('readwrite', function (s) { s.put(u8, id); }); }
  function idbDel(ids) { return idbDo('readwrite', function (s) { ids.forEach(function (id) { s.delete(id); }); }); }

  // รหัสไฟล์ใน Drive (บันทึกไว้ตอนอัปโหลด) — ให้ตัวกลางเปิดไฟล์ได้ทันทีโดยไม่ต้องค้นหาตามชื่อ
  function driveIdOf(id) {
    const p = FBL.docs('photos').find(function (d) { return d.__id === id; });
    return (p && p.driveId) || '';
  }
  // คำขอละ 1 รูป ส่งพร้อมกันได้ 10 คำขอ (Apps Script อ่านรูปในคำขอเดียวทีละรูป — แยกคำขอแล้วได้ทำงานขนานกันจริง)
  // ตอบช้าเกิน 60 วินาทีลองใหม่ 1 ครั้ง
  const GET_BATCH = 1, GET_PARALLEL = 10, GET_TIMEOUT = 60000;
  let queue = [], timer = null, running = 0;
  function driveGet(id) {
    return new Promise(function (resolve, reject) {
      queue.push({ id: id, resolve: resolve, reject: reject });
      if (!timer) timer = setTimeout(pump, 40);
    });
  }
  function pump() {
    timer = null;
    while (running < GET_PARALLEL && queue.length) {
      const part = queue.splice(0, GET_BATCH);
      running++;
      const done = function () { running--; pump(); };
      fetchPart(part, 1).then(done, done);
    }
  }
  function fetchPart(part, retries) {
    return bridge({
      action: 'get',
      names: part.map(function (x) { return driveName(x.id); }),
      ids: part.map(function (x) { return driveIdOf(x.id); })
    }, GET_TIMEOUT).then(function (j) {
      const by = {};
      (j.files || []).forEach(function (f) { by[f.name] = f; });
      part.forEach(function (x) {
        const f = by[driveName(x.id)];
        // รูปเก่าที่ยังไม่มีรหัสไฟล์ Drive — จดไว้ให้ครั้งหน้าเร็วขึ้น
        if (f && f.id && !driveIdOf(x.id)) FBL.commit([{ op: 'update', col: 'photos', id: x.id, data: { driveId: f.id } }]).catch(function () {});
        x.resolve(f && !f.missing ? fromB64(f.data) : null);
      });
    }, function (e) {
      if (retries > 0) return fetchPart(part, retries - 1);
      part.forEach(function (x) { x.reject(e); });
    });
  }

  FBL.savePhoto = async function (id, meta, bytes) {
    if (DRIVE) {
      const j = await bridge({ action: 'put', name: driveName(id), month: meta.mk, slot: meta.slot, orig: meta.name, data: toB64(bytes) });
      if (j.size !== bytes.length) throw new Error('อัปโหลดรูปไม่ครบ กรุณาลองใหม่');
      await FBL.set('photos', id, Object.assign({}, meta, { store: 'drive', driveId: j.id || '' }));
      idbPut(id, bytes);
      return;
    }
    await FBL.commit([
      { op: 'set', col: 'photoData', id: id, data: { data: store.toBytes(bytes), mk: meta.mk } },
      { op: 'set', col: 'photos', id: id, data: meta }
    ]);
  };
  const photoCache = new Map(), photoLoading = new Map();
  // รูปเดียวกันที่ถูกขอซ้ำระหว่างกำลังโหลด (เช่น โหลดล่วงหน้าอยู่แล้วกดส่งออก) ใช้คำขอเดิม ไม่โหลดซ้ำ
  FBL.photoBytes = function (id) {
    if (photoCache.has(id)) return Promise.resolve(photoCache.get(id));
    if (!photoLoading.has(id)) photoLoading.set(id, loadPhoto(id).finally(function () { photoLoading.delete(id); }));
    return photoLoading.get(id);
  };
  async function loadPhoto(id) {
    let u8 = DRIVE ? await idbGet(id) : null;
    const local = !!u8;
    if (!u8 && DRIVE) u8 = await driveGet(id);
    if (!u8) {   // รูปที่อัปโหลดก่อนเปลี่ยนมาใช้ Drive ยังอยู่ใน photoData
      const d = await FBL.get('photoData', id);
      if (!d || !d.data) throw new Error('ไม่พบข้อมูลรูป (อาจถูกลบไปแล้ว)');
      u8 = store.fromBytes(d.data);
    }
    if (DRIVE && !local) idbPut(id, u8);
    photoCache.set(id, u8);
    return u8;
  }
  // โหลดรูปล่วงหน้าพร้อมกันหลายรูป (ก่อนส่งออก) — รูปที่โหลดไม่ได้ข้ามไป ให้ photoBytes แจ้งตอนใช้จริง
  // onProgress(โหลดเสร็จแล้ว, ทั้งหมด)
  FBL.prefetchPhotos = function (ids, onProgress) {
    let n = 0;
    return Promise.all(ids.map(function (id) {
      return FBL.photoBytes(id).catch(function () { return null; }).then(function (v) {
        n++; if (onProgress) onProgress(n, ids.length);
        return v;
      });
    }));
  };
  // ลบแบบซ่อน (ถังขยะ): ทุกคนทำได้ (เป็นการแก้เอกสาร) — เจ้าของ/ผู้ดูแลตรวจแล้วค่อยลบจริง (FBL.deletePhotos / FBL.del)
  FBL.setDeleted = function (col, ids, on) {
    const stamp = on ? { deletedAt: nowIso(), deletedBy: FBL.user ? FBL.user.name : '' } : { deletedAt: null, deletedBy: '' };
    return FBL.commit(ids.map(function (id) { return { op: 'update', col: col, id: id, data: stamp }; }));
  };
  FBL.deletePhotos = async function (ids) {
    requirePrivileged();   // ลบรูป: เจ้าของ/ผู้ดูแลระบบเท่านั้น (บังคับที่ firestore.rules ด้วย) — ตรวจก่อนเริ่ม ไม่ให้ลบไฟล์ใน Drive ไปแล้วค่อยพบว่าลบข้อมูลไม่ได้
    if (DRIVE) {
      // ย้ายเข้าถังขยะของ Drive (กู้คืนได้ 30 วัน) ก่อน แล้วค่อยลบข้อมูลรูปใน Firestore
      for (let i = 0; i < ids.length; i += 100) await bridge({ action: 'del', names: ids.slice(i, i + 100).map(driveName) });
    }
    const ops = [];
    ids.forEach(function (id) {
      ops.push({ op: 'delete', col: 'photos', id: id });
      ops.push({ op: 'delete', col: 'photoData', id: id });
      photoCache.delete(id);
    });
    idbDel(ids);
    await FBL.commit(ops);
  };
})();
