import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chunkForStream,
  pullCompleteSentences,
  stripTagsForDisplay,
} from '../public/mockStream.js';

describe('mock stream helpers', () => {
  it('keeps action tags as whole chunks', () => {
    const chunks = chunkForStream('您好[action_wave]，欢迎。', 1, 1);
    assert.ok(chunks.includes('[action_wave]'));
    assert.equal(chunks.join(''), '您好[action_wave]，欢迎。');
  });

  it('pulls complete sentences and leaves a partial rest', () => {
    const { sentences, rest } = pullCompleteSentences('第一句。第二句还没');
    assert.deepEqual(sentences, ['第一句。']);
    assert.equal(rest, '第二句还没');
  });

  it('returns leftover when there is no sentence end', () => {
    const { sentences, rest } = pullCompleteSentences('还在生成');
    assert.deepEqual(sentences, []);
    assert.equal(rest, '还在生成');
  });

  it('strips tags from display text', () => {
    assert.equal(stripTagsForDisplay('您好[action_wave]，欢迎。'), '您好，欢迎。');
  });
});
