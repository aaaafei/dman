/**
 * 模拟大模型流式吐字：按块拆分、按句冲刷。不调用 NLP。
 */

export const MOCK_STREAM_SCRIPTS = [
  {
    id: 'welcome',
    label: '流式·欢迎',
    text: '您好[action_wave]，欢迎光临。我是智能客服小依。请问需要了解产品、价格，还是售后服务？',
  },
  {
    id: 'product',
    label: '流式·产品介绍',
    text: '这款服务支持实时语音识别和文本播报。您可以按住说话，也可以直接输入文字。形象支持透明背景，可以叠加在不同场景上。需要的话，我可以再介绍办理流程。',
  },
  {
    id: 'process',
    label: '流式·办理流程',
    text: '好的，我来说明办理流程。第一，请准备好身份证件。第二，在柜台或线上提交申请。第三，等待审核，一般一到两个工作日。如果材料齐全，当天就可以完成。还有其他问题随时问我。',
  },
];

const TAG_RE = /\[[^\]]+\]/g;
const SENTENCE_RE = /.*?[。！？!?;；\n]/gs;

export function chunkForStream(text, minSize = 1, maxSize = 3) {
  const source = String(text || '');
  const chunks = [];
  let i = 0;
  const lo = Math.max(1, minSize);
  const hi = Math.max(lo, maxSize);
  while (i < source.length) {
    if (source[i] === '[') {
      const close = source.indexOf(']', i);
      if (close >= 0) {
        chunks.push(source.slice(i, close + 1));
        i = close + 1;
        continue;
      }
    }
    const size = lo + Math.floor(Math.random() * (hi - lo + 1));
    chunks.push(source.slice(i, i + size));
    i += size;
  }
  return chunks;
}

export function pullCompleteSentences(buffer) {
  const source = String(buffer || '');
  const sentences = [];
  SENTENCE_RE.lastIndex = 0;
  let last = 0;
  let match = SENTENCE_RE.exec(source);
  while (match) {
    sentences.push(match[0]);
    last = match.index + match[0].length;
    match = SENTENCE_RE.exec(source);
  }
  return { sentences, rest: source.slice(last) };
}

export function stripTagsForDisplay(text) {
  return String(text || '')
    .replace(TAG_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([，。！？,.!?])/g, '$1')
    .trim();
}
