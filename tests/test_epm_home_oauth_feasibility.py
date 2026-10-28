import json
import unittest

from backend.epm import home as epm_home


class HomeGraphQLOAuthFeasibilityTests(unittest.TestCase):
    def test_probe_uses_exact_home_query_constants(self):
        queries = epm_home.home_graphql_feasibility_queries()

        self.assertIs(queries["goals_search"], epm_home.QUERY_GOALS_SEARCH)
        self.assertIs(queries["goal_by_key"], epm_home.QUERY_GOAL_BY_KEY)
        self.assertIs(queries["sub_goals"], epm_home.QUERY_SUB_GOALS)
        self.assertIs(queries["goal_projects"], epm_home.QUERY_GOAL_PROJECTS)
        self.assertIs(queries["project_details"], epm_home.QUERY_PROJECT_DETAILS)
        self.assertIs(queries["project_updates"], epm_home.QUERY_PROJECT_UPDATES)
        self.assertIs(queries["project_tags"], epm_home.QUERY_PROJECT_TAGS)
        self.assertIs(queries["teamwork_graph_project_tags"], epm_home.QUERY_TEAMWORK_GRAPH_PROJECT_TAGS)

    def test_probe_output_redacts_token_material(self):
        payload = {
            "access_token": "access-123",
            "refresh_token": "refresh-123",
            "authorization": "Bearer access-123",
            "results": [{"operation": "goals_search", "ok": True}],
        }

        redacted = epm_home.redact_home_oauth_probe_payload(payload)
        rendered = json.dumps(redacted)

        self.assertNotIn("access-123", rendered)
        self.assertNotIn("refresh-123", rendered)
        self.assertNotIn("Bearer", rendered)
        self.assertEqual(redacted["results"][0]["operation"], "goals_search")

    def test_probe_result_classifies_auth_failures_as_unsupported(self):
        result = epm_home.classify_home_graphql_probe_results([
            {"operation": "goals_search", "status": 401, "ok": False},
            {"operation": "teamwork_graph_project_tags", "status": 403, "ok": False},
        ])

        self.assertEqual(result["decision"], "fail")
        self.assertEqual(result["reason"], "home_graphql_3lo_unsupported")

    def test_probe_result_classifies_scope_error_messages_as_unsupported(self):
        result = epm_home.classify_home_graphql_probe_results([
            {
                "operation": "goals_search",
                "status": 200,
                "ok": False,
                "errors": ["This request does not contain the right authorisation scopes to access this field"],
            },
        ])

        self.assertEqual(result["decision"], "fail")
        self.assertEqual(result["reason"], "home_graphql_3lo_unsupported")

    def test_probe_result_passes_only_when_home_and_twg_operations_succeed(self):
        operations = [
            "goals_search",
            "goal_by_key",
            "sub_goals",
            "goal_projects",
            "project_details",
            "project_updates",
            "project_tags",
            "teamwork_graph_project_tags",
        ]
        result = epm_home.classify_home_graphql_probe_results([
            {"operation": operation, "status": 200, "ok": True} for operation in operations
        ])

        self.assertEqual(result["decision"], "pass")


# ---------------------------------------------------------------------------
# public-read-v1 (Task 1): registry, strict client, typed errors, tags, probe
# ---------------------------------------------------------------------------
import hashlib
import inspect
import io
import os
import tempfile
from email.message import Message
from unittest.mock import patch
from urllib.error import HTTPError

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_KEYS = (
    "goals_search", "goals_byKey", "subGoals", "goalProjects",
    "projectDetails", "projectUpdates", "projectTags",
)
FAKE_TOKEN = "fake-access-token-not-real"


class _Resp:
    def __init__(self, payload, status=200):
        self._body = json.dumps(payload).encode("utf-8")
        self.status = status

    def read(self):
        return self._body

    def getcode(self):
        return self.status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _http_error(code, retry_after=None, body=b"{}"):
    headers = Message()
    if retry_after is not None:
        headers["Retry-After"] = retry_after
    return HTTPError("https://api.atlassian.com/graphql", code, "err", headers, io.BytesIO(body))


class _FakeHttp:
    """Scripted urlopen: each item is a payload dict, (payload, status) or an Exception."""

    def __init__(self, *items):
        self.items = list(items)
        self.requests = []

    def __call__(self, request, timeout=None):
        body = json.loads(request.data.decode("utf-8"))
        self.requests.append({
            "url": request.full_url,
            "headers": dict(request.header_items()),
            "body": body,
        })
        item = self.items.pop(0) if len(self.items) > 1 else self.items[0]
        if callable(item):
            item = item(body)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, tuple):
            return _Resp(*item)
        return _Resp(item)


def _tags(*names):
    return {"edges": [{"node": {"id": f"tag-{n}", "name": n, "url": "https://example.invalid/t"}} for n in names]}


def _project_node(project_id="proj-1", tags=None, updates=None):
    return {
        "id": project_id, "key": project_id.upper(), "name": f"Project {project_id}",
        "url": f"https://example.invalid/projects/{project_id}",
        "state": {"label": "On track", "value": "ON_TRACK"},
        "tags": _tags("rnd_project_x") if tags is None else tags,
        "updates": {"edges": []} if updates is None else updates,
    }


def _projects_payload(nodes, errors=None, page_info=True, has_next=False):
    projects = {"edges": [{"node": node} for node in nodes]}
    if page_info:
        projects["pageInfo"] = {"hasNextPage": has_next, "endCursor": "c1" if has_next else None}
    payload = {"data": {"goals_byId": {"projects": projects}}}
    if errors:
        payload["errors"] = errors
    return payload


def _tag_error(index=0, extra=(), message="secret provider text", classification=None):
    error = {
        "message": message,
        "path": ["goals_byId", "projects", "edges", index, "node", "tags", *extra],
    }
    if classification:
        error["extensions"] = {"classification": classification}
    return error


class PublicReadRegistryTests(unittest.TestCase):
    def test_registry_has_exactly_the_seven_operations_with_fixed_names(self):
        registry = epm_home.PUBLIC_READ_V1_REGISTRY
        self.assertEqual(tuple(registry), PUBLIC_KEYS)
        names = {entry["operationName"] for entry in registry.values()}
        self.assertEqual(len(names), 7)
        for key, entry in registry.items():
            self.assertRegex(entry["query"], rf"\b(query)\s+{entry['operationName']}\b", key)
            self.assertNotRegex(entry["query"], r"\bmutation\b")

    def test_public_documents_omit_owner_creator_and_teamwork_graph(self):
        for key, entry in epm_home.PUBLIC_READ_V1_REGISTRY.items():
            for forbidden in ("owner", "creator", "cypher", "AtlassianHomeTag", "teamwork"):
                self.assertNotIn(forbidden.lower(), entry["query"].lower(), (key, forbidden))

    def test_public_documents_keep_the_enrichment_fields(self):
        query = epm_home.PUBLIC_READ_V1_REGISTRY["goalProjects"]["query"]
        for field in ("state", "tags", "updates", "pageInfo", "creationDate", "summary", "updateType"):
            self.assertIn(field, query)

    def test_mutation_is_not_registered_by_text_or_hash(self):
        digest = hashlib.sha256(epm_home.HOME_PROJECT_UPDATE_MUTATION.encode()).hexdigest()
        for entry in epm_home.PUBLIC_READ_V1_REGISTRY.values():
            self.assertNotEqual(entry["query"], epm_home.HOME_PROJECT_UPDATE_MUTATION)
            self.assertNotEqual(hashlib.sha256(entry["query"].encode()).hexdigest(), digest)
        self.assertNotIn("projects_createUpdate", json.dumps(epm_home.PUBLIC_READ_V1_REGISTRY))

    def test_legacy_constants_and_basic_signature_are_unchanged(self):
        self.assertEqual(epm_home.HOME_GRAPHQL_ENDPOINT, "https://team.atlassian.com/gateway/api/graphql")
        self.assertEqual(epm_home.HOME_OAUTH_GRAPHQL_ENDPOINT, "https://api.atlassian.com/graphql")
        params = list(inspect.signature(epm_home.HomeGraphQLClient.__init__).parameters)
        self.assertEqual(params, ["self", "email", "api_token", "endpoint"])
        self.assertIn("owner", epm_home.QUERY_GOAL_PROJECTS)
        self.assertEqual(epm_home.HOME_MAX_RETRY_WAIT_SECONDS, 30)


class StrictClientBoundaryTests(unittest.TestCase):
    def _forbid_network_and_headers(self):
        http = _FakeHttp({"data": {}})
        return http, patch.object(epm_home, "urlopen", http), patch.object(
            epm_home, "_bearer_headers", side_effect=AssertionError("headers built before validation"),
        )

    def test_rejects_every_non_oauth_endpoint_before_headers(self):
        targets = (
            epm_home.HOME_GRAPHQL_ENDPOINT,
            "https://example.invalid/gateway/api/graphql/twg",
            "https://example.atlassian.net/gateway/api/graphql",
            "https://api.atlassian.com/graphql/",
            "http://api.atlassian.com/graphql",
            "https://api.atlassian.com/graphql?x=1",
            "",
            None,
        )
        for target in targets:
            with self.subTest(target=target):
                http, urlopen_patch, header_patch = self._forbid_network_and_headers()
                with urlopen_patch, header_patch:
                    with self.assertRaises(epm_home.HomeReadError) as raised:
                        epm_home.HomeOAuthGraphQLClient(FAKE_TOKEN, target)
                self.assertEqual(raised.exception.category, "invalid_target")
                self.assertEqual(http.requests, [])
                self.assertNotIn(FAKE_TOKEN, str(raised.exception))

    def test_probe_and_builder_use_the_same_exact_endpoint(self):
        client = epm_home.build_home_oauth_graphql_client(FAKE_TOKEN)
        self.assertEqual(client.endpoint, epm_home.HOME_OAUTH_GRAPHQL_ENDPOINT)
        with self.assertRaises(epm_home.HomeReadError):
            epm_home.build_home_oauth_graphql_client(FAKE_TOKEN, "https://example.invalid/graphql")

    def test_rejects_mutation_and_unregistered_documents_exactly(self):
        client = epm_home.HomeOAuthGraphQLClient(FAKE_TOKEN)
        registered = epm_home.PUBLIC_READ_V1_REGISTRY["projectTags"]["query"]
        documents = (
            epm_home.HOME_PROJECT_UPDATE_MUTATION,
            registered + " ",
            registered.replace("name", "name owner { id }"),
            epm_home.QUERY_GOAL_PROJECTS,
            epm_home.QUERY_TEAMWORK_GRAPH_PROJECT_TAGS,
            "query Other { __typename }",
            f"# {registered}\nmutation M {{ x }}",
        )
        for document in documents:
            with self.subTest(document=document[:40]):
                http = _FakeHttp({"data": {}})
                with patch.object(epm_home, "urlopen", http):
                    with self.assertRaises(epm_home.HomeReadError) as raised:
                        client.execute(document, {"projectId": "p"})
                self.assertEqual(raised.exception.category, "unregistered_operation")
                self.assertEqual(http.requests, [])
        with self.assertRaises(epm_home.HomeReadError):
            client.execute_operation("projects_createUpdate", {})

    def test_sends_exact_endpoint_operation_name_and_bearer_only(self):
        http = _FakeHttp({"data": {"projects_byId": {"tags": _tags("a")}}})
        client = epm_home.HomeOAuthGraphQLClient(FAKE_TOKEN)
        with patch.object(epm_home, "urlopen", http):
            result = client.execute_operation("projectTags", {"projectId": "p1"})
        request = http.requests[0]
        self.assertEqual(request["url"], "https://api.atlassian.com/graphql")
        self.assertEqual(request["body"]["operationName"], "ProjectTags")
        self.assertEqual(request["body"]["query"], epm_home.PUBLIC_READ_V1_REGISTRY["projectTags"]["query"])
        self.assertEqual(request["headers"]["Authorization"], f"Bearer {FAKE_TOKEN}")
        self.assertNotIn("Basic", json.dumps(request["headers"]))
        self.assertEqual(result.errors, ())
        self.assertNotIn(FAKE_TOKEN, repr(client))

    def test_basic_client_still_sends_basic_and_legacy_query(self):
        http = _FakeHttp({"data": {"ok": 1}})
        client = epm_home.HomeGraphQLClient("u@example.invalid", "tok")
        with patch.object(epm_home, "urlopen", http):
            data = client.execute(epm_home.QUERY_PROJECT_TAGS, {"projectId": "p"})
        self.assertEqual(data, {"data": {"ok": 1}})
        self.assertEqual(http.requests[0]["url"], epm_home.HOME_GRAPHQL_ENDPOINT)
        self.assertTrue(http.requests[0]["headers"]["Authorization"].startswith("Basic "))
        self.assertNotIn("operationName", http.requests[0]["body"])


class StrictTypedErrorTests(unittest.TestCase):
    def _run(self, *items):
        http = _FakeHttp(*items)
        client = epm_home.HomeOAuthGraphQLClient(FAKE_TOKEN)
        with patch.object(epm_home, "urlopen", http), patch.object(epm_home.time, "sleep") as sleep:
            try:
                return client.execute_operation("projectTags", {"projectId": "p"}), http, sleep, None
            except epm_home.HomeReadError as exc:
                return None, http, sleep, exc

    def test_http_failures_are_typed_and_leak_no_provider_text(self):
        cases = (
            (401, "auth_rejected"), (403, "access_denied"), (500, "http_error"), (404, "http_error"),
        )
        for status, category in cases:
            with self.subTest(status=status):
                _, _, _, error = self._run(_http_error(status, body=b'{"errors":[{"message":"secret provider text"}]}'))
                self.assertEqual((error.category, error.status), (category, status))
                self.assertNotIn("secret provider text", str(error))
                self.assertNotIn(FAKE_TOKEN, str(error))

    def test_network_and_invalid_json_are_typed(self):
        _, _, _, error = self._run(OSError("boom secret"))
        self.assertEqual(error.category, "network")
        self.assertNotIn("secret", str(error))
        bad = _http_error(200)
        class _Garbage(_Resp):
            def read(self):
                return b"not json"
        http = lambda request, timeout=None: _Garbage({})
        client = epm_home.HomeOAuthGraphQLClient(FAKE_TOKEN)
        with patch.object(epm_home, "urlopen", http):
            with self.assertRaises(epm_home.HomeReadError) as raised:
                client.execute_operation("projectTags", {"projectId": "p"})
        self.assertEqual(raised.exception.category, "invalid_response")
        del bad

    def test_graphql_errors_are_structured_and_sanitised(self):
        payload = {
            "data": {"projects_byId": None},
            "errors": [
                {"message": "secret provider text", "path": ["projects_byId", "tags", 0],
                 "extensions": {"classification": "DataFetchingException", "stacktrace": "secret"}},
                {"message": "x", "path": ["projects_byId", "bad path!", {"a": 1}]},
                {"message": "does not contain the right authorisation scopes"},
            ],
        }
        result, _, _, error = self._run(payload)
        self.assertIsNone(error)
        self.assertEqual(result.data, {"projects_byId": None})
        self.assertEqual(result.errors[0].path, ("projects_byId", "tags", 0))
        self.assertEqual(result.errors[0].classification, "DataFetchingException")
        self.assertIsNone(result.errors[1].path)
        self.assertTrue(result.errors[2].auth)
        self.assertNotIn("secret", repr(result.errors))

    def test_raise_for_errors_collects_validated_paths(self):
        payload = {"data": {}, "errors": [{"message": "m", "path": ["a", "b"]}, {"message": "m"}]}
        result, _, _, _ = self._run(payload)
        with self.assertRaises(epm_home.HomeReadError) as raised:
            result.raise_for_errors()
        self.assertEqual(raised.exception.category, "graphql_error")
        self.assertEqual(raised.exception.paths, (("a", "b"),))
        self.assertNotIn("secret", str(raised.exception))

    def test_auth_marked_graphql_error_is_access_denied(self):
        payload = {"data": {}, "errors": [{"message": "Forbidden", "path": ["x"]}]}
        result, _, _, _ = self._run(payload)
        with self.assertRaises(epm_home.HomeReadError) as raised:
            result.raise_for_errors()
        self.assertEqual(raised.exception.category, "access_denied")

    def test_retry_after_is_capped_for_strict_clients(self):
        cases = {"abc": 1, "-5": 1, "99999": 30, "0": 1, "7": 7, "Wed, 21 Oct 2026 07:28:00 GMT": 1}
        for value, expected_first_wait in cases.items():
            with self.subTest(retry_after=value):
                _, http, sleep, error = self._run(_http_error(429, retry_after=value))
                self.assertEqual(error.category, "rate_limited")
                self.assertEqual(error.status, 429)
                self.assertEqual(len(http.requests), epm_home.HOME_MAX_RETRIES + 1)
                waits = [call.args[0] for call in sleep.call_args_list]
                self.assertEqual(waits[0], expected_first_wait if value not in {"abc", "Wed, 21 Oct 2026 07:28:00 GMT"} else 1)
                self.assertTrue(all(1 <= w <= 30 for w in waits), waits)
                self.assertTrue(1 <= error.retry_after <= 30)

    def test_missing_retry_after_uses_capped_backoff_and_recovers(self):
        result, http, sleep, error = self._run(
            _http_error(429), {"data": {"projects_byId": {"tags": _tags("a")}}},
        )
        self.assertIsNone(error)
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [1])
        self.assertEqual(len(http.requests), 2)

    def test_basic_retry_semantics_are_unchanged(self):
        http = _FakeHttp(_http_error(429, retry_after="99999"))
        client = epm_home.HomeGraphQLClient("u@example.invalid", "tok")
        with patch.object(epm_home, "urlopen", http), patch.object(epm_home.time, "sleep") as sleep:
            with self.assertRaises(epm_home.HomeRateLimitError):
                client.execute("query Q { x }", {})
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [99999, 99999, 99999])


class StrictOptionalTagTests(unittest.TestCase):
    def _links(self, *items):
        http = _FakeHttp(*items)
        client = epm_home.HomeOAuthGraphQLClient(FAKE_TOKEN)
        with patch.object(epm_home, "urlopen", http):
            return epm_home.fetch_goal_project_links(client, "goal-1"), http

    def _reject(self, payload):
        client = epm_home.HomeOAuthGraphQLClient(FAKE_TOKEN)
        with patch.object(epm_home, "urlopen", _FakeHttp(payload)):
            with self.assertRaises(epm_home.HomeReadError) as raised:
                epm_home.fetch_goal_project_links(client, "goal-1")
        return raised.exception

    def test_confined_tag_error_marks_only_the_affected_node(self):
        rows, http = self._links(_projects_payload(
            [_project_node("p1"), _project_node("p2", tags=None), _project_node("p3")],
            errors=[_tag_error(1, extra=("edges", 0, "node", "name"), classification="DataFetchingException")],
        ))
        self.assertEqual(len(http.requests), 1)
        flags = {row["id"]: bool(row.get("_tagsUnavailable")) for row in rows}
        self.assertEqual(flags, {"p1": False, "p2": True, "p3": False})
        self.assertIn("tags", rows[1])
        records = {row["id"]: epm_home._fetch_or_build_home_project_record(None, row) for row in rows}
        self.assertTrue(records["p2"]["homeTagsUnavailable"])
        self.assertEqual(records["p2"]["homeTags"], [])
        self.assertFalse(records["p1"]["homeTagsUnavailable"])
        self.assertEqual(records["p1"]["homeTags"], ["rnd_project_x"])
        self.assertEqual(http.requests[0]["body"]["operationName"], "GoalProjects")

    def test_ordinary_empty_tags_are_available(self):
        rows, _ = self._links(_projects_payload([_project_node("p1", tags={"edges": []})]))
        record = epm_home._fetch_or_build_home_project_record(None, rows[0])
        self.assertFalse(record["homeTagsUnavailable"])
        self.assertEqual(record["homeTags"], [])

    def test_enriched_row_keys_are_unchanged_and_no_internal_flag_leaks(self):
        rows, _ = self._links(_projects_payload([_project_node("p1")]))
        self.assertTrue(epm_home._has_enriched_goal_project_fields(rows[0]))
        record = epm_home._fetch_or_build_home_project_record(None, rows[0])
        self.assertNotIn("_tagsUnavailable", record)
        self.assertEqual(record["ownerAccountId"], "")
        self.assertEqual(record["latestUpdateAuthor"], "")

    def test_non_confined_or_unsafe_failures_reject(self):
        node = _project_node("p1")
        cases = {
            "auth on tags path": _projects_payload([node], errors=[_tag_error(0, message="Forbidden")]),
            "auth classification": _projects_payload([node], errors=[_tag_error(0, classification="FORBIDDEN")]),
            "scope marker": _projects_payload([node], errors=[_tag_error(0, message="does not contain the right authorisation scopes")]),
            "core path": _projects_payload([node], errors=[{"message": "m", "path": ["goals_byId", "projects", "edges", 0, "node", "name"]}]),
            "updates path": _projects_payload([node], errors=[{"message": "m", "path": ["goals_byId", "projects", "edges", 0, "node", "updates"]}]),
            "no path": _projects_payload([node], errors=[{"message": "m"}]),
            "invalid path": _projects_payload([node], errors=[{"message": "m", "path": ["goals_byId", "projects", "edges", 0, "node", "tags!"]}]),
            "unknown root": _projects_payload([node], errors=[{"message": "m", "path": ["other", "tags"]}]),
            "tags-like prefix": _projects_payload([node], errors=[{"message": "m", "path": ["goals_byId", "projects", "edges", 0, "node", "tagsX"]}]),
            "bubbled node": _projects_payload([None], errors=[_tag_error(0)]),
            "mixed confined and core": _projects_payload([node], errors=[_tag_error(0), {"message": "m", "path": ["goals_byId", "projects"]}]),
            "index out of range": _projects_payload([node], errors=[_tag_error(5)]),
            "missing project core": _projects_payload([{"id": "p1", "tags": None, "updates": {"edges": []}}], errors=[_tag_error(0)]),
            "null projects": {"data": {"goals_byId": {"projects": None}}, "errors": [_tag_error(0)]},
            "missing projects pageInfo": _projects_payload([node], page_info=False),
        }
        for name, payload in cases.items():
            with self.subTest(name):
                self._reject(payload)

    def test_tag_and_update_subconnections_need_no_pageinfo(self):
        rows, _ = self._links(_projects_payload([_project_node("p1")]))
        self.assertNotIn("pageInfo", rows[0]["tags"])
        self.assertNotIn("pageInfo", rows[0]["updates"])

    def test_strict_row_without_enrichment_is_rejected_not_fanned_out(self):
        client = epm_home.HomeOAuthGraphQLClient(FAKE_TOKEN)
        http = _FakeHttp({"data": {}})
        with patch.object(epm_home, "urlopen", http):
            with self.assertRaises(epm_home.HomeReadError):
                epm_home._fetch_or_build_home_project_record(client, {"id": "p1"})
        self.assertEqual(http.requests, [])

    def test_strict_pagination_follows_cursor_with_one_request_per_page(self):
        rows, http = self._links(
            _projects_payload([_project_node("p1")], has_next=True),
            _projects_payload([_project_node("p2")]),
        )
        self.assertEqual([r["id"] for r in rows], ["p1", "p2"])
        self.assertEqual(len(http.requests), 2)
        self.assertEqual(http.requests[1]["body"]["variables"]["after"], "c1")

    def test_project_tags_confined_error_is_unavailable_and_empty_is_available(self):
        client = epm_home.HomeOAuthGraphQLClient(FAKE_TOKEN)
        twg = patch.object(epm_home, "build_teamwork_graph_client", side_effect=AssertionError("TWG forbidden"))
        confined = {"data": {"projects_byId": {"tags": None}},
                    "errors": [{"message": "m", "path": ["projects_byId", "tags"]}]}
        with twg, patch.object(epm_home, "urlopen", _FakeHttp(confined)):
            self.assertIsNone(epm_home.fetch_project_tags(client, {"id": "p1"}))
        empty = {"data": {"projects_byId": {"tags": {"edges": []}}}}
        with twg, patch.object(epm_home, "urlopen", _FakeHttp(empty)) as _:
            http = epm_home.urlopen
            self.assertEqual(epm_home.fetch_project_tags(client, {"id": "p1"}), [])
            self.assertEqual(len(http.requests), 1)

    def test_project_tags_rejects_auth_core_and_bubbled_failures(self):
        client = epm_home.HomeOAuthGraphQLClient(FAKE_TOKEN)
        bad = (
            {"data": {"projects_byId": {"tags": None}}, "errors": [{"message": "Forbidden", "path": ["projects_byId", "tags"]}]},
            {"data": {"projects_byId": None}, "errors": [{"message": "m", "path": ["projects_byId", "tags"]}]},
            {"data": {"projects_byId": {"tags": None}}, "errors": [{"message": "m", "path": ["projects_byId", "id"]}]},
            {"data": {"projects_byId": {"tags": None}}, "errors": [{"message": "m"}]},
        )
        for payload in bad:
            with self.subTest(payload=payload["errors"]):
                with patch.object(epm_home, "urlopen", _FakeHttp(payload)):
                    with self.assertRaises(epm_home.HomeReadError):
                        epm_home.fetch_project_tags(client, {"id": "p1"})


class StrictConsumerPropagationTests(unittest.TestCase):
    """Strict required failures must re-raise at every site Basic swallows."""

    def setUp(self):
        self.client = epm_home.HomeOAuthGraphQLClient(FAKE_TOKEN)
        epm_home._GOAL_BY_KEY_CACHE.clear()
        self.addCleanup(epm_home._GOAL_BY_KEY_CACHE.clear)

    def _fail(self, status=500):
        return patch.object(epm_home, "urlopen", _FakeHttp(_http_error(status)))

    def test_goal_lookup_does_not_fall_back_or_swallow(self):
        http = _FakeHttp(_http_error(500))
        with patch.object(epm_home, "urlopen", http):
            with self.assertRaises(epm_home.HomeReadError):
                epm_home.resolve_goal_by_key(self.client, "ROOT-1", "ari:cloud:townsquare::site/c")
        self.assertEqual(len(http.requests), 1)

    def test_goal_search_fallback_failure_raises(self):
        found_nothing = {"data": {"goals_byKey": None}}
        http = _FakeHttp(found_nothing, _http_error(500))
        with patch.object(epm_home, "urlopen", http):
            with self.assertRaises(epm_home.HomeReadError):
                epm_home.resolve_goal_by_key(self.client, "ROOT-1", "ari:cloud:townsquare::site/c")
        self.assertEqual([r["body"]["operationName"] for r in http.requests], ["GoalByKey", "GoalsSearch"])

    def test_sub_goals_project_links_and_updates_raise(self):
        with self._fail():
            with self.assertRaises(epm_home.HomeReadError):
                epm_home.fetch_sub_goals(self.client, "goal-1")
        with self._fail():
            with self.assertRaises(epm_home.HomeReadError):
                epm_home.fetch_projects_for_goal(self.client, "goal-1")
        with self._fail():
            with self.assertRaises(epm_home.HomeReadError):
                epm_home.fetch_latest_project_update(self.client, "p1")

    def test_goal_lookup_and_sub_goals_use_public_documents(self):
        http = _FakeHttp(
            {"data": {"goals_byKey": {"id": "g1", "key": "ROOT-1", "name": "n", "url": "u"}}},
            {"data": {"goals_byId": {"subGoals": {"pageInfo": {"hasNextPage": False}, "edges": [
                {"node": {"id": "g2", "key": "S-1", "name": "n", "url": "u", "isArchived": False}}]}}}},
        )
        with patch.object(epm_home, "urlopen", http):
            goal = epm_home.resolve_goal_by_key(self.client, "ROOT-1", "ari:cloud:townsquare::site/c")
            subs = epm_home.fetch_sub_goals(self.client, goal["id"])
        self.assertEqual([s["key"] for s in subs], ["S-1"])
        self.assertEqual([r["body"]["operationName"] for r in http.requests], ["GoalByKey", "SubGoals"])
        for request in http.requests:
            self.assertEqual(request["url"], epm_home.HOME_OAUTH_GRAPHQL_ENDPOINT)

    def test_latest_update_strict_reads_projection_without_creator(self):
        payload = {"data": {"projects_byId": {"updates": {"edges": [{"node": {
            "id": "u1", "url": "u", "creationDate": "2026-01-01T00:00:00Z", "editDate": None,
            "summary": "s", "updateType": "ON_TRACK"}}]}}}}
        with patch.object(epm_home, "urlopen", _FakeHttp(payload)):
            rows = epm_home.fetch_latest_project_update(self.client, "p1")
        self.assertEqual(rows[0]["id"], "u1")

    def test_basic_swallow_behavior_is_preserved(self):
        basic = epm_home.HomeGraphQLClient("u@example.invalid", "t")
        with patch.object(epm_home, "urlopen", _FakeHttp(_http_error(500))):
            self.assertEqual(epm_home.fetch_sub_goals(basic, "goal-1"), [])
        with patch.object(epm_home, "urlopen", _FakeHttp(_http_error(500))):
            self.assertEqual(epm_home.fetch_latest_project_update(basic, "p1"), [])


def _probe_responder(overrides=None, cloud_scope=True):
    overrides = overrides or {}

    def respond(body):
        name = body["operationName"]
        if name in overrides:
            return overrides[name]
        project = _project_node("proj-1")
        data = {
            "GoalsSearch": {"goals_search": {"pageInfo": {"hasNextPage": False}, "edges": [{"node": {"id": "g0", "key": "ROOT-1", "name": "n", "url": "u"}}]}},
            "GoalByKey": {"goals_byKey": {"id": "g-root", "key": "ROOT-1", "name": "n", "url": "u"}},
            "SubGoals": {"goals_byId": {"subGoals": {"pageInfo": {"hasNextPage": False}, "edges": [{"node": {"id": "g-sub", "key": "SUB-1", "name": "n", "url": "u", "isArchived": False}}]}}},
            "GoalProjects": {"goals_byId": {"projects": {"pageInfo": {"hasNextPage": False}, "edges": [{"node": project}]}}},
            "ProjectDetails": {"projects_byId": {"id": "proj-1", "key": "P", "name": "n", "url": "u", "state": {"label": "l", "value": "ON_TRACK"}}},
            "ProjectUpdates": {"projects_byId": {"updates": {"pageInfo": {"hasNextPage": False}, "edges": []}}},
            "ProjectTags": {"projects_byId": {"tags": _tags("rnd_project_x")}},
        }[name]
        return {"data": data}

    return respond


SCOPE = {"rootGoalKey": "ROOT-1", "subGoalKeys": ["SUB-1"]}


class PublicReadProbeTests(unittest.TestCase):
    def _probe(self, overrides=None, scope=SCOPE, token=FAKE_TOKEN, cloud="cloud-1"):
        http = _FakeHttp(_probe_responder(overrides))
        with patch.object(epm_home, "urlopen", http):
            payload = epm_home.run_home_graphql_public_read_probe(token, cloud, scope)
        return payload, http

    def test_error_free_seven_operation_probe_passes(self):
        payload, http = self._probe()
        self.assertEqual(payload["profile"], "public-read-v1")
        self.assertEqual(payload["version"], 1)
        self.assertEqual((payload["decision"], payload["reason"]), ("pass", "home_graphql_public_read_v1_supported"))
        self.assertEqual([r["operation"] for r in payload["results"]], list(PUBLIC_KEYS))
        for row in payload["results"]:
            self.assertEqual((row["status"], row["ok"], row["category"]), (200, True, "ok"))
            self.assertNotIn("code", row)
        self.assertEqual({r["url"] for r in http.requests}, {epm_home.HOME_OAUTH_GRAPHQL_ENDPOINT})
        self.assertEqual(len(http.requests), 7)
        self.assertNotIn(FAKE_TOKEN, json.dumps(payload))
        self.assertFalse(epm_home.contains_probe_secret_material(payload))

    def test_confined_tag_error_is_not_a_probe_pass(self):
        overrides = {"ProjectTags": {"data": {"projects_byId": {"tags": None}},
                                     "errors": [{"message": "m", "path": ["projects_byId", "tags"]}]}}
        payload, _ = self._probe(overrides)
        self.assertEqual(payload["decision"], "fail")
        tag_row = payload["results"][-1]
        self.assertEqual((tag_row["operation"], tag_row["ok"], tag_row["category"]), ("projectTags", False, "graphql_error"))

    def test_auth_rejection_fails_unsupported_without_leaking(self):
        payload, http = self._probe({"GoalsSearch": _http_error(403, body=b'{"errors":[{"message":"secret provider text"}]}')})
        self.assertEqual(payload["decision"], "fail")
        self.assertEqual(payload["reason"], "home_graphql_public_read_v1_unsupported")
        self.assertEqual(payload["results"][0]["category"], "access_denied")
        self.assertEqual(len(http.requests), 1)
        self.assertNotIn("secret provider text", json.dumps(payload))

    def test_missing_private_scope_is_insufficient_fixture_not_pass(self):
        for scope in ({}, {"rootGoalKey": "ROOT-1"}, {"subGoalKeys": ["SUB-1"]}):
            with self.subTest(scope=scope):
                payload, _ = self._probe(scope=scope)
                self.assertEqual((payload["decision"], payload["reason"]), ("fail", "insufficient_home_fixture"))
        payload, http = self._probe(token="")
        self.assertEqual(payload["reason"], "insufficient_home_fixture")
        self.assertEqual(http.requests, [])

    def test_empty_goal_projects_is_insufficient_fixture(self):
        payload, _ = self._probe({"GoalProjects": {"data": {"goals_byId": {"projects": {"pageInfo": {"hasNextPage": False}, "edges": []}}}}})
        self.assertEqual(payload["reason"], "insufficient_home_fixture")
        self.assertNotEqual(payload["decision"], "pass")


class PublicReadChecklessClassifierTests(unittest.TestCase):
    def _rows(self):
        return [{"operation": key, "status": 200, "ok": True, "category": "ok"} for key in PUBLIC_KEYS]

    def _classify(self, **overrides):
        payload = {"version": 1, "profile": "public-read-v1", "results": self._rows()}
        payload.update(overrides)
        return epm_home.classify_home_public_read_v1_probe(payload)

    def test_valid_rows_pass_with_distinct_reason(self):
        result = self._classify()
        self.assertEqual(result, {"decision": "pass", "reason": "home_graphql_public_read_v1_supported"})
        self.assertNotEqual(result["reason"], "home_graphql_3lo_supported")

    def test_summary_only_pass_and_trusted_top_level_decision_are_rejected(self):
        result = epm_home.classify_home_public_read_v1_probe({
            "version": 1, "profile": "public-read-v1",
            "decision": "pass", "reason": "home_graphql_public_read_v1_supported",
        })
        self.assertEqual(result["decision"], "fail")
        forged = self._classify(decision="pass", reason="home_graphql_public_read_v1_supported",
                                results=self._rows()[:6])
        self.assertEqual(forged["decision"], "fail")

    def test_profile_version_rows_are_validated(self):
        bad = {
            "wrong profile": self._classify(profile="legacy"),
            "no profile": self._classify(profile=None),
            "wrong version": self._classify(version=2),
            "string version": self._classify(version="1"),
            "missing row": self._classify(results=self._rows()[:-1]),
            "duplicate row": self._classify(results=self._rows() + [self._rows()[0]]),
            "unknown row": self._classify(results=self._rows()[:-1] + [{"operation": "teamwork_graph_project_tags", "status": 200, "ok": True, "category": "ok"}]),
            "fixture row": self._classify(results=self._rows() + [{"operation": "fixture", "status": 0, "ok": False, "category": "insufficient_home_fixture"}]),
            "not ok": self._classify(results=[dict(r, ok=False) if r["operation"] == "projectTags" else r for r in self._rows()]),
            "ok but 500": self._classify(results=[dict(r, status=500) if r["operation"] == "subGoals" else r for r in self._rows()]),
            "ok but category": self._classify(results=[dict(r, category="graphql_error") if r["operation"] == "subGoals" else r for r in self._rows()]),
            "extra field": self._classify(results=[dict(r, errors=["x"]) if r["operation"] == "subGoals" else r for r in self._rows()]),
            "string ok": self._classify(results=[dict(r, ok="true") if r["operation"] == "subGoals" else r for r in self._rows()]),
            "non-list": self._classify(results="x"),
        }
        for name, result in bad.items():
            with self.subTest(name):
                self.assertEqual(result["decision"], "fail", result)
                self.assertNotEqual(result["reason"], "home_graphql_public_read_v1_supported")

    def test_auth_status_rows_report_unsupported(self):
        rows = self._rows()
        rows[0] = {"operation": "goals_search", "status": 403, "ok": False, "category": "access_denied"}
        self.assertEqual(self._classify(results=rows)["reason"], "home_graphql_public_read_v1_unsupported")


class PublicReadCheckerScriptTests(unittest.TestCase):
    def _run(self, payload, *argv):
        import scripts.check_home_graphql_oauth as checker
        os.makedirs(os.path.join(REPO_ROOT, "tmp", "h1"), exist_ok=True)
        with tempfile.TemporaryDirectory(dir=os.path.join(REPO_ROOT, "tmp", "h1")) as tmp:
            path = os.path.join(tmp, "probe.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
            out = io.StringIO()
            with patch("sys.argv", ["check", "--input", path, *argv]), patch("sys.stdout", out):
                code = checker.main()
        return code, out.getvalue().strip()

    def _payload(self):
        return {"version": 1, "profile": "public-read-v1", "results": [
            {"operation": key, "status": 200, "ok": True, "category": "ok"} for key in PUBLIC_KEYS]}

    def test_profile_pass_prints_distinct_reason(self):
        self.assertEqual(self._run(self._payload(), "--profile", "public-read-v1"),
                         (0, "PASS home_graphql_public_read_v1_supported"))

    def test_profile_rejects_summary_only_secret_and_unknown_profile(self):
        code, out = self._run({"version": 1, "profile": "public-read-v1", "decision": "pass",
                               "reason": "home_graphql_public_read_v1_supported"}, "--profile", "public-read-v1")
        self.assertEqual(code, 1)
        self.assertTrue(out.startswith("FAIL"))
        secret = self._payload()
        secret["results"][0]["authorization"] = "Bearer x"
        self.assertEqual(self._run(secret, "--profile", "public-read-v1"), (1, "FAIL token_material_exposed"))
        with self.assertRaises(SystemExit) as raised:
            self._run(self._payload(), "--profile", "bogus")
        self.assertEqual(raised.exception.code, 2)

    def test_legacy_default_is_untouched_and_never_passes_with_public_payload(self):
        legacy_ops = ["goals_search", "goal_by_key", "sub_goals", "goal_projects", "project_details",
                      "project_updates", "project_tags", "teamwork_graph_project_tags"]
        legacy = {"results": [{"operation": op, "status": 200, "ok": True} for op in legacy_ops]}
        self.assertEqual(self._run(legacy), (0, "PASS home_graphql_3lo_supported"))
        failing = {"decision": "fail", "reason": "home_graphql_3lo_unsupported"}
        self.assertEqual(self._run(failing), (1, "FAIL home_graphql_3lo_unsupported"))
        self.assertEqual(self._run(failing, "--profile", "legacy"), (1, "FAIL home_graphql_3lo_unsupported"))
        code, out = self._run(self._payload())
        self.assertEqual(code, 1)
        self.assertNotIn("PASS", out)
