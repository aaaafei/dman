import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advanceBroadcast,
  applyAsr,
  createAsrState,
  createBroadcastState,
  finishBroadcast,
  getAsrDisplayText,
  getBroadcastDisplay,
  interruptBroadcast,
  resetAsr,
  startBroadcast,
  truncateBroadcast,
} from '../public/streamText.js';

describe('broadcast typewriter', () => {
  it('starts from empty and reveals nothing until advanced', () => {
    const started = startBroadcast(createBroadcastState(), '你好世界');
    assert.equal(getBroadcastDisplay(started), '');
    assert.equal(started.active, true);
    assert.equal(started.fullText, '你好世界');
  });

  it('advances by concatenating revealed characters', () => {
    let state = startBroadcast(createBroadcastState(), '播报文本');
    state = advanceBroadcast(state, 2);
    assert.equal(getBroadcastDisplay(state), '播报');
    state = advanceBroadcast(state, 2);
    assert.equal(getBroadcastDisplay(state), '播报文本');
    assert.equal(state.done, true);
  });

  it('clamps reveal count so it never exceeds full text', () => {
    let state = startBroadcast(createBroadcastState(), '短');
    state = advanceBroadcast(state, 99);
    assert.equal(getBroadcastDisplay(state), '短');
    assert.equal(state.revealed, 1);
    assert.equal(state.done, true);
  });

  it('truncates the visible broadcast text', () => {
    let state = startBroadcast(createBroadcastState(), '欢迎光临本店');
    state = finishBroadcast(state);
    state = truncateBroadcast(state, 4);
    assert.equal(getBroadcastDisplay(state), '欢迎光临');
    assert.equal(state.active, false);
  });

  it('interrupt keeps currently revealed text and stops advancing', () => {
    let state = startBroadcast(createBroadcastState(), 'ABCDEFG');
    state = advanceBroadcast(state, 3);
    state = interruptBroadcast(state);
    assert.equal(getBroadcastDisplay(state), 'ABC');
    assert.equal(state.active, false);
    const frozen = advanceBroadcast(state, 10);
    assert.equal(getBroadcastDisplay(frozen), 'ABC');
  });

  it('finishBroadcast shows the full text and marks inactive', () => {
    let state = startBroadcast(createBroadcastState(), '结束对齐');
    state = finishBroadcast(state);
    assert.equal(getBroadcastDisplay(state), '结束对齐');
    assert.equal(state.active, false);
    assert.equal(state.done, true);
  });

  it('empty or missing text is safe', () => {
    const empty = startBroadcast(createBroadcastState(), '');
    assert.equal(getBroadcastDisplay(advanceBroadcast(empty, 3)), '');
    const missing = startBroadcast(createBroadcastState(), undefined);
    assert.equal(getBroadcastDisplay(missing), '');
  });
});

describe('ASR merge', () => {
  it('partial results overwrite the current partial, not the committed text', () => {
    let state = createAsrState();
    state = applyAsr(state, { text: '你', type: 'partial' });
    assert.equal(getAsrDisplayText(state), '你');
    state = applyAsr(state, { text: '你好', type: 'partial' });
    assert.equal(getAsrDisplayText(state), '你好');
    assert.equal(state.committed, '');
    assert.equal(state.partial, '你好');
  });

  it('final results commit text and clear partial', () => {
    let state = createAsrState();
    state = applyAsr(state, { text: '你好世', type: 'partial' });
    state = applyAsr(state, { text: '你好世界', type: 'final' });
    assert.equal(state.partial, '');
    assert.equal(state.committed, '你好世界');
    assert.equal(getAsrDisplayText(state), '你好世界');
  });

  it('concatenates successive finals without duplicating the last partial', () => {
    let state = createAsrState();
    state = applyAsr(state, { text: '第一句', type: 'final' });
    state = applyAsr(state, { text: '第二句', type: 'final' });
    assert.equal(getAsrDisplayText(state), '第一句第二句');
  });

  it('accepts a bare string as partial text', () => {
    const state = applyAsr(createAsrState(), '按住说话');
    assert.equal(getAsrDisplayText(state), '按住说话');
    assert.equal(state.partial, '按住说话');
  });

  it('treats status=2 or is_end as final', () => {
    let state = applyAsr(createAsrState(), { text: '定稿', status: 2 });
    assert.equal(state.committed, '定稿');
    state = applyAsr(createAsrState(), { text: '也定稿', is_end: true });
    assert.equal(state.committed, '也定稿');
  });

  it('ignores empty payloads', () => {
    const original = createAsrState();
    assert.deepEqual(applyAsr(original, null), original);
    assert.deepEqual(applyAsr(original, {}), original);
    assert.deepEqual(applyAsr(original, { type: 'partial' }), original);
  });

  it('resetAsr clears both committed and partial', () => {
    let state = applyAsr(createAsrState(), { text: '残留', type: 'final' });
    state = applyAsr(state, { text: '中间', type: 'partial' });
    state = resetAsr();
    assert.equal(getAsrDisplayText(state), '');
    assert.equal(state.committed, '');
    assert.equal(state.partial, '');
  });
});
