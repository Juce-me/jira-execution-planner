#!/usr/bin/env python3
"""Explicitly promote one immutable private-view version into workspace config."""

from __future__ import annotations

import argparse
import hashlib
import json

from sqlalchemy import select

from backend.config.shared_config import normalize_workspace_admin_payload
from backend.db import engine as db_engine
from backend.db import models


def _fingerprint(payload):
    canonical = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def _candidate(session, *, workspace_id, view_config_id, version_number):
    row = session.execute(
        select(models.ViewConfigVersion, models.ViewConfig, models.User)
        .join(models.ViewConfig, models.ViewConfig.id == models.ViewConfigVersion.view_config_id)
        .join(models.User, models.User.id == models.ViewConfig.owner_user_id)
        .where(
            models.ViewConfigVersion.view_config_id == view_config_id,
            models.ViewConfigVersion.version_number == version_number,
            models.ViewConfig.workspace_id == workspace_id,
        )
    ).first()
    if row is None:
        raise ValueError('selected workspace view version was not found')
    version, view, owner = row
    if version.change_note != 'compatibility save':
        raise ValueError('selected version is not a compatibility save')
    if owner.status != 'active' or owner.account_type != 'admin' or version.created_by != owner.id:
        raise ValueError('selected version must be owned and created by an active administrator')
    payload = normalize_workspace_admin_payload(
        version.payload,
        allow_legacy_excluded_fields=True,
    )
    return view, owner, payload


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace-id', required=True)
    parser.add_argument('--view-config-id', required=True)
    parser.add_argument('--version-number', required=True, type=int)
    parser.add_argument('--expected-sha256')
    parser.add_argument('--apply', action='store_true')
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.apply and not args.expected_sha256:
        raise ValueError('--expected-sha256 is required with --apply')
    database_url = db_engine.resolve_database_url(required=True)
    with db_engine.session_scope(database_url) as session:
        _view, owner, payload = _candidate(
            session,
            workspace_id=args.workspace_id,
            view_config_id=args.view_config_id,
            version_number=args.version_number,
        )
        fingerprint = _fingerprint(payload)
        print(
            f'workspace {args.workspace_id} view {args.view_config_id} version {args.version_number} '
            f"sections: {', '.join(sorted(payload))} {fingerprint}"
        )
        if not args.apply:
            print('dry-run only; no database changes applied')
            return 0
        if args.expected_sha256 != fingerprint:
            raise ValueError('fingerprint mismatch')
        existing = session.execute(
            select(models.WorkspaceDashboardConfig.id).where(
                models.WorkspaceDashboardConfig.workspace_id == args.workspace_id,
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise ValueError('workspace configuration already exists')
        # The immutable version and fingerprint are re-read and checked inside
        # the same insertion transaction to prevent a stale dry-run decision.
        _view, current_owner, current_payload = _candidate(
            session,
            workspace_id=args.workspace_id,
            view_config_id=args.view_config_id,
            version_number=args.version_number,
        )
        if current_owner.id != owner.id or _fingerprint(current_payload) != fingerprint:
            raise ValueError('fingerprint mismatch')
        session.add(models.WorkspaceDashboardConfig(
            workspace_id=args.workspace_id,
            payload_version=int(current_payload.get('version') or 1),
            payload=current_payload,
            config_revision=1,
            created_by=current_owner.id,
            updated_by=current_owner.id,
        ))
        session.flush()
        print('applied revision 1')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
