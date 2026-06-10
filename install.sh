#!/bin/bash
set -euo pipefail

echo "Installing Python dependencies for Jira Delivery Planner..."
echo ""

if [ ! -d .venv ]; then
    python3 -m venv .venv
fi

.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip install -e .

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
