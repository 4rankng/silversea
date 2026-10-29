import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZodError, z } from 'zod';
import { globalErrorHandler } from '../../middleware/errorHandler';

/** Regression pin (zod v3 → v4 bump): the global handler must read `.issues`
 *  — v4 removed the `.errors` alias, and reading it yielded undefined, so
 *  every parse-thrown route degraded to the generic "Dữ liệu không hợp lệ"
 *  400 with the details array dropped entirely. */
interface ZodIssueDetails {
  code?: string;
  message: string;
  path: Array<string | number>;
}

interface ErrorResponseBody {
  error: string;
  details?: ZodIssueDetails[];
}

interface MockResponse {
  statusCode: number;
  body: ErrorResponseBody | undefined;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
}

function respond(): MockResponse {
  const res: MockResponse = {
    statusCode: 0,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload as ErrorResponseBody;
      return this;
    },
  };
  return res;
}

test('globalErrorHandler surfaces zod v4 issues with path-labelled message and JSON-safe details', () => {
  const schema = z.object({ expectedVersion: z.number().int(), note: z.string().min(1) });
  let caught: unknown;
  try {
    schema.parse({ expectedVersion: 'abc', note: '' });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ZodError);

  const res = respond();
  globalErrorHandler(caught as ZodError, {} as Parameters<typeof globalErrorHandler>[1], res as never, (() => undefined) as never);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body, 'the handler must answer with a JSON body');
  // The first issue's message must surface (with its path label) — not the
  // generic fallback that the broken `.errors` read produced.
  assert.match(res.body.error, /Invalid input/);
  assert.match(res.body.error, /expectedVersion/);

  assert.ok(Array.isArray(res.body.details));
  assert.equal(res.body.details.length, 2);
  assert.deepEqual(res.body.details.map((issue) => issue.path), [
    ['expectedVersion'],
    ['note'],
  ]);
  for (const issue of res.body.details) {
    assert.equal(typeof issue.message, 'string');
    assert.ok(Array.isArray(issue.path));
    assert.equal(issue.path.filter((segment) => typeof segment === 'symbol').length, 0);
  }
});
