/* ==========================================================================
   Command Garden — Feedback & Reactions
   ========================================================================== */

import { el } from './app.js';

// ---------- Rate Limiting ----------
const RATE_LIMIT = {
  maxSubmissions: 5,
  windowMs: 60 * 60 * 1000, // 1 hour
  storageKey: 'cg-feedback-timestamps',
};

function getRateLimitTimestamps() {
  try {
    const raw = localStorage.getItem(RATE_LIMIT.storageKey);
    if (!raw) return [];
    const timestamps = JSON.parse(raw);
    const cutoff = Date.now() - RATE_LIMIT.windowMs;
    return timestamps.filter((t) => t > cutoff);
  } catch {
    return [];
  }
}

function recordSubmission() {
  const timestamps = getRateLimitTimestamps();
  timestamps.push(Date.now());
  localStorage.setItem(RATE_LIMIT.storageKey, JSON.stringify(timestamps));
}

function isRateLimited() {
  return getRateLimitTimestamps().length >= RATE_LIMIT.maxSubmissions;
}

function getRemainingSubmissions() {
  return Math.max(0, RATE_LIMIT.maxSubmissions - getRateLimitTimestamps().length);
}

// ---------- Toast Notification System ----------
let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('aria-live', 'polite');
    toastContainer.setAttribute('role', 'status');
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function showToast(type, title, message, duration = 4000) {
  const container = getToastContainer();

  const icons = {
    success: '\u2705',
    error: '\u274C',
    info: '\u2139\uFE0F',
  };

  const toast = el('div', { className: `toast toast--${type}` },
    el('span', { className: 'toast__icon' }, icons[type] || ''),
    el('div', { className: 'toast__content' },
      el('div', { className: 'toast__title' }, title),
      message ? el('div', { className: 'toast__message' }, message) : null
    ),
    el('button', {
      className: 'toast__close',
      onClick: () => dismissToast(toast),
      'aria-label': 'Dismiss',
    }, '\u2715')
  );

  container.appendChild(toast);

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => dismissToast(toast), duration);
  }

  return toast;
}

function dismissToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.add('toast--exiting');
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

// ---------- Validation ----------
const VALIDATION = {
  minLength: 10,
  maxLength: 2000,
};

function validateFeedback(text) {
  if (!text || text.trim().length === 0) {
    return { valid: false, error: 'Please enter your feedback.' };
  }
  if (text.trim().length < VALIDATION.minLength) {
    return {
      valid: false,
      error: `Please write at least ${VALIDATION.minLength} characters.`,
    };
  }
  if (text.length > VALIDATION.maxLength) {
    return {
      valid: false,
      error: `Feedback must be under ${VALIDATION.maxLength} characters.`,
    };
  }
  return { valid: true, error: null };
}

// ---------- Form Submission ----------
async function submitFeedback(type, text) {
  if (isRateLimited()) {
    showToast(
      'error',
      'Rate limit reached',
      'You can submit up to 5 times per hour. Please try again later.'
    );
    return false;
  }

  const validation = validateFeedback(text);
  if (!validation.valid) {
    showToast('error', 'Invalid input', validation.error);
    return false;
  }

  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        content: text.trim(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    recordSubmission();
    const remaining = getRemainingSubmissions();
    showToast(
      'success',
      'Feedback submitted',
      `Thank you! You have ${remaining} submission${remaining !== 1 ? 's' : ''} remaining this hour.`
    );
    return true;
  } catch (err) {
    showToast(
      'error',
      'Submission failed',
      'Could not reach the server. Your feedback was not saved. Please try again.'
    );
    return false;
  }
}

// ---------- Form Initialization ----------
function initFeedbackForm(formEl) {
  if (!formEl) return;

  const textarea = formEl.querySelector('.feedback-form__textarea');
  const submitBtn = formEl.querySelector('.feedback-form__submit');
  const errorEl = formEl.querySelector('.feedback-form__error');
  const charCountEl = formEl.querySelector('.feedback-form__char-count');
  const type = formEl.dataset.type || 'general';

  if (!textarea || !submitBtn) return;

  // Character count
  if (charCountEl) {
    textarea.addEventListener('input', () => {
      const len = textarea.value.length;
      charCountEl.textContent = `${len} / ${VALIDATION.maxLength}`;
      if (len > VALIDATION.maxLength) {
        charCountEl.style.color = 'var(--color-error)';
      } else {
        charCountEl.style.color = '';
      }
    });
  }

  // Clear error on input
  textarea.addEventListener('input', () => {
    textarea.classList.remove('feedback-form__textarea--error');
    if (errorEl) {
      errorEl.classList.remove('feedback-form__error--visible');
    }
  });

  // Submit
  const handleSubmit = async (e) => {
    e.preventDefault();

    const text = textarea.value;
    const validation = validateFeedback(text);

    if (!validation.valid) {
      textarea.classList.add('feedback-form__textarea--error');
      if (errorEl) {
        errorEl.textContent = validation.error;
        errorEl.classList.add('feedback-form__error--visible');
      }
      return;
    }

    // Disable during submission
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    const success = await submitFeedback(type, text);

    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';

    if (success) {
      textarea.value = '';
      if (charCountEl) {
        charCountEl.textContent = `0 / ${VALIDATION.maxLength}`;
      }
    }
  };

  formEl.addEventListener('submit', handleSubmit);
  submitBtn.addEventListener('click', handleSubmit);
}

// ---------- Initialize All Forms on Page ----------
function initAllFeedbackForms() {
  const forms = document.querySelectorAll('.feedback-form');
  forms.forEach((form) => initFeedbackForm(form));

  // Show remaining submissions
  const remaining = getRemainingSubmissions();
  const rateNote = document.getElementById('rate-limit-note');
  if (rateNote) {
    rateNote.textContent = `${remaining} submission${remaining !== 1 ? 's' : ''} remaining this hour.`;
  }
}

// ---------- Exports ----------
export {
  submitFeedback,
  showToast,
  dismissToast,
  initFeedbackForm,
  initAllFeedbackForms,
  validateFeedback,
  isRateLimited,
  getRemainingSubmissions,
};
