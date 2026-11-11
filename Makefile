PYTHON_TEST_RUNNER = .venv/bin/python tests/run_isolated_runtime_tests.py --node "$(shell command -v node)"

.PHONY: install build test test-security test-frontend-unit test-frontend-ui verify preflight run

install:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r requirements.txt
	.venv/bin/python -m pip install -e .
	npm ci && npm run build

build:
	npm run build

test:
	$(PYTHON_TEST_RUNNER)

test-security:
	$(PYTHON_TEST_RUNNER) tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_network_bind_guards tests.test_security_headers tests.test_oauth_route_guards tests.test_backend_route_source_guards tests.test_route_move_preservation

test-frontend-unit:
	npm run test:frontend:unit

test-frontend-ui:
	npm run test:frontend:ui

verify:
	.venv/bin/python scripts/verify_tests.py $(ARGS)

preflight:
	.venv/bin/python scripts/check_startup_preflight.py

run:
	.venv/bin/python jira_server.py

.PHONY: sync
sync:
	scripts/sync_main.sh $(ARGS)
