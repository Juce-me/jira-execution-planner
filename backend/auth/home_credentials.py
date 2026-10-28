"""Home/Townsquare credential descriptor for the Basic/JSON compatibility clients.

DB OAuth mode never resolves a Home credential here: Home is read only through the user's OAuth grant
(public-read-v1), and the user-owned Atlassian API token connection no longer exists.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class HomeCredential:
    credential_type: str
    provider: str
    email: str
    api_token: str = field(repr=False)
    workspace_id: str = ''
    site_url: str = ''
    cloud_id: str = ''
    cache_key: tuple = field(default_factory=tuple)
