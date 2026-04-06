/* ==========================================================================
   Command Garden — Artifact Renderers
   All renderers return DOM elements (not innerHTML strings) for safety.
   ========================================================================== */

import { el, getDayUrl, formatDate, formatDateShort, relativeTime } from './app.js';

// ---------- Simple Markdown Renderer ----------
function renderMarkdown(md) {
  if (!md) return el('div');

  const container = el('div', { className: 'rendered-md' });
  const lines = md.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Code block
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const pre = el('pre');
      const code = el('code');
      if (lang) pre.dataset.lang = lang;
      code.textContent = codeLines.join('\n');
      pre.appendChild(code);
      container.appendChild(pre);
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const tag = `h${level}`;
      container.appendChild(el(tag, {}, ...inlineMarkdown(headerMatch[2])));
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      container.appendChild(el('hr'));
      i++;
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const bq = el('blockquote');
      bq.appendChild(el('p', {}, ...inlineMarkdown(quoteLines.join(' '))));
      container.appendChild(bq);
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s/.test(line)) {
      const listEl = el('ul');
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*+]\s/, '');
        listEl.appendChild(el('li', {}, ...inlineMarkdown(text)));
        i++;
      }
      container.appendChild(listEl);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const listEl = el('ol');
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+\.\s/, '');
        listEl.appendChild(el('li', {}, ...inlineMarkdown(text)));
        i++;
      }
      container.appendChild(listEl);
      continue;
    }

    // Paragraph (collect consecutive non-empty lines)
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('>') &&
      !/^\s*[-*+]\s/.test(lines[i]) &&
      !/^\s*\d+\.\s/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      container.appendChild(
        el('p', {}, ...inlineMarkdown(paraLines.join(' ')))
      );
    }
  }

  return container;
}

function inlineMarkdown(text) {
  // Process inline markdown into an array of nodes
  const nodes = [];
  // Regex for: **bold**, *italic*, `code`, [link](url)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // **bold**
      nodes.push(el('strong', {}, match[2]));
    } else if (match[3]) {
      // *italic*
      nodes.push(el('em', {}, match[3]));
    } else if (match[4]) {
      // `code`
      nodes.push(el('code', {}, match[4]));
    } else if (match[5] && match[6]) {
      // [link](url)
      nodes.push(el('a', { href: match[6] }, match[5]));
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

// ---------- Decision Renderer ----------
function renderDecision(data) {
  if (!data) {
    return el('div', { className: 'empty-state' },
      el('div', { className: 'empty-state__icon' }, '\u{1F4CB}'),
      el('h3', { className: 'empty-state__title' }, 'No decision data available'),
      el('p', { className: 'empty-state__message' }, 'The decision artifact has not been generated yet.')
    );
  }

  const container = el('div');

  // Winner
  if (data.winner) {
    container.appendChild(renderWinner(data.winner, data.rationale));
  }

  // Candidates
  if (data.candidates && data.candidates.length > 0) {
    const candidatesSection = el('div', { className: 'mt-8' });
    candidatesSection.appendChild(
      el('h3', { className: 'section__title mb-6' }, 'All Candidates')
    );
    candidatesSection.appendChild(renderCandidates(data.candidates));
    container.appendChild(candidatesSection);
  }

  return container;
}

// ---------- Candidates Renderer ----------
function renderCandidates(candidates, limit = 0) {
  if (!candidates || candidates.length === 0) {
    return el('p', { className: 'text-muted text-sm' }, 'No candidates available.');
  }

  const sorted = [...candidates].sort(
    (a, b) => (b.totalScore || 0) - (a.totalScore || 0)
  );
  const toShow = limit > 0 ? sorted.slice(0, limit) : sorted;

  const grid = el('div', {
    className: 'd-grid gap-4',
    style: 'grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));',
  });

  toShow.forEach((candidate, idx) => {
    const rank = idx + 1;
    const card = el('div', { className: 'candidate-card' },
      el('div', { className: 'candidate-card__rank' }, String(rank)),
      el('h4', { className: 'candidate-card__title' }, candidate.title || 'Untitled'),
      el('p', { className: 'candidate-card__summary' }, candidate.summary || ''),
      renderCandidateScores(candidate)
    );
    grid.appendChild(card);
  });

  return grid;
}

function renderCandidateScores(candidate) {
  const scores = candidate.scores || {};
  const container = el('div', { className: 'candidate-card__scores' });

  const dimensions = [
    { key: 'impact', label: 'Impact' },
    { key: 'feasibility', label: 'Feasibility' },
    { key: 'novelty', label: 'Novelty' },
    { key: 'continuity', label: 'Continuity' },
    { key: 'clarity', label: 'Clarity' },
    { key: 'delight', label: 'Delight' },
  ];

  for (const dim of dimensions) {
    const val = scores[dim.key];
    if (val == null) continue;
    const pct = Math.round((val / 10) * 100);

    container.appendChild(
      el('div', { className: 'score-bar' },
        el('span', { className: 'score-bar__label' }, dim.label),
        el('div', { className: 'score-bar__track' },
          el('div', {
            className: 'score-bar__fill',
            style: `width: ${pct}%`,
          })
        ),
        el('span', { className: 'score-bar__value' }, String(val))
      )
    );
  }

  // Total
  if (candidate.totalScore != null) {
    container.appendChild(
      el('div', { className: 'score-bar mt-2' },
        el('span', {
          className: 'score-bar__label font-semibold',
        }, 'Total'),
        el('div', { className: 'score-bar__track' },
          el('div', {
            className: 'score-bar__fill score-bar__fill--gold',
            style: `width: ${Math.round((candidate.totalScore / 60) * 100)}%`,
          })
        ),
        el('span', {
          className: 'score-bar__value font-bold',
        }, String(candidate.totalScore))
      )
    );
  }

  return container;
}

// ---------- Winner Renderer ----------
function renderWinner(winner, rationale) {
  const winnerData = winner || {};
  return el('div', { className: 'winner-highlight' },
    el('div', { className: 'winner-highlight__badge' }, '\u2713 Winner'),
    el('h2', { className: 'winner-highlight__title' }, winnerData.title || 'Untitled'),
    rationale
      ? el('p', { className: 'winner-highlight__rationale' }, rationale)
      : null,
    winnerData.totalScore != null
      ? el('div', { className: 'winner-highlight__score' },
          `Score: ${winnerData.totalScore} / 60`
        )
      : null
  );
}

// ---------- Score Table Renderer ----------
function renderScoreTable(candidates) {
  if (!candidates || candidates.length === 0) {
    return el('p', { className: 'text-muted text-sm' }, 'No scoring data available.');
  }

  const sorted = [...candidates].sort(
    (a, b) => (b.totalScore || 0) - (a.totalScore || 0)
  );

  const dimensions = ['impact', 'feasibility', 'novelty', 'continuity', 'clarity', 'delight'];
  const dimLabels = ['Impact', 'Feasibility', 'Novelty', 'Continuity', 'Clarity', 'Delight'];

  const table = el('table', { className: 'score-table' });

  // Header
  const thead = el('thead');
  const headerRow = el('tr');
  headerRow.appendChild(el('th', {}, 'Candidate'));
  dimLabels.forEach((label) => headerRow.appendChild(el('th', {}, label)));
  headerRow.appendChild(el('th', {}, 'Total'));
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = el('tbody');
  sorted.forEach((candidate, idx) => {
    const isWinner = idx === 0;
    const row = el('tr', {
      className: isWinner ? 'score-table__winner' : '',
    });

    row.appendChild(
      el('td', { className: 'score-table__candidate' },
        candidate.title || 'Untitled',
        isWinner ? el('span', { className: 'badge badge--shipped ml-2' }, 'Winner') : null
      )
    );

    const scores = candidate.scores || {};
    dimensions.forEach((dim) => {
      row.appendChild(
        el('td', { className: 'score-table__score' },
          scores[dim] != null ? String(scores[dim]) : '-'
        )
      );
    });

    row.appendChild(
      el('td', { className: 'score-table__score score-table__total' },
        candidate.totalScore != null ? String(candidate.totalScore) : '-'
      )
    );

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  // Wrap in scrollable container
  const wrapper = el('div', { style: 'overflow-x: auto;' }, table);
  return wrapper;
}

// ---------- Feedback Digest Renderer ----------
function renderFeedbackDigest(data) {
  if (!data || (!data.items && !data.themes)) {
    return el('div', { className: 'empty-state' },
      el('div', { className: 'empty-state__icon' }, '\u{1F4AC}'),
      el('h3', { className: 'empty-state__title' }, 'No feedback data'),
      el('p', { className: 'empty-state__message' }, 'No feedback influenced this day\'s decisions.')
    );
  }

  const container = el('div');

  // Themes summary
  if (data.themes && data.themes.length > 0) {
    const themesSection = el('div', { className: 'mb-6' });
    themesSection.appendChild(
      el('h4', { className: 'text-sm font-semibold text-muted uppercase tracking-wide mb-3' }, 'Themes')
    );
    const tagsContainer = el('div', { className: 'd-flex flex-wrap gap-2' });
    data.themes.forEach((theme) => {
      tagsContainer.appendChild(el('span', { className: 'tag tag--green' }, theme));
    });
    themesSection.appendChild(tagsContainer);
    container.appendChild(themesSection);
  }

  // Summary
  if (data.summary) {
    container.appendChild(
      el('p', { className: 'text-sm text-muted mb-6' }, data.summary)
    );
  }

  // Individual feedback items
  if (data.items && data.items.length > 0) {
    const itemsContainer = el('div');
    data.items.forEach((item) => {
      itemsContainer.appendChild(
        el('div', { className: 'feedback-item' },
          el('div', { className: 'feedback-item__type' }, item.type || 'Feedback'),
          el('p', { className: 'feedback-item__text' }, item.text || ''),
          item.receivedAt
            ? el('span', { className: 'feedback-item__meta' }, relativeTime(item.receivedAt))
            : null
        )
      );
    });
    container.appendChild(itemsContainer);
  }

  return container;
}

// ---------- Test Results Renderer ----------
function renderTestResults(data) {
  if (!data) {
    return el('div', { className: 'empty-state' },
      el('div', { className: 'empty-state__icon' }, '\u{1F9EA}'),
      el('h3', { className: 'empty-state__title' }, 'No test results'),
      el('p', { className: 'empty-state__message' }, 'Test results are not available for this day.')
    );
  }

  const container = el('div');

  // Summary bar
  const passed = data.passed || 0;
  const failed = data.failed || 0;
  const total = data.total || passed + failed;

  const summaryBar = el('div', {
    className: 'd-flex items-center gap-4 mb-6 p-4 card',
  });

  summaryBar.appendChild(
    el('div', { className: 'd-flex items-center gap-2' },
      el('span', { className: 'badge badge--pass' }, `${passed} passed`),
      failed > 0
        ? el('span', { className: 'badge badge--fail' }, `${failed} failed`)
        : null,
      el('span', { className: 'text-sm text-muted' }, `${total} total`)
    )
  );

  if (data.duration) {
    summaryBar.appendChild(
      el('span', { className: 'text-xs text-light font-mono' }, data.duration)
    );
  }

  container.appendChild(summaryBar);

  // Scenarios
  if (data.scenarios && data.scenarios.length > 0) {
    const scenariosEl = el('div', { className: 'test-results' });
    data.scenarios.forEach((scenario) => {
      const passed = scenario.status === 'pass' || scenario.status === 'passed';
      scenariosEl.appendChild(
        el('div', { className: 'test-result' },
          el('span', { className: 'test-result__icon' }, passed ? '\u2705' : '\u274C'),
          el('span', { className: 'test-result__name' }, scenario.name || 'Unknown test'),
          scenario.duration
            ? el('span', { className: 'test-result__duration' }, scenario.duration)
            : null,
          el('span', {
            className: `badge badge--${passed ? 'pass' : 'fail'}`,
          }, passed ? 'Pass' : 'Fail')
        )
      );
    });
    container.appendChild(scenariosEl);
  }

  return container;
}

// ---------- Timeline Renderer ----------
function renderTimeline(manifest, options = {}) {
  const { limit = 0, showToday = true } = options;

  if (!manifest || !manifest.days || manifest.days.length === 0) {
    return el('div', { className: 'empty-state' },
      el('div', { className: 'empty-state__icon' }, '\u{1F331}'),
      el('h3', { className: 'empty-state__title' }, 'No entries yet'),
      el('p', { className: 'empty-state__message' }, 'The garden is just getting started.')
    );
  }

  const sorted = [...manifest.days].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
  const entries = limit > 0 ? sorted.slice(0, limit) : sorted;
  const todayStr = new Date().toISOString().split('T')[0];

  const timeline = el('div', { className: 'timeline' });

  entries.forEach((day) => {
    const isToday = showToday && day.date === todayStr;
    const dotClass = isToday
      ? 'timeline-entry__dot--today'
      : day.status === 'shipped'
      ? 'timeline-entry__dot--shipped'
      : day.status === 'failed'
      ? 'timeline-entry__dot--failed'
      : '';

    const entry = el('div', { className: 'timeline-entry' },
      el('div', { className: `timeline-entry__dot ${dotClass}` }),
      el('div', { className: 'timeline-entry__date' },
        `${formatDateShort(day.date)} ${isToday ? ' \u2014 Today' : ` \u2014 ${relativeTime(day.date)}`}`
      ),
      el('div', { className: 'timeline-entry__title' },
        el('a', { href: getDayUrl(day.date) }, day.title || 'Untitled')
      ),
      day.summary
        ? el('p', { className: 'timeline-entry__summary' }, day.summary)
        : null,
      day.status
        ? el('span', {
            className: `badge badge--${day.status} mt-2`,
          }, day.status)
        : null
    );

    timeline.appendChild(entry);
  });

  return timeline;
}

// ---------- Reactions Renderer ----------
function renderReactions(dayDate, reactions = {}) {
  const reactionTypes = [
    { emoji: '\u{1F331}', label: 'Sprout', key: 'sprout' },
    { emoji: '\u{1F33F}', label: 'Herb', key: 'herb' },
    { emoji: '\u{1F333}', label: 'Tree', key: 'tree' },
    { emoji: '\u2B50', label: 'Star', key: 'star' },
    { emoji: '\u{1F41B}', label: 'Bug', key: 'bug' },
    { emoji: '\u{1F4A1}', label: 'Idea', key: 'idea' },
  ];

  const bar = el('div', { className: 'reaction-bar' });

  // Check localStorage for user's reactions
  const userReactions = JSON.parse(
    localStorage.getItem(`reactions-${dayDate}`) || '{}'
  );

  reactionTypes.forEach((type) => {
    const count = reactions[type.key] || 0;
    const isActive = !!userReactions[type.key];

    const btn = el('button', {
      className: `reaction-bar__btn ${isActive ? 'reaction-bar__btn--active' : ''}`,
      title: type.label,
      dataset: { reaction: type.key, date: dayDate },
    },
      el('span', {}, type.emoji),
      el('span', { className: 'reaction-bar__count' }, String(count))
    );

    btn.addEventListener('click', () => handleReaction(btn, type.key, dayDate));
    bar.appendChild(btn);
  });

  return bar;
}

async function handleReaction(btn, reactionKey, dayDate) {
  const userReactions = JSON.parse(
    localStorage.getItem(`reactions-${dayDate}`) || '{}'
  );

  const isActive = !!userReactions[reactionKey];
  const countEl = btn.querySelector('.reaction-bar__count');
  let count = parseInt(countEl.textContent) || 0;

  // Optimistic update
  if (isActive) {
    btn.classList.remove('reaction-bar__btn--active');
    count = Math.max(0, count - 1);
    delete userReactions[reactionKey];
  } else {
    btn.classList.add('reaction-bar__btn--active');
    count += 1;
    userReactions[reactionKey] = true;
  }

  countEl.textContent = String(count);
  localStorage.setItem(`reactions-${dayDate}`, JSON.stringify(userReactions));

  // Send to API (fire-and-forget)
  try {
    await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: dayDate,
        reaction: reactionKey,
        action: isActive ? 'remove' : 'add',
      }),
    });
  } catch {
    // Silently fail — optimistic update is already applied
  }
}

// ---------- Artifact Links Renderer ----------
function renderArtifactLinks(dateStr) {
  const basePath = `/days/${dateStr}`;
  const files = [
    { name: 'decision.json', icon: '\u{1F4CB}' },
    { name: 'feedback-digest.json', icon: '\u{1F4AC}' },
    { name: 'spec.md', icon: '\u{1F4DD}' },
    { name: 'build-summary.md', icon: '\u{1F528}' },
    { name: 'review.md', icon: '\u{1F50D}' },
    { name: 'test-results.json', icon: '\u{1F9EA}' },
  ];

  const grid = el('div', {
    className: 'd-flex flex-wrap gap-3',
  });

  files.forEach((file) => {
    grid.appendChild(
      el('a', {
        href: `${basePath}/${file.name}`,
        className: 'artifact-link',
        target: '_blank',
        rel: 'noopener',
      },
        el('span', { className: 'artifact-link__icon' }, file.icon),
        el('span', { className: 'artifact-link__name' }, file.name)
      )
    );
  });

  return grid;
}

// ---------- Exports ----------
export {
  renderMarkdown,
  renderDecision,
  renderCandidates,
  renderWinner,
  renderScoreTable,
  renderFeedbackDigest,
  renderTestResults,
  renderTimeline,
  renderReactions,
  renderArtifactLinks,
};
