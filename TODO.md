# Monday TODO

- If you want, I can:
  1. Add a tiny build step (precompile JSX to plain JS) and remove babel.min.js.
  2. Keep the HTML-only workflow but precompile via a script (e.g., npm run build or a one-off babel command) and include the compiled JS.
- Create a configuration of the env in the UI
- Scenario planner follow-ups (optional): scenario comparison/export.
- Scenario planner: add a small legend for blocked/excluded/quarter markers.
- Config: decide on frontend bundling path
  - Full rewrite to vanilla JS (no React, no Babel, no CDN).
  - Keep React but bundle locally (no internet access, no source-map warning).
- Pack to Docker.
- CI/CD + multi-user deployment ideation:
  - Shared instance for many users (secrets, API key strategy, config storage/sharing).

Whistles
- dark mode/company colors?
