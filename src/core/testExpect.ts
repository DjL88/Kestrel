/**
 * A tiny `expect` for tests written in the Vitest/Jest style, running on Node's own test runner (`node:test`),
 * which is what `npm test` uses. Import `describe`/`it` from 'node:test' and `expect` from here; never from 'vitest'
 * (it is not a dependency, and such files fail to load).
 */
import assert from 'node:assert/strict';
import { it as nodeIt } from 'node:test';

function matchers(actual: unknown, negate: boolean) {
  const check = (pass: () => void) => {
    if (!negate) return pass();
    let passed = true;
    try { pass(); } catch { passed = false; }
    if (passed) assert.fail(`expected not to match: ${JSON.stringify(actual)}`);
  };
  return {
    toBe: (expected: unknown) => check(() => assert.equal(actual, expected)),
    toEqual: (expected: unknown) => check(() => assert.deepEqual(actual, expected)),
    toStrictEqual: (expected: unknown) => check(() => assert.deepStrictEqual(actual, expected)),
    toBeNull: () => check(() => assert.equal(actual, null)),
    toBeUndefined: () => check(() => assert.equal(actual, undefined)),
    toBeTruthy: () => check(() => assert.ok(actual)),
    toBeFalsy: () => check(() => assert.ok(!actual)),
    toHaveLength: (length: number) => check(() => assert.equal((actual as { length: number }).length, length)),
    toContain: (item: unknown) => check(() => assert.ok((actual as unknown[] | string).includes(item as never))),
    toMatchObject: (expected: Record<string, unknown>) => check(() => {
      for (const [key, value] of Object.entries(expected)) assert.deepEqual((actual as Record<string, unknown>)[key], value, key);
    }),
    toThrow: () => check(() => assert.throws(actual as () => unknown)),
  };
}

const messageMatches = (error: unknown, expected?: string | RegExp) => {
  if (expected === undefined) return;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof expected === 'string') assert.ok(message.includes(expected), `"${message}" does not include "${expected}"`);
  else assert.match(message, expected);
};

export function expect(actual: unknown) {
  return {
    ...matchers(actual, false),
    not: matchers(actual, true),
    /** `await expect(promise).rejects.toThrow('reason')` */
    rejects: {
      toThrow: async (expected?: string | RegExp) => {
        let failed = false;
        try { await (typeof actual === 'function' ? (actual as () => unknown)() : actual); } catch (error) { failed = true; messageMatches(error, expected); }
        assert.ok(failed, 'expected the promise to reject');
      },
    },
    /** `await expect(promise).resolves.toEqual(value)` */
    resolves: {
      toBe: async (expected: unknown) => assert.equal(await actual, expected),
      toEqual: async (expected: unknown) => assert.deepEqual(await actual, expected),
    },
  };
}

type Row = unknown;
const label = (name: string, row: Row, index: number) => {
  const values = Array.isArray(row) ? row : [row];
  let used = 0;
  let text = name.replace(/%[sidfjpo#%]/g, (token) => (token === '%%' ? '%' : token === '%#' ? String(index) : String(values[used++])));
  if (row && typeof row === 'object' && !Array.isArray(row)) text = text.replace(/$(w+)/g, (_, key) => String((row as Record<string, unknown>)[key]));
  return text === name ? `${name} [${index}]` : text;
};

/** `it` from node:test, plus `it.each(table)(name, fn)` as in Vitest. */
export const it = Object.assign(nodeIt, {
  each: (table: readonly Row[]) => (name: string, fn: (...args: never[]) => unknown) => {
    table.forEach((row, index) => (nodeIt as (name: string, fn: () => unknown) => unknown)(label(name, row, index), () => (fn as (...args: unknown[]) => unknown)(...(Array.isArray(row) ? row : [row]))));
  },
});
