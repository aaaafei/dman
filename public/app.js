import AvatarPlatform, {
  PlayerEvents,
  SDKEvents,
} from '/sdk/avatar-web-sdk/avatar-sdk-web_3.2.3.1002/esm/index.js';
import {
  advanceBroadcast,
  applyAsr,
  createAsrState,
  createBroadcastState,
  finishBroadcast,
  getAsrDisplayText,
  getBroadcastDisplay,
  interruptBroadcast,
  startBroadcast,
} from './streamText.js';
import { parseSpeechWithActions } from './actionTags.js';
import { MOCK_STREAM_SCRIPTS, chunkForStream, pullCompleteSentences } from './mockStream.js';

const SDK_IMPORT = '/sdk/avatar-web-sdk/avatar-sdk-web_3.2.3.1002/esm/index.js';
const WELCOME_TEXT = '您好[action_wave]，欢迎光临。我可以为您播报信息，也可以识别您说的话。';
const TAG_EXAMPLE_TEXT = '大家好[action_wave]，欢迎光临。这边请看[action_thumbup]。';
const DUPLEX_WAIT_MS = 5000;
const RECORD_MAX_MS = 60 * 1000;
const TYPEWRITER_STEP = 2;
const TYPEWRITER_MS = 48;
const CHAR_MS = 200;
const SCALE_MIN = 0.32;
const SCALE_MAX = 1.85;
const SCALE_STEP = 0.12;
const INTRO_SCALE = 0.42;

const el = {
  wrapper: document.getElementById('avatar-wrapper'),
  stage: document.getElementById('avatar-stage'),
  status: document.getElementById('status'),
  hint: document.getElementById('hint'),
  broadcast: document.getElementById('broadcast-text'),
  asr: document.getElementById('asr-text'),
  start: document.getElementById('btn-start'),
  welcome: document.getElementById('btn-welcome'),
  interrupt: document.getElementById('btn-interrupt'),
  hold: document.getElementById('btn-hold'),
  send: document.getElementById('btn-send'),
  tagExample: document.getElementById('btn-tag-example'),
  input: document.getElementById('input-text'),
  resumeOverlay: document.getElementById('resume-overlay'),
  resume: document.getElementById('btn-resume'),
  actionBar: document.getElementById('action-bar'),
  mockStreamBar: document.getElementById('mock-stream-bar'),
  pageBg: document.getElementById('page-bg'),
  bgSwitch: document.getElementById('bg-switch'),
  zoomIn: document.getElementById('btn-zoom-in'),
  zoomOut: document.getElementById('btn-zoom-out'),
  poseReset: document.getElementById('btn-pose-reset'),
};

let avatar = null;
let recorder = null;
let config = null;
let connected = false;
let speaking = false;
let voiceMode = 'push';
let gotAsr = false;
let duplexTimer = 0;
let typewriterTimer = 0;
let broadcastState = createBroadcastState();
let asrState = createAsrState();
let holding = false;
let releasing = false;
let pendingSpeechActions = [];
let actionTimers = [];
let mockStreamToken = 0;
let mockChunkTimers = [];
let mockActive = false;
let pose = { x: 0, y: 0, scale: INTRO_SCALE };
let introArmed = false;
let introTimer = 0;
let dragging = false;
let dragOrigin = { x: 0, y: 0, px: 0, py: 0 };

function introPose() {
  return { x: 0, y: 0, scale: INTRO_SCALE };
}

function homePose() {
  const height = el.stage?.clientHeight || 640;
  return { x: 0, y: -Math.round(height * 0.22), scale: 1 };
}

function applyPose(animate) {
  if (!el.wrapper) return;
  el.wrapper.classList.toggle('is-animating', !!animate && !dragging);
  el.wrapper.style.setProperty('--dx', `${pose.x}px`);
  el.wrapper.style.setProperty('--dy', `${pose.y}px`);
  el.wrapper.style.setProperty('--scale', String(pose.scale));
}

function clampScale(value) {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Number(value) || INTRO_SCALE));
}

function armIntroPose() {
  if (introTimer) {
    clearTimeout(introTimer);
    introTimer = 0;
  }
  pose = introPose();
  applyPose(false);
  introArmed = true;
}

function playIntroToCenter() {
  if (!introArmed) return;
  introArmed = false;
  introTimer = window.setTimeout(() => {
    introTimer = 0;
    pose = homePose();
    applyPose(true);
  }, 380);
}

function replayIntro() {
  armIntroPose();
  window.requestAnimationFrame(() => {
    introArmed = true;
    playIntroToCenter();
  });
}

function nudgePose(dx, dy) {
  pose = { ...pose, x: pose.x + dx, y: pose.y + dy };
  applyPose(true);
}

function zoomPose(delta) {
  pose = { ...pose, scale: clampScale(pose.scale + delta) };
  applyPose(true);
}

/** 118801001 依丹官方动作名。标签用于播报文本，播报到该处时执行。 */
const ACTION_BUTTONS = [
  { id: 'wave', label: '挥手', cmd: 'A_RH_bye_O' },
  { id: 'intro', label: '介绍', cmd: 'A_LH_introduced_O' },
  { id: 'like', label: '点赞', cmd: 'A_RH_good_O' },
  { id: 'heart', label: '比心', cmd: 'A_RH_like_O' },
  { id: 'ok', label: 'OK', cmd: 'A_RH_ok_O' },
  { id: 'please', label: '有请', cmd: 'A_RH_please_O' },
  { id: 'cheer', label: '加油', cmd: 'A_RH_encourage_O' },
];

function renderMockStreamBar() {
  if (!el.mockStreamBar) return;
  el.mockStreamBar.innerHTML = '';
  MOCK_STREAM_SCRIPTS.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.scriptId = item.id;
    btn.textContent = item.label;
    btn.disabled = !connected;
    el.mockStreamBar.appendChild(btn);
  });
}

function stopMockStream() {
  mockStreamToken += 1;
  mockActive = false;
  mockChunkTimers.forEach((id) => clearTimeout(id));
  mockChunkTimers = [];
}

function delayMs(ms) {
  return new Promise((resolve) => {
    const id = window.setTimeout(resolve, ms);
    mockChunkTimers.push(id);
  });
}

function showStreamDisplay(text) {
  stopTypewriter();
  const value = String(text || '');
  broadcastState = {
    fullText: value,
    revealed: value.length,
    active: true,
    done: false,
  };
  renderBroadcast();
}

async function driveStreamSentence(raw, interruptFirst) {
  const parsed = parseSpeechWithActions(raw);
  const spoken = (parsed.spoken || String(raw || '')).trim();
  if (!spoken || !avatar) return;
  parsed.actions.forEach((item) => {
    const wait = Math.max(120, Number(item.atChars || 0) * CHAR_MS);
    const timer = window.setTimeout(() => {
      if (!avatar || !connected) return;
      avatar.writeCmd('action', item.cmd).catch(() => {});
    }, wait);
    actionTimers.push(timer);
  });
  await avatar.writeText(spoken, {
    nlp: false,
    avatar_dispatch: {
      interactive_mode: interruptFirst ? 1 : 0,
      enable_action_status: 1,
    },
  });
}

async function runMockStream(script) {
  if (!avatar || !connected || !script?.text) return;
  const token = ++mockStreamToken;
  mockActive = true;
  mockChunkTimers.forEach((id) => clearTimeout(id));
  mockChunkTimers = [];
  clearActionTimers();
  try {
    await avatar.interrupt();
  } catch (_) {
    /* ignore */
  }
  showStreamDisplay('');
  setHint(`正在模拟流式：${script.label}（不调大模型）`);

  const chunks = chunkForStream(script.text, 1, 3);
  let buffer = '';
  let arrived = '';
  let firstDrive = true;
  const driveQueue = [];
  let driving = false;

  const pumpDrive = async () => {
    if (driving) return;
    driving = true;
    while (driveQueue.length) {
      const item = driveQueue.shift();
      if (token !== mockStreamToken) {
        driveQueue.length = 0;
        break;
      }
      await driveStreamSentence(item.sentence, item.interruptFirst);
    }
    driving = false;
  };

  for (const chunk of chunks) {
    if (token !== mockStreamToken) return;
    await delayMs(55);
    if (token !== mockStreamToken) return;
    buffer += chunk;
    arrived += chunk;
    const parsedView = parseSpeechWithActions(arrived);
    showStreamDisplay(parsedView.spoken || arrived);
    const flushed = pullCompleteSentences(buffer);
    buffer = flushed.rest;
    for (const sentence of flushed.sentences) {
      driveQueue.push({ sentence, interruptFirst: firstDrive });
      firstDrive = false;
      pumpDrive();
    }
  }
  if (token !== mockStreamToken) return;
  if (buffer.trim()) {
    driveQueue.push({ sentence: buffer, interruptFirst: firstDrive });
    pumpDrive();
  }
  while (driving || driveQueue.length) {
    if (token !== mockStreamToken) return;
    await delayMs(40);
  }
  if (token === mockStreamToken) {
    mockActive = false;
    setHint('模拟流式结束。可再点其他段落，或点打断。');
  }
}

function renderActionBar() {
  if (!el.actionBar) return;
  el.actionBar.innerHTML = '';
  ACTION_BUTTONS.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.actionKey = item.id;
    btn.textContent = item.label;
    btn.disabled = !connected;
    el.actionBar.appendChild(btn);
  });
}

function setStatus(text) {
  el.status.textContent = text;
}

function setHint(text) {
  el.hint.textContent = text;
}

function setConnectedUi(on) {
  connected = on;
  el.welcome.disabled = !on;
  el.interrupt.disabled = !on;
  el.hold.disabled = !on;
  el.send.disabled = !on;
  if (el.tagExample) el.tagExample.disabled = !on;
  el.input.disabled = !on;
  renderActionBar();
  renderMockStreamBar();
}

function actionLabelByName(name) {
  const id = String(name || '');
  const hit = ACTION_BUTTONS.find((item) => item.cmd === id || item.id === id);
  return hit?.label || id;
}

async function playAction(item) {
  if (!avatar || !connected || !item?.cmd) return;
  try {
    await avatar.writeCmd('action', item.cmd);
    setHint(`已发送动作：${item.label}`);
  } catch (err) {
    const { message } = sanitizeError(err);
    setHint(message);
  }
}

function clearActionTimers() {
  actionTimers.forEach((id) => clearTimeout(id));
  actionTimers = [];
  pendingSpeechActions = [];
}

function armSpeechActions(actions) {
  clearActionTimers();
  pendingSpeechActions = Array.isArray(actions) ? actions.slice() : [];
}

function startScheduledActions() {
  const list = pendingSpeechActions;
  pendingSpeechActions = [];
  list.forEach((item) => {
    const delay = Math.max(120, Number(item.atChars || 0) * CHAR_MS);
    const timer = window.setTimeout(() => {
      if (!avatar || !connected) return;
      avatar.writeCmd('action', item.cmd).catch(() => {});
    }, delay);
    actionTimers.push(timer);
  });
}

function sanitizeError(err) {
  const code = err?.code ?? err?.status ?? err?.error_code ?? '';
  let message = String(err?.message ?? err?.msg ?? err ?? 'unknown');
  message = message
    .replace(/authorization=[^&\s]+/gi, 'authorization=***')
    .replace(/api[_-]?secret[^\s]*/gi, 'secret=***');
  if (message.length > 180) message = `${message.slice(0, 180)}…`;
  return { code, message };
}

function explainError(code) {
  const map = {
    10110: '应用配置错误，请检查服务端 appId',
    10113: '认证失败，请检查服务端签名与 UTC 时间',
    10114: '场景不存在或未发布',
    10120: '形象未授权',
    10121: '场景未发布',
    10200: '连接超时，请检查网络',
    10201: '握手失败，请确认生产服务地址',
    11203: '并发路数超限，请先断开再启动',
    20003: '麦克风不可用或权限被拒绝',
    22106: '播报文本无效（空文本不能发给平台）。请用「欢迎播报」或输入文字后再发送。',
    600003: '连到了测试地址，请确认已设置生产 serverUrl',
  };
  return map[String(code)] || '';
}

function renderBroadcast() {
  el.broadcast.textContent = getBroadcastDisplay(broadcastState);
}

function renderAsr() {
  el.asr.textContent = getAsrDisplayText(asrState);
}

function stopTypewriter() {
  if (typewriterTimer) {
    clearInterval(typewriterTimer);
    typewriterTimer = 0;
  }
}

function beginTypewriter(text) {
  stopTypewriter();
  broadcastState = startBroadcast(broadcastState, text);
  renderBroadcast();
  typewriterTimer = window.setInterval(() => {
    broadcastState = advanceBroadcast(broadcastState, TYPEWRITER_STEP);
    renderBroadcast();
    if (broadcastState.done) stopTypewriter();
  }, TYPEWRITER_MS);
}

function showResume(show) {
  el.resumeOverlay.hidden = !show;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`请求失败 ${res.status}`);
  return res.json();
}

function bindPlayerEvents(player) {
  if (!player?.on) return;
  player.on(PlayerEvents.playNotAllowed, () => {
    setHint('浏览器拦截了自动播放，请点击「恢复声音」。');
    showResume(true);
  });
  player.on(PlayerEvents.play, () => {
    setStatus('出画中');
    playIntroToCenter();
  });
  player.on(PlayerEvents.playing, () => {
    setStatus('播放中');
    playIntroToCenter();
  });
}

function bindSdkEvents(instance) {
  instance
    .on(SDKEvents.connected, () => {
      setStatus('已连接');
      setConnectedUi(true);
    })
    .on(SDKEvents.stream_start, () => {
      setStatus('推流开始');
      playIntroToCenter();
    })
    .on(SDKEvents.disconnected, () => {
      setStatus('已断开');
      setConnectedUi(false);
    })
    .on(SDKEvents.error, (err) => {
      const { code, message } = sanitizeError(err);
      const extra = explainError(code);
      setStatus(code ? `错误 ${code}` : '发生错误');
      setHint(extra || message);
      console.warn('SDK error', code, extra || message);
    })
    .on(SDKEvents.frame_start, () => {
      speaking = true;
      startScheduledActions();
    })
    .on(SDKEvents.frame_stop, (data) => {
      if (data?.vmr_status === 2) {
        speaking = false;
        stopTypewriter();
        broadcastState = finishBroadcast(broadcastState);
        renderBroadcast();
      }
    })
    .on(SDKEvents.asr, (data) => {
      gotAsr = true;
      asrState = applyAsr(asrState, data);
      renderAsr();
    })
    .on(SDKEvents.action_start, (data) => {
      const name = data?.name || data?.action_id || '';
      const label = actionLabelByName(name);
      if (label) setHint(`正在做：${label}`);
    })
    .on(SDKEvents.action_stop, () => {
      if (mockActive) return;
      setHint('动作结束。可继续点肢体动作，或发送播报。');
    });
}

async function teardown() {
  stopTypewriter();
  stopMockStream();
  clearActionTimers();
  if (introTimer) {
    clearTimeout(introTimer);
    introTimer = 0;
  }
  if (duplexTimer) {
    clearTimeout(duplexTimer);
    duplexTimer = 0;
  }
  showResume(false);
  speaking = false;
  connected = false;
  voiceMode = 'push';
  holding = false;
  try {
    if (recorder) {
      const rec = recorder.recording || (typeof recorder.isRecording === 'function' && recorder.isRecording());
      if (rec) await recorder.stopRecord();
    }
  } catch (_) {
    /* ignore */
  }
  try {
    avatar?.stop();
  } catch (_) {
    /* ignore */
  }
  try {
    avatar?.destroy();
  } catch (_) {
    /* ignore */
  }
  try {
    avatar?.destroyRecorder?.();
  } catch (_) {
    /* ignore */
  }
  avatar = null;
  recorder = null;
  setConnectedUi(false);
  setStatus('未连接');
}

async function speak(text) {
  const value = String(text || '').trim();
  if (!value || !avatar) return;
  stopMockStream();
  const parsed = parseSpeechWithActions(value);
  const spoken = parsed.spoken || value;
  beginTypewriter(spoken);
  armSpeechActions(parsed.actions);
  if (parsed.skipped.length && !parsed.actions.length) {
    setHint('当前形象没有点头、鼓掌这些动作，可用挥手、点赞、比心。');
  } else if (parsed.skipped.length) {
    setHint('点头、鼓掌当前形象没有对应动作，其余标签会在播报时做动作。');
  }
  await avatar.writeText(spoken, { nlp: false });
}

async function fallbackToPushTalk() {
  voiceMode = 'push';
  if (duplexTimer) {
    clearTimeout(duplexTimer);
    duplexTimer = 0;
  }
  try {
    if (recorder?.recording) await recorder.stopRecord();
  } catch (_) {
    /* ignore */
  }
  setHint('请按住说话识别，或使用文本播报。');
}

async function startSession() {
  el.start.disabled = true;
  console.info('SDK import', SDK_IMPORT);
  setHint('正在连接虚拟人服务…');
  setStatus('正在启动…');
  try {
    await teardown();
    const [cfg, auth] = await Promise.all([
      fetchJson('/api/config'),
      fetchJson('/api/avatar-auth'),
    ]);
    config = cfg;
    if (!auth?.signedUrl || !cfg?.serverUrl) {
      throw new Error('缺少 signedUrl 或 serverUrl');
    }

    avatar = new AvatarPlatform();
    avatar.setApiInfo({
      signedUrl: auth.signedUrl,
      appId: cfg.appId,
      sceneId: cfg.sceneId,
      serverUrl: cfg.serverUrl,
    });
    avatar.setGlobalParams({
      stream: {
        protocol: 'xrtc',
        fps: 25,
        bitrate: 2000,
      },
      avatar: {
        avatar_id: cfg.avatarId,
        width: 720,
        height: 1280,
        // 手写 avatar.stream：原样发送，避开 SDK 对顶层 bitrate 的 /1024
        stream: {
          protocol: 'xrtc',
          fps: 25,
          bitrate: 2000,
          alpha: 1,
        },
      },
      tts: {
        vcn: cfg.vcn,
        speed: 50,
        pitch: 50,
        volume: 50,
      },
      avatar_dispatch: {
        interactive_mode: 1,
        enable_action_status: 1,
      },
      air: {
        air: 1,
      },
    });
    bindSdkEvents(avatar);
    armIntroPose();
    await avatar.start({ wrapper: el.wrapper });
    if (avatar.player) {
      try {
        avatar.player.alpha = true;
      } catch (_) {
        /* player.alpha 不在 d.ts 中，运行时可能存在 */
      }
      bindPlayerEvents(avatar.player);
    }
    recorder = avatar.createRecorder({ sampleRate: 16000 });
    voiceMode = 'push';
    setConnectedUi(true);
    setStatus('已启动');
    setHint('已连接。形象会从底部放大到中间；也可拖动或用「形象位置」调整。');
  } catch (err) {
    const { code, message } = sanitizeError(err);
    setStatus(code ? `启动失败 ${code}` : '启动失败');
    setHint(explainError(code) || message);
    await teardown();
  } finally {
    el.start.disabled = false;
  }
}

async function startPushTalk() {
  if (!recorder || holding || releasing) return;
  if (voiceMode === 'duplex') {
    await fallbackToPushTalk();
  }
  holding = true;
  asrState = createAsrState();
  renderAsr();
  el.hold.classList.add('holding');
  setHint('正在聆听…松开结束（最长 60 秒）');
  try {
    await recorder.startRecord(RECORD_MAX_MS, () => {
      holding = false;
    }, { nlp: false });
  } catch (err) {
    holding = false;
    const { code, message } = sanitizeError(err);
    if (String(code) === '20003' || /NotAllowed|Permission/i.test(message)) {
      setHint('麦克风权限被拒绝，可继续使用文本播报。');
    } else {
      setHint(message);
    }
  }
}

async function stopPushTalk() {
  if (!recorder || releasing) return;
  releasing = true;
  holding = false;
  el.hold.classList.remove('holding');
  try {
    await recorder.stopRecord();
  } catch (_) {
    /* ignore */
  } finally {
    releasing = false;
    setHint('识别结束。可再次按住说话，或发送文本播报。');
  }
}

async function requestMicOrHint() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setHint('当前浏览器不支持麦克风，可使用文本播报。');
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (err) {
    if (err?.name === 'NotAllowedError') {
      setHint('麦克风权限被拒绝，可继续使用文本播报。');
    } else {
      setHint('无法打开麦克风，可继续使用文本播报。');
    }
    return false;
  }
}

el.start.addEventListener('click', () => {
  startSession();
});

el.welcome.addEventListener('click', () => {
  speak(WELCOME_TEXT);
});

el.send.addEventListener('click', () => {
  speak(el.input.value);
});

el.tagExample.addEventListener('click', () => {
  el.input.value = TAG_EXAMPLE_TEXT;
  speak(TAG_EXAMPLE_TEXT);
});

el.interrupt.addEventListener('click', async () => {
  stopTypewriter();
  stopMockStream();
  clearActionTimers();
  broadcastState = interruptBroadcast(broadcastState);
  renderBroadcast();
  speaking = false;
  try {
    await avatar?.interrupt();
  } catch (_) {
    /* 未播报时 interrupt 无效果 */
  }
});

el.actionBar?.addEventListener('click', (event) => {
  const btn = event.target?.closest?.('button[data-action-key]');
  if (!btn) return;
  const item = ACTION_BUTTONS.find((row) => row.id === btn.dataset.actionKey);
  playAction(item);
});

el.hold.addEventListener('pointerdown', async (event) => {
  event.preventDefault();
  if (!connected) return;
  el.hold.setPointerCapture?.(event.pointerId);
  const ok = await requestMicOrHint();
  if (!ok) return;
  await startPushTalk();
});

el.hold.addEventListener('pointerup', () => {
  stopPushTalk();
});

el.hold.addEventListener('pointercancel', () => {
  stopPushTalk();
});

el.resume.addEventListener('click', async () => {
  try {
    await avatar?.player?.resume();
    showResume(false);
    setHint('已尝试恢复声音。');
  } catch (err) {
    const { message } = sanitizeError(err);
    setHint(message);
  }
});

window.addEventListener('beforeunload', () => {
  try {
    if (recorder?.recording) recorder.stopRecord();
  } catch (_) {
    /* ignore */
  }
  try {
    avatar?.stop();
  } catch (_) {
    /* ignore */
  }
  try {
    avatar?.destroy();
  } catch (_) {
    /* ignore */
  }
});

el.zoomIn?.addEventListener('click', () => zoomPose(SCALE_STEP));
el.zoomOut?.addEventListener('click', () => zoomPose(-SCALE_STEP));
el.poseReset?.addEventListener('click', () => {
  replayIntro();
  setHint('正在从底部移到中间并放大。');
});

document.querySelector('.pose-nudge')?.addEventListener('click', (event) => {
  const btn = event.target?.closest?.('button[data-nudge]');
  if (!btn) return;
  const [dx, dy] = String(btn.dataset.nudge || '0,0').split(',').map(Number);
  nudgePose(dx || 0, dy || 0);
});

el.wrapper?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  dragging = true;
  el.wrapper.classList.add('is-dragging');
  el.wrapper.classList.remove('is-animating');
  dragOrigin = { x: pose.x, y: pose.y, px: event.clientX, py: event.clientY };
  el.wrapper.setPointerCapture?.(event.pointerId);
});

el.wrapper?.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  pose = {
    ...pose,
    x: dragOrigin.x + (event.clientX - dragOrigin.px),
    y: dragOrigin.y + (event.clientY - dragOrigin.py),
  };
  applyPose(false);
});

const endDrag = (event) => {
  if (!dragging) return;
  dragging = false;
  el.wrapper?.classList.remove('is-dragging');
  if (event?.pointerId != null) {
    try {
      el.wrapper?.releasePointerCapture?.(event.pointerId);
    } catch (_) {
      /* ignore */
    }
  }
};

el.wrapper?.addEventListener('pointerup', endDrag);
el.wrapper?.addEventListener('pointercancel', endDrag);

el.stage?.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    zoomPose(event.deltaY < 0 ? SCALE_STEP / 2 : -SCALE_STEP / 2);
  },
  { passive: false }
);

el.mockStreamBar?.addEventListener('click', (event) => {
  const btn = event.target?.closest?.('button[data-script-id]');
  if (!btn) return;
  const script = MOCK_STREAM_SCRIPTS.find((row) => row.id === btn.dataset.scriptId);
  runMockStream(script);
});

el.bgSwitch?.addEventListener('click', (event) => {
  const btn = event.target?.closest?.('button[data-scene]');
  if (!btn) return;
  applyScene(btn.dataset.scene);
});

function applyScene(scene) {
  const allowed = ['tech', 'lobby', 'daylight'];
  const next = allowed.includes(scene) ? scene : 'tech';
  if (el.pageBg) el.pageBg.dataset.scene = next;
  el.bgSwitch?.querySelectorAll('button[data-scene]').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.scene === next);
  });
  try {
    localStorage.setItem('dman-scene', next);
  } catch (_) {
    /* ignore */
  }
}

let savedScene = 'tech';
try {
  savedScene = localStorage.getItem('dman-scene') || 'tech';
} catch (_) {
  savedScene = 'tech';
}
applyScene(savedScene);
applyPose(false);

renderActionBar();
renderMockStreamBar();
if (el.input) el.input.value = TAG_EXAMPLE_TEXT;
setStatus('未连接');
setHint('请先点击「启动」。出画后形象会从底部移到中间并放大。');
