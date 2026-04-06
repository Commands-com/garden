'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Bluesky / AT Protocol publisher
//
// Posts daily feature announcements to Bluesky using the AT Protocol HTTP API.
// No external dependencies — uses Node 18+ built-in fetch.
// ---------------------------------------------------------------------------

const BSKY_API = 'https://bsky.social/xrpc';

/**
 * Create an authenticated session with Bluesky.
 * @param {string} handle - Bluesky handle (e.g. "command-garden.bsky.social")
 * @param {string} appPassword - App password
 * @returns {Promise<{did: string, accessJwt: string}>}
 */
async function createSession(handle, appPassword) {
  const res = await fetch(`${BSKY_API}/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bluesky auth failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { did: data.did, accessJwt: data.accessJwt };
}

/**
 * Upload an image blob to Bluesky.
 * @param {string} accessJwt
 * @param {Buffer} imageBuffer
 * @param {string} mimeType
 * @returns {Promise<Object>} blob reference
 */
async function uploadBlob(accessJwt, imageBuffer, mimeType) {
  const res = await fetch(`${BSKY_API}/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessJwt}`,
      'Content-Type': mimeType,
    },
    body: imageBuffer,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bluesky blob upload failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.blob;
}

/**
 * Detect facets (links, mentions) in post text for rich text rendering.
 * @param {string} text
 * @returns {Array} AT Protocol facet objects
 */
function detectFacets(text) {
  const facets = [];
  const encoder = new TextEncoder();

  // Detect URLs
  const urlRegex = /https?:\/\/[^\s)>\]]+/g;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    const beforeBytes = encoder.encode(text.slice(0, match.index)).length;
    const matchBytes = encoder.encode(match[0]).length;
    facets.push({
      index: { byteStart: beforeBytes, byteEnd: beforeBytes + matchBytes },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }],
    });
  }

  // Detect mentions (@handle.bsky.social)
  const mentionRegex = /@([a-zA-Z0-9.-]+\.[a-zA-Z]+)/g;
  while ((match = mentionRegex.exec(text)) !== null) {
    const beforeBytes = encoder.encode(text.slice(0, match.index)).length;
    const matchBytes = encoder.encode(match[0]).length;
    facets.push({
      index: { byteStart: beforeBytes, byteEnd: beforeBytes + matchBytes },
      features: [{ $type: 'app.bsky.richtext.facet#mention', did: match[1] }],
    });
  }

  // Detect hashtags
  const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
  while ((match = hashtagRegex.exec(text)) !== null) {
    const beforeBytes = encoder.encode(text.slice(0, match.index)).length;
    const matchBytes = encoder.encode(match[0]).length;
    facets.push({
      index: { byteStart: beforeBytes, byteEnd: beforeBytes + matchBytes },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: match[1] }],
    });
  }

  return facets;
}

/**
 * Create a Bluesky post with optional image embed.
 * @param {Object} session - { did, accessJwt }
 * @param {string} text - Post text (max 300 chars)
 * @param {Object} [embed] - Optional embed
 * @param {Object} [embed.image] - { blob, alt }
 * @param {Object} [embed.link] - { uri, title, description }
 * @returns {Promise<{uri: string, cid: string}>}
 */
async function createPost(session, text, embed) {
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    facets: detectFacets(text),
  };

  // Add image embed
  if (embed?.image) {
    record.embed = {
      $type: 'app.bsky.embed.images',
      images: [
        {
          image: embed.image.blob,
          alt: embed.image.alt || '',
          aspectRatio: embed.image.aspectRatio,
        },
      ],
    };
  }

  // Add link card embed (external)
  if (embed?.link) {
    record.embed = {
      $type: 'app.bsky.embed.external',
      external: {
        uri: embed.link.uri,
        title: embed.link.title || '',
        description: embed.link.description || '',
      },
    };
  }

  const res = await fetch(`${BSKY_API}/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bluesky post failed (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Compose and publish the daily Bluesky post for a Command Garden run.
 *
 * Reads the decision.json for the bluesky_post field (written by the Review stage).
 * Falls back to generating a post from the decision headline/summary if the
 * pipeline didn't produce a bluesky_post field.
 *
 * @param {Object} config - Runner config with bluesky credentials
 * @param {string} runDate - YYYY-MM-DD
 * @param {string} artifactDir - Path to the day's artifact directory
 * @param {string} [siteUrl] - Public site URL for linking
 * @returns {Promise<{posted: boolean, uri?: string, error?: string}>}
 */
async function publishToBluesky(config, runDate, artifactDir, siteUrl) {
  const { handle, appPassword } = config.bluesky;

  if (!handle || !appPassword) {
    return { posted: false, error: 'Bluesky credentials not configured' };
  }

  // Read decision.json for post content
  let decision;
  try {
    const raw = fs.readFileSync(path.join(artifactDir, 'decision.json'), 'utf8');
    decision = JSON.parse(raw);
  } catch (err) {
    return { posted: false, error: `Could not read decision.json: ${err.message}` };
  }

  // Build post text
  let postText;
  const dayUrl = siteUrl ? `${siteUrl}/days/?date=${runDate}` : null;

  if (decision.bluesky_post) {
    // Pipeline produced a crafted post
    const bp = decision.bluesky_post;
    postText = bp.headline
      ? `${bp.headline}\n\n${bp.body || ''}`
      : bp.body || bp.text || '';
  } else {
    // Fallback: compose from decision data
    const winner = decision.winner?.title || decision.headline || `Day ${runDate}`;
    const summary = decision.rationale
      ? decision.rationale.slice(0, 200)
      : '';
    postText = `🌱 Command Garden — Day ${runDate}\n\n${winner}\n\n${summary}`;
  }

  // Add link if we have a site URL
  if (dayUrl && !postText.includes(dayUrl)) {
    const remaining = 300 - postText.length - 2; // 2 for \n\n
    if (remaining >= dayUrl.length) {
      postText += `\n\n${dayUrl}`;
    }
  }

  // Truncate to Bluesky's 300-char limit (grapheme-aware would be better, but
  // for ASCII-heavy posts this is safe)
  if (postText.length > 300) {
    postText = postText.slice(0, 297) + '...';
  }

  // Authenticate
  let session;
  try {
    session = await createSession(handle, appPassword);
  } catch (err) {
    return { posted: false, error: `Bluesky auth failed: ${err.message}` };
  }

  // Check for a screenshot to attach
  let imageEmbed = null;
  const screenshotDir = path.join(artifactDir, 'screenshots');
  try {
    if (fs.existsSync(screenshotDir)) {
      const screenshots = fs.readdirSync(screenshotDir)
        .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
        .sort();

      if (screenshots.length > 0) {
        const imgPath = path.join(screenshotDir, screenshots[0]);
        const imgBuffer = fs.readFileSync(imgPath);
        const ext = path.extname(screenshots[0]).toLowerCase();
        const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
        const mimeType = mimeMap[ext] || 'image/png';

        const blob = await uploadBlob(session.accessJwt, imgBuffer, mimeType);
        const altText = decision.bluesky_post?.alt_text
          || `Screenshot of today's Command Garden feature: ${decision.winner?.title || 'daily update'}`;

        imageEmbed = { blob, alt: altText };
      }
    }
  } catch (err) {
    // Non-fatal — post without image
    console.log(`[${new Date().toISOString()}] Warning: could not attach screenshot: ${err.message}`);
  }

  // Build embed — prefer image if available, otherwise link card
  let embed = null;
  if (imageEmbed) {
    embed = { image: imageEmbed };
  } else if (dayUrl) {
    embed = {
      link: {
        uri: dayUrl,
        title: `Command Garden — ${runDate}`,
        description: decision.winner?.title || 'See what the garden grew today.',
      },
    };
  }

  // Post
  try {
    const result = await createPost(session, postText, embed);
    return { posted: true, uri: result.uri };
  } catch (err) {
    return { posted: false, error: `Bluesky post failed: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Audience growth — search, engage, and build presence
// ---------------------------------------------------------------------------

/**
 * Search Bluesky for posts matching a query.
 * @param {string} accessJwt
 * @param {string} query
 * @param {number} [limit=25]
 * @returns {Promise<Array>} Array of post objects
 */
async function searchPosts(accessJwt, query, limit = 25) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${BSKY_API}/app.bsky.feed.searchPosts?${params}`, {
    headers: { Authorization: `Bearer ${accessJwt}` },
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data.posts || [];
}

/**
 * Like a post.
 * @param {Object} session
 * @param {string} uri - AT URI of the post
 * @param {string} cid - CID of the post
 */
async function likePost(session, uri, cid) {
  await fetch(`${BSKY_API}/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.like',
      record: {
        $type: 'app.bsky.feed.like',
        subject: { uri, cid },
        createdAt: new Date().toISOString(),
      },
    }),
  });
}

/**
 * Repost a post.
 * @param {Object} session
 * @param {string} uri
 * @param {string} cid
 */
async function repost(session, uri, cid) {
  await fetch(`${BSKY_API}/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.repost',
      record: {
        $type: 'app.bsky.feed.repost',
        subject: { uri, cid },
        createdAt: new Date().toISOString(),
      },
    }),
  });
}

/**
 * Follow an account.
 * @param {Object} session
 * @param {string} did - DID of the account to follow
 */
async function followAccount(session, did) {
  await fetch(`${BSKY_API}/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.graph.follow',
      record: {
        $type: 'app.bsky.graph.follow',
        subject: did,
        createdAt: new Date().toISOString(),
      },
    }),
  });
}

/**
 * Reply to a post.
 * @param {Object} session
 * @param {string} text
 * @param {Object} parent - { uri, cid }
 * @param {Object} [root] - { uri, cid } — the thread root, defaults to parent
 * @returns {Promise<{uri: string, cid: string}>}
 */
async function replyToPost(session, text, parent, root) {
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    reply: {
      root: root || parent,
      parent,
    },
    facets: detectFacets(text),
  };

  const res = await fetch(`${BSKY_API}/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reply failed (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Get our account's current profile (follower count, etc.).
 * @param {string} accessJwt
 * @param {string} handle
 * @returns {Promise<Object>}
 */
async function getProfile(accessJwt, handle) {
  const params = new URLSearchParams({ actor: handle });
  const res = await fetch(`${BSKY_API}/app.bsky.actor.getProfile?${params}`, {
    headers: { Authorization: `Bearer ${accessJwt}` },
  });

  if (!res.ok) return null;
  return res.json();
}

/**
 * Get engagement metrics for our recent posts.
 * @param {string} accessJwt
 * @param {string} handle
 * @param {number} [limit=10]
 * @returns {Promise<Object>} Aggregated engagement metrics
 */
async function getRecentEngagement(accessJwt, handle, limit = 10) {
  const params = new URLSearchParams({ actor: handle, limit: String(limit) });
  const res = await fetch(`${BSKY_API}/app.bsky.feed.getAuthorFeed?${params}`, {
    headers: { Authorization: `Bearer ${accessJwt}` },
  });

  if (!res.ok) return null;
  const data = await res.json();
  const feed = data.feed || [];

  let totalLikes = 0;
  let totalReposts = 0;
  let totalReplies = 0;
  const posts = [];

  for (const item of feed) {
    const post = item.post;
    if (!post) continue;
    const likes = post.likeCount || 0;
    const reposts = post.repostCount || 0;
    const replies = post.replyCount || 0;

    totalLikes += likes;
    totalReposts += reposts;
    totalReplies += replies;

    posts.push({
      uri: post.uri,
      text: post.record?.text?.slice(0, 100) || '',
      likes,
      reposts,
      replies,
      createdAt: post.record?.createdAt || post.indexedAt,
    });
  }

  return {
    postCount: posts.length,
    totalLikes,
    totalReposts,
    totalReplies,
    avgLikes: posts.length ? (totalLikes / posts.length).toFixed(1) : 0,
    avgReposts: posts.length ? (totalReposts / posts.length).toFixed(1) : 0,
    avgReplies: posts.length ? (totalReplies / posts.length).toFixed(1) : 0,
    topPost: posts.sort((a, b) => (b.likes + b.reposts) - (a.likes + a.reposts))[0] || null,
    posts,
  };
}

/**
 * Get our notifications (mentions, replies, follows, likes).
 * @param {string} accessJwt
 * @param {number} [limit=25]
 * @returns {Promise<Array>}
 */
async function getNotifications(accessJwt, limit = 25) {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`${BSKY_API}/app.bsky.notification.listNotifications?${params}`, {
    headers: { Authorization: `Bearer ${accessJwt}` },
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data.notifications || [];
}

/**
 * Execute the daily Bluesky outreach strategy.
 *
 * This is the core audience-growth function. It:
 * 1. Searches for conversations about topics we're relevant to
 * 2. Engages authentically with people discussing AI, autonomous systems, etc.
 * 3. Follows interesting accounts in our space
 * 4. Replies to mentions and questions about Command Garden
 *
 * The strategy data from decision.json (bluesky_strategy field) guides what
 * topics to search for and how to engage.
 *
 * @param {Object} config
 * @param {string} runDate
 * @param {string} artifactDir
 * @returns {Promise<Object>} Outreach results
 */
async function executeOutreach(config, runDate, artifactDir) {
  const { handle, appPassword } = config.bluesky;
  if (!handle || !appPassword) {
    return { executed: false, error: 'Bluesky credentials not configured' };
  }

  let session;
  try {
    session = await createSession(handle, appPassword);
  } catch (err) {
    return { executed: false, error: `Auth failed: ${err.message}` };
  }

  // Read today's strategy from decision.json
  let strategy = null;
  try {
    const raw = fs.readFileSync(path.join(artifactDir, 'decision.json'), 'utf8');
    const decision = JSON.parse(raw);
    strategy = decision.bluesky_strategy || null;
  } catch {
    // No strategy — use defaults
  }

  const results = {
    executed: true,
    searchQueries: [],
    postsLiked: 0,
    postsRepliedTo: 0,
    accountsFollowed: 0,
    mentionsHandled: 0,
    errors: [],
  };

  // Default search queries if the pipeline didn't provide a strategy
  const searchQueries = strategy?.searchQueries || [
    'AI building websites',
    'autonomous software',
    'AI shipping code',
    'self-evolving',
    'AI agent daily',
    'AI side project',
  ];

  const maxActions = strategy?.maxDailyActions || 15;
  let actionCount = 0;

  // --- 1. Handle notifications (replies, mentions) ---
  try {
    const notifications = await getNotifications(session.accessJwt, 20);
    const mentions = notifications.filter(
      (n) => (n.reason === 'mention' || n.reason === 'reply') && !n.isRead
    );

    for (const mention of mentions) {
      if (actionCount >= maxActions) break;

      // Only reply to genuine questions or comments, not spam
      const text = mention.record?.text || '';
      if (text.length < 5) continue;

      // Generate a contextual reply based on what they said
      // The pipeline's bluesky_strategy can include pre-written replies for common topics
      const replyTemplates = strategy?.replyTemplates || {};
      let replyText = null;

      // Check if it's a question
      if (text.includes('?')) {
        if (/what is|what's/.test(text.toLowerCase())) {
          replyText = replyTemplates.whatIs ||
            "Command Garden is a website that autonomously ships one new feature every day. An AI pipeline explores ideas, picks the best one, builds it, tests it, and publishes it — with the full decision process visible on the site.";
        } else if (/how does|how do/.test(text.toLowerCase())) {
          replyText = replyTemplates.howDoesItWork ||
            "Each morning a 5-stage AI pipeline runs: explore candidates, write a spec, implement, test, and review. The winning feature gets shipped and the full decision trail is published. Today's entry shows exactly what was considered and why.";
        } else {
          replyText = replyTemplates.genericQuestion ||
            "Great question! Check out today's entry on the site — we publish the full decision log, candidate rankings, and build artifacts every day. Everything is inspectable.";
        }
      }

      if (replyText) {
        try {
          await replyToPost(session, replyText, {
            uri: mention.uri,
            cid: mention.cid,
          });
          results.mentionsHandled++;
          actionCount++;
        } catch (err) {
          results.errors.push(`Reply failed: ${err.message}`);
        }
      }
    }
  } catch (err) {
    results.errors.push(`Notification handling failed: ${err.message}`);
  }

  // --- 2. Search for relevant conversations and engage ---
  const seenDids = new Set();

  for (const query of searchQueries) {
    if (actionCount >= maxActions) break;

    try {
      const posts = await searchPosts(session.accessJwt, query, 10);
      results.searchQueries.push({ query, postsFound: posts.length });

      for (const post of posts) {
        if (actionCount >= maxActions) break;

        // Skip our own posts
        if (post.author?.handle === handle) continue;

        // Skip posts we've already engaged with (same author in this run)
        if (seenDids.has(post.author?.did)) continue;
        seenDids.add(post.author?.did);

        // Skip very old posts (older than 48 hours)
        const postAge = Date.now() - new Date(post.indexedAt).getTime();
        if (postAge > 48 * 60 * 60 * 1000) continue;

        // Skip very low-effort posts
        const postText = post.record?.text || '';
        if (postText.length < 20) continue;

        // Like posts that are relevant to our space
        try {
          await likePost(session, post.uri, post.cid);
          results.postsLiked++;
          actionCount++;
        } catch (err) {
          results.errors.push(`Like failed: ${err.message}`);
        }

        // Follow accounts that seem genuinely interested in our topics
        // (only if they have a reasonable follower count — not bots)
        const followerCount = post.author?.followersCount || 0;
        const followingCount = post.author?.followsCount || 0;
        if (
          followerCount >= 10 &&
          followerCount < 100000 &&
          followingCount > 0 &&
          followingCount < 5000
        ) {
          try {
            await followAccount(session, post.author.did);
            results.accountsFollowed++;
            actionCount++;
          } catch (err) {
            // May already be following — ignore
          }
        }
      }
    } catch (err) {
      results.errors.push(`Search "${query}" failed: ${err.message}`);
    }
  }

  return results;
}

/**
 * Collect Bluesky engagement metrics for feeding back into the pipeline.
 * This data becomes part of the next day's feedback digest.
 *
 * @param {Object} config
 * @returns {Promise<Object>} Bluesky metrics snapshot
 */
async function collectBlueskyMetrics(config) {
  const { handle, appPassword } = config.bluesky;
  if (!handle || !appPassword) return null;

  let session;
  try {
    session = await createSession(handle, appPassword);
  } catch {
    return null;
  }

  const profile = await getProfile(session.accessJwt, handle);
  const engagement = await getRecentEngagement(session.accessJwt, handle, 10);

  return {
    collectedAt: new Date().toISOString(),
    profile: profile ? {
      followers: profile.followersCount || 0,
      following: profile.followsCount || 0,
      posts: profile.postsCount || 0,
    } : null,
    recentEngagement: engagement,
  };
}

module.exports = {
  publishToBluesky,
  executeOutreach,
  collectBlueskyMetrics,
  createSession,
  createPost,
  uploadBlob,
  searchPosts,
  likePost,
  repost,
  followAccount,
  replyToPost,
  getProfile,
  getRecentEngagement,
  getNotifications,
};
