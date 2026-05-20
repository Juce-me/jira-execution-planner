.PHONY: install build test test-security run

install:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r requirements.txt
	.venv/bin/python -m pip install -e .
	npm ci

build:
	npm run build

test:
	.venv/bin/python -m unittest discover -s tests

test-security:
	.venv/bin/python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_network_bind_guards tests.test_security_headers tests.test_oauth_route_guards tests.test_backend_route_source_guards tests.test_route_move_preservation

run:
	.venv/bin/python jira_server.py
