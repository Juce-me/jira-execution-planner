#!/usr/bin/env python3

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
import requests
import argparse
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
JIRA_TEAM_FIELD_ID = os.getenv('JIRA_TEAM_FIELD_ID', 'customfield_30101')  # Optional: custom field id for Team[Team]
JIRA_TEAM_FALLBACK_FIELD_ID = 'customfield_30101'
JIRA_PRODUCT_PROJECT = os.getenv('JIRA_PRODUCT_PROJECT', 'PRODUCT ROADMAPS')
JIRA_TECH_PROJECT = os.getenv('JIRA_TECH_PROJECT', 'TECHNICAL ROADMAP')
SERVER_PORT = int(os.getenv('SERVER_PORT', '5050'))

# Cache settings
SPRINTS_CACHE_FILE = 'sprints_cache.json'
CACHE_EXPIRY_HOURS = 24

def parse_args():
    """Parse CLI arguments to optionally override environment variables."""
    parser = argparse.ArgumentParser(description='Jira proxy server')
    parser.add_argument('--server_port', type=int, help='Port to run the server on (defaults to 5050 or SERVER_PORT env)')
    parser.add_argument('--jira_email', help='Jira account email (overrides JIRA_EMAIL env)')
    parser.add_argument('--jira_token', help='Jira API token (overrides JIRA_TOKEN env)')
    parser.add_argument('--jira_url', help='Base Jira URL, e.g. https://your-domain.atlassian.net (overrides JIRA_URL env)')
    parser.add_argument('--jira_query', help='JQL query to use for fetching issues (overrides JQL_QUERY env)')
    return parser.parse_args()


def add_clause_to_jql(jql: str, clause: str) -> str:
    """Append a clause to JQL before ORDER BY if present."""
    if not clause:
        return jql

    if 'ORDER BY' in jql:
        parts = jql.split('ORDER BY')
        return f"{parts[0].strip()} AND {clause} ORDER BY {parts[1].strip()}"
    return f"{jql} AND {clause}"


TEAM_FIELD_CACHE = None


def resolve_team_field_id(headers):
    """Resolve the Jira custom field ID for Team[Team]."""
    global TEAM_FIELD_CACHE
    if TEAM_FIELD_CACHE:
        return TEAM_FIELD_CACHE
    if JIRA_TEAM_FIELD_ID:
        TEAM_FIELD_CACHE = JIRA_TEAM_FIELD_ID
        return TEAM_FIELD_CACHE

    try:
        response = requests.get(f'{JIRA_URL}/rest/api/3/field', headers=headers, timeout=20)
        if response.status_code != 200:
            return None

        fields = response.json() or []
        for field in fields:
            name = str(field.get('name', '')).strip().lower()
            if name == 'team[team]':
                TEAM_FIELD_CACHE = field.get('id')
                return TEAM_FIELD_CACHE
    except Exception:
        return None

    return None


def extract_team_name(value):
    """Extract a readable team name from Jira Team field values."""
    if value is None:
        return None
    if isinstance(value, list):
        names = [extract_team_name(item) for item in value]
        names = [name for name in names if name]
        return ', '.join(names) if names else None
    if isinstance(value, dict):
        for key in ('name', 'title', 'value', 'displayName', 'teamName'):
            if value.get(key):
                return value.get(key)
        return value.get('id')
    return str(value)


def normalize_team_value(value):
    """Normalize Team field values to human-readable names."""
    if isinstance(value, list):
        return [normalize_team_value(item) for item in value if item]
    if isinstance(value, dict):
        return value.get('name') or value.get('value') or value.get('displayName') or value.get('teamName') or value.get('title') or value.get('id')
    return value


def build_team_value(raw_team):
    """Build a consistent team payload with id/name when possible."""
    if isinstance(raw_team, dict):
        return {
            'id': raw_team.get('id') or raw_team.get('teamId'),
            'name': raw_team.get('name') or raw_team.get('title') or raw_team.get('value') or raw_team.get('displayName')
        }
    return raw_team


def jira_search_request(headers, payload):
    """Call Jira search endpoint using query parameters for /search/jql."""
    url = f'{JIRA_URL}/rest/api/3/search/jql'
    params = {}

    def to_csv(value):
        if isinstance(value, list):
            return ','.join(value)
        return value

    for key in ('jql', 'startAt', 'maxResults', 'expand', 'fields', 'fieldsByKeys'):
        if key in payload and payload[key] is not None:
            params[key] = to_csv(payload[key])

    return requests.get(url, params=params, headers=headers, timeout=30)


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

        response = jira_search_request(headers, payload)

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


def fetch_tasks(include_team_name=False):
    """Fetch tasks from Jira API."""
    try:
        # Get sprint parameter from query string
        sprint = request.args.get('sprint', '')
        team = request.args.get('team', '').strip()
        project_filter = request.args.get('project', '').strip().lower()

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
            jql = add_clause_to_jql(jql, f"Sprint = {sprint}")

        if team and team.lower() != 'all':
            jql = add_clause_to_jql(jql, f'"Team[Team]" = {team}')

        if project_filter in ('product', 'tech'):
            project_name = JIRA_PRODUCT_PROJECT if project_filter == 'product' else JIRA_TECH_PROJECT
            jql = add_clause_to_jql(jql, f'project = "{project_name}"')

        team_field_id = resolve_team_field_id(headers)

        # Prepare request parameters for search endpoint
        fields_list = [
            'summary',
            'status',
            'priority',
            'issuetype',
            'assignee',
            'updated',
            'customfield_10004',  # Story Points
            'parent'
        ]
        if team_field_id:
            fields_list.append(team_field_id)
        if JIRA_TEAM_FALLBACK_FIELD_ID not in fields_list:
            fields_list.append(JIRA_TEAM_FALLBACK_FIELD_ID)
        if not team_field_id:
            print('⚠️ Team field id not resolved; using customfield_30101 fallback.')

        max_results = 250
        start_at = 0
        collected_issues = []
        names_map = {}
        total_issues = None

        print(f'\n🔍 Making request to Jira API...')
        print(f'URL: {JIRA_URL}/rest/api/3/search/jql')
        print(f'Sprint: {sprint if sprint else "All"}')
        print(f'JQL: {jql}')

        while len(collected_issues) < max_results:
            payload = {
                'jql': jql,
                'startAt': start_at,
                'maxResults': max_results,
                'fields': fields_list
            }

            response = jira_search_request(headers, payload)
            print(f'📊 Response Status: {response.status_code}')

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
                    'jql_used': jql
                })
                error_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                error_response.headers['Pragma'] = 'no-cache'
                error_response.headers['Expires'] = '0'
                return error_response, response.status_code

            data = response.json()
            if not names_map:
                names_map = data.get('names', {}) or {}
            total_issues = data.get('total', total_issues)

            issues = data.get('issues', [])
            if not issues:
                break

            collected_issues.extend(issues)
            if len(collected_issues) >= max_results:
                collected_issues = collected_issues[:max_results]
                break

            start_at += len(issues)
            if total_issues is not None and start_at >= total_issues:
                break

        data = {
            'issues': collected_issues,
            'names': names_map,
            'total': total_issues,
            'startAt': 0,
            'maxResults': max_results
        }

        if not team_field_id:
            team_field_id = next((k for k, v in names_map.items() if str(v).lower() == 'team[team]'), None)
        epic_link_field = next((k for k, v in names_map.items() if str(v).lower() == 'epic link'), None)
        epic_name_field = next((k for k, v in names_map.items() if str(v).lower() == 'epic name'), None)

        epic_keys = set()

        for issue in issues:
            fields = issue.get('fields', {})

            raw_team = None
            if fields.get(JIRA_TEAM_FALLBACK_FIELD_ID) is not None:
                raw_team = fields.get(JIRA_TEAM_FALLBACK_FIELD_ID)
            elif team_field_id and fields.get(team_field_id) is not None:
                raw_team = fields.get(team_field_id)

            if raw_team is not None:
                team_name = extract_team_name(raw_team)
                fields['team'] = build_team_value(raw_team)
                fields['teamName'] = team_name
                fields['teamId'] = fields['team'].get('id') if isinstance(fields['team'], dict) else None

            parent_fields = fields.get('parent', {}).get('fields', {})
            if parent_fields.get('summary'):
                fields['parentSummary'] = parent_fields.get('summary')

            epic_key = None
            if epic_link_field and fields.get(epic_link_field):
                epic_key = fields.get(epic_link_field)
            elif fields.get('parent') and fields['parent'].get('key') and \
                    fields['parent'].get('fields', {}).get('issuetype', {}).get('name', '').lower() == 'epic':
                epic_key = fields['parent'].get('key')

            if epic_key:
                fields['epicKey'] = epic_key
                epic_keys.add(epic_key)

        epic_details = {}
        if epic_keys:
            for epic_key in epic_keys:
                epic_fields = ['summary', 'reporter']
                if epic_name_field:
                    epic_fields.append(epic_name_field)
                else:
                    epic_fields.append('customfield_10011')

                try:
                    epic_resp = requests.get(
                        f'{JIRA_URL}/rest/api/3/issue/{epic_key}',
                        headers=headers,
                        params={'fields': ','.join(epic_fields)},
                        timeout=20
                    )

                    if epic_resp.status_code == 200:
                        epic_data = epic_resp.json()
                        epic_fields_data = epic_data.get('fields', {})
                        epic_details[epic_key] = {
                            'key': epic_key,
                            'summary': epic_fields_data.get('summary'),
                            'reporter': (epic_fields_data.get('reporter') or {}).get('displayName'),
                            'epicName': epic_fields_data.get(epic_name_field) if epic_name_field else epic_fields_data.get('customfield_10011')
                        }
                    else:
                        print(f'⚠️ Failed to fetch epic {epic_key}: {epic_resp.status_code}')
                except Exception as epic_error:
                    print(f'⚠️ Epic fetch error for {epic_key}: {epic_error}')

        slim_issues = []
        for issue in issues:
            fields = issue.get('fields', {})
            status = fields.get('status') or {}
            priority = fields.get('priority') or {}
            issuetype = fields.get('issuetype') or {}
            assignee = fields.get('assignee') or {}
            slim_issues.append({
                'id': issue.get('id'),
                'key': issue.get('key'),
                'fields': {
                    'summary': fields.get('summary'),
                    'status': {'name': status.get('name')} if status else None,
                    'priority': {'name': priority.get('name')} if priority else None,
                    'issuetype': {'name': issuetype.get('name')} if issuetype else None,
                    'assignee': {'displayName': assignee.get('displayName')} if assignee else None,
                    'updated': fields.get('updated'),
                    'customfield_10004': fields.get('customfield_10004'),
                    'team': fields.get('team'),
                    'teamName': fields.get('teamName'),
                    'teamId': fields.get('teamId'),
                    'epicKey': fields.get('epicKey'),
                    'parentSummary': fields.get('parentSummary')
                }
            })

        data['issues'] = slim_issues
        data['epics'] = epic_details
        data['teamFieldId'] = team_field_id

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


@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    """Fetch tasks from Jira API."""
    return fetch_tasks(include_team_name=False)


@app.route('/api/tasks-with-team-name', methods=['GET'])
def get_tasks_with_team_name():
    """Fetch tasks with team name derived from Jira Team field."""
    return fetch_tasks(include_team_name=True)


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

        response = jira_search_request(headers, test_payload)

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

        response = jira_search_request(headers, payload)

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


@app.route('/api/tasks-fields', methods=['GET'])
def get_tasks_fields():
    """Return all available fields and values for issues matching JQL_QUERY."""
    try:
        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        limit = request.args.get('limit', '5')
        try:
            limit_value = max(1, min(int(limit), 50))
        except ValueError:
            limit_value = 5

        payload = {
            'jql': JQL_QUERY,
            'maxResults': limit_value,
            'fields': ['*all']
        }

        print(f'\n🔍 Fetching all fields for {limit_value} issues...')

        response = jira_search_request(headers, payload)

        if response.status_code != 200:
            return jsonify({
                'error': f'Jira API error: {response.status_code}',
                'details': response.text
            }), response.status_code

        data = response.json()
        issues = data.get('issues', [])

        return jsonify({
            'total': data.get('total'),
            'returned': len(issues),
            'issues': issues
        })

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
    args = parse_args()

    # Apply CLI overrides while keeping env defaults as fallbacks
    if args.jira_url:
        JIRA_URL = args.jira_url
    if args.jira_email:
        JIRA_EMAIL = args.jira_email
    if args.jira_token:
        JIRA_TOKEN = args.jira_token
    if args.jira_query:
        JQL_QUERY = args.jira_query
    if args.server_port:
        SERVER_PORT = args.server_port

    # Validate configuration
    if not JIRA_URL or not JIRA_EMAIL or not JIRA_TOKEN:
        print('\n❌ ERROR: JIRA_URL, JIRA_EMAIL and JIRA_TOKEN must be set via environment or CLI!')
        print('📝 Please copy .env.example to .env, fill in your credentials, or pass them as flags.\n')
        exit(1)

    print('\n🚀 Jira Proxy Server starting...')
    print(f'📧 Using email: {JIRA_EMAIL}')
    print(f'🔗 Jira URL: {JIRA_URL}')
    print(f'📊 Board ID: {JIRA_BOARD_ID}')
    print(f'📝 JQL Query: {JQL_QUERY[:80]}...' if len(JQL_QUERY) > 80 else f'📝 JQL Query: {JQL_QUERY}')
    print(f'💾 Cache expires after: {CACHE_EXPIRY_HOURS} hours')
    print('\n📋 Endpoints:')
    print(f'   • http://localhost:{SERVER_PORT}/api/tasks - Get sprint tasks')
    print(f'   • http://localhost:{SERVER_PORT}/api/tasks-with-team-name - Get sprint tasks with team names')
    print(f'   • http://localhost:{SERVER_PORT}/api/sprints - Get available sprints (cached)')
    print(f'   • http://localhost:{SERVER_PORT}/api/sprints?refresh=true - Force refresh sprints cache')
    print(f'   • http://localhost:{SERVER_PORT}/api/boards - Get all boards (to find board ID)')
    print(f'   • http://localhost:{SERVER_PORT}/api/test - Test connection')
    print(f'   • http://localhost:{SERVER_PORT}/health - Health check')
    print('\n✅ Server ready! Open jira-dashboard.html in your browser\n')

    app.run(host='0.0.0.0', port=SERVER_PORT, debug=True)
