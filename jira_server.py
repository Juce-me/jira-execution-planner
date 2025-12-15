#!/usr/bin/env python3

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
import requests
import base64
import os
import re
import json
from datetime import datetime, timedelta
from dotenv import load_dotenv
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
import io

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# CONFIGURATION - Load from environment variables
JIRA_URL = os.getenv('JIRA_URL')
JIRA_EMAIL = os.getenv('JIRA_EMAIL')
JIRA_TOKEN = os.getenv('JIRA_TOKEN')
JQL_QUERY = os.getenv('JQL_QUERY', 'project IN (PRODUCT, TECH) ORDER BY created DESC')
JIRA_BOARD_ID = os.getenv('JIRA_BOARD_ID')  # Optional: board ID for faster sprint fetching

# Cache settings
SPRINTS_CACHE_FILE = 'sprints_cache.json'
CACHE_EXPIRY_HOURS = 24

# Validate configuration
if not JIRA_URL or not JIRA_EMAIL or not JIRA_TOKEN:
    print('\n❌ ERROR: JIRA_URL, JIRA_EMAIL and JIRA_TOKEN must be set in .env file!')
    print('📝 Please copy .env.example to .env and fill in your credentials\n')
    exit(1)


# Cache helper functions
def load_sprints_cache():
    """Load sprints from cache file"""
    try:
        if os.path.exists(SPRINTS_CACHE_FILE):
            with open(SPRINTS_CACHE_FILE, 'r') as f:
                cache_data = json.load(f)
                return cache_data
        return None
    except Exception as e:
        print(f'⚠️ Failed to load cache: {e}')
        return None


def save_sprints_cache(sprints):
    """Save sprints to cache file"""
    try:
        cache_data = {
            'timestamp': datetime.now().isoformat(),
            'sprints': sprints
        }
        with open(SPRINTS_CACHE_FILE, 'w') as f:
            json.dump(cache_data, f, indent=2)
        print(f'💾 Cached {len(sprints)} sprints to {SPRINTS_CACHE_FILE}')
        return True
    except Exception as e:
        print(f'⚠️ Failed to save cache: {e}')
        return False


def is_cache_valid():
    """Check if cache exists and is not expired"""
    cache_data = load_sprints_cache()
    if not cache_data or 'timestamp' not in cache_data:
        return False

    try:
        cache_time = datetime.fromisoformat(cache_data['timestamp'])
        expiry_time = cache_time + timedelta(hours=CACHE_EXPIRY_HOURS)
        is_valid = datetime.now() < expiry_time

        if is_valid:
            hours_old = (datetime.now() - cache_time).total_seconds() / 3600
            print(f'✅ Cache is valid (age: {hours_old:.1f} hours)')
        else:
            print(f'⏰ Cache expired (age: {(datetime.now() - cache_time).total_seconds() / 3600:.1f} hours)')

        return is_valid
    except Exception as e:
        print(f'⚠️ Failed to validate cache: {e}')
        return False


def fetch_sprints_from_jira():
    """Fetch sprints from Jira (not from cache)"""
    auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
    auth_bytes = auth_string.encode('ascii')
    auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

    headers = {
        'Authorization': f'Basic {auth_base64}',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }

    formatted_sprints = []

    # Method 1: Try to get sprints from board (if JIRA_BOARD_ID is set)
    if JIRA_BOARD_ID:
        try:
            print(f'\n📅 Fetching sprints from board {JIRA_BOARD_ID}...')
            response = requests.get(
                f'{JIRA_URL}/rest/agile/1.0/board/{JIRA_BOARD_ID}/sprint',
                headers=headers,
                params={'maxResults': 100},
                timeout=30
            )

            if response.status_code == 200:
                data = response.json()
                sprints = data.get('values', [])

                for sprint in sprints:
                    name = sprint.get('name', '')
                    sprint_id = sprint.get('id')
                    state = sprint.get('state', '')

                    if re.match(r'^\d{4}Q[1-4]$', name):
                        formatted_sprints.append({
                            'id': sprint_id,
                            'name': name,
                            'state': state
                        })
                print(f'✅ Found {len(formatted_sprints)} sprints from board')
            else:
                print(f'⚠️ Board API returned {response.status_code}, trying alternative method...')
        except Exception as board_error:
            print(f'⚠️ Board API failed: {board_error}, trying alternative method...')

    # Method 2: If board method failed or found no sprints, get sprints from issues
    if len(formatted_sprints) == 0:
        print(f'\n📅 Fetching sprints from issues (alternative method)...')

        # Build JQL query without sprint filter to get all issues
        base_jql = JQL_QUERY
        # Remove any existing sprint filters from the query
        base_jql = re.sub(r'\s+AND\s+Sprint\s*=\s*\d+', '', base_jql, flags=re.IGNORECASE)

        payload = {
            'jql': base_jql,
            'maxResults': 200,  # Reduced from 1000 for better performance
            'fields': ['customfield_10101']  # Only get sprint field
        }

        response = requests.post(
            f'{JIRA_URL}/rest/api/3/search/jql',
            json=payload,
            headers=headers,
            timeout=30
        )

        if response.status_code == 200:
            data = response.json()
            issues = data.get('issues', [])

            # Extract unique sprints from issues
            sprints_dict = {}
            for issue in issues:
                sprint_field = issue.get('fields', {}).get('customfield_10101', [])
                if sprint_field and isinstance(sprint_field, list):
                    for sprint in sprint_field:
                        if sprint and isinstance(sprint, dict):
                            name = sprint.get('name', '')
                            sprint_id = sprint.get('id')
                            state = sprint.get('state', '')

                            # Check if sprint name matches quarter pattern
                            if re.match(r'^\d{4}Q[1-4]$', name) and sprint_id:
                                sprints_dict[sprint_id] = {
                                    'id': sprint_id,
                                    'name': name,
                                    'state': state
                                }

            formatted_sprints = list(sprints_dict.values())
            print(f'✅ Found {len(formatted_sprints)} unique sprints from {len(issues)} issues')
        else:
            raise Exception(f'Jira API error: {response.status_code}')

    # Sort sprints by name (will sort chronologically)
    formatted_sprints.sort(key=lambda x: x['name'])

    return formatted_sprints


@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    """Fetch tasks from Jira API"""
    try:
        # Get sprint parameter from query string
        sprint = request.args.get('sprint', '')

        # Prepare authorization
        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

        # Prepare headers
        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        # Build JQL query with sprint filter if provided
        jql = JQL_QUERY
        if sprint:
            # Add sprint filter to the JQL query using sprint ID
            if 'ORDER BY' in jql:
                # Insert sprint filter before ORDER BY
                parts = jql.split('ORDER BY')
                jql = f"{parts[0].strip()} AND Sprint = {sprint} ORDER BY {parts[1].strip()}"
            else:
                jql = f"{jql} AND Sprint = {sprint}"

        # Prepare request body for new API endpoint
        payload = {
            'jql': jql,
            'maxResults': 100,
            'fields': [
                'summary',
                'status',
                'priority',
                'issuetype',
                'assignee',
                'created',
                'updated',
                'customfield_10004',  # Story Points
                'customfield_10101'   # Sprint
            ]
        }
        
        print(f'\n🔍 Making request to Jira API...')
        print(f'URL: {JIRA_URL}/rest/api/3/search/jql')
        print(f'Sprint: {sprint if sprint else "All"}')
        print(f'JQL: {jql}')
        
        # Make request to NEW Jira API endpoint
        response = requests.post(
            f'{JIRA_URL}/rest/api/3/search/jql',
            json=payload,
            headers=headers,
            timeout=30
        )
        
        print(f'📊 Response Status: {response.status_code}')
        
        # Check if request was successful
        if response.status_code != 200:
            error_text = response.text
            print(f'❌ Error Response: {error_text}')
            
            try:
                error_json = response.json()
                print(f'Error Details: {error_json}')
            except:
                pass
            
            error_response = jsonify({
                'error': f'Jira API error: {response.status_code}',
                'details': error_text,
                'jql_used': JQL_QUERY
            })
            error_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            error_response.headers['Pragma'] = 'no-cache'
            error_response.headers['Expires'] = '0'
            return error_response, response.status_code
        
        # Return the data
        data = response.json()
        print(f'✅ Success! Found {len(data.get("issues", []))} issues')
        
        success_response = jsonify(data)
        success_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        success_response.headers['Pragma'] = 'no-cache'
        success_response.headers['Expires'] = '0'
        return success_response
        
    except Exception as e:
        print(f'❌ Exception: {str(e)}')
        import traceback
        traceback.print_exc()
        error_response = jsonify({
            'error': 'Failed to fetch tasks from Jira',
            'message': str(e)
        })
        error_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return error_response, 500


@app.route('/api/boards', methods=['GET'])
def get_boards():
    """Fetch available boards from Jira API"""
    try:
        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        print(f'\n📋 Fetching all boards...')

        # Get boards from Jira Agile API
        response = requests.get(
            f'{JIRA_URL}/rest/agile/1.0/board',
            headers=headers,
            params={'maxResults': 100},
            timeout=30
        )

        print(f'Boards Response Status: {response.status_code}')

        if response.status_code != 200:
            error_text = response.text
            print(f'❌ Error Response: {error_text}')
            return jsonify({
                'error': f'Jira API error: {response.status_code}',
                'details': error_text
            }), response.status_code

        data = response.json()
        boards = data.get('values', [])

        # Format boards
        formatted_boards = []
        for board in boards:
            formatted_boards.append({
                'id': board.get('id'),
                'name': board.get('name'),
                'type': board.get('type'),
                'location': board.get('location', {})
            })

        print(f'✅ Found {len(formatted_boards)} boards')

        success_response = jsonify({'boards': formatted_boards})
        success_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        success_response.headers['Pragma'] = 'no-cache'
        success_response.headers['Expires'] = '0'
        return success_response

    except Exception as e:
        print(f'❌ Exception: {str(e)}')
        import traceback
        traceback.print_exc()
        error_response = jsonify({
            'error': 'Failed to fetch boards from Jira',
            'message': str(e)
        })
        error_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return error_response, 500


@app.route('/api/sprints', methods=['GET'])
def get_sprints():
    """Fetch available sprints - uses cache if valid, otherwise fetches from Jira"""
    try:
        force_refresh = request.args.get('refresh', '').lower() == 'true'

        formatted_sprints = []

        # Check if we should use cache
        if not force_refresh and is_cache_valid():
            cache_data = load_sprints_cache()
            if cache_data and 'sprints' in cache_data:
                formatted_sprints = cache_data['sprints']
                print(f'📦 Loaded {len(formatted_sprints)} sprints from cache')

        # If no valid cache or force refresh, fetch from Jira
        if not formatted_sprints or force_refresh:
            if force_refresh:
                print('🔄 Force refresh requested')

            formatted_sprints = fetch_sprints_from_jira()

            # Save to cache
            if formatted_sprints:
                save_sprints_cache(formatted_sprints)

        print(f'✅ Total quarterly sprints: {len(formatted_sprints)}')

        success_response = jsonify({'sprints': formatted_sprints})
        success_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        success_response.headers['Pragma'] = 'no-cache'
        success_response.headers['Expires'] = '0'
        return success_response

    except Exception as e:
        print(f'❌ Exception: {str(e)}')
        import traceback
        traceback.print_exc()
        error_response = jsonify({
            'error': 'Failed to fetch sprints from Jira',
            'message': str(e)
        })
        error_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return error_response, 500


@app.route('/api/config', methods=['GET'])
def get_config():
    """Get public configuration"""
    return jsonify({
        'jiraUrl': JIRA_URL
    })


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'OK',
        'message': 'Jira proxy server is running'
    })


@app.route('/api/test', methods=['GET'])
def test_connection():
    """Test Jira connection with simple query"""
    try:
        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        # Simple test query - just get any 5 issues from PRODUCT project
        test_payload = {
            'jql': 'project = PRODUCT ORDER BY created DESC',
            'maxResults': 5,
            'fields': ['summary', 'status', 'priority']
        }

        print(f'\n🧪 Testing Jira connection...')
        print(f'Test JQL: {test_payload["jql"]}')

        response = requests.post(
            f'{JIRA_URL}/rest/api/3/search/jql',
            json=test_payload,
            headers=headers,
            timeout=30
        )

        print(f'Test Response Status: {response.status_code}')

        if response.status_code != 200:
            return jsonify({
                'status': 'error',
                'code': response.status_code,
                'message': response.text
            }), response.status_code

        data = response.json()
        return jsonify({
            'status': 'success',
            'message': f'Connection OK! Found {len(data.get("issues", []))} test issues',
            'sample_issue': data.get('issues', [{}])[0].get('key', 'N/A') if data.get('issues') else None
        })

    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/debug-fields', methods=['GET'])
def debug_fields():
    """Debug endpoint to see all fields of a single task"""
    try:
        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        # Get one issue with ALL fields
        payload = {
            'jql': JQL_QUERY,
            'maxResults': 1,
            'fields': ['*all']
        }

        print(f'\n🔍 Fetching all fields for debugging...')

        response = requests.post(
            f'{JIRA_URL}/rest/api/3/search/jql',
            json=payload,
            headers=headers,
            timeout=30
        )

        if response.status_code != 200:
            return jsonify({
                'error': f'Jira API error: {response.status_code}',
                'details': response.text
            }), response.status_code

        data = response.json()

        if data.get('issues') and len(data['issues']) > 0:
            issue = data['issues'][0]
            fields = issue.get('fields', {})

            # Look for Story Points in customfields
            customfields = {}
            for key, value in fields.items():
                if key.startswith('customfield_') and value is not None:
                    customfields[key] = value

            return jsonify({
                'issue_key': issue.get('key'),
                'all_customfields': customfields,
                'fields_keys': list(fields.keys())
            })
        else:
            return jsonify({
                'error': 'No issues found',
                'jql': JQL_QUERY
            }), 404

    except Exception as e:
        return jsonify({
            'error': str(e)
        }), 500


@app.route('/api/export-excel', methods=['POST'])
def export_excel():
    """Export selected tasks to Excel file"""
    try:
        data = request.get_json()
        tasks = data.get('tasks', [])

        if not tasks:
            return jsonify({'error': 'No tasks provided'}), 400

        print(f'\n📊 Exporting {len(tasks)} tasks to Excel...')

        # Create a new workbook
        wb = Workbook()
        ws = wb.active
        ws.title = 'Sprint Tasks'

        # Define header style
        header_fill = PatternFill(start_color='107C41', end_color='107C41', fill_type='solid')
        header_font = Font(bold=True, color='FFFFFF', size=12)
        header_alignment = Alignment(horizontal='center', vertical='center')

        # Add headers
        headers = ['ID', 'Subject', 'Story Points']
        for col_num, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_num)
            cell.value = header
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = header_alignment

        # Add data
        for row_num, task in enumerate(tasks, 2):
            ws.cell(row=row_num, column=1, value=task.get('key', ''))
            ws.cell(row=row_num, column=2, value=task.get('summary', ''))
            ws.cell(row=row_num, column=3, value=task.get('storyPoints', 0))

        # Auto-adjust column widths
        ws.column_dimensions['A'].width = 15
        ws.column_dimensions['B'].width = 60
        ws.column_dimensions['C'].width = 15

        # Align Story Points column to center
        for row in range(2, len(tasks) + 2):
            ws.cell(row=row, column=3).alignment = Alignment(horizontal='center')

        # Save to BytesIO
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)

        print(f'✅ Excel file generated successfully')

        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=f'sprint_tasks_{datetime.now().strftime("%Y-%m-%d")}.xlsx'
        )

    except Exception as e:
        print(f'❌ Export error: {str(e)}')
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': 'Failed to export to Excel',
            'message': str(e)
        }), 500


if __name__ == '__main__':
    print('\n🚀 Jira Proxy Server starting...')
    print(f'📧 Using email: {JIRA_EMAIL}')
    print(f'🔗 Jira URL: {JIRA_URL}')
    print(f'📊 Board ID: {JIRA_BOARD_ID}')
    print(f'📝 JQL Query: {JQL_QUERY[:80]}...' if len(JQL_QUERY) > 80 else f'📝 JQL Query: {JQL_QUERY}')
    print(f'💾 Cache expires after: {CACHE_EXPIRY_HOURS} hours')
    print('\n📋 Endpoints:')
    print('   • http://localhost:5000/api/tasks - Get sprint tasks')
    print('   • http://localhost:5000/api/sprints - Get available sprints (cached)')
    print('   • http://localhost:5000/api/sprints?refresh=true - Force refresh sprints cache')
    print('   • http://localhost:5000/api/boards - Get all boards (to find board ID)')
    print('   • http://localhost:5000/api/test - Test connection')
    print('   • http://localhost:5000/health - Health check')
    print('\n✅ Server ready! Open jira-dashboard.html in your browser\n')
    
    app.run(host='0.0.0.0', port=5000, debug=True)
