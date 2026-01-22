#!/bin/bash

echo "🔧 Installing Python dependencies for Jira Dashboard..."
echo ""

# Try to install pip if not available
if ! command -v pip3 &> /dev/null
then
    echo "pip3 not found, trying python3 -m pip..."
    python3 -m pip install --user flask flask-cors requests python-dotenv openpyxl "urllib3<2"
else
    pip3 install --user flask flask-cors requests python-dotenv openpyxl "urllib3<2"
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Copy .env.example to .env:"
echo "   cp .env.example .env"
echo ""
echo "2. Edit .env and add your credentials"
echo ""
echo "3. Run the server:"
echo "   python3 jira_server.py"
