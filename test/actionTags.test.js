import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSpeechWithActions } from '../public/actionTags.js';

describe('parseSpeechWithActions', () => {
  it('maps [action_wave] to 依丹挥手动作并去掉标签', () => {
    const result = parseSpeechWithActions('大家好[action_wave]，欢迎光临。');
    assert.equal(result.spoken, '大家好，欢迎光临。');
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].cmd, 'A_RH_bye_O');
    assert.equal(result.actions[0].atChars, 3);
  });

  it('maps multiple tags at their spoken offsets', () => {
    const result = parseSpeechWithActions(
      '大家好[action_wave]，欢迎光临。这边请看[action_thumbup]。'
    );
    assert.equal(result.spoken, '大家好，欢迎光临。这边请看。');
    assert.deepEqual(
      result.actions.map((item) => item.cmd),
      ['A_RH_bye_O', 'A_RH_good_O']
    );
    assert.ok(result.actions[1].atChars > result.actions[0].atChars);
  });

  it('accepts engine names in [[action=A_RH_like_O]]', () => {
    const result = parseSpeechWithActions('谢谢[[action=A_RH_like_O]]');
    assert.equal(result.spoken, '谢谢');
    assert.equal(result.actions[0].cmd, 'A_RH_like_O');
  });

  it('records unsupported tags such as nod and clap', () => {
    const result = parseSpeechWithActions('点头[action_nod]鼓掌[action_clap]');
    assert.equal(result.spoken, '点头鼓掌');
    assert.equal(result.actions.length, 0);
    assert.deepEqual(result.skipped, ['nod', 'clap']);
  });
});
