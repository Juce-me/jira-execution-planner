# Test Fixtures

This directory contains test data used by unit and integration tests.

## Security Policy

**IMPORTANT: Keep test fixtures LOCAL ONLY**

Test fixtures may contain sensitive information from real Jira instances:
- Issue keys (e.g., PRODUCT-12345)
- Team names and assignees
- Project summaries and descriptions
- API response structures
- Scheduling data

### Rules

1. **Never commit fixture files with real Jira data** to the repository
2. All fixture files (`.json`, `.csv`, `.xml`) are blocked by `.gitignore`
3. Tests using real fixtures must be kept in local branches only
4. Only sanitized/synthetic fixtures can be committed (use `-template` or `-example-sanitized` suffix)

### For PRODUCT-33712 Test

To run the PRODUCT-33712 test case:

```bash
# Copy the fixture file (do this locally, never commit)
cp /mnt/data/scenario-example.json tests/fixtures/scenario-example.json

# Run the test
python3 -m unittest tests.test_scheduler_product_33712_active_sprint
```

The test will fail if the fixture is missing with a clear error message.

### Creating Sanitized Fixtures

If you need to commit test data for others to use:

1. Create a sanitized version with fake data:
   - Replace real issue keys with synthetic ones (e.g., `TEST-001`)
   - Use generic team names (`Team Alpha`, `Team Beta`)
   - Remove or anonymize assignee names
   - Clear any API tokens or sensitive fields

2. Save with a safe suffix:
   ```bash
   # This file CAN be committed
   tests/fixtures/scenario-example-sanitized.json
   ```

3. Update tests to use the sanitized version when the real fixture isn't available

## Available Fixtures

- `scenario-example.json` - Real Jira scenario data for PRODUCT-33712 (LOCAL ONLY, not committed)
- Add other fixture descriptions here as needed

## Questions?

See `AGENTS.md` section "Security & Configuration Tips" for more details.
