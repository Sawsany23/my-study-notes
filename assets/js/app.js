/* =========================================================
   منطق التطبيق — My Study Notes
   ========================================================= */
(function () {
  'use strict';

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const t = (key, vars) => I18n.t(key, vars);

  const STATUSES = ['excellent', 'good', 'review', 'weak'];
  const STATUS_ORDER = { excellent: 0, good: 1, review: 2, weak: 3 };
  const VIEWS = ['dashboard', 'notes', 'exams', 'settings'];
  const SUMMARY_LIMIT = 1200;

  const state = {
    user: null,
    notes: [],
    view: 'dashboard',
    filters: { q: '', subject: '', status: '', sort: 'recent' },
    editingId: null,
    authTab: 'login',
    confirmHandler: null,
    lastFocus: null
  };

  /* ---------- أدوات عامة ---------- */
  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initialOf(name) {
    const chars = Array.from(String(name || '').trim());
    return chars.length ? chars[0].toUpperCase() : '?';
  }

  function locale() {
    return I18n.lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
  }

  function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parts = value.split('-').map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (date.getFullYear() !== parts[0] || date.getMonth() !== parts[1] - 1 || date.getDate() !== parts[2]) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function isValidDate(value) {
    return parseDate(value) !== null;
  }

  function formatDate(value, options) {
    const date = value instanceof Date ? value : parseDate(value);
    if (!date) return '';
    const formatOptions = options && options.short
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'long', year: 'numeric' };
    if (options && options.short && date.getFullYear() !== new Date().getFullYear()) {
      formatOptions.year = 'numeric';
    }
    try {
      return new Intl.DateTimeFormat(locale(), formatOptions).format(date);
    } catch (err) {
      return date.toISOString().slice(0, 10);
    }
  }

  function dayParts(value) {
    const date = parseDate(value);
    if (!date) return { day: '', month: '' };
    try {
      return {
        day: new Intl.DateTimeFormat(locale(), { day: 'numeric' }).format(date),
        month: new Intl.DateTimeFormat(locale(), { month: 'short' }).format(date)
      };
    } catch (err) {
      return { day: String(date.getDate()), month: '' };
    }
  }

  function daysUntil(value) {
    const date = parseDate(value);
    if (!date) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((date.getTime() - today.getTime()) / 86400000);
  }

  function daysLabel(days) {
    if (days === null || days === undefined) return '';
    if (days === 0) return t('exams.today');
    if (days === 1) return t('exams.tomorrow');
    if (days === 2) return t('exams.two');
    if (days === -1) return t('exams.yesterday');
    if (days === -2) return t('exams.twoAgo');
    if (days > 0) {
      return days <= 10 ? t('exams.inDays', { n: days }) : t('exams.inDaysMany', { n: days });
    }
    const abs = Math.abs(days);
    return abs <= 10 ? t('exams.daysAgo', { n: abs }) : t('exams.daysAgoMany', { n: abs });
  }

  function examsPhrase(count) {
    if (count === 0) return t('dash.examsNone');
    if (count === 1) return t('dash.examsOne');
    return count <= 10 ? t('dash.examsFew', { n: count }) : t('dash.examsMany', { n: count });
  }

  function notesCount(n) {
    if (I18n.lang === 'en') {
      if (n === 0) return t('notes.countNone');
      return n === 1 ? t('notes.countOne') : t('notes.countMany', { n: n });
    }
    if (n === 0) return t('notes.countNone');
    if (n === 1) return t('notes.countOne');
    if (n === 2) return t('notes.countTwo');
    if (n <= 10) return t('notes.countFew', { n: n });
    return t('notes.countMany', { n: n });
  }

  function upcomingList() {
    return state.notes
      .filter((note) => note.examDate && daysUntil(note.examDate) !== null && daysUntil(note.examDate) >= 0)
      .sort((a, b) => a.examDate.localeCompare(b.examDate));
  }

  function needsReview(note) {
    return note.status === 'review' || note.status === 'weak';
  }

  function uniqueSubjects() {
    const seen = new Map();
    state.notes.forEach((note) => {
      const key = note.subject.trim().toLocaleLowerCase();
      if (!seen.has(key)) seen.set(key, note.subject.trim());
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, I18n.lang === 'ar' ? 'ar' : 'en'));
  }

  function toast(message, type) {
    const wrap = $('#toast-wrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (type === 'error' ? 'is-error' : 'is-success');
    el.innerHTML = '<svg><use href="#' + (type === 'error' ? 'i-alert' : 'i-check') + '"></use></svg><span></span>';
    el.querySelector('span').textContent = message;
    wrap.appendChild(el);
    window.setTimeout(() => {
      el.classList.add('is-leaving');
      window.setTimeout(() => el.remove(), 240);
    }, 3200);
  }

  function storageError() {
    toast(t('toast.storageError'), 'error');
  }

  /* ---------- النوافذ ---------- */
  function topModal() {
    const open = $$('.modal').filter((modal) => !modal.hidden);
    return open.length ? open[open.length - 1] : null;
  }

  function openModal(selector, focusTarget) {
    const modal = typeof selector === 'string' ? $(selector) : selector;
    if (!modal) return;
    if (!topModal()) state.lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('no-scroll');
    const target = focusTarget || modal.querySelector('input:not([type="hidden"]), select, textarea, button');
    window.setTimeout(() => {
      try { if (target) target.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
    }, 40);
  }

  function closeModal(selector) {
    const modal = typeof selector === 'string' ? $(selector) : selector;
    if (!modal) return;
    modal.hidden = true;
    if (!topModal()) {
      document.body.classList.remove('no-scroll');
      if (state.lastFocus && document.contains(state.lastFocus)) {
        try { state.lastFocus.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      }
      state.lastFocus = null;
    }
  }

  function closeTopModal() {
    const modal = topModal();
    if (modal) closeModal(modal);
  }

  /* ---------- الثيم واللغة ---------- */
  function applyTheme(theme, persist) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    if (persist !== false) {
      try { Store.setPref('theme', next); } catch (err) { /* ignore */ }
    }
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'dark' ? '#0c1411' : '#f6f1e7');
    $$('#theme-seg [data-theme-set]').forEach((button) => {
      button.classList.toggle('is-active', button.getAttribute('data-theme-set') === next);
    });
  }

  function setLanguage(lang) {
    I18n.setLang(lang);
    try { Store.setPref('lang', lang); } catch (err) { /* ignore */ }
    syncAuthTab(state.authTab);
    renderAll();
  }

  function syncAuthTab(tab) {
    state.authTab = tab === 'register' ? 'register' : 'login';
    const isLogin = state.authTab === 'login';
    const loginTab = $('#tab-login');
    const registerTab = $('#tab-register');
    if (loginTab) loginTab.setAttribute('aria-selected', String(isLogin));
    if (registerTab) registerTab.setAttribute('aria-selected', String(!isLogin));
    const loginForm = $('#login-form');
    const registerForm = $('#register-form');
    if (loginForm) loginForm.hidden = !isLogin;
    if (registerForm) registerForm.hidden = isLogin;

    const title = $('#auth-title');
    const sub = $('#auth-sub');
    const titleKey = isLogin ? 'auth.loginTitle' : 'auth.registerTitle';
    const subKey = isLogin ? 'auth.loginSub' : 'auth.registerSub';
    if (title) {
      title.setAttribute('data-i18n', titleKey);
      title.textContent = t(titleKey);
    }
    if (sub) {
      sub.setAttribute('data-i18n', subKey);
      sub.textContent = t(subKey);
    }
    clearAuthErrors();
  }

  function clearAuthErrors() {
    $$('[data-auth-error]').forEach((el) => {
      el.hidden = true;
      el.textContent = '';
    });
    $$('.auth-form .input').forEach((input) => input.classList.remove('is-invalid'));
  }

  function showAuthError(key) {
    const form = state.authTab === 'login' ? $('#login-form') : $('#register-form');
    if (!form) return;
    const error = form.querySelector('[data-auth-error]');
    if (!error) return;
    error.textContent = t(key);
    error.hidden = false;
  }

  /* ---------- الشريط الجانبي والقائمة ---------- */
  function syncSidebarA11y() {
    const sidebar = $('#sidebar');
    if (!sidebar) return;
    const mobile = window.matchMedia('(max-width: 960px)').matches;
    const hidden = mobile && !sidebar.classList.contains('is-open');
    try { sidebar.inert = hidden; } catch (err) { /* older browsers */ }
    if (hidden) sidebar.setAttribute('aria-hidden', 'true');
    else sidebar.removeAttribute('aria-hidden');
  }

  function openSidebar() {
    const sidebar = $('#sidebar');
    const scrim = $('#sidebar-scrim');
    if (!sidebar) return;
    sidebar.classList.add('is-open');
    if (scrim) scrim.hidden = false;
    document.body.classList.add('no-scroll');
    syncSidebarA11y();
  }

  function closeSidebar() {
    const sidebar = $('#sidebar');
    const scrim = $('#sidebar-scrim');
    if (sidebar) sidebar.classList.remove('is-open');
    if (scrim) scrim.hidden = true;
    if (!topModal()) document.body.classList.remove('no-scroll');
    syncSidebarA11y();
  }

  function closeUserMenu() {
    const pop = $('#user-pop');
    const trigger = $('.user-chip');
    if (pop) pop.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function toggleUserMenu() {
    const pop = $('#user-pop');
    const trigger = $('.user-chip');
    if (!pop || !trigger) return;
    const willOpen = pop.hidden;
    pop.hidden = !willOpen;
    trigger.setAttribute('aria-expanded', String(willOpen));
  }

  /* ---------- التنقل ---------- */
  function switchView(view) {
    if (VIEWS.indexOf(view) === -1) return;
    state.view = view;
    $$('.view').forEach((section) => {
      section.hidden = section.getAttribute('data-view') !== view;
    });
    $$('.nav-link').forEach((link) => {
      link.classList.toggle('is-active', link.getAttribute('data-view-target') === view);
    });
    closeSidebar();
    closeUserMenu();
    if (view === 'settings') renderSettings();
    if (view === 'dashboard') renderDashboard();
    if (view === 'notes') renderNotes();
    if (view === 'exams') renderExams();
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (err) { window.scrollTo(0, 0); }
  }

  /* ---------- الدخول ---------- */
  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = form.querySelector('[data-auth-error]');
    if (error) { error.hidden = true; error.textContent = ''; }
    const email = (form.elements.email && form.elements.email.value || '').trim();
    const password = (form.elements.password && form.elements.password.value || '').trim();

    if (!email || !password) return showAuthError('auth.errFields');
    if (!Store.isValidEmail(email)) return showAuthError('auth.errEmailFormat');
    if (password.length < 8) return showAuthError('auth.errPasswordFormat');

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await Store.signIn(email, password);
      const user = await Store.getUser();
      if (!user) throw new Error('NO_USER');
      form.reset();
      await enterApp(user, true);
    } catch (err) {
      showAuthError(err && err.message ? err.message : 'auth.errCredentials');
    } finally {
      if (submit) submit.disabled = false;
    }
  }
  async function handleRegister(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = form.querySelector('[data-auth-error]');
    if (error) { error.hidden = true; error.textContent = ''; }
    const name = (form.elements.displayName && form.elements.displayName.value || '').trim().replace(/\s+/g, ' ');
    const email = (form.elements.email && form.elements.email.value || '').trim();
    const password = (form.elements.password && form.elements.password.value || '').trim();
    const confirm = (form.elements.confirm && form.elements.confirm.value || '').trim();

    if (!name || !email || !password || !confirm) return showAuthError('auth.errFields');
    if (name.length < 3) return showAuthError('auth.errShortUser');
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{2,23}$/u.test(name)) return showAuthError('auth.errUsernameChars');
    if (!Store.isValidEmail(email)) return showAuthError('auth.errEmailFormat');
    if (password.length < 8) return showAuthError('auth.errPasswordFormat');
    if (password !== confirm) return showAuthError('auth.errPasswordMatch');

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await Store.signUp(name, email, password);
      const user = await Store.getUser();
      if (!user) {
        showAuthError('auth.errConfirmEmail');
        return;
      }
      form.reset();
      await enterApp(user, 'created');
    } catch (err) {
      if (err && /already|registered|exists/i.test(err.message || '')) showAuthError('auth.errUserExists');
      else showAuthError(err && err.message ? err.message : 'auth.errGeneric');
    } finally {
      if (submit) submit.disabled = false;
    }
  }
  async function handleResetRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = $('#reset-request-error');
    if (error) { error.hidden = true; error.textContent = ''; }
    const email = (form.elements.email && form.elements.email.value || '').trim();
    if (!email) return showResetError('auth.errFields');
    if (!Store.isValidEmail(email)) return showResetError('auth.errEmailFormat');

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const redirectTo = window.location.origin + window.location.pathname;
      const { error: err } = await Store.supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
      if (err) throw err;
      form.reset();
      closeModal('#reset-request-modal');
      toast('?? ????? ???? ????? ??????? ??? ?????.', 'success');
    } catch (err) {
      showResetError(err && err.message ? err.message : 'auth.errGeneric');
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function showResetError(key) {
    const error = $('#reset-request-error');
    if (error) { error.textContent = t(key, {}) || key; error.hidden = false; }
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = $('#reset-password-error');
    if (error) { error.hidden = true; error.textContent = ''; }
    const password = (form.elements.password && form.elements.password.value || '').trim();
    const confirm = (form.elements.confirm && form.elements.confirm.value || '').trim();
    if (!password || !confirm) return showResetPassError('auth.errFields');
    if (password.length < 8) return showResetPassError('auth.errPasswordFormat');
    if (password !== confirm) return showResetPassError('auth.errPasswordMatch');

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const { error: err } = await Store.supabase.auth.updateUser({ password: password });
      if (err) throw err;
      form.reset();
      closeModal('#reset-password-modal');
      toast(t('pin.done'), 'success');
      const user = await Store.getUser();
      if (user) await enterApp(user, false);
    } catch (err) {
      showResetPassError(err && err.message ? err.message : 'auth.errGeneric');
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function showResetPassError(msg) {
    const error = $('#reset-password-error');
    if (error) { error.textContent = msg; error.hidden = false; }
  }
  async function enterApp(user, announce) {
    state.user = user;
    state.notes = [];
    state.filters = { q: '', subject: '', status: '', sort: 'recent' };
    try {
      state.notes = await Store.getNotes(user.id);
    } catch (err) { state.notes = []; storageError(); }

    const authScreen = $('#auth-screen');
    const app = $('#app');
    if (authScreen) authScreen.hidden = true;
    if (app) app.hidden = false;
    document.body.classList.add('is-authed');

    renderAll();
    if (announce) {
      toast(t(announce === 'created' ? 'auth.created' : 'auth.welcome', { name: user.name }), 'success');
    }
  }
  function resetToAuth() {
    state.user = null;
    state.notes = [];
    state.filters = { q: '', subject: '', status: '', sort: 'recent' };
    state.editingId = null;
    $$('.modal').forEach((modal) => { modal.hidden = true; });
    document.body.classList.remove('no-scroll', 'is-authed');
    const app = $('#app');
    const authScreen = $('#auth-screen');
    if (app) app.hidden = true;
    if (authScreen) authScreen.hidden = false;
    const login = $('#login-form');
    const register = $('#register-form');
    if (login) login.reset();
    if (register) register.reset();
    syncAuthTab('login');
    closeSidebar();
    closeUserMenu();
    try { window.scrollTo(0, 0); } catch (err) { /* ignore */ }
  }

  async function logout(silent) {
    try { await Store.signOut(); } catch (err) { /* ignore */ }
    resetToAuth();
    if (!silent) toast(t('toast.loggedOut'), 'success');
  }
  function renderChrome() {
    if (!state.user) return;
    const user = state.user;
    const name = user.name;
    const avatar = initialOf(name);
    const joined = user.createdAt ? formatDate(new Date(user.createdAt)) : '';

    if ($('#user-name')) $('#user-name').textContent = name;
    if ($('#user-avatar')) $('#user-avatar').textContent = avatar;
    if ($('#user-pop-name')) $('#user-pop-name').textContent = name;
    if ($('#user-pop-meta')) $('#user-pop-meta').textContent = t('settings.joined', { date: joined });
    if ($('#settings-name')) $('#settings-name').textContent = name;
    if ($('#settings-avatar')) $('#settings-avatar').textContent = avatar;
    if ($('#settings-joined')) $('#settings-joined').textContent = t('settings.joined', { date: joined });

    if ($('#nav-notes-count')) $('#nav-notes-count').textContent = String(state.notes.length);
    const upcoming = upcomingList();
    if ($('#nav-exam-count')) $('#nav-exam-count').textContent = String(upcoming.length);

    const focusTitle = $('#side-focus');
    const focusMeta = $('#side-focus-meta');
    if (focusTitle && focusMeta) {
      if (upcoming.length) {
        const next = upcoming[0];
        focusTitle.textContent = next.lesson;
        focusMeta.textContent = next.subject + ' · ' + daysLabel(daysUntil(next.examDate));
      } else {
        focusTitle.textContent = t('sidebar.focusNone');
        focusMeta.textContent = '';
      }
    }
  }

  function statusPill(status) {
    const key = STATUSES.indexOf(status) === -1 ? 'good' : status;
    return '<span class="status-pill status-' + key + '">' + esc(t('status.' + key)) + '</span>';
  }

  function inlineEmpty(message, icon) {
    return '<div class="inline-empty"><svg><use href="#' + (icon || 'i-spark') + '"></use></svg><p>' + esc(message) + '</p></div>';
  }

  /* ---------- لوحة المتابعة ---------- */
  function renderDashboard() {
    if (!state.user) return;
    const hour = new Date().getHours();
    const greeting = hour < 12 ? t('dash.greetingMorning') : t('dash.greetingEvening');
    if ($('#dash-greeting')) $('#dash-greeting').textContent = greeting;
    if ($('#dash-name')) $('#dash-name').textContent = state.user.name;

    const total = state.notes.length;
    const subjects = uniqueSubjects().length;
    const upcoming = upcomingList();
    const review = state.notes.filter(needsReview).length;

    if ($('#stat-total')) $('#stat-total').textContent = String(total);
    if ($('#stat-subjects')) $('#stat-subjects').textContent = String(subjects);
    if ($('#stat-upcoming')) $('#stat-upcoming').textContent = String(upcoming.length);
    if ($('#stat-review')) $('#stat-review').textContent = String(review);
    if ($('#dash-sub')) {
      $('#dash-sub').textContent = t('dash.sub', {
        notes: notesCount(total),
        exams: examsPhrase(upcoming.length)
      });
    }

    const upcomingWrap = $('#dash-upcoming');
    if (upcomingWrap) {
      if (!upcoming.length) {
        upcomingWrap.innerHTML = inlineEmpty(t('dash.noUpcoming'), 'i-calendar');
      } else {
        upcomingWrap.innerHTML = upcoming.slice(0, 4).map((note) => {
          const days = daysUntil(note.examDate);
          const parts = dayParts(note.examDate);
          const cls = days === 0 ? 'is-today' : days <= 3 ? 'is-soon' : '';
          return '<article class="stack-item" data-action="open-note" data-id="' + esc(note.id) + '" tabindex="0" role="button">'
            + '<div class="date-block"><b>' + esc(parts.day) + '</b><span>' + esc(parts.month) + '</span></div>'
            + '<div class="stack-info"><strong dir="auto">' + esc(note.lesson) + '</strong><span dir="auto">' + esc(note.subject) + '</span></div>'
            + '<span class="chip-countdown ' + cls + '">' + esc(daysLabel(days)) + '</span>'
            + '</article>';
        }).join('');
      }
    }

    const progressWrap = $('#dash-progress');
    if (progressWrap) {
      if (!total) {
        progressWrap.innerHTML = inlineEmpty(t('dash.progressEmpty'), 'i-spark');
      } else {
        progressWrap.innerHTML = STATUSES.map((status) => {
          const count = state.notes.filter((note) => note.status === status).length;
          const percent = Math.round((count / total) * 100);
          return '<div class="progress-row status-' + status + '">'
            + '<div class="progress-row-head"><span class="progress-dot"></span><span>' + esc(t('status.' + status)) + '</span><b>' + count + '</b></div>'
            + '<div class="progress-track"><span class="progress-fill" style="width:' + percent + '%"></span></div>'
            + '</div>';
        }).join('');
      }
    }

    const recentWrap = $('#dash-recent');
    if (recentWrap) {
      if (!total) {
        recentWrap.innerHTML = inlineEmpty(t('dash.noNotes'), 'i-notebook');
      } else {
        const recent = state.notes.slice().sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)).slice(0, 4);
        recentWrap.innerHTML = recent.map((note) => miniCard(note)).join('');
      }
    }
  }

  function miniCard(note) {
    const summary = note.summary ? note.summary : t('notes.summaryEmpty');
    const exam = note.examDate
      ? '<svg><use href="#i-clock"></use></svg>' + esc(formatDate(note.examDate, { short: true }))
      : '<svg><use href="#i-clock"></use></svg>' + esc(t('detail.noExam'));
    return '<article class="mini-card" data-action="open-note" data-id="' + esc(note.id) + '" tabindex="0" role="button">'
      + '<span class="subject-badge" dir="auto">' + esc(note.subject) + '</span>'
      + '<strong dir="auto">' + esc(note.lesson) + '</strong>'
      + '<p class="' + (note.summary ? '' : 'is-empty') + '" dir="auto">' + esc(summary) + '</p>'
      + '<span class="mini-foot">' + exam + '</span>'
      + '</article>';
  }

  /* ---------- المذكرات ---------- */
  function getFilteredNotes() {
    const query = state.filters.q.trim().toLocaleLowerCase();
    const filtered = state.notes.filter((note) => {
      if (state.filters.status && note.status !== state.filters.status) return false;
      if (state.filters.subject && note.subject !== state.filters.subject) return false;
      if (query) {
        const haystack = (note.subject + ' ' + note.lesson + ' ' + note.summary).toLocaleLowerCase();
        if (haystack.indexOf(query) === -1) return false;
      }
      return true;
    });

    const sorters = {
      recent: (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
      exam: (a, b) => {
        const da = a.examDate ? daysUntil(a.examDate) : null;
        const db = b.examDate ? daysUntil(b.examDate) : null;
        if (da === null && db === null) return (b.updatedAt || 0) - (a.updatedAt || 0);
        if (da === null) return 1;
        if (db === null) return -1;
        if (da !== db) return da - db;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      },
      subject: (a, b) => a.subject.localeCompare(b.subject, I18n.lang === 'ar' ? 'ar' : 'en') || a.lesson.localeCompare(b.lesson),
      status: (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || (b.updatedAt || 0) - (a.updatedAt || 0)
    };
    const sorter = sorters[state.filters.sort] || sorters.recent;
    return filtered.sort(sorter);
  }

  function renderNotes() {
    if (!state.user) return;
    const list = getFilteredNotes();
    const grid = $('#notes-grid');
    const empty = $('#notes-empty');
    const clear = $('#clear-filters');
    const countEl = $('#notes-count');
    const filtersActive = Boolean(state.filters.q.trim() || state.filters.subject || state.filters.status);

    if (countEl) countEl.textContent = notesCount(list.length);
    if (clear) clear.hidden = !filtersActive;

    if (grid) grid.innerHTML = list.map((note) => noteCard(note)).join('');
    if (empty) {
      empty.hidden = list.length > 0;
      const title = $('#notes-empty-title');
      const text = $('#notes-empty-text');
      const cta = $('#notes-empty .btn');
      if (state.notes.length === 0) {
        if (title) { title.setAttribute('data-i18n', 'notes.emptyTitle'); title.textContent = t('notes.emptyTitle'); }
        if (text) { text.setAttribute('data-i18n', 'notes.emptyText'); text.textContent = t('notes.emptyText'); }
        if (cta) {
          cta.hidden = false;
          cta.setAttribute('data-action', 'new-note');
          cta.querySelector('span').setAttribute('data-i18n', 'notes.emptyCta');
          cta.querySelector('span').textContent = t('notes.emptyCta');
          cta.querySelector('use').setAttribute('href', '#i-plus');
        }
      } else {
        if (title) { title.setAttribute('data-i18n', 'notes.filteredEmptyTitle'); title.textContent = t('notes.filteredEmptyTitle'); }
        if (text) { text.setAttribute('data-i18n', 'notes.filteredEmptyText'); text.textContent = t('notes.filteredEmptyText'); }
        if (cta) {
          cta.hidden = !filtersActive;
          cta.setAttribute('data-action', 'clear-filters');
          cta.querySelector('span').setAttribute('data-i18n', 'notes.clear');
          cta.querySelector('span').textContent = t('notes.clear');
          cta.querySelector('use').setAttribute('href', '#i-filter');
        }
      }
    }

    renderFilters();
  }

  function noteCard(note) {
    const days = note.examDate ? daysUntil(note.examDate) : null;
    let examHtml;
    if (days === null) {
      examHtml = '<span class="exam-chip"><svg><use href="#i-clock"></use></svg><span>' + esc(t('detail.noExam')) + '</span></span>';
    } else {
      const cls = days < 0 ? 'is-past' : days === 0 ? 'is-today' : days <= 3 ? 'is-soon' : '';
      examHtml = '<span class="exam-chip ' + cls + '"><svg><use href="#i-clock"></use></svg><span>' + esc(formatDate(note.examDate, { short: true })) + '</span></span>';
    }
    return '<article class="note-card status-' + (STATUSES.indexOf(note.status) === -1 ? 'good' : note.status) + '"'
      + ' data-action="open-note" data-id="' + esc(note.id) + '" tabindex="0" role="button"'
      + ' aria-label="' + esc(note.lesson + ' — ' + note.subject) + '">'
      + '<div class="note-top"><span class="subject-badge" dir="auto">' + esc(note.subject) + '</span>' + statusPill(note.status) + '</div>'
      + '<h3 class="note-title" dir="auto">' + esc(note.lesson) + '</h3>'
      + '<p class="note-summary ' + (note.summary ? '' : 'is-empty') + '" dir="auto">' + esc(note.summary || t('notes.summaryEmpty')) + '</p>'
      + '<div class="note-foot">' + examHtml
      + '<div class="note-actions">'
      + '<button type="button" class="icon-btn sm" data-action="edit-note" data-id="' + esc(note.id) + '" aria-label="' + esc(t('common.edit')) + '" title="' + esc(t('common.edit')) + '"><svg><use href="#i-pencil"></use></svg></button>'
      + '<button type="button" class="icon-btn sm is-danger" data-action="delete-note" data-id="' + esc(note.id) + '" aria-label="' + esc(t('common.delete')) + '" title="' + esc(t('common.delete')) + '"><svg><use href="#i-trash"></use></svg></button>'
      + '</div></div></article>';
  }

  function renderFilters() {
    const subjectSelect = $('#filter-subject');
    if (subjectSelect) {
      const subjects = uniqueSubjects();
      if (state.filters.subject && subjects.indexOf(state.filters.subject) === -1) state.filters.subject = '';
      subjectSelect.innerHTML = '<option value="">' + esc(t('notes.allSubjects')) + '</option>'
        + subjects.map((subject) => '<option value="' + esc(subject) + '">' + esc(subject) + '</option>').join('');
      subjectSelect.value = state.filters.subject;
    }
    const statusSelect = $('#filter-status');
    if (statusSelect) statusSelect.value = state.filters.status;
    const sortSelect = $('#filter-sort');
    if (sortSelect) sortSelect.value = state.filters.sort;
    const search = $('#search-input');
    if (search && search.value !== state.filters.q) search.value = state.filters.q;
  }

  /* ---------- الامتحانات ---------- */
  function renderExams() {
    if (!state.user) return;
    const upcoming = upcomingList();
    const past = state.notes
      .filter((note) => note.examDate && daysUntil(note.examDate) !== null && daysUntil(note.examDate) < 0)
      .sort((a, b) => b.examDate.localeCompare(a.examDate));

    if ($('#exams-upcoming-count')) $('#exams-upcoming-count').textContent = String(upcoming.length);
    if ($('#exams-past-count')) $('#exams-past-count').textContent = String(past.length);

    const upcomingWrap = $('#exams-upcoming');
    if (upcomingWrap) {
      upcomingWrap.innerHTML = upcoming.length
        ? upcoming.map(examRow).join('')
        : inlineEmpty(t('exams.emptyUpcoming'), 'i-calendar');
    }
    const pastWrap = $('#exams-past');
    if (pastWrap) {
      pastWrap.innerHTML = past.length
        ? past.map(examRow).join('')
        : inlineEmpty(t('exams.emptyPast'), 'i-clock');
    }
  }

  function examRow(note) {
    const days = daysUntil(note.examDate);
    const parts = dayParts(note.examDate);
    const past = days < 0;
    const chipClass = past ? '' : days === 0 ? 'is-today' : days <= 3 ? 'is-soon' : '';
    return '<article class="exam-row' + (past ? ' is-past' : '') + '" data-action="open-note" data-id="' + esc(note.id) + '" tabindex="0" role="button">'
      + '<div class="exam-date"><b>' + esc(parts.day) + '</b><span>' + esc(parts.month) + '</span></div>'
      + '<div class="exam-info"><strong dir="auto">' + esc(note.lesson) + '</strong><span dir="auto">' + esc(note.subject) + ' · ' + esc(formatDate(note.examDate, { short: true })) + '</span></div>'
      + '<div class="exam-side">' + statusPill(note.status)
      + '<span class="chip-countdown ' + chipClass + '">' + esc(daysLabel(days)) + '</span>'
      + '</div></article>';
  }

  /* ---------- الإعدادات ---------- */
  function renderSettings() {
    if (!state.user) return;
    const total = state.notes.length;
    const subjects = uniqueSubjects().length;
    const upcoming = upcomingList().length;
    if ($('#settings-notes-count')) $('#settings-notes-count').textContent = String(total);
    if ($('#settings-subjects-count')) $('#settings-subjects-count').textContent = String(subjects);
    if ($('#settings-exams-count')) $('#settings-exams-count').textContent = String(upcoming);
    const theme = document.documentElement.getAttribute('data-theme');
    $$('#theme-seg [data-theme-set]').forEach((button) => {
      button.classList.toggle('is-active', button.getAttribute('data-theme-set') === theme);
    });
    $$('#lang-seg [data-lang-set]').forEach((button) => {
      button.classList.toggle('is-active', button.getAttribute('data-lang-set') === I18n.lang);
    });
  }

  function renderAll() {
    if (!state.user) return;
    renderChrome();
    renderDashboard();
    renderNotes();
    renderExams();
    renderSettings();
  }

  /* ---------- نموذج المذكرة ---------- */
  function updateSubjectDatalist() {
    const datalist = $('#subject-list');
    if (!datalist) return;
    datalist.innerHTML = uniqueSubjects().map((subject) => '<option value="' + esc(subject) + '"></option>').join('');
  }

  function updateSummaryCounter() {
    const field = $('#note-form textarea[name="summary"]');
    const counter = $('#summary-counter');
    if (!field || !counter) return;
    counter.textContent = field.value.length + ' / ' + SUMMARY_LIMIT;
  }

  function hideNoteError() {
    const error = $('#note-error');
    if (error) {
      error.hidden = true;
      error.textContent = '';
    }
    $$('#note-form .input').forEach((input) => input.classList.remove('is-invalid'));
  }

  function showNoteError(message) {
    const error = $('#note-error');
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  }

  function openNoteModal(note) {
    const form = $('#note-form');
    if (!form) return;
    const editing = Boolean(note);
    state.editingId = editing ? note.id : null;
    form.reset();
    hideNoteError();

    const kicker = $('#note-modal-kicker');
    const title = $('#note-modal-title');
    const submitLabel = $('#note-submit-label');
    if (kicker) {
      kicker.setAttribute('data-i18n', editing ? 'form.kickerEdit' : 'form.kickerNew');
      kicker.textContent = t(editing ? 'form.kickerEdit' : 'form.kickerNew');
    }
    if (title) {
      title.setAttribute('data-i18n', editing ? 'form.titleEdit' : 'form.titleNew');
      title.textContent = t(editing ? 'form.titleEdit' : 'form.titleNew');
    }
    if (submitLabel) {
      submitLabel.setAttribute('data-i18n', editing ? 'form.saveEdit' : 'form.save');
      submitLabel.textContent = t(editing ? 'form.saveEdit' : 'form.save');
    }

    if (editing) {
      form.elements.subject.value = note.subject;
      form.elements.lesson.value = note.lesson;
      form.elements.summary.value = note.summary || '';
      form.elements.examDate.value = note.examDate || '';
      form.elements.status.value = STATUSES.indexOf(note.status) === -1 ? 'good' : note.status;
    } else {
      form.elements.status.value = 'good';
    }

    updateSubjectDatalist();
    updateSummaryCounter();
    openModal('#note-modal', form.elements.subject);
  }

  async function handleNoteSubmit(event) {
    event.preventDefault();
    if (!state.user) return;
    const form = event.currentTarget;
    const subject = form.elements.subject.value.trim();
    const lesson = form.elements.lesson.value.trim();
    const summary = form.elements.summary.value.trim().slice(0, SUMMARY_LIMIT);
    const examDate = form.elements.examDate.value || '';
    const status = STATUSES.indexOf(form.elements.status.value) === -1 ? 'good' : form.elements.status.value;
    hideNoteError();

    if (!subject) {
      form.elements.subject.classList.add('is-invalid');
      form.elements.subject.focus();
      return showNoteError(t('form.errSubject'));
    }
    if (!lesson) {
      form.elements.lesson.classList.add('is-invalid');
      form.elements.lesson.focus();
      return showNoteError(t('form.errLesson'));
    }

    const now = Date.now();
    try {
      if (state.editingId) {
        const updated = await Store.updateNote(state.user.id, state.editingId, {
          subject: subject, lesson: lesson, summary: summary, examDate: examDate, status: status, updatedAt: now
        });
        state.notes = state.notes.map((note) => note.id === state.editingId ? updated : note);
      } else {
        const created = await Store.createNote(state.user.id, {
          subject: subject, lesson: lesson, summary: summary, examDate: examDate, status: status, createdAt: now, updatedAt: now
        });
        state.notes = [created].concat(state.notes);
      }
      const wasEditing = Boolean(state.editingId);
      state.editingId = null;
      closeModal('#note-modal');
      renderAll();
      toast(t(wasEditing ? 'notes.updated' : 'notes.saved'), 'success');
    } catch (err) {
      storageError();
    }
  }

  /* ---------- تفاصيل المذكرة ---------- */
  function openDetail(id) {
    const note = state.notes.find((item) => item.id === id);
    if (!note) return;

    const subject = $('#detail-subject');
    const status = $('#detail-status');
    const title = $('#detail-title');
    const meta = $('#detail-meta');
    const body = $('#detail-body');
    const edit = $('#detail-edit');
    const remove = $('#detail-delete');

    if (subject) subject.textContent = note.subject;
    if (status) {
      status.className = 'status-pill status-' + (STATUSES.indexOf(note.status) === -1 ? 'good' : note.status);
      status.textContent = t('status.' + (STATUSES.indexOf(note.status) === -1 ? 'good' : note.status));
    }
    if (title) title.textContent = note.lesson;
    if (meta) {
      const exam = note.examDate ? formatDate(note.examDate) : t('detail.noExam');
      meta.innerHTML = '<span><svg><use href="#i-calendar"></use></svg>' + esc(exam) + '</span>'
        + '<span><svg><use href="#i-clock"></use></svg>' + esc(t('detail.updated', { date: formatDate(new Date(note.updatedAt || note.createdAt)) })) + '</span>';
    }
    if (body) {
      body.textContent = note.summary || t('detail.noSummary');
      body.classList.toggle('is-empty', !note.summary);
    }
    if (edit) {
      edit.setAttribute('data-action', 'edit-note');
      edit.setAttribute('data-id', note.id);
    }
    if (remove) {
      remove.setAttribute('data-action', 'delete-note');
      remove.setAttribute('data-id', note.id);
    }
    openModal('#detail-modal', edit);
  }

  function editNote(id) {
    const note = state.notes.find((item) => item.id === id);
    if (!note) return;
    const detail = $('#detail-modal');
    if (detail && !detail.hidden) closeModal(detail);
    openNoteModal(note);
  }

  /* ---------- الحذف والتأكيد ---------- */
  function openConfirm(options) {
    const title = $('#confirm-title');
    const text = $('#confirm-text');
    const ok = $('#confirm-ok');
    if (title) title.textContent = options.title;
    if (text) text.textContent = options.text;
    if (ok) ok.textContent = options.okLabel;
    state.confirmHandler = options.onConfirm;
    openModal('#confirm-modal', ok);
  }

  function runConfirm() {
    const handler = state.confirmHandler;
    state.confirmHandler = null;
    closeModal('#confirm-modal');
    if (typeof handler === 'function') {
      try { handler(); } catch (err) { storageError(); }
    }
  }

  function requestDeleteNote(id) {
    const note = state.notes.find((item) => item.id === id);
    if (!note) return;
    const detail = $('#detail-modal');
    if (detail && !detail.hidden) closeModal(detail);
    openConfirm({
      title: t('confirm.deleteNoteTitle'),
      text: t('confirm.deleteNoteText', { lesson: note.lesson }),
      okLabel: t('confirm.ok'),
      onConfirm: async function () {
        try {
          await Store.deleteNote(state.user.id, id);
          state.notes = state.notes.filter((item) => item.id !== id);
          renderAll();
          toast(t('notes.deleted'), 'success');
        } catch (err) { storageError(); }
      }
    });
  }

  function requestDeleteAll() {
    openConfirm({
      title: t('confirm.deleteAllTitle'),
      text: t('confirm.deleteAllText', { n: state.notes.length }),
      okLabel: t('confirm.ok'),
      onConfirm: async function () {
        try {
          await Store.deleteAllNotes(state.user.id);
          state.notes = [];
          renderAll();
          toast(t('toast.deletedAll'), 'success');
        } catch (err) { storageError(); }
      }
    });
  }

  function requestDeleteAccount() {
    if (!state.user) return;
    openConfirm({
      title: t('confirm.deleteAccountTitle'),
      text: t('confirm.deleteAccountText'),
      okLabel: t('confirm.ok'),
      onConfirm: function () {
        Store.deleteUser(state.user.id);
        resetToAuth();
        toast(t('toast.accountDeleted'), 'success');
      }
    });
  }

  /* ---------- الرقم السري ---------- */
  function openPinModal() {
    const form = $('#pin-form');
    if (!form) return;
    form.reset();
    const error = $('#pin-error');
    if (error) {
      error.hidden = true;
      error.textContent = '';
    }
    openModal('#pin-modal', form.elements.current);
  }

  async function handlePinSubmit(event) {
    event.preventDefault();
    if (!state.user) return;
    const form = event.currentTarget;
    const current = form.elements.current.value.trim();
    const pin = form.elements.pin.value.trim();
    const confirm = form.elements.confirm.value.trim();
    const error = $('#pin-error');
    const fail = function (key) {
      if (error) {
        error.textContent = t(key);
        error.hidden = false;
      }
    };
    if (error) error.hidden = true;

    if (!current || !pin || !confirm) return fail('auth.errFields');
    if (pin.length < 8) return fail('pin.errFormat');
    if (pin !== confirm) return fail('pin.errMatch');
    if (pin === current) return fail('pin.errSame');

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const { error: signInError } = await Store.supabase.auth.signInWithPassword({ email: state.user.email, password: current });
      if (signInError) return fail('pin.errCurrent');
      const { error } = await Store.supabase.auth.updateUser({ password: pin });
      if (error) throw error;
      form.reset();
      closeModal('#pin-modal');
      toast(t('pin.done'), 'success');
    } catch (err) {
      fail(err && err.message ? err.message : 'auth.errGeneric');
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  /* ---------- التصدير والاستيراد ---------- */
  function exportNotes() {
    if (!state.user) return;
    try {
      const payload = Store.exportPayload(state.user, state.notes);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      const name = state.user.name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
      link.href = url;
      link.download = 'my-study-notes-' + (name || 'backup') + '-' + date + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast(t('settings.exported'), 'success');
    } catch (err) {
      storageError();
    }
  }

  function normalizeIncoming(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const subject = String(raw.subject || '').trim().slice(0, 60);
    const lesson = String(raw.lesson || '').trim().slice(0, 120);
    if (!subject || !lesson) return null;
    const status = STATUSES.indexOf(raw.status) === -1 ? 'good' : raw.status;
    const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : Store.uid(),
      subject: subject,
      lesson: lesson,
      summary: String(raw.summary || '').slice(0, SUMMARY_LIMIT),
      examDate: isValidDate(raw.examDate) ? raw.examDate : '',
      status: status,
      createdAt: createdAt,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt
    };
  }

  async function handleImportFile(event) {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file || !state.user) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const incoming = Array.isArray(data) ? data : (data && Array.isArray(data.notes) ? data.notes : null);
      if (!incoming) throw new Error('INVALID');
      const clean = incoming.map(normalizeIncoming).filter(Boolean);
      if (!clean.length) throw new Error('EMPTY');

      const map = new Map(state.notes.map((note) => [note.id, note]));
      clean.forEach((note) => {
        const existing = map.get(note.id);
        map.set(note.id, existing ? { ...existing, ...note, updatedAt: Date.now() } : note);
      });
      const next = Array.from(map.values());
      try {
        await Store.deleteAllNotes(state.user.id);
        const created = await Store.createNotes(state.user.id, next);
        state.notes = created.length ? created : next;
      } catch (err) {
        state.notes = next;
      }
      renderAll();
      toast(t('settings.imported', { n: clean.length }), 'success');
    } catch (err) {
      toast(t('settings.importError'), 'error');
    }
  }

  /* ---------- التفاعلات ---------- */
  function handleAction(action, element) {
    switch (action) {
      case 'toggle-lang':
        setLanguage(I18n.lang === 'ar' ? 'en' : 'ar');
        break;
      case 'toggle-theme':
        applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
        break;
      case 'forgot-password':
        openModal('#reset-request-modal', $('#reset-request-form') && $('#reset-request-form').elements.email);
        break;
      case 'toggle-sidebar':
        if ($('#sidebar') && $('#sidebar').classList.contains('is-open')) closeSidebar();
        else openSidebar();
        break;
      case 'close-sidebar':
        closeSidebar();
        break;
      case 'toggle-user-menu':
        toggleUserMenu();
        break;
      case 'logout':
        logout();
        break;
      case 'new-note':
        closeUserMenu();
        openNoteModal(null);
        break;
      case 'open-note':
        closeUserMenu();
        openDetail(element.getAttribute('data-id'));
        break;
      case 'edit-note':
        closeUserMenu();
        editNote(element.getAttribute('data-id'));
        break;
      case 'delete-note':
        requestDeleteNote(element.getAttribute('data-id'));
        break;
      case 'clear-filters':
        state.filters = { q: '', subject: '', status: '', sort: state.filters.sort };
        renderNotes();
        break;
      case 'export':
        exportNotes();
        break;
      case 'import':
        if ($('#import-file')) $('#import-file').click();
        break;
      case 'change-pin':
        openPinModal();
        break;
      case 'delete-all':
        requestDeleteAll();
        break;
      case 'delete-account':
        requestDeleteAccount();
        break;
      case 'toggle-pin':
        togglePinVisibility(element);
        break;
      default:
        break;
    }
  }

  function togglePinVisibility(button) {
    const group = button.closest('.input-group');
    const input = group ? group.querySelector('input') : null;
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const label = t(show ? 'auth.hidePin' : 'auth.showPin');
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    const use = button.querySelector('use');
    if (use) use.setAttribute('href', show ? '#i-eye-off' : '#i-eye');
  }

  /* ---------- ربط الأحداث ---------- */
  function bindEvents() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const closeTrigger = target.closest('[data-close-modal]');
      if (closeTrigger) {
        const modal = closeTrigger.closest('.modal');
        if (modal) closeModal(modal);
        return;
      }

      const actionEl = target.closest('[data-action]');
      if (actionEl) {
        handleAction(actionEl.getAttribute('data-action'), actionEl);
        return;
      }

      const viewEl = target.closest('[data-view-target]');
      if (viewEl) {
        switchView(viewEl.getAttribute('data-view-target'));
        return;
      }

      const themeBtn = target.closest('[data-theme-set]');
      if (themeBtn) {
        applyTheme(themeBtn.getAttribute('data-theme-set'));
        return;
      }

      const langBtn = target.closest('[data-lang-set]');
      if (langBtn) {
        setLanguage(langBtn.getAttribute('data-lang-set'));
        return;
      }

      if (!target.closest('.user-menu')) closeUserMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (topModal()) {
          closeTopModal();
          return;
        }
        closeUserMenu();
        closeSidebar();
        return;
      }

      if (event.key === 'Tab') {
        const modal = topModal();
        if (!modal) return;
        const focusables = $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', modal)
          .filter((el) => el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element) {
        const card = event.target.closest('[data-action="open-note"][tabindex]');
        if (card && event.target === card) {
          event.preventDefault();
          openDetail(card.getAttribute('data-id'));
        }
      }
    });

    document.addEventListener('input', (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.getAttribute('inputmode') === 'numeric') {
        const clean = input.value.replace(/\D+/g, '').slice(0, 8);
        if (clean !== input.value) input.value = clean;
      }
      if (input.closest('#note-form')) input.classList.remove('is-invalid');
      if (input.name === 'summary' && input.closest('#note-form')) updateSummaryCounter();
    });

    const loginForm = $('#login-form');
    const registerForm = $('#register-form');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (registerForm) registerForm.addEventListener('submit', handleRegister);

    $$('[data-auth-tab]').forEach((button) => {
      button.addEventListener('click', () => syncAuthTab(button.getAttribute('data-auth-tab')));
    });

    const noteForm = $('#note-form');
    if (noteForm) noteForm.addEventListener('submit', handleNoteSubmit);

    const resetRequestForm = $('#reset-request-form');
    if (resetRequestForm) resetRequestForm.addEventListener('submit', handleResetRequest);
    const resetPasswordForm = $('#reset-password-form');
    if (resetPasswordForm) resetPasswordForm.addEventListener('submit', handleResetPassword);

    const pinForm = $('#pin-form');
    if (pinForm) pinForm.addEventListener('submit', handlePinSubmit);

    const confirmOk = $('#confirm-ok');
    if (confirmOk) confirmOk.addEventListener('click', runConfirm);

    const search = $('#search-input');
    if (search) {
      search.addEventListener('input', () => {
        state.filters.q = search.value;
        renderNotes();
      });
    }

    const subjectFilter = $('#filter-subject');
    if (subjectFilter) {
      subjectFilter.addEventListener('change', () => {
        state.filters.subject = subjectFilter.value;
        renderNotes();
      });
    }

    const statusFilter = $('#filter-status');
    if (statusFilter) {
      statusFilter.addEventListener('change', () => {
        state.filters.status = statusFilter.value;
        renderNotes();
      });
    }

    const sortFilter = $('#filter-sort');
    if (sortFilter) {
      sortFilter.addEventListener('change', () => {
        state.filters.sort = sortFilter.value;
        renderNotes();
      });
    }

    const importFile = $('#import-file');
    if (importFile) importFile.addEventListener('change', handleImportFile);

    /* Supabase handles multi-tab sync via auth state changes; no localStorage sync needed. */

    window.addEventListener('resize', () => {
      if (window.innerWidth > 960) closeSidebar();
      else syncSidebarA11y();
    });
  }

  /* ---------- البداية ---------- */
  async function init() {
    const prefs = Store.getPrefs();
    I18n.init(prefs.lang === 'en' ? 'en' : 'ar');
    applyTheme(prefs.theme === 'dark' ? 'dark' : 'light', false);
    bindEvents();
    syncSidebarA11y();
    syncAuthTab('login');

    try {
      const session = await Store.getSession();
      if (session) {
        const user = await Store.getUser();
        if (user) await enterApp(user, false);
      }
    } catch (err) { /* ignore */ }

    if (!Store.storageAvailable()) toast(t('toast.storageError'), 'error');

    Store.onAuthStateChange(async function (event, session) {
      if (event === 'PASSWORD_RECOVERY') {
        openModal('#reset-password-modal', $('#reset-password-form') && $('#reset-password-form').elements.password);
        return;
      }
      if (event === 'SIGNED_OUT') {
        resetToAuth();
      } else if (event === 'SIGNED_IN' && session) {
        const user = await Store.getUser();
        if (user && !document.body.classList.contains('is-authed')) await enterApp(user, false);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
