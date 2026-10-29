from functools import lru_cache
from urllib.parse import urlsplit

# Atlassian-hosted avatar hosts only. Gravatar is deliberately absent (decided 2026-10-29):
# it would send each viewer's IP and a colleague's email hash to a third party.
AVATAR_HOSTS = frozenset({
    'avatar-management--avatars.us-west-2.prod.public.atl-paas.net',
})

_MAX_LENGTH = 2048
_INITIALS_PATH_PREFIX = '/initials/'


def sanitize_avatar_url(value):
    """Return value when it is a plain https URL on an allowlisted host, else None.

    Generated initials defaults map to None so users without a photo keep the person glyph
    and cost no image request.
    """
    return _sanitize(value) if isinstance(value, str) else None


# One avatar URL repeats on every row of a person, so memoizing keeps the per-row cost to a lookup.
@lru_cache(maxsize=4096)
def _sanitize(value):
    if not value or len(value) > _MAX_LENGTH:
        return None
    if any(ch.isspace() or ch == '\\' or ord(ch) < 0x20 or ord(ch) == 0x7f for ch in value):
        return None
    try:
        parts = urlsplit(value)
    except ValueError:
        return None
    if parts.scheme != 'https' or parts.netloc not in AVATAR_HOSTS:
        return None
    if parts.path.startswith(_INITIALS_PATH_PREFIX):
        return None
    return value
