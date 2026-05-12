"""Seed encrypted workspace service credentials."""

from __future__ import annotations

import argparse
import getpass
import os

from backend.auth.key_provider import key_provider_from_env
from backend.auth.service_integrations import SERVICE_INTEGRATION_PROVIDERS, seed_service_integration
from backend.db.engine import session_scope


def build_parser():
    parser = argparse.ArgumentParser(description='Seed an encrypted workspace service credential.')
    parser.add_argument('--workspace-id', required=True)
    parser.add_argument('--provider', required=True, choices=sorted(SERVICE_INTEGRATION_PROVIDERS))
    parser.add_argument('--credential-subject', required=True)
    parser.add_argument('--actor-user-id')
    parser.add_argument('--api-token-env', default='ATLASSIAN_API_TOKEN')
    parser.add_argument('--database-url')
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    api_token = os.getenv(args.api_token_env)
    if not api_token:
        api_token = getpass.getpass('Service API token: ')
    with session_scope(args.database_url) as session:
        integration = seed_service_integration(
            session,
            workspace_id=args.workspace_id,
            provider=args.provider,
            credential_subject=args.credential_subject,
            api_token=api_token,
            actor_user_id=args.actor_user_id,
            key_provider=key_provider_from_env(),
        )
        print(f'Seeded {integration.provider} service integration {integration.id}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
