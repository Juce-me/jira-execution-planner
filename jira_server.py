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
from requests import Session

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Reuse a single HTTP session to avoid reconnect overhead on repeated calls
HTTP_SESSION = Session()

# CONFIGURATION - Load from environment variables
JIRA_URL = os.getenv('JIRA_URL')
JIRA_EMAIL = os.getenv('JIRA_EMAIL')
JIRA_TOKEN = os.getenv('JIRA_TOKEN')
JQL_QUERY = os.getenv('JQL_QUERY', 'project IN (PRODUCT, TECH) ORDER BY created DESC')
JIRA_BOARD_ID = os.getenv('JIRA_BOARD_ID')  # Optional: board ID for faster sprint fetching
JIRA_TEAM_FIELD_ID = os.getenv('JIRA_TEAM_FIELD_ID', 'customfield_30101')  # Optional: custom field id for Team[Team]
JIRA_TEAM_FALLBACK_FIELD_ID = 'customfield_30101'
JIRA_EPIC_LINK_FIELD_ID = os.getenv('JIRA_EPIC_LINK_FIELD_ID', '').strip()  # Optional: custom field id for Epic Link
JIRA_PRODUCT_PROJECT = os.getenv('JIRA_PRODUCT_PROJECT', 'PRODUCT ROADMAPS')
JIRA_TECH_PROJECT = os.getenv('JIRA_TECH_PROJECT', 'TECHNICAL ROADMAP')
SERVER_PORT = int(os.getenv('SERVER_PORT', '5050'))
EPIC_EMPTY_EXCLUDED_STATUSES = [s.strip() for s in os.getenv('EPIC_EMPTY_EXCLUDED_STATUSES', 'Killed,Done,Incomplete').split(',') if s.strip()]
EPIC_EMPTY_TEAM_IDS = [s.strip() for s in os.getenv('EPIC_EMPTY_TEAM_IDS', '').split(',') if s.strip()]
MISSING_INFO_COMPONENT = os.getenv('MISSING_INFO_COMPONENT', 'ATS - Bidswitch')
MISSING_INFO_TEAM_IDS = [s.strip() for s in os.getenv('MISSING_INFO_TEAM_IDS', '').split(',') if s.strip()]

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
EPIC_LINK_FIELD_CACHE = None


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


def resolve_epic_link_field_id(headers, names_map=None):
    """Resolve the Jira custom field ID for Epic Link."""
    global EPIC_LINK_FIELD_CACHE
    if EPIC_LINK_FIELD_CACHE:
        return EPIC_LINK_FIELD_CACHE
    if JIRA_EPIC_LINK_FIELD_ID:
        EPIC_LINK_FIELD_CACHE = JIRA_EPIC_LINK_FIELD_ID
        return EPIC_LINK_FIELD_CACHE

    if names_map:
        for field_id, field_name in (names_map or {}).items():
            if str(field_name).strip().lower() == 'epic link':
                EPIC_LINK_FIELD_CACHE = field_id
                return EPIC_LINK_FIELD_CACHE

    try:
        response = requests.get(f'{JIRA_URL}/rest/api/3/field', headers=headers, timeout=20)
        if response.status_code != 200:
            return None

        fields = response.json() or []
        for field in fields:
            name = str(field.get('name', '')).strip().lower()
            if name == 'epic link':
                EPIC_LINK_FIELD_CACHE = field.get('id')
                return EPIC_LINK_FIELD_CACHE
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

    return HTTP_SESSION.get(url, params=params, headers=headers, timeout=30)


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


def fetch_epic_details_bulk(epic_keys, headers, epic_name_field):
    """Fetch epic details in small batches to avoid per-epic network calls."""
    epic_details = {}
    if not epic_keys:
        return epic_details

    epic_field = epic_name_field or 'customfield_10011'
    keys_list = list(epic_keys)
    batch_size = 40  # keep JQL length reasonable for GET

    for start in range(0, len(keys_list), batch_size):
        batch_keys = keys_list[start:start + batch_size]
        jql = f'issueKey in ({",".join(batch_keys)})'
        payload = {
            'jql': jql,
            'maxResults': len(batch_keys),
            'fields': ['summary', 'reporter', 'assignee', epic_field]
        }

        try:
            resp = jira_search_request(headers, payload)
            if resp.status_code != 200:
                print(f'⚠️ Epic batch {start}-{start + len(batch_keys)} failed: {resp.status_code}')
                continue

            data = resp.json()
            for issue in data.get('issues', []):
                fields = issue.get('fields', {}) or {}
                key = issue.get('key')
                epic_details[key] = {
                    'key': key,
                    'summary': fields.get('summary'),
                    'reporter': (fields.get('reporter') or {}).get('displayName'),
                    'assignee': {'displayName': (fields.get('assignee') or {}).get('displayName')} if fields.get('assignee') else None,
                }
        except Exception as exc:
            print(f'⚠️ Epic batch fetch error: {exc}')

    return epic_details


def derive_epic_jql(base_jql: str, team_ids=None) -> str:
    """Attempt to derive an epic query from a story query by swapping Story→Epic."""
    if not base_jql:
        base_jql = ''

    jql = base_jql
    replacements = [
        ('type = Story', 'type = Epic'),
        ('type=Story', 'type=Epic'),
        ('type = "Story"', 'type = "Epic"'),
        ("type = 'Story'", "type = 'Epic'"),
        ('issuetype = Story', 'issuetype = Epic'),
        ('issuetype=Story', 'issuetype=Epic'),
        ('issuetype = "Story"', 'issuetype = "Epic"'),
        ("issuetype = 'Story'", "issuetype = 'Epic'"),
    ]
    replaced = False
    for old, new in replacements:
        if old in jql:
            jql = jql.replace(old, new)
            replaced = True

    if not replaced:
        jql = add_clause_to_jql(jql, 'type = Epic') if jql else 'type = Epic'

    if EPIC_EMPTY_EXCLUDED_STATUSES:
        quoted = ', '.join(f'"{s}"' for s in EPIC_EMPTY_EXCLUDED_STATUSES)
        jql = add_clause_to_jql(jql, f'status not in ({quoted})')

    team_ids = [t.strip() for t in (team_ids or []) if t and str(t).strip()]
    if team_ids:
        if len(team_ids) == 1:
            jql = add_clause_to_jql(jql, f'"Team[Team]" = "{team_ids[0]}"')
        else:
            quoted_teams = ', '.join(f'"{t}"' for t in team_ids)
            jql = add_clause_to_jql(jql, f'"Team[Team]" in ({quoted_teams})')
    return jql


def fetch_epics_for_empty_alert(jql, headers, team_field_id, epic_name_field):
    """Fetch epics matching the current sprint/team filters so UI can flag epics with 0 stories."""
    epic_jql = derive_epic_jql(jql, EPIC_EMPTY_TEAM_IDS)
    epic_field = epic_name_field or 'customfield_10011'

    fields_list = ['summary', 'status', 'assignee', epic_field]
    if team_field_id and team_field_id not in fields_list:
        fields_list.append(team_field_id)
    if JIRA_TEAM_FALLBACK_FIELD_ID not in fields_list:
        fields_list.append(JIRA_TEAM_FALLBACK_FIELD_ID)

    payload = {
        'jql': epic_jql,
        'startAt': 0,
        'maxResults': 250,
        'fields': fields_list
    }
    resp = jira_search_request(headers, payload)
    if resp.status_code != 200:
        print(f'⚠️ Epic empty-state fetch failed: {resp.status_code}')
        return []

    data = resp.json() or {}
    issues = data.get('issues', []) or []
    epics = []
    for issue in issues:
        fields = issue.get('fields', {}) or {}

        raw_team = None
        if fields.get(JIRA_TEAM_FALLBACK_FIELD_ID) is not None:
            raw_team = fields.get(JIRA_TEAM_FALLBACK_FIELD_ID)
        elif team_field_id and fields.get(team_field_id) is not None:
            raw_team = fields.get(team_field_id)

        team_value = build_team_value(raw_team) if raw_team is not None else None
        team_name = extract_team_name(raw_team) if raw_team is not None else None

        assignee = fields.get('assignee') or {}
        status = fields.get('status') or {}
        epics.append({
            'key': issue.get('key'),
            'summary': fields.get('summary'),
            'status': {'name': status.get('name')} if status else None,
            'assignee': {'displayName': assignee.get('displayName')} if assignee else None,
            'team': team_value,
            'teamName': team_name,
            'teamId': team_value.get('id') if isinstance(team_value, dict) else None,
        })
    return epics


def fetch_story_counts_for_epics(epic_keys, headers, epic_link_field):
    """Return total Story counts for each epic key.

    Prefer counting via the Epic Link field (company-managed Jira). If that yields zero for an epic,
    fall back to counting via `parent` (team-managed projects / some Jira configs).
    """
    epic_keys = [k for k in (epic_keys or []) if k]
    if not epic_keys:
        return {}

    def count_by_query(batch_keys, jql, parse_epic_key, fields):
        start_at = 0
        max_results = 250
        local_counts = {k: 0 for k in batch_keys}

        while True:
            payload = {
                'jql': jql,
                'startAt': start_at,
                'maxResults': max_results,
                'fields': fields
            }
            resp = jira_search_request(headers, payload)
            if resp.status_code != 200:
                return local_counts

            data = resp.json() or {}
            issues = data.get('issues', []) or []
            if not issues:
                break

            for issue in issues:
                fields_obj = issue.get('fields', {}) or {}
                epic_key = parse_epic_key(fields_obj)
                if epic_key in local_counts:
                    local_counts[epic_key] += 1

            start_at += len(issues)
            total = data.get('total')
            if total is not None and start_at >= total:
                break
            if len(issues) < max_results:
                break

        return local_counts

    counts = {k: 0 for k in epic_keys}
    batch_size = 40

    for start in range(0, len(epic_keys), batch_size):
        batch = epic_keys[start:start + batch_size]

        # 1) Try Epic Link counting (company-managed)
        if epic_link_field:
            epic_link_jql = f'"Epic Link" in ({",".join(batch)}) AND issuetype = Story'
            link_counts = count_by_query(
                batch,
                epic_link_jql,
                lambda f: f.get(epic_link_field),
                [epic_link_field]
            )
            for k, v in link_counts.items():
                counts[k] += v

        # 2) Fall back to parent counting for epics that still have 0
        remaining = [k for k in batch if counts.get(k, 0) == 0]
        if remaining:
            parent_jql = f'parent in ({",".join(remaining)}) AND issuetype = Story'
            parent_counts = count_by_query(
                remaining,
                parent_jql,
                lambda f: (f.get('parent') or {}).get('key'),
                ['parent']
            )
            for k, v in parent_counts.items():
                counts[k] += v

    return counts


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
        epic_link_field_id = resolve_epic_link_field_id(headers)

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
        if epic_link_field_id and epic_link_field_id not in fields_list:
            fields_list.append(epic_link_field_id)
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
            # Stop when Jira signals we're at the end or when the last page is smaller than the request size
            if len(issues) < payload['maxResults']:
                break
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

        if total_issues is None:
            total_issues = len(collected_issues)

        if not team_field_id:
            team_field_id = next((k for k, v in names_map.items() if str(v).lower() == 'team[team]'), None)
        epic_link_field = epic_link_field_id or resolve_epic_link_field_id(headers, names_map)
        epic_name_field = next((k for k, v in names_map.items() if str(v).lower() == 'epic name'), None)

        epic_keys = set()

        for issue in collected_issues:
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

        epic_details = fetch_epic_details_bulk(epic_keys, headers, epic_name_field)
        epics_in_scope = fetch_epics_for_empty_alert(jql, headers, team_field_id, epic_name_field)
        epic_story_counts = fetch_story_counts_for_epics([e.get('key') for e in epics_in_scope], headers, epic_link_field) if epic_link_field else None
        for epic in epics_in_scope:
            key = epic.get('key')
            epic['totalStories'] = epic_story_counts.get(key) if (epic_story_counts and key) else None
        slim_issues = []
        for issue in collected_issues:
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
        data['epicsInScope'] = epics_in_scope
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


def build_missing_info_scope_clause(team_ids, component_name):
    clauses = []
    component_name = (component_name or '').strip()
    team_ids = [t.strip() for t in (team_ids or []) if t and str(t).strip()]

    if component_name:
        clauses.append(f'component = "{component_name}"')
    if team_ids:
        if len(team_ids) == 1:
            clauses.append(f'"Team[Team]" = "{team_ids[0]}"')
        else:
            quoted = ', '.join(f'"{t}"' for t in team_ids)
            clauses.append(f'"Team[Team]" in ({quoted})')

    if not clauses:
        return ''
    if len(clauses) == 1:
        return clauses[0]
    return f"({ ' OR '.join(clauses) })"


@app.route('/api/missing-info', methods=['GET'])
def get_missing_info():
    """Find stories under epics in a given sprint that are missing key planning fields (sprint/SP/team)."""
    try:
        sprint = request.args.get('sprint', '').strip()
        if not sprint:
            return jsonify({'error': 'Missing required query param: sprint'}), 400

        # Prepare authorization
        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        # Resolve fields
        team_field_id = resolve_team_field_id(headers)
        epic_link_field_id = resolve_epic_link_field_id(headers)

        scope_clause = build_missing_info_scope_clause(MISSING_INFO_TEAM_IDS, MISSING_INFO_COMPONENT)

        # 1) Fetch epics that are in the sprint (future sprint planning), scoped by component/team.
        epic_jql = f'Sprint = {sprint} AND issuetype = Epic'
        if scope_clause:
            epic_jql = add_clause_to_jql(epic_jql, scope_clause)
        epic_jql = add_clause_to_jql(epic_jql, 'status not in ("Killed","Done","Incomplete")')
        epic_jql = add_clause_to_jql(epic_jql, f'project in ("{JIRA_PRODUCT_PROJECT}","{JIRA_TECH_PROJECT}")')

        epic_fields = ['summary', 'status', 'assignee', 'parent']
        if team_field_id:
            epic_fields.append(team_field_id)
        if JIRA_TEAM_FALLBACK_FIELD_ID not in epic_fields:
            epic_fields.append(JIRA_TEAM_FALLBACK_FIELD_ID)

        epics_resp = jira_search_request(headers, {
            'jql': epic_jql,
            'startAt': 0,
            'maxResults': 250,
            'fields': epic_fields
        })
        if epics_resp.status_code != 200:
            return jsonify({'error': 'Failed to fetch epics for missing-info scan', 'details': epics_resp.text}), 502

        epics_data = epics_resp.json() or {}
        epic_issues = epics_data.get('issues', []) or []
        epic_keys = [e.get('key') for e in epic_issues if e.get('key')]
        if not epic_keys:
            return jsonify({'issues': [], 'epics': [], 'count': 0})

        # 2) Fetch stories under those epics, regardless of story sprint (to catch missing Sprint field).
        story_fields = [
            'summary',
            'status',
            'priority',
            'issuetype',
            'assignee',
            'updated',
            'customfield_10004',  # Story Points
            'customfield_10101',  # Sprint
            'parent'
        ]
        if epic_link_field_id and epic_link_field_id not in story_fields:
            story_fields.append(epic_link_field_id)
        if team_field_id and team_field_id not in story_fields:
            story_fields.append(team_field_id)
        if JIRA_TEAM_FALLBACK_FIELD_ID not in story_fields:
            story_fields.append(JIRA_TEAM_FALLBACK_FIELD_ID)

        missing = []
        batch_size = 40
        for start in range(0, len(epic_keys), batch_size):
            batch = epic_keys[start:start + batch_size]

            link_clause = f'"Epic Link" in ({",".join(batch)})'
            parent_clause = f'parent in ({",".join(batch)})'
            # Important: do NOT scope stories by component/team here because the whole point is to
            # find stories missing those fields. We only scope epics, then pull every story under them.
            story_jql = f'({link_clause} OR {parent_clause}) AND issuetype = Story AND status not in (Killed, Done, Postponed)'

            start_at = 0
            while True:
                resp = jira_search_request(headers, {
                    'jql': story_jql,
                    'startAt': start_at,
                    'maxResults': 250,
                    'fields': story_fields
                })
                if resp.status_code != 200:
                    break

                data = resp.json() or {}
                issues = data.get('issues', []) or []
                if not issues:
                    break

                for issue in issues:
                    fields = issue.get('fields', {}) or {}
                    status = (fields.get('status') or {}).get('name') or ''
                    if str(status).strip().lower() == 'postponed':
                        continue

                    # team enrichment
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

                    # epic link
                    epic_key = None
                    if epic_link_field_id and fields.get(epic_link_field_id):
                        epic_key = fields.get(epic_link_field_id)
                    elif fields.get('parent') and fields['parent'].get('key') and \
                            fields['parent'].get('fields', {}).get('issuetype', {}).get('name', '').lower() == 'epic':
                        epic_key = fields['parent'].get('key')
                    if epic_key:
                        fields['epicKey'] = epic_key

                    sp = fields.get('customfield_10004')
                    try:
                        sp_num = float(sp) if sp not in (None, '', []) else 0.0
                    except Exception:
                        sp_num = 0.0
                    has_sp = sp_num > 0

                    sprint_value = fields.get('customfield_10101')
                    has_sprint = bool(sprint_value)
                    has_team = bool(fields.get('teamName'))

                    missing_fields = []
                    if not has_sprint:
                        missing_fields.append('Sprint')
                    if not has_sp:
                        missing_fields.append('Story Points')
                    if not has_team:
                        missing_fields.append('Team')

                    if not missing_fields:
                        continue

                    assignee = fields.get('assignee') or {}
                    priority = fields.get('priority') or {}
                    issuetype = fields.get('issuetype') or {}
                    missing.append({
                        'id': issue.get('id'),
                        'key': issue.get('key'),
                        'fields': {
                            'summary': fields.get('summary'),
                            'status': {'name': status} if status else None,
                            'priority': {'name': priority.get('name')} if priority else None,
                            'issuetype': {'name': issuetype.get('name')} if issuetype else None,
                            'assignee': {'displayName': assignee.get('displayName')} if assignee else None,
                            'updated': fields.get('updated'),
                            'customfield_10004': fields.get('customfield_10004'),
                            'customfield_10101': fields.get('customfield_10101'),
                            'team': fields.get('team'),
                            'teamName': fields.get('teamName'),
                            'teamId': fields.get('teamId'),
                            'epicKey': fields.get('epicKey'),
                            'missingFields': missing_fields
                        }
                    })

                start_at += len(issues)
                total = data.get('total')
                if total is not None and start_at >= total:
                    break
                if len(issues) < 250:
                    break

        response = jsonify({'issues': missing, 'count': len(missing), 'epicCount': len(epic_keys)})
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    except Exception as e:
        print(f'❌ Missing-info error: {e}')
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to compute missing-info', 'message': str(e)}), 500


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
