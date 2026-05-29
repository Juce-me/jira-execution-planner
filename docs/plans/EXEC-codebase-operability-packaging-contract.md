# Codebase Operability Packaging Contract Slice

> **Status:** Implemented locally and verified on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Make the packaging story explicit: the release zip is the runnable package; editable installs are for a source checkout or extracted release directory with sibling runtime assets present.

## Scope

- Document the release-zip-only runnable package contract in README/INSTALL.
- Add packaging tests that assert the release workflow keeps runtime assets and strips development-only frontend source.
- Keep `pip install -e .` as the local/release-directory install path.

## Out Of Scope

- No wheel/sdist asset packaging.
- No static asset path refactor.
- No release workflow behavior change unless the packaging tests reveal a mismatch.

## Verification

- `.venv/bin/python -m unittest tests.test_project_packaging tests.test_env_config_docs`: passed 10 tests.
