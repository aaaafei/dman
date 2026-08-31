/**
 * 客户端流式文字纯函数：播报打字机 + ASR 增量合并。
 * 无 DOM、无 SDK，便于 node --test。
 */

export function createBroadcastState() {
  return { fullText: '', revealed: 0, active: false, done: true };
}

export function startBroadcast(_state, fullText) {
  const text = typeof fullText === 'string' ? fullText : '';
  return {
    fullText: text,
    revealed: 0,
    active: true,
    done: text.length === 0,
  };
}

export function advanceBroadcast(state, step = 1) {
  if (!state || !state.active) {
    return state ? { ...state } : createBroadcastState();
  }
  const increment = Number.isFinite(step) ? Math.max(0, Math.floor(step)) : 1;
  const revealed = Math.min(state.fullText.length, (state.revealed || 0) + increment);
  const done = revealed >= state.fullText.length;
  return {
    ...state,
    revealed,
    done,
    active: done ? false : true,
  };
}

export function getBroadcastDisplay(state) {
  if (!state || !state.fullText) return '';
  return state.fullText.slice(0, Math.max(0, state.revealed || 0));
}

export function finishBroadcast(state) {
  const fullText = state?.fullText || '';
  return {
    fullText,
    revealed: fullText.length,
    active: false,
    done: true,
  };
}

export function truncateBroadcast(state, maxLen) {
  const fullText = state?.fullText || '';
  const cap = Number.isFinite(maxLen) ? Math.max(0, Math.floor(maxLen)) : 0;
  const revealed = Math.min(state?.revealed ?? fullText.length, cap, fullText.length);
  return {
    fullText,
    revealed,
    active: false,
    done: revealed >= fullText.length,
  };
}

export function interruptBroadcast(state) {
  if (!state) return createBroadcastState();
  return {
    ...state,
    active: false,
    done: (state.revealed || 0) >= (state.fullText || '').length,
  };
}

export function createAsrState() {
  return { committed: '', partial: '' };
}

function extractAsrText(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.content === 'string') return payload.content;
  if (payload.data && typeof payload.data.text === 'string') return payload.data.text;
  return '';
}

function isAsrFinal(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const type = String(payload.type || payload.status || '').toLowerCase();
  if (type === 'final' || type === 'end' || type === '2') return true;
  if (payload.status === 2) return true;
  if (payload.is_end === true || payload.end === true) return true;
  return false;
}

export function applyAsr(state, payload) {
  const current = state && typeof state === 'object' ? state : createAsrState();
  const text = extractAsrText(payload);
  if (!text) return { committed: current.committed || '', partial: current.partial || '' };

  if (isAsrFinal(payload)) {
    return {
      committed: `${current.committed || ''}${text}`,
      partial: '',
    };
  }

  return {
    committed: current.committed || '',
    partial: text,
  };
}

export function getAsrDisplayText(state) {
  if (!state) return '';
  return `${state.committed || ''}${state.partial || ''}`;
}

export function resetAsr() {
  return createAsrState();
}
