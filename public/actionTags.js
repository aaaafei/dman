/** 播报标签 → 118801001 依丹官方动作名。平台不会执行 [action_wave] 这类别名。 */
export const TAG_ALIAS_TO_CMD = {
  wave: 'A_RH_bye_O',
  hello: 'A_RH_bye_O',
  heart: 'A_RH_like_O',
  thumbup: 'A_RH_good_O',
  like: 'A_RH_good_O',
  ok: 'A_RH_ok_O',
  intro: 'A_LH_introduced_O',
  please: 'A_RH_please_O',
  cheer: 'A_RH_encourage_O',
  打招呼: 'A_RH_bye_O',
  拜拜: 'A_RH_bye_O',
  左手点赞: 'A_RH_good_O',
  右手点赞: 'A_RH_good_O',
  双手比心: 'A_RH_like_O',
  展开双手: 'A_LH_introduced_O',
};

const TOKEN_RE =
  /\[action_([a-z0-9_]+)\]|\[\[action=([A-Za-z0-9_]+)\]\]|\[action=([A-Za-z0-9_]+)\]|\[(打招呼|鞠躬|左手点赞|右手点赞|双手比心|拜拜|展开双手|聆听点头)\]/gi;

function resolveCmd(alias, engineName) {
  if (engineName && /^A_[A-Za-z0-9_]+$/.test(engineName)) return engineName;
  const key = String(alias || '').toLowerCase();
  return TAG_ALIAS_TO_CMD[alias] || TAG_ALIAS_TO_CMD[key] || '';
}

export function parseSpeechWithActions(text) {
  const source = String(text || '');
  const actions = [];
  const skipped = [];
  let spoken = '';
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let match = TOKEN_RE.exec(source);
  while (match) {
    spoken += source.slice(lastIndex, match.index);
    const alias = match[1] || match[4] || '';
    const engine = match[2] || match[3] || '';
    const cmd = resolveCmd(alias, engine);
    if (cmd) {
      actions.push({ cmd, atChars: spoken.length, label: alias || engine });
    } else {
      skipped.push(alias || engine || match[0]);
    }
    lastIndex = match.index + match[0].length;
    match = TOKEN_RE.exec(source);
  }
  spoken += source.slice(lastIndex);
  spoken = spoken.replace(/\s{2,}/g, ' ').replace(/\s+([，。！？,.!?])/g, '$1').trim();
  return { spoken, actions, skipped };
}
