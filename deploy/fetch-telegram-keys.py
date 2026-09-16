#!/usr/bin/env python3
"""Fetch public verification keys from Telegram over verified HTTPS."""
import datetime
import gzip
import io
import json
import urllib.request

with urllib.request.urlopen('https://oauth.telegram.org/.well-known/jwks.json', timeout=20) as response:
    payload = response.read(131073)
if len(payload) > 131072:
    raise ValueError('JWKS response is too large')
# Some Telegram edges gzip the body even when no compression was requested.
if payload.startswith(b'\x1f\x8b'):
    with gzip.GzipFile(fileobj=io.BytesIO(payload)) as compressed:
        payload = compressed.read(131073)
    if len(payload) > 131072:
        raise ValueError('Decompressed JWKS response is too large')
keys = json.loads(payload)['keys']
if not keys or not isinstance(keys, list):
    raise ValueError('No Telegram keys')
for key in keys:
    if not isinstance(key, dict) or any(field in key for field in ['d', 'p', 'q', 'k']):
        raise ValueError('Expected public keys only')
if not any(key.get('kty') == 'RSA' and key.get('n') and key.get('e') for key in keys):
    raise ValueError('Missing Telegram RSA key')
print(json.dumps({'fetchedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'keys': keys}))
