#!/usr/bin/env python3
"""Fetch public verification keys from Telegram over verified HTTPS."""
import datetime
import json
import urllib.request

with urllib.request.urlopen('https://oauth.telegram.org/.well-known/jwks.json', timeout=20) as response:
    payload = response.read(131073)
if len(payload) > 131072:
    raise ValueError('JWKS response is too large')
keys = json.loads(payload)['keys']
if not keys or not isinstance(keys, list):
    raise ValueError('No Telegram keys')
for key in keys:
    if not isinstance(key, dict) or any(field in key for field in ['d', 'p', 'q', 'k']):
        raise ValueError('Expected public keys only')
if not any(key.get('kty') == 'RSA' and key.get('n') and key.get('e') for key in keys):
    raise ValueError('Missing Telegram RSA key')
print(json.dumps({'fetchedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'keys': keys}))
