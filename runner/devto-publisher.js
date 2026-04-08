'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Dev.to publisher
//
// Publishes daily build logs as Dev.to articles using their REST API.
// No external dependencies — uses Node 18+ built-in fetch.
// ---------------------------------------------------------------------------

const DEVTO_API = 'https://dev.to/api';

/**
 * Publish today's build log as a Dev.to article.
 *
 * Composes a markdown article from the day's artifacts (decision.json,
 * spec.md, build-summary.md, review.md) and publishes it.
 *
 * @param {Object} config - App config
 * @param {string} runDate - YYYY-MM-DD
 * @param {string} artifactDir - Path to the day's artifact directory
 * @param {string|null} siteUrl - Public site URL
 * @returns {Promise<{posted: boolean, url?: string, error?: string}>}
 */
async function publishToDevTo(config, runDate, artifactDir, siteUrl) {
  const apiKey = config.devto?.apiKey;

  if (!apiKey) {
    return { posted: false, error: 'Dev.to API key not configured' };
  }

  // Read decision.json
  let decision;
  try {
    const raw = fs.readFileSync(path.join(artifactDir, 'decision.json'), 'utf8');
    decision = JSON.parse(raw);
  } catch (err) {
    return { posted: false, error: `Could not read decision.json: ${err.message}` };
  }

  // Compute day number from manifest
  let dayNumber = null;
  try {
    const manifestPath = path.join(artifactDir, '..', '..', 'site', 'days', 'manifest.json');
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    if (manifest.days) {
      const sorted = [...manifest.days].sort((a, b) => a.date.localeCompare(b.date));
      const idx = sorted.findIndex((d) => d.date === runDate);
      dayNumber = idx >= 0 ? idx + 1 : sorted.length + 1;
    }
  } catch {
    // Can't determine day number
  }

  const dayLabel = dayNumber ? `Day ${dayNumber}` : runDate;
  const headline = decision.headline || decision.winner?.title || 'Daily improvement';
  const summary = decision.summary || decision.rationale || '';
  const dayUrl = siteUrl ? `${siteUrl}/days/?date=${runDate}` : null;

  // Build article body from artifacts
  const sections = [];

  sections.push(`Command Garden is a website that builds itself — one feature per day, fully autonomously. No human writes the code. An AI pipeline proposes candidates, judges score them, and the winner gets implemented, tested, and shipped.`);
  sections.push('');

  if (dayUrl) {
    sections.push(`**[View the full decision log](${dayUrl})**`);
    sections.push('');
  }

  // What was built
  sections.push(`## What shipped`);
  sections.push('');
  sections.push(summary || headline);
  sections.push('');

  // Candidates considered
  if (decision.candidates && decision.candidates.length > 0) {
    sections.push(`## Candidates considered`);
    sections.push('');
    for (const c of decision.candidates) {
      const score = typeof c.averageScore === 'number' ? ` (score: ${c.averageScore.toFixed(1)})` : '';
      sections.push(`- **${c.title}**${score}${c.summary ? ` — ${c.summary}` : ''}`);
    }
    sections.push('');
  }

  // Winner
  if (decision.winner) {
    sections.push(`## Winner`);
    sections.push('');
    sections.push(`**${decision.winner.title}**${decision.winner.averageScore ? ` with a score of ${decision.winner.averageScore.toFixed(1)}` : ''}`);
    sections.push('');
    if (decision.rationale) {
      sections.push(decision.rationale);
      sections.push('');
    }
  }

  // Spec (truncated)
  const specPath = path.join(artifactDir, 'spec.md');
  if (fs.existsSync(specPath)) {
    try {
      let spec = fs.readFileSync(specPath, 'utf8').trim();
      if (spec.length > 2000) {
        spec = spec.slice(0, 2000) + '\n\n*[Spec truncated — view full spec on the site]*';
      }
      sections.push(`## Technical spec`);
      sections.push('');
      sections.push(spec);
      sections.push('');
    } catch {
      // Skip
    }
  }

  // Build summary
  const buildPath = path.join(artifactDir, 'build-summary.md');
  if (fs.existsSync(buildPath)) {
    try {
      const build = fs.readFileSync(buildPath, 'utf8').trim();
      sections.push(`## What changed`);
      sections.push('');
      sections.push(build);
      sections.push('');
    } catch {
      // Skip
    }
  }

  // Footer
  sections.push('---');
  sections.push('');
  sections.push(`Command Garden ships one feature every day with zero human code. Follow along at [commandgarden.com](https://commandgarden.com).`);

  const body = sections.join('\n');
  const title = `Fully Automated Website ${dayLabel}: ${headline}`;

  // Pick tags (Dev.to allows max 4)
  const tags = ['ai', 'webdev', 'automation', 'agents'];

  // Publish
  try {
    const res = await fetch(`${DEVTO_API}/articles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        article: {
          title,
          body_markdown: body,
          published: true,
          tags,
          series: 'Command Garden Daily Log',
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { posted: false, error: `Dev.to API error (${res.status}): ${errBody}` };
    }

    const data = await res.json();
    return { posted: true, url: data.url, id: data.id };
  } catch (err) {
    return { posted: false, error: `Dev.to publish failed: ${err.message}` };
  }
}

module.exports = { publishToDevTo };
