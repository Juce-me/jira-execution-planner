"""Read local Git revision metadata for performance observations."""

import subprocess


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
