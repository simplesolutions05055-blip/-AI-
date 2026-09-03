import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, sameOriginLink } from './security.js';

test('blocks private networks', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
});

test('keeps crawler on official origin', () => {
  assert.equal(sameOriginLink('https://example.com', '/contact'), 'https://example.com/contact');
  assert.equal(sameOriginLink('https://example.com', 'https://evil.test'), null);
});
