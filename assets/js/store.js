/* =========================================================
   طبقة البيانات — Supabase (PostgreSQL) كقاعدة بيانات
   - مصادقة Supabase Auth (بريد + كلمة مرور)
   - مذكرات معزولة لكل مستخدم عبر RLS
   ========================================================= */
(function (global) {
  'use strict';

  const SUPABASE_URL = 'https://iloniowcbppoothpckjt.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_oBRKRNYDzsz6J9GYtXWsFw_W8drXMfs';

  const hasWindow = typeof window !== 'undefined';
  const storage = hasWindow ? window.localStorage : null;
  const sessionStore = hasWindow ? window.sessionStorage : null;

  const PREFIX = 'msn.v1.';

  /* ---------- Supabase client ---------- */
  let supabase = null;
  try {
    if (hasWindow && window.supabase && typeof window.supabase.createClient === 'function') {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
  } catch (err) { supabase = null; }

  /* ---------- أدوات تخزين محلية للتفضيلات ---------- */
  function readRaw(store, key, fallback) {
    try {
      if (!store) return fallback;
      const raw = store.getItem(PREFIX + key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (err) { return fallback; }
  }
  function writeRaw(store, key, value) {
    try {
      if (!store) throw new Error('Storage unavailable');
      store.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (err) { throw new Error('STORAGE_WRITE_FAILED'); }
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
    } catch (err) { return false; }
  }
  function getPrefs() {
    const prefs = readRaw(storage, 'prefs', {});
    return prefs && typeof prefs === 'object' ? prefs : {};
  }
  function setPref(key, value) {
    const prefs = getPrefs();
    prefs[key] = value;
    writeRaw(storage, 'prefs', prefs);
    return prefs;
  }

  function uid() {
    try {
      if (hasWindow && window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (err) { /* fall through */ }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(email || '').trim());
  }

  /* ---------- تحويل صفوف قاعدة البيانات ---------- */
  function mapFromDb(row) {
    if (!row) return null;
    return {
      id: row.id,
      subject: row.subject || '',
      lesson: row.lesson || '',
      summary: row.summary || '',
      examDate: row.exam_date || '',
      status: row.status || 'good',
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
    };
  }

  function mapToDb(note) {
    const out = {};
    if (note.subject !== undefined) out.subject = note.subject;
    if (note.lesson !== undefined) out.lesson = note.lesson;
    if (note.summary !== undefined) out.summary = note.summary;
    if (note.examDate !== undefined) out.exam_date = note.examDate || null;
    if (note.status !== undefined) out.status = note.status;
    if (note.updatedAt !== undefined) out.updated_at = new Date(note.updatedAt).toISOString();
    return out;
  }

  /* ---------- المصادقة ---------- */
  async function getSession() {
    if (!supabase) return null;
    try {
      const { data } = await supabase.auth.getSession();
      return data && data.session ? data.session : null;
    } catch (err) { return null; }
  }

  async function getUser() {
    if (!supabase) return null;
    try {
      const { data } = await supabase.auth.getUser();
      const user = data && data.user;
      if (!user) return null;
      return {
        id: user.id,
        email: user.email || '',
        name: (user.user_metadata && user.user_metadata.name) || (user.email ? user.email.split('@')[0] : 'مستخدم')
      };
    } catch (err) { return null; }
  }

  async function signUp(name, email, password) {
    if (!supabase) throw new Error('SUPABASE_UNAVAILABLE');
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: { data: { name: name } }
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    if (!supabase) throw new Error('SUPABASE_UNAVAILABLE');
    const { data, error } = await supabase.auth.signInWithPassword({ email: email, password: password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (!supabase) return;
    try { await supabase.auth.signOut(); } catch (err) { /* ignore */ }
  }

  function onAuthStateChange(callback) {
    if (!supabase) return { data: { subscription: { unsubscribe: function () {} } } };
    return supabase.auth.onAuthStateChange(function (event, session) {
      try { callback(event, session); } catch (err) { /* ignore */ }
    });
  }

  /* ---------- المذكرات ---------- */
  async function getNotes(userId) {
    if (!supabase || !userId) return [];
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapFromDb);
  }

  async function createNote(userId, note) {
    if (!supabase || !userId) throw new Error('SUPABASE_UNAVAILABLE');
    const payload = Object.assign({ user_id: userId }, mapToDb(note || {}));
    const { data, error } = await supabase
      .from('notes')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return mapFromDb(data);
  }

  async function createNotes(userId, notes) {
    if (!supabase || !userId) throw new Error('SUPABASE_UNAVAILABLE');
    const rows = (notes || []).map(function (note) {
      return Object.assign({ user_id: userId }, mapToDb(note || {}));
    });
    if (!rows.length) return [];
    const { data, error } = await supabase
      .from('notes')
      .insert(rows)
      .select();
    if (error) throw error;
    return (data || []).map(mapFromDb);
  }

  async function updateNote(userId, id, patch) {
    if (!supabase || !userId) throw new Error('SUPABASE_UNAVAILABLE');
    const payload = mapToDb(patch || {});
    const { data, error } = await supabase
      .from('notes')
      .update(payload)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    return mapFromDb(data);
  }

  async function deleteNote(userId, id) {
    if (!supabase || !userId) throw new Error('SUPABASE_UNAVAILABLE');
    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    return true;
  }

  async function deleteAllNotes(userId) {
    if (!supabase || !userId) throw new Error('SUPABASE_UNAVAILABLE');
    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('user_id', userId);
    if (error) throw error;
    return true;
  }

  function exportPayload(user, notes) {
    return {
      app: 'My Study Notes',
      schema: 2,
      exportedAt: new Date().toISOString(),
      owner: user ? user.name : '',
      notes: notes
    };
  }

  global.Store = {
    supabase: supabase,
    getSession: getSession,
    getUser: getUser,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    onAuthStateChange: onAuthStateChange,
    getNotes: getNotes,
    createNote: createNote,
    createNotes: createNotes,
    updateNote: updateNote,
    deleteNote: deleteNote,
    deleteAllNotes: deleteAllNotes,
    isValidEmail: isValidEmail,
    getPrefs: getPrefs,
    setPref: setPref,
    storageAvailable: storageAvailable,
    exportPayload: exportPayload,
    uid: uid
  };
})(typeof window !== 'undefined' ? window : globalThis);