"""Validate effective E2E frontend/API targets before any workflow runs."""
import ipaddress
import os
import socket
import sys
from urllib.parse import urlparse


def parse_target(url):
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        raise ValueError('E2E targets must be absolute HTTP(S) URLs')
    if parsed.username is not None or parsed.password is not None:
        raise ValueError('E2E target URLs must not contain credentials')
    # Accessing .port validates an explicitly supplied port.
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    return parsed, port


def is_loopback(hostname):
    if hostname == 'localhost':
        return True
    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


def resolve_targets(environment):
    """Pure validation; local defaults and explicit paired staging are supported."""
    frontend_override = environment.get('SILVERSEA_URL')
    api_override = environment.get('SILVERSEA_API')
    frontend = frontend_override or f"http://localhost:{environment.get('SILVERSEA_FRONTEND_PORT') or '7174'}"
    api = api_override or f"http://localhost:{environment.get('SILVERSEA_BACKEND_PORT') or '3001'}"
    frontend_url, _ = parse_target(frontend)
    api_url, _ = parse_target(api)
    frontend_local = is_loopback(frontend_url.hostname)
    api_local = is_loopback(api_url.hostname)
    if (not frontend_local or not api_local) and (not frontend_override or not api_override):
        raise ValueError('Remote E2E requires explicit SILVERSEA_URL and SILVERSEA_API')
    if frontend_local != api_local:
        raise ValueError('Mixed local/remote E2E targets are not supported; set both targets deliberately')
    if frontend_url.scheme != api_url.scheme:
        raise ValueError('E2E frontend/API schemes must match')
    if not frontend_local:
        if frontend_url.hostname != api_url.hostname:
            raise ValueError('Remote E2E frontend/API hosts must match')
    return {'frontend': frontend, 'api': api}


def main():
    try:
        targets = resolve_targets(os.environ)
        for name, url in targets.items():
            parsed, port = parse_target(url)
            print(f'E2E {name}: {url}', flush=True)
            # Check the actual effective host/port, including explicit overrides.
            # Local unrelated listeners are not proof of a remote target's state.
            with socket.create_connection((parsed.hostname, port), timeout=3):
                pass
    except (ValueError, OSError) as error:
        print(f'E2E target check failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
