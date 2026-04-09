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
    (a, b) => (b.averageScore ?? b.totalScore ?? 0) - (a.averageScore ?? a.totalScore ?? 0)
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
      renderCandidateScores(candidate),
      candidate.reviewerBreakdown ? renderReviewerBreakdown(candidate) : null
    );
    grid.appendChild(card);
  });

  return grid;
}

function renderCandidateScores(candidate) {
  const container = el('div', { className: 'candidate-card__scores' });

  // v2 shape: dimensionAverages keyed by dimension ID
  if (candidate.dimensionAverages) {
    const dimAvgs = candidate.dimensionAverages;
    for (const [dimId, dimData] of Object.entries(dimAvgs)) {
      const avg = dimData.average;
      if (avg == null) continue;
      // Scale 1-10 to 0-100% for the bar
      const pct = Math.round((avg / 10) * 100);
      container.appendChild(
        el('div', { className: 'score-bar' },
          el('span', { className: 'score-bar__label' }, dimData.label || dimId),
          el('div', { className: 'score-bar__track' },
            el('div', {
              className: 'score-bar__fill',
              style: `width: ${pct}%`,
            })
          ),
          el('span', { className: 'score-bar__value' }, String(avg))
        )
      );
    }
  } else {
    // v1 fallback: flat scores object with hardcoded dimensions
    const scores = candidate.scores || {};
    const dimensions = [
      { key: 'compoundingValue', label: 'Compounding Value' },
      { key: 'usefulness', label: 'Usefulness' },
      { key: 'feasibility', label: 'Feasibility' },
      { key: 'artifactClarity', label: 'Artifact Clarity' },
      { key: 'novelty', label: 'Novelty' },
      { key: 'feedbackPull', label: 'Feedback Pull' },
      { key: 'shareability', label: 'Shareability' },
    ];

    for (const dim of dimensions) {
      const val = scores[dim.key];
      if (val == null) continue;
      const pct = Math.round(val);
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
  }

  // Total — v2 uses averageScore, v1 uses totalScore
  const totalScore = candidate.averageScore ?? candidate.totalScore;
  if (totalScore != null) {
    // For v2 (1-10 scale), map to percentage; for v1 (0-100 scale), use directly
    const isV2 = candidate.averageScore != null;
    const pct = isV2
      ? Math.min(100, Math.round((totalScore / 10) * 100))
      : Math.min(100, Math.round(totalScore));
    container.appendChild(
      el('div', { className: 'score-bar mt-2' },
        el('span', {
          className: 'score-bar__label font-semibold',
        }, 'Average'),
        el('div', { className: 'score-bar__track' },
          el('div', {
            className: 'score-bar__fill score-bar__fill--gold',
            style: `width: ${pct}%`,
          })
        ),
        el('span', {
          className: 'score-bar__value font-bold',
        }, String(totalScore))
      )
    );
  }

  return container;
}

// ---------- Winner Renderer ----------
function renderWinner(winner, rationale) {
  const winnerData = winner || {};
  const score = winnerData.averageScore ?? winnerData.totalScore;
  const scoreLabel = winnerData.averageScore != null ? 'Avg Score' : 'Score';
  return el('div', { className: 'winner-highlight' },
    el('div', { className: 'winner-highlight__badge' }, '\u2713 Winner'),
    el('h2', { className: 'winner-highlight__title' }, winnerData.title || 'Untitled'),
    rationale
      ? el('p', { className: 'winner-highlight__rationale' }, rationale)
      : null,
    winnerData.rationale && !rationale
      ? el('p', { className: 'winner-highlight__rationale' }, winnerData.rationale)
      : null,
    score != null
      ? el('div', { className: 'winner-highlight__score' },
          `${scoreLabel}: ${score}`
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
    (a, b) => (b.averageScore ?? b.totalScore ?? 0) - (a.averageScore ?? a.totalScore ?? 0)
  );

  // Detect v2 shape: read dimension columns dynamically from first candidate's dimensionAverages
  const firstCandidate = sorted[0];
  const isV2 = !!firstCandidate.dimensionAverages;

  let dimensions, dimLabels;
  if (isV2) {
    dimensions = Object.keys(firstCandidate.dimensionAverages);
    dimLabels = dimensions.map(
      (key) => firstCandidate.dimensionAverages[key].label || key
    );
  } else {
    // v1 fallback: hardcoded dimensions
    dimensions = ['compoundingValue', 'usefulness', 'feasibility', 'artifactClarity', 'novelty', 'feedbackPull', 'shareability'];
    dimLabels = ['Compounding Value', 'Usefulness', 'Feasibility', 'Artifact Clarity', 'Novelty', 'Feedback Pull', 'Shareability'];
  }

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

    if (isV2) {
      const dimAvgs = candidate.dimensionAverages || {};
      dimensions.forEach((dim) => {
        const dimData = dimAvgs[dim];
        row.appendChild(
          el('td', { className: 'score-table__score' },
            dimData && dimData.average != null ? String(dimData.average) : '-'
          )
        );
      });
    } else {
      const scores = candidate.scores || {};
      dimensions.forEach((dim) => {
        row.appendChild(
          el('td', { className: 'score-table__score' },
            scores[dim] != null ? String(scores[dim]) : '-'
          )
        );
      });
    }

    const totalScore = candidate.averageScore ?? candidate.totalScore;
    row.appendChild(
      el('td', { className: 'score-table__score score-table__total' },
        totalScore != null ? String(totalScore) : '-'
      )
    );

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  // Wrap in scrollable container
  const wrapper = el('div', { style: 'overflow-x: auto;' }, table);
  return wrapper;
}

// ---------- Judge Panel Renderer ----------
function renderJudgePanel(judgePanel) {
  if (!judgePanel || judgePanel.length === 0) {
    return el('div', { className: 'empty-state' },
      el('div', { className: 'empty-state__icon' }, '\u2696\uFE0F'),
      el('h3', { className: 'empty-state__title' }, 'No judge panel data'),
      el('p', { className: 'empty-state__message' }, 'Judge panel information is not available for this day.')
    );
  }

  const lensIcons = {
    gardener: '\u{1F33F}',
    visitor: '\u{1F441}\uFE0F',
    explorer: '\u{1F9ED}',
  };

  const grid = el('div', {
    className: 'd-grid gap-4',
    style: 'grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));',
  });

  judgePanel.forEach((judge) => {
    const icon = lensIcons[judge.lens] || '\u{1F916}';
    const model = judge.model || judge.displayName || 'Unknown model';
    const lens = judge.lens
      ? judge.lens.charAt(0).toUpperCase() + judge.lens.slice(1)
      : '';

    const card = el('article', { className: 'judge-card' },
      el('div', { className: 'judge-card__icon' }, icon),
      el('h3', { className: 'judge-card__name' }, lens || judge.displayName || 'Judge'),
      el('p', { className: 'judge-card__role' }, model),
      lens
        ? el('p', { className: 'judge-card__model' },
            `Lens: ${lens}`
          )
        : null
    );
    grid.appendChild(card);
  });

  return grid;
}

// ---------- Reviewer Breakdown Renderer ----------
function renderReviewerBreakdown(candidate) {
  const breakdown = candidate.reviewerBreakdown;
  if (!breakdown || breakdown.length === 0) {
    return null;
  }

  const lensIcons = { gardener: '\u{1F33F}', visitor: '\u{1F441}\uFE0F', explorer: '\u{1F9ED}' };

  const wrapper = el('details', { className: 'reviewer-breakdown mt-4' });
  const summary = el('summary', { className: 'reviewer-breakdown__toggle' },
    `Individual Judge Reviews (${breakdown.length})`
  );
  wrapper.appendChild(summary);

  const list = el('div', { className: 'reviewer-breakdown__list' });

  breakdown.forEach((entry) => {
    const reviewerInfo = entry.reviewer || entry;
    const model = reviewerInfo.model || reviewerInfo.displayName || 'Judge';
    const lens = reviewerInfo.lens || '';
    const lensLabel = lens ? lens.charAt(0).toUpperCase() + lens.slice(1) : '';
    const icon = lensIcons[lens] || '\u{1F916}';
    const score = entry.overallScore ?? entry.score ?? null;

    const detail = el('details', { className: 'reviewer-card' });
    const detailSummary = el('summary', { className: 'reviewer-card__header' },
      el('span', { className: 'reviewer-card__identity' },
        el('span', { className: 'reviewer-card__icon' }, icon),
        el('strong', {}, lensLabel || model),
        el('span', { className: 'reviewer-card__model text-muted text-sm' }, model)
      ),
      score != null
        ? el('span', { className: 'badge badge--shipped' }, String(score))
        : null
    );
    detail.appendChild(detailSummary);

    const body = el('div', { className: 'reviewer-card__body' });

    // Per-dimension scores
    if (entry.dimensionScores && Object.keys(entry.dimensionScores).length > 0) {
      for (const [dimId, dimData] of Object.entries(entry.dimensionScores)) {
        const val = typeof dimData === 'object' ? dimData.score : dimData;
        const label = typeof dimData === 'object' && dimData.label ? dimData.label : dimId;
        if (val == null) continue;
        const pct = Math.round((val / 10) * 100);
        body.appendChild(
          el('div', { className: 'score-bar' },
            el('span', { className: 'score-bar__label' }, label),
            el('div', { className: 'score-bar__track' },
              el('div', { className: 'score-bar__fill', style: `width: ${pct}%` })
            ),
            el('span', { className: 'score-bar__value' }, String(val))
          )
        );
      }
    }

    // Keep / Must Change / Risks
    const feedbackItems = [
      [entry.keep, 'Keep', '\u2705'],
      [entry.mustChange, 'Must Change', '\u26A0\uFE0F'],
      [entry.risks, 'Risks', '\u{1F6A9}'],
    ];
    feedbackItems.forEach(([items, heading, emoji]) => {
      if (!items || items.length === 0) return;
      const ul = el('ul', { className: 'text-sm mb-2' });
      items.forEach((item) => ul.appendChild(el('li', {}, `${emoji} ${item}`)));
      body.appendChild(el('div', { className: 'mb-2' },
        el('strong', { className: 'text-sm' }, `${heading}:`), ul
      ));
    });

    detail.appendChild(body);
    list.appendChild(detail);
  });

  wrapper.appendChild(list);
  return wrapper;
}

// ---------- Feedback Digest Renderer ----------
function renderFeedbackDigest(data) {
  // The actual schema uses: data.suggestions, data.bugs, data.confusion, data.recurringThemes
  const hasFeedback = data && (
    (data.suggestions && data.suggestions.length > 0) ||
    (data.bugs && data.bugs.length > 0) ||
    (data.confusion && data.confusion.length > 0) ||
    (data.recurringThemes && data.recurringThemes.length > 0) ||
    // Legacy field support
    (data.items && data.items.length > 0) ||
    (data.themes && data.themes.length > 0)
  );

  if (!data || !hasFeedback) {
    return el('div', { className: 'empty-state' },
      el('div', { className: 'empty-state__icon' }, '\u{1F4AC}'),
      el('h3', { className: 'empty-state__title' }, 'No feedback data'),
      el('p', { className: 'empty-state__message' }, 'No feedback influenced this day\'s decisions.')
    );
  }

  const container = el('div');

  // Recurring themes (spec field: recurringThemes; legacy: themes)
  const themes = data.recurringThemes || data.themes || [];
  if (themes.length > 0) {
    const themesSection = el('div', { className: 'mb-6' });
    themesSection.appendChild(
      el('h4', { className: 'text-sm font-semibold text-muted uppercase tracking-wide mb-3' }, 'Recurring Themes')
    );
    const tagsContainer = el('div', { className: 'd-flex flex-wrap gap-2' });
    themes.forEach((theme) => {
      tagsContainer.appendChild(el('span', { className: 'tag tag--green' }, theme));
    });
    themesSection.appendChild(tagsContainer);
    container.appendChild(themesSection);
  }

  // Summary stats
  if (data.summary && typeof data.summary === 'object') {
    const s = data.summary;
    container.appendChild(
      el('p', { className: 'text-sm text-muted mb-6' },
        `${s.totalItems || 0} feedback items (${s.byType?.suggestion || 0} suggestions, ${s.byType?.bug || 0} bugs, ${s.byType?.confusion || 0} confusion)`
      )
    );
  } else if (data.summary && typeof data.summary === 'string') {
    container.appendChild(
      el('p', { className: 'text-sm text-muted mb-6' }, data.summary)
    );
  }

  // Render feedback items by type (spec schema: suggestions, bugs, confusion arrays)
  const feedbackTypes = [
    { key: 'suggestions', label: 'Suggestions', icon: '\u{1F4A1}' },
    { key: 'bugs', label: 'Bugs', icon: '\u{1F41B}' },
    { key: 'confusion', label: 'Confusion', icon: '\u{1F914}' },
  ];

  for (const ft of feedbackTypes) {
    const items = data[ft.key];
    if (!items || items.length === 0) continue;

    const section = el('div', { className: 'mb-4' });
    section.appendChild(
      el('h4', { className: 'text-sm font-semibold text-muted uppercase tracking-wide mb-3' },
        `${ft.icon} ${ft.label} (${items.length})`)
    );

    items.forEach((item) => {
      const content = item.content || item.text || '';
      const countBadge = item.count && item.count > 1
        ? el('span', { className: 'badge badge--shipped ml-2' }, `×${item.count}`)
        : null;

      section.appendChild(
        el('div', { className: 'feedback-item' },
          el('div', { className: 'feedback-item__type' }, ft.label),
          el('p', { className: 'feedback-item__text' }, content, countBadge),
          item.dayDate
            ? el('span', { className: 'feedback-item__meta' }, `from ${item.dayDate}`)
            : null
        )
      );
    });

    container.appendChild(section);
  }

  // Legacy support: render data.items if present (old schema)
  if (data.items && data.items.length > 0 && !data.suggestions) {
    const itemsContainer = el('div');
    data.items.forEach((item) => {
      itemsContainer.appendChild(
        el('div', { className: 'feedback-item' },
          el('div', { className: 'feedback-item__type' }, item.type || 'Feedback'),
          el('p', { className: 'feedback-item__text' }, item.text || item.content || ''),
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

  // Summary bar — support nested object (data.summary.passed), flat (data.passed),
  // or derive from scenarios array
  const summary = (typeof data.summary === 'object' && data.summary) ? data.summary : {};
  const scenarios = Array.isArray(data.scenarios) ? data.scenarios : [];
  const scenarioPassed = scenarios.filter(s => s.status === 'pass' || s.status === 'passed').length;
  const scenarioTotal = scenarios.length;

  const passed = summary.passed ?? data.passed ?? scenarioPassed;
  const failed = summary.failed ?? data.failed ?? (scenarioTotal - scenarioPassed);
  const total = summary.totalScenarios ?? data.total ?? ((passed + failed) || scenarioTotal);
  const passRate = summary.passRate ?? data.passRate ?? null;

  const summaryBar = el('div', {
    className: 'd-flex items-center gap-4 mb-6 p-4 card',
  });

  summaryBar.appendChild(
    el('div', { className: 'd-flex items-center gap-2' },
      el('span', { className: 'badge badge--pass' }, `${passed} passed`),
      failed > 0
        ? el('span', { className: 'badge badge--fail' }, `${failed} failed`)
        : null,
      el('span', { className: 'text-sm text-muted' }, `${total} total`),
      passRate != null
        ? el('span', { className: 'text-xs text-muted ml-2' }, `(${passRate}% pass rate)`)
        : null
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
    { emoji: '\u{1F525}', label: 'Fire', key: 'fire' },
    { emoji: '\u{1F914}', label: 'Thinking', key: 'thinking' },
    { emoji: '\u2764\uFE0F', label: 'Heart', key: 'heart' },
    { emoji: '\u{1F680}', label: 'Rocket', key: 'rocket' },
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
        dayDate,
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

// ---------- Garden Stats Renderer ----------
function renderGardenStats(manifest) {
  if (!manifest || !manifest.days || manifest.days.length === 0) {
    return null;
  }

  const dayCount = manifest.days.length;
  const shippedCount = manifest.days.filter(d => d.status === 'shipped').length;
  const sorted = [...manifest.days].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const startDate = formatDate(sorted[0].date);

  return el('section', {
    className: 'garden-stats',
    'aria-labelledby': 'garden-stats-heading',
  },
    el('h2', { id: 'garden-stats-heading' }, 'Garden Stats'),
    el('dl', { className: 'garden-stats__list' },
      el('div', { className: 'garden-stats__item' },
        el('dt', {}, 'Pipeline Runs'),
        el('dd', {}, String(dayCount))
      ),
      el('div', { className: 'garden-stats__item' },
        el('dt', {}, 'Features Shipped'),
        el('dd', {}, String(shippedCount))
      ),
      el('div', { className: 'garden-stats__item' },
        el('dt', {}, 'Growing Since'),
        el('dd', {}, startDate)
      )
    )
  );
}

// ---------- Garden Visualization Renderer ----------
function renderGardenViz(manifest) {
  if (!manifest || !manifest.days || manifest.days.length === 0) {
    return null;
  }

  const shippedDays = manifest.days
    .filter(d => d.status === 'shipped')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (shippedDays.length === 0) {
    return null;
  }

  // Seeded height variation from date string — 4 tiers per spec
  function plantHeight(dateStr) {
    let sum = 0;
    for (let i = 0; i < dateStr.length; i++) {
      sum += dateStr.charCodeAt(i);
    }
    const tiers = [60, 80, 100, 120];
    return tiers[sum % 4];
  }

  const container = el('div', { className: 'garden-viz' });

  shippedDays.forEach((day, index) => {
    const isNewest = index === shippedDays.length - 1;
    const height = plantHeight(day.date);

    const label = (day.title || day.date) + ' — ' + formatDate(day.date);
    const plant = el('a', {
      className: 'garden-viz__plant' + (isNewest ? ' garden-viz__plant--newest' : ''),
      href: getDayUrl(day.date),
      title: day.title || day.date,
      'aria-label': label,
    },
      el('div', { className: 'garden-viz__crown' }),
      el('div', {
        className: 'garden-viz__stem',
        style: `--plant-height: ${height}px`,
      }),
      el('span', { className: 'garden-viz__label' }, formatDateShort(day.date))
    );

    container.appendChild(plant);
  });

  container.appendChild(el('div', { className: 'garden-viz__ground' }));

  const section = el('section', {
    id: 'garden-section',
    className: 'garden-viz-section',
    'aria-labelledby': 'garden-viz-heading',
  },
    el('div', { className: 'container' },
      el('div', { className: 'section__header' },
        el('span', { className: 'section__label' }, 'The Garden'),
        el('h2', { id: 'garden-viz-heading', className: 'section__title' }, 'Watch It Grow'),
        el('p', { className: 'section__subtitle' }, 'Each plant represents a shipped feature.')
      ),
      container
    )
  );

  return section;
}

// ---------- Exports ----------
export {
  renderMarkdown,
  renderDecision,
  renderCandidates,
  renderWinner,
  renderScoreTable,
  renderJudgePanel,
  renderReviewerBreakdown,
  renderFeedbackDigest,
  renderTestResults,
  renderTimeline,
  renderReactions,
  renderArtifactLinks,
  renderGardenStats,
  renderGardenViz,
};
