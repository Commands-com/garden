# Claude Code Instructions

Read `AGENTS.md` in this directory for the full project guide. It covers architecture, conventions, what you can/can't modify, and common patterns.

Key reminders:
- Use `el()` helper for DOM creation, never `innerHTML` with dynamic data
- Use CSS variables from `design-system.css`, never hardcode colors/spacing
- BEM naming for CSS components (`.block__element--modifier`)
- All changes must be backward compatible
- Run `npx playwright test` before considering work complete
- Never expose or commit `.env` contents
