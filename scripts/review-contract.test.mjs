import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveReviewStatus } from '../src/lib/review-contract.ts';

test('rejected candidate remains pending, confirmed unmatched is distinct', () => {
  assert.equal(effectiveReviewStatus({ status: 'possible_match', display_status: 'manual_rejected' }), 'possible_match');
  assert.equal(effectiveReviewStatus({ status: 'unmatched', display_status: 'confirmed_unmatched' }), 'unmatched');
  assert.equal(effectiveReviewStatus({ status: 'matched', display_status: 'manual_accepted' }), 'matched');
});
test('authoritative server status wins over stale labels', () => {
  assert.equal(effectiveReviewStatus({ status: 'matched', display_status: 'need_review' }), 'matched');
  assert.equal(effectiveReviewStatus({ status: 'possible_match', display_status: 'manual_accepted' }), 'possible_match');
});
test('legacy badges map explicitly; unsupported states stay unknown', () => {
  assert.equal(effectiveReviewStatus({ display_status: 'manual_rejected' }), 'possible_match');
  assert.equal(effectiveReviewStatus({ display_status: 'auto_matched' }), 'matched');
  assert.equal(effectiveReviewStatus({ status: 'duplicate' }), null);
  assert.equal(effectiveReviewStatus({ status: 'reference_conflict', display_status: 'auto_matched' }), null);
  assert.equal(effectiveReviewStatus({}), null);
  assert.equal(effectiveReviewStatus({ status: 'constructor' }), null);
});
