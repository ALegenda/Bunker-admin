import 'dotenv/config';
import { z } from 'zod';
const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    AUTH_MODE: z.enum(['local', 'telegram']).default('local'),
    PAGES_FRONTEND_URL: z
      .string()
      .url()
      .default('https://alegenda.github.io/Bunker-admin/')
      .refine((value) => {
        const u = new URL(value);
        return (
          u.protocol === 'https:' &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          u.pathname.endsWith('/')
        );
      }, 'PAGES_FRONTEND_URL must be an HTTPS URL ending with /'),
    PUBLIC_ORIGIN: z
      .string()
      .url()
      .default('http://localhost:4173')
      .refine((value) => {
        const u = new URL(value);
        return (
          ['http:', 'https:'].includes(u.protocol) &&
          u.pathname === '/' &&
          !u.search &&
          !u.hash &&
          !u.username &&
          !u.password
        );
      }, 'PUBLIC_ORIGIN must contain only scheme and host')
      .transform((value) => new URL(value).origin),
    TELEGRAM_CLIENT_ID: z.string().default(''),
    TELEGRAM_CLIENT_SECRET: z.string().default(''),
    TELEGRAM_JWKS_FILE: z.string().default(''),
    TELEGRAM_ADMIN_IDS: z
      .string()
      .regex(/^(?:\d+(?:\s*,\s*\d+)*)?$/)
      .default(''),
    DATABASE_URL: z.string().url(),
    S3_ENDPOINT: z.string().url(),
    S3_ACCESS_KEY: z.string().min(3),
    S3_SECRET_KEY: z.string().min(8),
    S3_BUCKET: z.string().default('bunker'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().default(4173),
    TRUST_LOCAL_PROXY: z.string().default('false'),
    CHROMIUM_NO_SANDBOX: z.enum(['true', 'false']).default('false'),
    CHROME_PATH: z
      .string()
      .default(
        process.platform === 'darwin'
          ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          : '/usr/bin/chromium',
      ),
  })
  .parse(process.env);
if (
  env.NODE_ENV === 'production' &&
  (env.AUTH_MODE !== 'telegram' || !env.PUBLIC_ORIGIN.startsWith('https://'))
)
  throw Error('Production requires Telegram authentication and an HTTPS PUBLIC_ORIGIN');
if (env.AUTH_MODE === 'telegram' && (!env.TELEGRAM_CLIENT_ID || !env.TELEGRAM_CLIENT_SECRET))
  throw Error('Configure TELEGRAM_CLIENT_ID and TELEGRAM_CLIENT_SECRET');
export const config = env;
