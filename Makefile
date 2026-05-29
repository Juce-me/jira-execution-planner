PYTHON_TEST_ENV = JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile

.PHONY: install build test test-security test-frontend-unit test-frontend-ui verify verify-dist-clean preflight run

install:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r requirements.txt
	.venv/bin/python -m pip install -e .
	npm ci

build:
	npm run build

test:
	$(PYTHON_TEST_ENV) .venv/bin/python -m unittest discover -s tests

test-security:
	$(PYTHON_TEST_ENV) .venv/bin/python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_network_bind_guards tests.test_security_headers tests.test_oauth_route_guards tests.test_backend_route_source_guards tests.test_route_move_preservation

test-frontend-unit:
	npm run test:frontend:unit

test-frontend-ui:
	npm run test:frontend:ui

verify: build test test-security test-frontend-unit verify-dist-clean

verify-dist-clean:
	@if [ -n "$$(git status --porcelain -- frontend/dist)" ]; then \
		git status --short -- frontend/dist; \
		git diff -- frontend/dist; \
		echo "Compiled frontend output changed. Run 'npm run build' and commit frontend/dist."; \
		exit 1; \
	fi

preflight:
	.venv/bin/python scripts/check_startup_preflight.py

run:
	.venv/bin/python jira_server.py
