# Tests

This directory contains automated tests for the Jira Execution Planner.

## Test Organization

- `test_planning.py` - Unit tests for scheduling logic (dependencies, capacity, priority)
- `test_scheduler_active_sprint_anchor.py` - Regression test for the Active Sprint anchor behavior
- `test_date_parsing.py` - Unit tests for date parsing utilities
- `fixtures/` - Test data files (see `fixtures/README.md` for security policy)
- `ui/` - UI/integration tests (Playwright or similar)

## Running Tests

Run the local CI-style verification path:
```bash
make verify
```

Run all tests:
```bash
python3 -m unittest discover -s tests
```

Run endpoint security tests:
```bash
make test-security
```

Run frontend unit/source-guard tests:
```bash
npm run test:frontend:unit
```

Run Playwright UI tests:
```bash
npm run test:frontend:ui
```

Run specific test file:
```bash
python3 -m unittest tests.test_planning
python3 -m unittest tests.test_date_parsing
```

Run specific test case:
```bash
python3 -m unittest tests.test_planning.PlanningSchedulerTests.test_dependency_ordering
```

## Test Categories

### Unit Tests
Fast, isolated tests for individual functions/modules:
- `test_planning.py`
- `test_date_parsing.py`

### Integration Tests
Tests that use fixtures or test multiple components:
- `test_scheduler_active_sprint_anchor.py` (uses the sanitized fixture when local real data is absent)

### UI Tests
Browser-based tests (Playwright):
- `ui/*.spec.js` (requires Playwright setup and the local app target used by the spec)

### Source Guard Tests
Node tests that keep extracted frontend ownership boundaries from regressing:
- `test_*_source_guards.js`
- focused frontend utility tests such as `test_stats_utils.js`, `test_epm_project_utils.js`, and `test_scenario_lane_utils.js`

## Security Guidelines

**IMPORTANT**: Some tests use real Jira data and must be kept LOCAL ONLY.

Tests marked with "LOCAL ONLY" comments:
- Use fixtures containing real issue keys, team names, and project data
- Should never be committed to public repositories
- Are blocked by `.gitignore` in the fixtures directory

See `fixtures/README.md` for detailed security policy.

## Writing Tests

When adding new tests:

1. **Use unittest framework** (matches existing tests)
2. **Name test files** `test_*.py`
3. **Name test classes** `Test*` or `*Tests`
4. **Name test methods** `test_*`
5. **Add docstrings** explaining what the test verifies
6. **Keep tests focused** - one concept per test method

Example:
```python
import unittest
from planning.scheduler import schedule_issues

class TestMyFeature(unittest.TestCase):
    """Tests for my new feature."""

    def test_basic_behavior(self):
        """Verify basic functionality works as expected."""
        result = my_function(input_data)
        self.assertEqual(result, expected_value)
```

## Test Data Guidelines

- **Synthetic data** (fake issue keys, generic names): Can be committed
- **Real Jira data**: Must stay local, use fixtures with `.gitignore`
- **Sanitized data**: Create `-sanitized` versions for sharing
- See `fixtures/README.md` for details

## Questions?

See `AGENTS.md` for project structure and guidelines.
