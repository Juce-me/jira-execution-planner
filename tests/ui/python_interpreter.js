const fs = require('node:fs');
const path = require('node:path');

// Interpreter for specs that start a real Flask process. A git worktree has no .venv of its own,
// so JEP_TEST_PYTHON points those specs at an existing interpreter instead.
const python = process.env.JEP_TEST_PYTHON || path.join(__dirname, '..', '..', '.venv', 'bin', 'python');
const pythonMissingReason = fs.existsSync(python)
    ? ''
    : `Python interpreter not found at ${python}; create .venv or set JEP_TEST_PYTHON`;

module.exports = { python, pythonMissingReason };
