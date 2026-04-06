/* ==========================================================================
   Command Garden — Application Core
   ========================================================================== */

// ---------- Configuration ----------
const CONFIG = {
  apiBaseUrl: '/api',
  artifactBasePath: '/days',
  manifestPath: '/days/manifest.json',
  artifactFiles: [
    'decision.json',
    'feedback-digest.json',
    'spec.md',
    'build-summary.md',
    'review.md',
    'test-results.json'
  ],
  cacheDuration: 5 * 60 * 1000, // 5 minutes
};

// ---------- Cache ----------
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CONFIG.cacheDuration) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ---------- Fetch Helpers ----------
async function fetchJSON(url) {
  const cached = getCached(url);
  if (cached) return cached;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const data = await response.json();
  setCache(url, data);
  return data;
}

async function fetchText(url) {
  const cached = getCached(url);
  if (cached) return cached;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const text = await response.text();
  setCache(url, text);
  return text;
}

async function fetchOptional(url, type = 'json') {
  try {
    return type === 'json' ? await fetchJSON(url) : await fetchText(url);
  } catch {
    return null;
  }
}

// ---------- Manifest ----------
async function getManifest() {
  return fetchJSON(CONFIG.manifestPath);
}

function getLatestDay(manifest) {
  if (!manifest || !manifest.days || manifest.days.length === 0) return null;
  const sorted = [...manifest.days].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
  return sorted[0];
}

function getDayByDate(manifest, dateStr) {
  if (!manifest || !manifest.days) return null;
  return manifest.days.find((d) => d.date === dateStr) || null;
}

function getAdjacentDays(manifest, dateStr) {
  if (!manifest || !manifest.days) return { prev: null, next: null };
  const sorted = [...manifest.days].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const idx = sorted.findIndex((d) => d.date === dateStr);
  return {
    prev: idx > 0 ? sorted[idx - 1] : null,
    next: idx < sorted.length - 1 ? sorted[idx + 1] : null,
  };
}

// ---------- Day Artifacts ----------
async function loadDay(dateStr) {
  const basePath = `${CONFIG.artifactBasePath}/${dateStr}`;

  const [decision, feedbackDigest, spec, buildSummary, review, testResults] =
    await Promise.all([
      fetchOptional(`${basePath}/decision.json`, 'json'),
      fetchOptional(`${basePath}/feedback-digest.json`, 'json'),
      fetchOptional(`${basePath}/spec.md`, 'text'),
      fetchOptional(`${basePath}/build-summary.md`, 'text'),
      fetchOptional(`${basePath}/review.md`, 'text'),
      fetchOptional(`${basePath}/test-results.json`, 'json'),
    ]);

  return {
    date: dateStr,
    decision,
    feedbackDigest,
    spec,
    buildSummary,
    review,
    testResults,
  };
}

async function loadLatestDay() {
  const manifest = await getManifest();
  const latest = getLatestDay(manifest);
  if (!latest) return null;
  const artifacts = await loadDay(latest.date);
  return { manifest, day: latest, artifacts };
}

// ---------- Date Formatting ----------
function formatDate(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatDateShort(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function relativeTime(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  }
  const months = Math.floor(diffDays / 30);
  return `${months} month${months > 1 ? 's' : ''} ago`;
}

// ---------- URL Helpers ----------
function getDayUrl(dateStr) {
  return `/days/?date=${dateStr}`;
}

function getDateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const dateParam = params.get('date');
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return dateParam;
  }
  // Try to extract from path: /days/YYYY-MM-DD/
  const pathMatch = window.location.pathname.match(
    /\/days\/(\d{4}-\d{2}-\d{2})/
  );
  if (pathMatch) {
    return pathMatch[1];
  }
  return null;
}

// ---------- DOM Helpers ----------
function el(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') {
      element.className = value;
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value)) {
        element.dataset[dk] = dv;
      }
    } else if (key.startsWith('on')) {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'innerHTML') {
      element.innerHTML = value;
    } else {
      element.setAttribute(key, value);
    }
  }

  for (const child of children) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      element.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      element.appendChild(child);
    }
  }

  return element;
}

// ---------- Error Display ----------
function showError(container, message, detail = '') {
  container.innerHTML = '';
  container.appendChild(
    el('div', { className: 'empty-state' },
      el('div', { className: 'empty-state__icon' }, '\u{1F331}'),
      el('h3', { className: 'empty-state__title' }, message),
      detail
        ? el('p', { className: 'empty-state__message' }, detail)
        : null
    )
  );
}

function showLoading(container, count = 3) {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    container.appendChild(
      el('div', { className: 'card mb-4' },
        el('div', { className: 'skeleton skeleton--title' }),
        el('div', { className: 'skeleton skeleton--text' }),
        el('div', { className: 'skeleton skeleton--text-sm' })
      )
    );
  }
}

// ---------- Mobile Navigation ----------
function initMobileNav() {
  const toggle = document.querySelector('.nav__mobile-toggle');
  const links = document.querySelector('.nav__links');
  if (!toggle || !links) return;

  toggle.addEventListener('click', () => {
    links.classList.toggle('nav__links--open');
    const isOpen = links.classList.contains('nav__links--open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!toggle.contains(e.target) && !links.contains(e.target)) {
      links.classList.remove('nav__links--open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// ---------- Page Detection & Initialization ----------
function detectPage() {
  const path = window.location.pathname;

  if (path === '/' || path === '/index.html') return 'home';
  if (path.startsWith('/days')) return 'day';
  if (path.startsWith('/archive')) return 'archive';
  if (path.startsWith('/judges')) return 'judges';
  if (path.startsWith('/feedback')) return 'feedback';
  return 'unknown';
}

// ---------- Exports ----------
export {
  CONFIG,
  fetchJSON,
  fetchText,
  fetchOptional,
  getManifest,
  getLatestDay,
  getDayByDate,
  getAdjacentDays,
  loadDay,
  loadLatestDay,
  formatDate,
  formatDateShort,
  relativeTime,
  getDayUrl,
  getDateFromUrl,
  el,
  showError,
  showLoading,
  initMobileNav,
  detectPage,
};
