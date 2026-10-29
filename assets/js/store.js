/* =========================================================
   طبقة البيانات — localStorage كقاعدة بيانات محلية
   - مستخدمون بأرقام سرية مشتقة (PBKDF2 / SHA-256)
   - مذكرات معزولة تمامًا لكل مستخدم
   ========================================================= */
(function (global) {
  'use strict';

  const PREFIX = 'msn.v1.';
  const USERS_KEY = 'users';
  const SESSION_KEY = 'session';
  const PREFS_KEY = 'prefs';
  const PBKDF2_ITERATIONS = 150000;
  const FALLBACK_ITERATIONS = 6000;
  const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 ساعة

  const hasWindow = typeof window !== 'undefined';
  const storage = hasWindow ? window.localStorage : null;
  const sessionStore = hasWindow ? window.sessionStorage : null;

  /* ---------- أدوات تخزين آمنة ---------- */
  function readRaw(store, key, fallback) {
    try {
      if (!store) return fallback;
      const raw = store.getItem(PREFIX + key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function writeRaw(store, key, value) {
    try {
      if (!store) throw new Error('Storage unavailable');
      store.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (err) {
      const error = new Error('STORAGE_WRITE_FAILED');
      error.code = 'STORAGE';
      throw error;
    }
  }

  function removeRaw(store, key) {
    try { if (store) store.removeItem(PREFIX + key); } catch (err) { /* ignore */ }
  }

  function storageAvailable() {
    try {
      const probe = PREFIX + '__probe__';
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ---------- تشفير الرقم السري ---------- */
  const subtleCrypto = (function () {
    try {
      if (hasWindow && window.crypto && window.crypto.subtle) return window.crypto.subtle;
    } catch (err) { /* insecure context */ }
    return null;
  })();

  function bytesToB64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function b64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    try {
      if (hasWindow && window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(bytes);
        return bytes;
      }
    } catch (err) { /* fall through */ }
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
  }

  function uid() {
    try {
      if (hasWindow && window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (err) { /* fall through */ }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* SHA-256 احتياطي للمتصفحات التي لا تدعم Web Crypto */
  function sha256(ascii) {
    function rotateRight(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    const maxWord = Math.pow(2, 32);
    let result = '';
    const words = [];
    const asciiBitLength = ascii.length * 8;
    let hash = sha256.h = sha256.h || [];
    const k = sha256.k = sha256.k || [];
    let primeCounter = k.length;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate += 1) {
      if (!isComposite[candidate]) {
        for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
        primeCounter += 1;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (let i = 0; i < ascii.length; i += 1) {
      const code = ascii.charCodeAt(i);
      if (code >> 8) return '';
      words[i >> 2] |= code << (((3 - i) % 4) * 8);
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;

    for (let j = 0; j < words.length;) {
      const w = words.slice(j, (j += 16));
      const oldHash = hash.slice(0, 8);
      for (let i = 0; i < 64; i += 1) {
        const w15 = w[i - 15];
        const w2 = w[i - 2];
        const a = hash[0];
        const e = hash[4];
        const temp1 = hash[7]
          + (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25))
          + ((e & hash[5]) ^ (~e & hash[6]))
          + k[i]
          + (w[i] = i < 16 ? w[i] : (
            w[i - 16]
            + (rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10))
          ) | 0);
        const temp2 = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (let i = 0; i < 8; i += 1) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (let i = 0; i < 8; i += 1) {
      for (let j = 3; j + 1; j -= 1) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }

  function fallbackDigest(pin, saltB64, iterations) {
    let digest = sha256(saltB64 + ':' + pin + ':' + saltB64);
    for (let i = 0; i < iterations; i += 1) digest = sha256(digest + ':' + saltB64 + ':' + pin);
    return digest;
  }

  async function createHash(pin) {
    const salt = randomBytes(16);
    const saltB64 = bytesToB64(salt);
    if (subtleCrypto) {
      try {
        const keyMaterial = await subtleCrypto.importKey(
          'raw',
          new TextEncoder().encode(pin),
          'PBKDF2',
          false,
          ['deriveBits']
        );
        const bits = await subtleCrypto.deriveBits(
          { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
          keyMaterial,
          256
        );
        return 'pbkdf2$' + PBKDF2_ITERATIONS + '$' + saltB64 + '$' + bytesToB64(new Uint8Array(bits));
      } catch (err) { /* fall back below */ }
    }
    return 'sha256$' + FALLBACK_ITERATIONS + '$' + saltB64 + '$' + fallbackDigest(pin, saltB64, FALLBACK_ITERATIONS);
  }

  function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  async function verifyPin(pin, storedHash) {
    if (!storedHash || typeof storedHash !== 'string') return false;
    const parts = storedHash.split('$');
    if (parts.length !== 4) return false;
    const scheme = parts[0];
    const iterations = parseInt(parts[1], 10);
    const saltB64 = parts[2];
    const expected = parts[3];
    if (!Number.isFinite(iterations) || !saltB64 || !expected) return false;

    if (scheme === 'pbkdf2') {
      if (!subtleCrypto) return false;
      try {
        const keyMaterial = await subtleCrypto.importKey(
          'raw',
          new TextEncoder().encode(pin),
          'PBKDF2',
          false,
          ['deriveBits']
        );
        const bits = await subtleCrypto.deriveBits(
          { name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations: iterations, hash: 'SHA-256' },
          keyMaterial,
          256
        );
        return safeEqual(bytesToB64(new Uint8Array(bits)), expected);
      } catch (err) {
        return false;
      }
    }

    if (scheme === 'sha256') {
      return safeEqual(fallbackDigest(pin, saltB64, iterations), expected);
    }
    return false;
  }

  /* ---------- المستخدمون ---------- */
  function getUsers() {
    const users = readRaw(storage, USERS_KEY, []);
    return Array.isArray(users) ? users : [];
  }

  function saveUsers(users) {
    writeRaw(storage, USERS_KEY, users);
  }

  function normalizeName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  function findUserByName(name) {
    const target = normalizeName(name);
    return getUsers().find((user) => normalizeName(user.name) === target) || null;
  }

  function findUserById(id) {
    return getUsers().find((user) => user.id === id) || null;
  }

  async function createUser(name, pin) {
    const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
    if (findUserByName(cleanName)) {
      const error = new Error('USER_EXISTS');
      error.code = 'USER_EXISTS';
      throw error;
    }
    const user = {
      id: uid(),
      name: cleanName,
      hash: await createHash(pin),
      createdAt: Date.now()
    };
    const users = getUsers();
    users.push(user);
    saveUsers(users);
    return user;
  }

  async function updatePin(userId, newPin) {
    const users = getUsers();
    const index = users.findIndex((user) => user.id === userId);
    if (index === -1) throw new Error('USER_NOT_FOUND');
    users[index].hash = await createHash(newPin);
    users[index].updatedAt = Date.now();
    saveUsers(users);
    return users[index];
  }

  function deleteUser(userId) {
    const users = getUsers().filter((user) => user.id !== userId);
    saveUsers(users);
    removeRaw(storage, notesKey(userId));
    clearSession();
  }

  /* ---------- المذكرات ---------- */
  function notesKey(userId) {
    return 'notes.' + userId;
  }

  function getNotes(userId) {
    if (!userId) return [];
    const notes = readRaw(storage, notesKey(userId), []);
    if (!Array.isArray(notes)) return [];
    return notes.filter((note) => note && typeof note === 'object' && note.id && note.subject && note.lesson);
  }

  function setNotes(userId, notes) {
    if (!userId) throw new Error('MISSING_USER');
    writeRaw(storage, notesKey(userId), Array.isArray(notes) ? notes : []);
  }

  /* ---------- الجلسة (جلسة المتصفح فقط) ---------- */
  function getSession() {
    try {
      const raw = sessionStore ? sessionStore.getItem(PREFIX + SESSION_KEY) : null;
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session || !session.userId) return null;
      if (session.expiresAt && Date.now() > session.expiresAt) {
        clearSession();
        return null;
      }
      return session;
    } catch (err) {
      return null;
    }
  }

  function setSession(userId) {
    const payload = JSON.stringify({ userId: userId, expiresAt: Date.now() + SESSION_TTL });
    try {
      if (sessionStore) sessionStore.setItem(PREFIX + SESSION_KEY, payload);
    } catch (err) { /* session persistence is optional */ }
  }

  function clearSession() {
    removeRaw(sessionStore, SESSION_KEY);
  }

  /* ---------- التفضيلات ---------- */
  function getPrefs() {
    const prefs = readRaw(storage, PREFS_KEY, {});
    return prefs && typeof prefs === 'object' ? prefs : {};
  }

  function setPref(key, value) {
    const prefs = getPrefs();
    prefs[key] = value;
    writeRaw(storage, PREFS_KEY, prefs);
    return prefs;
  }

  /* ---------- أدوات ---------- */
  function exportPayload(user, notes) {
    return {
      app: 'My Study Notes',
      schema: 1,
      exportedAt: new Date().toISOString(),
      owner: user ? user.name : '',
      notes: notes
    };
  }

  global.Store = {
    getUsers,
    findUserByName,
    findUserById,
    createUser,
    updatePin,
    verifyPin,
    deleteUser,
    getNotes,
    setNotes,
    getSession,
    setSession,
    clearSession,
    getPrefs,
    setPref,
    storageAvailable,
    exportPayload,
    uid
  };
})(typeof window !== 'undefined' ? window : globalThis);
