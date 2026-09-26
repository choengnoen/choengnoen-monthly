/* ==========================================================================
   firebase-layer.js — ชั้นเชื่อมต่อ Firebase (Authentication + Firestore)
   ระบบสรุปรายงานประจำเดือน หมวดทางหลวงเชิงเนิน

   - ล็อกอินด้วยชื่อ + รหัสผ่าน (อีเมลสังเคราะห์) และจัดการทีม — วิธีเดียวกับระบบงานอุบัติเหตุ
   - อ่านข้อมูลแบบ realtime + แคชในเครื่อง
   - เก็บรูปภาพ (ย่อแล้ว) เป็นข้อมูลไบนารีใน Firestore คอลเลกชัน photoData (1 รูป = 1 เอกสาร ไม่เกิน ~1 MB)
     รูปเก็บชั่วคราวเฉพาะเดือนที่กำลังทำรายงาน เริ่มเดือนใหม่แล้วลบของเดือนก่อน

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
      'auth/weak-password': 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร',
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

  FBL.loadTeam = async function () {
    if (FBL.demo) { team = [Object.assign({ email: '' }, DEMO_USER)]; return team.slice(); }
    const snap = await FBL._db.collection('team').get();
    team = snap.docs.map(function (d) { return Object.assign({ uid: d.id }, d.data()); });
    team.sort(function (a, b) { return (b.isOwner ? 1 : 0) - (a.isOwner ? 1 : 0) || String(a.name).localeCompare(String(b.name), 'th'); });
    return team.slice();
  };
  FBL.team = function () { return team.slice(); };
  FBL.needsBootstrap = async function () {
    if (FBL.demo) return false;
    const d = await FBL._db.collection('config').doc('bootstrap').get();
    return !d.exists;
  };

  let suppressAuthEvents = false;
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
      if (!u) { FBL.user = null; cb(null); return; }
      try {
        const d = await FBL._db.collection('team').doc(u.uid).get();
        if (!d.exists) {
          FBL.user = null;
          await FBL._auth.signOut();
          cb(null, 'บัญชีนี้ไม่ได้อยู่ในรายชื่อเจ้าหน้าที่ กรุณาติดต่อเจ้าของระบบ');
          return;
        }
        FBL.user = { uid: u.uid, name: d.data().name, isOwner: !!d.data().isOwner, isAdmin: !!d.data().isAdmin };
        cb(FBL.user);
      } catch (e) { FBL.user = null; cb(null, thErr(e)); }
    });
  };

  FBL.login = async function (name, password) {
    if (FBL.demo) {
      try { sessionStorage.setItem('cn-monthly-demo-login', '1'); } catch (e) { /* ข้าม */ }
      FBL.user = Object.assign({}, DEMO_USER);
      if (FBL._demoCb) FBL._demoCb(FBL.user);
      return;
    }
    const m = team.find(function (x) { return x.name === String(name || '').trim(); });
    if (!m) throw new Error('ไม่พบชื่อนี้ในระบบ');
    try { await FBL._auth.signInWithEmailAndPassword(m.email, password); }
    catch (e) { throw new Error(thErr(e)); }
  };

  FBL.logout = async function () {
    FBL.stopAll();
    if (FBL.demo) {
      try { sessionStorage.removeItem('cn-monthly-demo-login'); } catch (e) { /* ข้าม */ }
      FBL.user = null;
      if (FBL._demoCb) FBL._demoCb(null);
      return;
    }
    await FBL._auth.signOut();
  };

  function newEmail() { return 'm-' + randomId(12) + '@' + EMAIL_DOMAIN; }

  FBL.bootstrapOwner = async function (name, password) {
    name = String(name || '').trim();
    if (!name) throw new Error('กรอกชื่อ-นามสกุลก่อน');
    suppressAuthEvents = true;
    try {
      const email = newEmail();
      const cred = await FBL._auth.createUserWithEmailAndPassword(email, password);
      const uid = cred.user.uid;
      try {
        const b = FBL._db.batch();
        b.set(FBL._db.collection('team').doc(uid), { name: name, email: email, isOwner: true, isAdmin: false, createdAt: nowIso() });
        b.set(FBL._db.collection('config').doc('bootstrap'), { uid: uid, at: nowIso() });
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
    try {
      const email = newEmail();
      const uid = await createAuthUserSecondary(email, password);
      await FBL._db.collection('team').doc(uid).set({ name: name, email: email, isOwner: false, isAdmin: !!isAdmin, createdAt: nowIso() });
      team.push({ uid: uid, name: name, email: email, isOwner: false, isAdmin: !!isAdmin });
    } catch (e) { throw new Error(thErr(e)); }
  };
  FBL.removeMember = async function (name) {
    demoTeamBlock(); requireOwner();
    const m = team.find(function (t) { return t.name === name; });
    if (!m) return;
    if (m.isOwner) throw new Error('ลบเจ้าของระบบไม่ได้');
    try { await FBL._db.collection('team').doc(m.uid).delete(); team = team.filter(function (t) { return t.uid !== m.uid; }); }
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
    try {
      if (FBL.user && m.uid === FBL.user.uid) { await FBL._auth.currentUser.updatePassword(newPassword); return; }
      const email = newEmail();
      const uid = await createAuthUserSecondary(email, newPassword);
      const b = FBL._db.batch();
      b.delete(FBL._db.collection('team').doc(m.uid));
      b.set(FBL._db.collection('team').doc(uid), { name: m.name, email: email, isOwner: !!m.isOwner, isAdmin: !!m.isAdmin, createdAt: nowIso() });
      await b.commit();
      team = team.filter(function (t) { return t.uid !== m.uid; });
      team.push({ uid: uid, name: m.name, email: email, isOwner: !!m.isOwner, isAdmin: !!m.isAdmin });
    } catch (e) { throw new Error(thErr(e)); }
  };

  /* ======================================================================
     อ่าน / เขียนข้อมูล
     ====================================================================== */
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
        if (FBL.onError) FBL.onError(thErr(err));
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
    try { return await store.get(col, String(id)); } catch (e) { throw new Error(thErr(e)); }
  };
  // ops: [{ op: 'set'|'update'|'delete', col, id, data, merge }]
  FBL.commit = async function (ops) {
    const list = ops.map(function (o) { return Object.assign({}, o, { id: String(o.id), data: o.data ? clean(o.data) : o.data }); });
    try { await store.commit(list); } catch (e) { throw new Error(thErr(e)); }
  };
  FBL.set = function (col, id, data, merge) { return FBL.commit([{ op: 'set', col: col, id: id, data: data, merge: !!merge }]); };
  FBL.del = function (col, id) { return FBL.commit([{ op: 'delete', col: col, id: id }]); };

  /* ---------- รูปภาพ: ข้อมูลรูปเต็มแยกไว้ใน photoData (ไม่โหลดจนกว่าจะใช้) ---------- */
  FBL.savePhoto = async function (id, meta, bytes) {
    await FBL.commit([
      { op: 'set', col: 'photoData', id: id, data: { data: store.toBytes(bytes), mk: meta.mk } },
      { op: 'set', col: 'photos', id: id, data: meta }
    ]);
  };
  const photoCache = new Map();
  FBL.photoBytes = async function (id) {
    if (photoCache.has(id)) return photoCache.get(id);
    const d = await FBL.get('photoData', id);
    if (!d || !d.data) throw new Error('ไม่พบข้อมูลรูป (อาจถูกลบไปแล้ว)');
    const u8 = store.fromBytes(d.data);
    photoCache.set(id, u8);
    return u8;
  };
  FBL.deletePhotos = async function (ids) {
    const ops = [];
    ids.forEach(function (id) {
      ops.push({ op: 'delete', col: 'photos', id: id });
      ops.push({ op: 'delete', col: 'photoData', id: id });
      photoCache.delete(id);
    });
    await FBL.commit(ops);
  };
})();
