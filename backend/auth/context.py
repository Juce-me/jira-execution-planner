from dataclasses import dataclass, field
from hashlib import sha256


@dataclass(frozen=True)
class ProjectAccessSnapshot:
    project_key: str
    project_type: str
    status: str
    checked_at: str = ""


@dataclass(frozen=True)
class RequestAuthContext:
    auth_mode: str
    user_id: str
    stable_subject: str
    atlassian_account_id: str
    workspace_id: str
    auth_connection_id: str
    cloud_id: str
    site_url: str
    token_version: str
    account_status: str
    is_admin: bool
    project_access: tuple[ProjectAccessSnapshot, ...] = field(default_factory=tuple)


def stable_local_workspace_id(environment_key, jira_site_url, cloud_id=""):
    environment = (environment_key or "local").strip().lower()
    site = (jira_site_url or "").strip().rstrip("/").lower()
    cloud = (cloud_id or "").strip()
    digest = sha256(f"{environment}|{cloud or site}".encode("utf-8")).hexdigest()
    return f"local-workspace-{digest[:16]}"


def build_auth_cache_key(context, *parts):
    connection_or_user = context.auth_connection_id or context.user_id
    return (
        context.workspace_id,
        connection_or_user,
        context.cloud_id,
        str(context.token_version),
        *(str(part) for part in parts),
    )
