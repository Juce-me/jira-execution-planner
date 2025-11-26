#!/usr/bin/env python3

from flask import Flask, jsonify
from flask_cors import CORS
import requests
import base64
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# CONFIGURATION - Load from environment variables
JIRA_URL = os.getenv('JIRA_URL', 'https://criteo.atlassian.net')
JIRA_EMAIL = os.getenv('JIRA_EMAIL')
JIRA_TOKEN = os.getenv('JIRA_TOKEN')
JQL_QUERY = os.getenv('JQL_QUERY', 'project IN (PRODUCT, TECH) ORDER BY created DESC')

# Validate configuration
if not JIRA_EMAIL or not JIRA_TOKEN:
    print('\n❌ ERROR: JIRA_EMAIL and JIRA_TOKEN must be set in .env file!')
    print('📝 Please copy .env.example to .env and fill in your credentials\n')
    exit(1)


@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    """Fetch tasks from Jira API"""
    try:
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
        
        # Prepare request body for new API endpoint
        payload = {
            'jql': JQL_QUERY,
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
        print(f'JQL: {JQL_QUERY}')
        
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


if __name__ == '__main__':
    print('\n🚀 Jira Proxy Server starting...')
    print(f'📧 Using email: {JIRA_EMAIL}')
    print(f'🔗 Jira URL: {JIRA_URL}')
    print(f'📝 JQL Query: {JQL_QUERY[:80]}...' if len(JQL_QUERY) > 80 else f'📝 JQL Query: {JQL_QUERY}')
    print('\n📋 Endpoints:')
    print('   • http://localhost:5000/api/tasks - Get sprint tasks')
    print('   • http://localhost:5000/api/test - Test connection')
    print('   • http://localhost:5000/health - Health check')
    print('\n✅ Server ready! Open jira-dashboard.html in your browser\n')
    
    app.run(host='0.0.0.0', port=5000, debug=True)
