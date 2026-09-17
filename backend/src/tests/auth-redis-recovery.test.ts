import assert from 'node:assert/strict';
import { once } from 'node:events';
import net, { type AddressInfo } from 'node:net';
import { test } from 'node:test';
import { config } from '../config';
import { blacklistToken, getRedis, isTokenBlacklisted } from '../lib/redis';

test('SISPROD-AUTH-005 Redis recovery replaces an ended connection and retains revocation', async () => {
  const target = new URL(config.redisUrl);
  const sockets = new Set<net.Socket>();
  // A transparent TCP relay uses the real configured Redis protocol/data. Its
  // stopped listener produces a genuine refusal without stopping shared Redis.
  const relay = net.createServer(socket => {
    const upstream = net.connect(Number(target.port || 6379), target.hostname);
    for (const connection of [socket, upstream]) {
      sockets.add(connection);
      connection.on('close', () => sockets.delete(connection));
    }
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve));
  const port = (relay.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => relay.close(error => error ? reject(error) : resolve()));
  const originalUrl = config.redisUrl;
  const relayedUrl = new URL(originalUrl);
  relayedUrl.hostname = '127.0.0.1';
  relayedUrl.port = String(port);
  config.redisUrl = relayedUrl.toString();
  const jti = `auth-recovery-${process.pid}-${Date.now()}`;
  let keyCreated = false;
  try {
    const endedClient = getRedis();
    await assert.rejects(isTokenBlacklisted(jti));
    if (endedClient.status !== 'end') await once(endedClient, 'end');
    assert.equal(endedClient.status, 'end');

    await new Promise<void>((resolve) => relay.listen(port, '127.0.0.1', resolve));
    const recoveredClient = getRedis();
    assert.notEqual(recoveredClient, endedClient, 'next request must replace the terminal client');
    assert.equal(await isTokenBlacklisted(jti), false, 'same endpoint recovers without an API restart');
    await blacklistToken(jti, 60);
    keyCreated = true;
    assert.equal(await isTokenBlacklisted(jti), true, 'real revocation remains enforced after recovery');
  } finally {
    if (keyCreated) await getRedis().del(`blacklist:${jti}`);
    getRedis().disconnect();
    config.redisUrl = originalUrl;
    for (const socket of sockets) socket.destroy();
    if (relay.listening) await new Promise<void>((resolve, reject) => relay.close(error => error ? reject(error) : resolve()));
  }
});
