import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const readable = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../edge/auth.js'), 'utf8');
const source = esbuild
  .transformSync(readable, { minify: true, target: 'node24', loader: 'js', legalComments: 'none' })
  .code.trim();

for (const marker of ['__REGION__', '__POOL_ID__', '__CLIENT_ID__', '__AUTH_BASE__']) {
  if (source.split(marker).length !== 2) {
    throw new Error(`edge/auth.js must contain ${marker} exactly once`);
  }
}

for (const required of [
  'HttpOnly',
  'Secure',
  'SameSite=Lax',
  'code_challenge_method',
  'S256',
  'token_use!=="id"',
  'openid email',
  'alg!=="RS256"',
]) {
  if (!source.includes(required)) throw new Error(`minified edge/auth.js is missing ${required}`);
}

if (/client_secret|SignUp|USER_PASSWORD/i.test(source)) {
  throw new Error('edge/auth.js must not embed a client secret or a sign-up flow');
}

const authBase = `https://${'a'.repeat(63)}.auth.ap-northeast-2.amazoncognito.com`;
const worst = source
  .replace('__REGION__', 'ap-northeast-2')
  .replace('__POOL_ID__', 'ap-northeast-2_Abcdefghi')
  .replace('__CLIENT_ID__', 'a'.repeat(26))
  .replace('__AUTH_BASE__', authBase);
const bytes = Buffer.byteLength(worst);
if (bytes > 4000) throw new Error(`edge auth handler is ${bytes} bytes; CloudFormation inline code allows 4096`);

const filled = source
  .replace('__REGION__', 'ap-northeast-2')
  .replace('__POOL_ID__', 'ap-northeast-2_TestPool1')
  .replace('__CLIENT_ID__', 'clientidclientidclientid12')
  .replace('__AUTH_BASE__', 'https://ft-stg-000000000000.auth.ap-northeast-2.amazoncognito.com');
const dir = mkdtempSync(join(tmpdir(), 'ft-auth-'));
const file = join(dir, 'auth.js');
writeFileSync(file, filled);
const { handler } = createRequire(import.meta.url)(file);

const anonymous = await handler(request('/'));
assert(anonymous.status === '302', 'anonymous viewer should be redirected to sign-in');
assert(anonymous.headers.location[0].value.includes('/oauth2/authorize'), 'login redirect should use the hosted UI authorize endpoint');
assert(anonymous.headers.location[0].value.includes('code_challenge_method=S256'), 'login must use PKCE S256');
assert(anonymous.headers['set-cookie'][0].value.startsWith('ftv='), 'login should set the verifier cookie');
assert(anonymous.headers['set-cookie'][0].value.includes('HttpOnly'), 'verifier cookie must be HttpOnly');
assert(!anonymous.headers.location[0].value.includes('client_secret'), 'login URL must not carry a client secret');

const logout = await handler(request('/_auth/logout'));
assert(logout.status === '302', 'logout should redirect');
assert(logout.headers.location[0].value.includes('/logout?'), 'logout should hit the hosted UI logout endpoint');
assert(logout.headers['set-cookie'].some((cookie) => cookie.value.startsWith('ft=') && cookie.value.includes('Max-Age=0')), 'logout should clear the session cookie');

const cancelled = await handler(request('/_auth/callback', 'error=access_denied'));
assert(cancelled.status === '401', 'a cancelled sign-in should fail closed');

const badToken = await handler(request('/', '', [{ key: 'Cookie', value: 'ft=a.b.c' }]));
assert(badToken.status === '302', 'an invalid id token should start sign-in again');

console.log(`Auth handler ok: ${bytes} bytes at the size budget`);

function request(uri, querystring = '', cookie = []) {
  return {
    Records: [
      {
        cf: {
          request: {
            uri,
            querystring,
            headers: {
              host: [{ key: 'Host', value: 'd111111abcdef8.cloudfront.net' }],
              ...(cookie.length > 0 ? { cookie } : {}),
            },
          },
        },
      },
    ],
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
