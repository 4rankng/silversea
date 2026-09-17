import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@tingting/shared';

// These cases use real refused connections in this test process. They never
// stop shared services, replace dependency functions or write to a database.
async function unusedLocalPort(): Promise<number> {
  const reservation = net.createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

let server: http.Server;
let baseUrl: string;
let secret: string;
let handlerCalls = 0;
let closeDependencies: () => Promise<void>;

before(async () => {
  const [databasePort, redisPort] = await Promise.all([unusedLocalPort(), unusedLocalPort()]);
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = `postgres://unavailable:unavailable@127.0.0.1:${databasePort}/unavailable`;
  process.env.REDIS_URL = `redis://127.0.0.1:${redisPort}`;
  process.env.DB_CONNECT_TIMEOUT_SECONDS = '1';

  const [{ authMiddleware, assetAuthMiddleware }, { config }, { client }, { getRedis }] = await Promise.all([
    import('../middleware/auth'), import('../config'), import('../db'), import('../lib/redis'),
  ]);
  secret = config.jwtSecret;
  closeDependencies = async () => {
    getRedis().disconnect();
    await client.end({ timeout: 1 });
  };
  const app = express();
  const protectedHandler: express.RequestHandler = (_req, res) => {
    handlerCalls += 1;
    res.json({ protected: true });
  };
  app.get('/api/protected', authMiddleware, protectedHandler);
  app.get('/api/photos/protected', assetAuthMiddleware, protectedHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  await closeDependencies?.();
});

const payload = { userId: 1, username: 'session-outage', role: Role.ADMIN };

for (const surface of ['api', 'asset'] as const) {
  async function request(token?: string) {
    const path = surface === 'api' ? '/api/protected' : '/api/photos/protected';
    const url = new URL(path, baseUrl);
    if (surface === 'asset' && token) url.searchParams.set('token', token);
    const response = await fetch(url, {
      headers: surface === 'api' && token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await response.json() as { error: string };
    assert.equal(handlerCalls, 0, 'authentication failure must never enter the protected handler');
    return { response, body };
  }

  test(`SISPROD-AUTH-001 ${surface}: unavailable database denies access with 503`, async () => {
    const { response, body } = await request(jwt.sign(payload, secret, { expiresIn: '1h' }));
    assert.equal(response.status, 503);
    assert.equal(body.error, 'Tạm thời không thể xác thực phiên đăng nhập. Vui lòng thử lại.');
  });

  test(`SISPROD-AUTH-002 ${surface}: unavailable Redis denies access without claiming revocation`, async () => {
    const token = jwt.sign(payload, secret, { expiresIn: '1h', jwtid: 'session-outage' });
    const { response, body } = await request(token);
    assert.equal(response.status, 503);
    assert.equal(body.error, 'Tạm thời không thể xác thực phiên đăng nhập. Vui lòng thử lại.');
  });

  for (const kind of ['missing', 'malformed', 'expired', 'not-yet-valid'] as const) {
    test(`SISPROD-AUTH-003 ${surface}: ${kind} token remains 401 during outage`, async () => {
      const token = kind === 'missing' ? undefined
        : kind === 'malformed' ? 'invalid.jwt'
          : jwt.sign(payload, secret, kind === 'expired' ? { expiresIn: -1 } : { notBefore: '1h' });
      const { response } = await request(token);
      assert.equal(response.status, 401);
    });
  }
}
