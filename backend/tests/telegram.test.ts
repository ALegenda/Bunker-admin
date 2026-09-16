import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import { verifyTelegramToken } from '../services/auth.js';
import { config } from '../config.js';
await test('Telegram JWT signature, audience, issuer and expiry validation', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] });
  config.TELEGRAM_CLIENT_ID = '12345';
  const make = (aud = '12345', iss = 'https://oauth.telegram.org', expires = '5m') =>
    new SignJWT({ id: 98765, name: 'Игрок', preferred_username: 'player' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(iss)
      .setAudience(aud)
      .setSubject('98765')
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(privateKey);
  assert.equal((await verifyTelegramToken(await make(), keys)).telegramId, '98765');
  await assert.rejects(verifyTelegramToken(await make('wrong'), keys));
  await assert.rejects(verifyTelegramToken(await make('12345', 'https://evil.invalid'), keys));
  await assert.rejects(
    verifyTelegramToken(await make('12345', 'https://oauth.telegram.org', '-1s'), keys),
  );
  const token = await make();
  await assert.rejects(verifyTelegramToken(token.slice(0, -10) + 'tamperedXX', keys));
});
