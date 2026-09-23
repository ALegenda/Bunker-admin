# Alternate frontend on GitHub Pages

URL: https://alegenda.github.io/Bunker-admin/
Branch: `pages-static-access`. Publishing is handled by `pages-static.yml`.
The custom domain continues to serve the original application on Render.

All frontend routes have actual `index.html` files, including `/catalog/`,
`/admin/`, `/profile/`, `/proposals/`, `/users/`, `/tips/`, `/achievements/`
and `/auth/callback/`. Direct navigation and refresh do not require a SPA 404 trick.

Build locally:

```sh
VITE_APP_BASE=/Bunker-admin/ VITE_API_ORIGIN=https://bunker-vdk.ru npm run build
VITE_APP_BASE=/Bunker-admin/ node scripts/prepare-pages.mjs
```

The normal build keeps root paths and same-origin cookies. The Pages build uses
Render for API requests, published releases, images, and PDF generation. Render
must remain reachable from the visitor's network: moving the frontend does not
proxy or bypass a blocked API.

## Login

Pages uses a per-tab session in sessionStorage and Authorization headers, with
`credentials: omit`, so Safari's third-party cookie blocking does not break it.
The existing Render cookie login is unchanged. Telegram still calls the existing
Render `/auth/callback`; there is no additional BotFather callback URL.

The Pages tab creates a random verifier and sends its SHA-256 challenge when
navigating to Render's Telegram login. After Telegram verification, Render sends
only a random, 60-second, single-use code back to the fixed Pages callback. The
tab removes the code from the address bar and exchanges it with its verifier for
a session token. The session token is never put in a URL. Sessions retain server
role checks, CSRF validation and revocation when access changes. Logging out
revokes the bearer session; closing the tab discards its browser copy.

`PAGES_FRONTEND_URL` defaults to `https://alegenda.github.io/Bunker-admin/` and
controls the exact allowed CORS origin and callback URL. Cross-origin cookies are
not accepted. CORS allows only the required methods and headers, with no wildcard.
As with any GitHub project Pages site, other repos on the same `alegenda.github.io`
origin share the browser origin, so only trusted scripts should be hosted there.

Private images and PDF previews are fetched with Authorization and rendered via
short-lived object URLs; credentials are never appended to download links.

## Validation and rollback

`backend/tests/pages-access.test.ts` tests the OAuth callback using local signing
keys, verifier binding, expiry, replay prevention, CORS, CSRF, roles and logout.
The original frontend suite also runs with the normal same-origin build.

Rollback the Pages branch/deployment independently of Render. The backend's
additive migration does not change existing user data or sessions. Keep the
migration once applied; it is checksum-verified on each startup.
