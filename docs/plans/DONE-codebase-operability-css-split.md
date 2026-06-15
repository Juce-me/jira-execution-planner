# Codebase Operability: CSS Source Split

> **Status:** Done. Executed in PR #54 (`879ad59`). Kept for audit context only.
> **Current accuracy:** This completed the first split from one monolithic source file into ordered top-level partials. It does not cover the follow-up nested feature-owned partial split tracked in `EXEC-css-feature-owned-partials.md`.

## Goal

Split the monolithic dashboard CSS source into ordered feature partials while keeping one bundled shipped stylesheet.

## Scope

- Keep `frontend/src/styles/dashboard.css` as the esbuild entrypoint.
- Move existing CSS blocks into ordered partials without rewriting selectors or changing cascade order.
- Regenerate `frontend/dist/dashboard.css` from source.
- Do not change JSX, UI behavior, class names, visual treatment, or sticky/menu semantics.

## Files

- `frontend/src/styles/dashboard.css`
- `frontend/src/styles/base.css`
- `frontend/src/styles/settings.css`
- `frontend/src/styles/eng.css`
- `frontend/src/styles/stats-summary.css`
- `frontend/src/styles/scenario.css`
- `frontend/src/styles/stats.css`
- `frontend/src/styles/planning.css`
- `frontend/src/styles/epm.css`
- `frontend/dist/dashboard.css`
- `tests/test_dashboard_css_extraction.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `node` source split check: concatenated ordered partials matched the original `frontend/src/styles/dashboard.css` byte-for-byte before bundling.
- `.venv/bin/python -m unittest tests.test_dashboard_css_extraction.TestDashboardCssFileContract.test_dashboard_css_source_is_ordered_import_entrypoint`: failed first while `dashboard.css` still held the monolithic source, then passed after the split.
- `.venv/bin/python -m unittest tests.test_dashboard_css_extraction`: passed 10 tests.
- `npm run build`: passed and regenerated `frontend/dist/dashboard.css`.
- `node --test tests/test_epm_settings_source_guards.js tests/test_epm_view_source_guards.js tests/test_excluded_capacity_stats_source_guards.js`: passed 76 tests after source guards were updated to read imported CSS partials.
- `npm run test:frontend:unit`: passed 250 tests.
- `make verify-dist-clean`: run after committing generated dist.

## Commit

`Split dashboard CSS source into partials`
