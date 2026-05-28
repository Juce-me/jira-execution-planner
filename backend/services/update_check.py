"""Local and remote update-check helpers."""

import json
import os
import subprocess


def _noop(*_args, **_kwargs):
    return None


def run_git_command(args, *, repo_dir, timeout=5):
    try:
        result = subprocess.run(
            ['git'] + args,
            cwd=repo_dir,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            return None, (result.stderr or result.stdout or '').strip()
        return result.stdout.strip(), None
    except Exception as exc:
        return None, str(exc)


def load_release_info(release_info_path, *, base_dir, log_warning_fn=None):
    log_warning_fn = log_warning_fn or _noop
    if not release_info_path:
        return None
    path = os.path.join(base_dir, release_info_path)
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            return None
        return data
    except Exception as exc:
        log_warning_fn(f'Failed to read release info: {exc}')
        return None


def build_update_check_payload(
    *,
    remote,
    branch,
    run_git_command_fn,
    load_release_info_fn,
    now_iso_fn,
):
    local_hash, local_err = run_git_command_fn(['rev-parse', 'HEAD'])
    local_branch, _ = run_git_command_fn(['rev-parse', '--abbrev-ref', 'HEAD'])
    local_source = 'git'
    if local_err:
        release_info = load_release_info_fn() or {}
        release_hash = str(release_info.get('hash') or '').strip()
        if release_hash:
            local_hash = release_hash
            local_branch = str(release_info.get('tag') or release_info.get('branch') or 'release').strip()
            local_source = 'release'
            local_err = None
        else:
            return {
                'enabled': True,
                'error': f'Failed to read local git state: {local_err}'
            }

    remote_output, remote_err = run_git_command_fn(['ls-remote', remote, f'refs/heads/{branch}'])
    if remote_err:
        return {
            'enabled': True,
            'local': {
                'hash': local_hash,
                'short': local_hash[:7] if local_hash else '',
                'branch': local_branch or ''
            },
            'error': f'Failed to check remote: {remote_err}'
        }

    remote_hash = ''
    if remote_output:
        remote_hash = remote_output.split()[0].strip()

    update_available = bool(local_hash and remote_hash and local_hash != remote_hash)
    return {
        'enabled': True,
        'local': {
            'hash': local_hash,
            'short': local_hash[:7] if local_hash else '',
            'branch': local_branch or '',
            'source': local_source
        },
        'remote': {
            'hash': remote_hash,
            'short': remote_hash[:7] if remote_hash else '',
            'branch': branch,
            'remote': remote
        },
        'updateAvailable': update_available,
        'checkedAt': now_iso_fn()
    }
