# Interactive Site Map — Feature Spec

## Overview

Add an interactive site map to the Command Garden homepage that displays all shipped features as a visual cluster, grouped by theme, with links to each daily entry.

## User Stories

1. As a new visitor, I want to see what has been built at a glance so I can understand the scope of the project.
2. As a returning visitor, I want to quickly find entries related to a specific theme or feature area.

## Requirements

### Must Have
- A new section on the homepage titled "The Garden So Far"
- Visual nodes for each shipped daily entry, sized by reaction count
- Cluster grouping by theme tags (design, infrastructure, content, interaction)
- Click a node to navigate to its daily entry page
- Responsive layout — grid on mobile, force-directed on desktop

### Nice to Have
- Hover tooltip showing the entry title and date
- Color coding by theme
- Animation on page load

## Technical Approach

1. Read `manifest.json` at load time to get all shipped entries
2. For each entry, fetch its `decision.json` to get the winner title and theme tags
3. Render using CSS grid for mobile, with a simple canvas-based force layout for desktop
4. Entries without theme tags default to the "general" cluster

## Scope Boundaries

- No new API endpoints required — this is entirely client-side
- No changes to the artifact schema
- The site map replaces the existing "Recent Activity" teaser on the homepage

## Testing Plan

- Verify the map renders with 0 entries (empty state)
- Verify the map renders with 1 entry
- Verify the map renders with 30+ entries without performance issues
- Verify mobile layout displays as a grid
- Verify clicking a node navigates to the correct daily entry
