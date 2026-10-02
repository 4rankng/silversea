// Mount-site material-write declarations (card 20260930_230, chunk 1).
// The declaration travels with the mount and is self-contained (express 5
// hides a route's HTTP verb and mount prefix from middleware, so the marker
// carries method + full path explicitly). declareMaterialWrite registers its
// registry rule at import time — no walk needed for matching;
// installGeneratedMaterialWriteRules(app) walks only to ASSERT that every
// mounted write route declares something or rides a legacy-bridged router.
// These pins hold that contract on fixture routers — no DB, no app entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express, { type RequestHandler } from 'express';

import {
  declareMaterialWrite,
  declareNonMaterialWrite,
  installGeneratedMaterialWriteRules,
  legacyMaterialWriteRegistry,
  matchDeclaredMaterialWrite,
} from '../../middleware/material-write';

const echo: RequestHandler = (_req, res) => { res.json({ ok: true }); };

test('a declared write route registers a rule matched by method and path — no install needed', () => {
  declareMaterialWrite('unit-test.things.seal', { method: 'POST', path: '/api/unit-test/things/:id/seal' });
  const match = matchDeclaredMaterialWrite('POST', '/api/unit-test/things/42/seal');
  assert.ok(match, 'the declaration alone must register a matchable rule');
  assert.equal(match?.endpoint, 'unit-test.things.seal');
  assert.equal(match?.path, '/api/unit-test/things/42/seal');
  // The :param segment accepts any single-segment id but nothing deeper, and
  // the method must agree — a PUT to the same path is not this rule.
  assert.ok(matchDeclaredMaterialWrite('POST', '/api/unit-test/things/abc-9/seal'));
  assert.equal(matchDeclaredMaterialWrite('POST', '/api/unit-test/things/42/seal/extra'), null);
  assert.equal(matchDeclaredMaterialWrite('PUT', '/api/unit-test/things/42/seal'), null);
  assert.equal(matchDeclaredMaterialWrite('GET', '/api/unit-test/things/42/seal'), null, 'reads are never material writes');
});

test('canonicalAliases ride the registered rule', () => {
  declareMaterialWrite('unit-test.things.voucher', {
    method: 'POST',
    path: '/api/unit-test/things/vouchers',
    canonicalAliases: ['payments.receive', 'payments.vendor'],
  });
  assert.deepEqual(
    matchDeclaredMaterialWrite('POST', '/api/unit-test/things/vouchers')?.canonicalAliases,
    ['payments.receive', 'payments.vendor'],
  );
});

test('an undeclared write route fails the install walk, named by method and router path', () => {
  const app = express();
  const router = express.Router();
  router.post('/:id/lock', echo);
  app.use('/api/things', router);
  assert.throws(
    () => installGeneratedMaterialWriteRules(app),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /POST \(router path \/:id\/lock\).*declareMaterialWrite/s);
      return true;
    },
  );
});

test('declareNonMaterialWrite excuses the route without registering a rule', () => {
  const app = express();
  const router = express.Router();
  router.post('/:id/read-marker', declareNonMaterialWrite('Per-user read marker; replay-safe.'), echo);
  app.use('/api/things', router);
  installGeneratedMaterialWriteRules(app);
  assert.equal(matchDeclaredMaterialWrite('POST', '/api/things/7/read-marker'), null);
});

test('a legacy-flagged router passes the walk — its rows still live in the hand-written registry', () => {
  const app = express();
  const router = express.Router();
  router.use(legacyMaterialWriteRegistry());
  router.post('/:id', echo);
  router.delete('/:id', echo);
  app.use('/api/things', router);
  installGeneratedMaterialWriteRules(app);
});

test('a declared route on an app also passes the walk, and install is idempotent per app', () => {
  const app = express();
  const router = express.Router();
  router.put('/:id', declareMaterialWrite('unit-test.things.update', { method: 'PUT', path: '/api/unit-test/things-2/:id' }), echo);
  app.use('/api/things-2', router);
  installGeneratedMaterialWriteRules(app);
  installGeneratedMaterialWriteRules(app);
  assert.equal(matchDeclaredMaterialWrite('PUT', '/api/unit-test/things-2/9')?.endpoint, 'unit-test.things.update');
});

test('nested routers are walked through their stacks', () => {
  const app = express();
  const inner = express.Router();
  inner.delete('/:id', declareMaterialWrite('unit-test.things.nested.delete', { method: 'DELETE', path: '/api/unit-test/inner/:id' }), echo);
  const outer = express.Router();
  outer.use('/inner', inner);
  app.use('/api', outer);
  installGeneratedMaterialWriteRules(app);
  assert.equal(matchDeclaredMaterialWrite('DELETE', '/api/unit-test/inner/3')?.endpoint, 'unit-test.things.nested.delete');
});

test('marker constructors refuse values that would silently break the registry', () => {
  assert.throws(() => declareMaterialWrite('', { method: 'POST', path: '/api/x' }), /non-empty/);
  assert.throws(() => declareMaterialWrite('x', { method: 'GET' as 'POST', path: '/api/x' }), /POST\/PUT\/PATCH\/DELETE/);
  assert.throws(() => declareMaterialWrite('x', { method: 'POST', path: '/things/:id' }), /FULL request path/);
  assert.throws(() => declareNonMaterialWrite(''), /non-empty/);
});
