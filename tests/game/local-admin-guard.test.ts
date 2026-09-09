import assert from 'node:assert/strict';
import test from 'node:test';
import { isLocalAdminPath, mustRestrictLocalAdmin } from '../../server/local-admin-guard.js';

const pathname = (value: string) => new URL(value, 'http://local.test').pathname;

test('local admin guard normalizes detail, repeated-slash, and dot-segment admin paths', () => {
  for (const value of ['/api/admin/questions', '/api/admin/questions/q1', '/api//admin/questions', '/api/rooms/../admin/questions']) {
    assert.equal(isLocalAdminPath(pathname(value)), true, value);
    assert.equal(mustRestrictLocalAdmin(pathname(value), '192.168.8.22'), true, value);
  }
});

test('local admin guard trusts only the socket peer, never forwarding headers', () => {
  assert.equal(mustRestrictLocalAdmin('/api/admin/questions', '127.0.0.1'), false);
  assert.equal(mustRestrictLocalAdmin('/api/admin/questions', '::1'), false);
  assert.equal(mustRestrictLocalAdmin('/api/admin/questions', '192.168.8.22'), true);
  assert.equal(mustRestrictLocalAdmin('/api/rooms/room/join', '192.168.8.22'), false);
});
