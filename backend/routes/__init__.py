"""Backend route blueprints and lazy access to the legacy server module."""

import importlib
import os
import sys


def _is_jira_server_main(module):
    return os.path.basename(str(getattr(module, "__file__", ""))) == "jira_server.py"


def get_jira_server():
    main_module = sys.modules.get("__main__")
    if main_module is not None and _is_jira_server_main(main_module):
        return main_module

    module = sys.modules.get("jira_server")
    if module is not None:
        return module

    return importlib.import_module("jira_server")


def bind_server_globals(target_globals):
    server = get_jira_server()
    for name, value in server.__dict__.items():
        if name.startswith("__") or name in {"bp", "bind_server_globals", "get_jira_server"}:
            continue
        target_globals[name] = value
    target_globals["_jira_server_module"] = server
    return server
