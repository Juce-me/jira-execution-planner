#!/usr/bin/env python3
"""Read-only rollback preflight for quarterly work configurations.

Reads one explicitly selected workspace's DB row and refuses (exit 1) when it
holds a promoted work-configuration bundle, even an incomplete one.  It never
writes, flattens or repairs; a downgrade needs a separately verified DB
restoration transaction.  Exit 0: safe, 1: refused, 2: row/DB unavailable.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import Text, cast, select

from backend.db import engine as db_engine
from backend.db import models
from backend.services import work_structure
from backend.services.workspace_dashboard_config import _decoded_payload


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace-id', required=True, help='Explicit workspace to check.')
    return parser


def check_workspace(workspace_id, *, database_url=None):
    """Return ``(exit_code, message)`` without mutating anything."""
    factory = db_engine.session_factory(database_url)
    session = factory()
    try:
        row = session.execute(
            select(cast(models.WorkspaceDashboardConfig.payload, Text))
            .where(models.WorkspaceDashboardConfig.workspace_id == workspace_id)
        ).first()
    finally:
        session.rollback()
        session.close()
    if row is None:
        return 0, f'workspace {workspace_id}: no configuration row; rollback preflight passed'
    if work_structure.is_promoted(_decoded_payload(row[0])):
        return 1, (
            f'workspace {workspace_id}: promoted work configuration bundle present; '
            'rollback refused (restore the flat keys with a separately verified DB transaction)'
        )
    return 0, f'workspace {workspace_id}: no promoted bundle; rollback preflight passed'


def main(argv=None, *, database_url=None):
    args = build_parser().parse_args(argv)
    try:
        url = database_url or db_engine.resolve_database_url(required=True)
        code, message = check_workspace(args.workspace_id, database_url=url)
    except Exception as error:  # report class only; never echo connection details
        print(f'rollback preflight unavailable: {type(error).__name__}', file=sys.stderr)
        return 2
    print(message)
    return code


if __name__ == '__main__':
    raise SystemExit(main())
