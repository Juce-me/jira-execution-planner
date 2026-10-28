#!/bin/bash
set -euo pipefail

echo "Installing Python dependencies for Jira Delivery Planner..."
echo ""

if [ ! -d .venv ]; then
    python3 -m venv .venv
fi

.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip install -e .

if [ -d frontend/src ] && [ ! -f frontend/dist/dashboard.js ]; then
    if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
        echo ""
        echo "Building the frontend (frontend/dist is not committed)..."
        npm ci && npm run build
    else
        echo ""
        echo "Node 20.x and npm are required to build the frontend from a source checkout."
        echo "Install them, then run: npm ci && npm run build"
        exit 1
    fi
fi

echo ""
echo "Installation complete."
echo ""
echo "Next steps:"
echo "1. Copy .env.example to .env:"
echo "   cp .env.example .env"
echo ""
echo "2. Configure .env, then follow INSTALL.md for DB/OAuth migrations when using DB mode."
echo ""
echo "3. Run the server:"
echo "   .venv/bin/python jira_server.py"
