# 实现计划：Web 虚拟人客服（播报 + ASR，无 NLP）

## 元信息
- 创建时间：2026-08-29 11:40
- 设计文档：`D:\demo\dman\avatar-integration-spec.md`
- 权威 playbook（HARD-GATE，必须先读再写）：`skills/avatar-executing/references/web-sdk-build-playbook.md`
- 项目路径：`D:\demo\dman`
- 平台：Web
- 实施类型：首次接入（`scope=full`）
- 预计工时：3 小时
- 风险等级：中（无大模型授权；全双工可能未开通；透明背景双重配置）

---

## 目标概述

在空工程 `D:\demo\dman` 上，按 **web-sdk-build-playbook.md** 六步构建可运行的 Web 客服虚拟人：形象透明叠加、文本播报、麦克风 ASR 上屏、打断、AIR 自动动作、客户端流式文字。账号仅有接口能力（appType=1），**本期不做 NLP / 大模型问答**。架构必须是 **Node Express 后端 HMAC 签名 + `public/` 静态前端**，`apiKey` / `apiSecret` 禁止进入前端。

实施入口只能是 **avatar-executing**。禁止主 agent 手写绕过 playbook（否则会踩 bitrate/1024、漏 `avatar.stream`、前端泄露密钥、或发明 `createStreamPlayer` / `sendText` 等不存在的 API）。

---

## 前置条件
- [x] 凭据 `.env` 已存在（Layer 1 PASS）
- [x] avatarId `118801001`、vcn `x4_lingxiaoqi_oral` 已授权（Layer 2 PASS）
- [x] Node.js v18.20.6 / npm 8.19.4（Layer 5 PASS）
- [ ] SDK 尚未下载（Layer 3 延后到 executing，由 `avatar-artifact-download` 执行）
- [ ] 最小链路浏览器验证（Layer 6 延后到工程生成后）

凭据（非密钥，写入代码时从 `.env` 读取，禁止写死 secret）：

| 变量 | 值 |
|------|-----|
| `XF_APP_ID` | `782a5949` |
| `XF_SCENE_ID` | `351920069200187392` |
| `XF_AVATAR_ID` | `118801001`（标准形象，禁止 cnr 超拟人） |
| `XF_VCN` | `x4_lingxiaoqi_oral` |
| `XF_WS_URL` | `wss://avatar.cn-huadong-1.xf-yun.com/v1/interact` |
| `XF_API_KEY` / `XF_API_SECRET` | 仅后端读取，禁止出现在 `public/` |

---

## Playbook 六步映射（执行顺序 HARD-GATE）

avatar-executing **必须按 playbook §2 的 1→6 顺序落地**，本文 8 步是同一条链路的切片，不是另一套流程。

| Playbook §2 | 本文步骤 | 产出 |
|-------------|----------|------|
| Step 1 确认凭据就绪 | Step 2 前置 + 核对 `.env` | 6 项凭据 + `XF_WS_URL` |
| Step 2 下载 SDK | **Step 1** | `sdk/.../esm/index.js` |
| Step 3 生成后端 `server.js` | **Step 3** | HMAC + `/api/avatar-auth` + 静态托管 |
| Step 4 生成前端 `app.js` | **Step 3 后半 + Step 4–7** | `setApiInfo` / 锁定表 / `start` / 业务 API |
| Step 5 生成 HTML/CSS + `package.json` | **Step 2** | 可 `npm install` 的骨架 |
| Step 6 启动 + 浏览器端到端 | **Step 6 + Step 8** | connected → 首帧 → 功能清单全绿 |

**真实 Web API 白名单**（只允许这些，对照 playbook / SDK 约定，禁止发明）：

`AvatarPlatform` · `setApiInfo` · `setGlobalParams` · `avatar.on(SDKEvents.*)` · `avatar.start({ wrapper })` · `avatar.player` · `player.alpha` · `player.resume()` · `PlayerEvents.playNotAllowed` · `writeText` · `writeCmds` · `interrupt` · `createRecorder` · `startRecord` · `stopRecord` · `avatar.stop` · `avatar.destroy`

**API 黑名单**（写完必须 grep 零命中）：`createStreamPlayer` · `sendText` · `onNlpResult` · `onAsrResult` · `onAvatarReady(`（方法） · `writeAudioFrame` · `startAudioInteract` · `createPlayer` 作为独立工厂（播放器由 `start({ wrapper })` 创建）

---

## 可并行任务

仅当**互不依赖且不写同一文件**时并行（见 `shared/dispatching-parallel-agents`）：

| 并行组 | 任务 A | 任务 B | 条件 |
|--------|--------|--------|------|
| P1 | Step 3：`server.js` | Step 2：`package.json` + `public/index.html` + `public/style.css` | Playbook 1–2 已完成；不改同一文件 |
| P2 | `public/streamText.js` 纯函数 + 单测 | Step 2 HTML 文案/布局 | 不写 `app.js`；TDD **仅此纯函数** |

**不可并行**：`public/app.js` 依赖 HTML 元素 id、`/api/*` 契约、SDK ESM 路径，必须在 P1 完成后写。SDK 下载与签名后端不可并行于「尚未确认 `.env`」。

**TDD 范围（HARD-GATE）**：只对客户端流式文字拼接/截断纯函数做先测后写（`node --test`）。SDK 初始化、`writeText`、录音、XRTC **不做 TDD**，走运行时验证。HMAC 签名不做单测提交（避免密钥进仓库）；用 curl 验证 signedUrl 形态即可。

---

## 强制架构（playbook §1）

```
D:\demo\dman\
├── server.js              # Express：HMAC 签名 + 静态托管 + 非敏感配置
├── package.json           # "type": "module"；express + dotenv
├── .env                   # 已存在，已在 .gitignore
├── .gitignore             # 已含 .env / node_modules / sdk / *.log
├── public/
│   ├── index.html
│   ├── app.js             # 只拿 signedUrl，永远看不到 apiSecret
│   ├── streamText.js      # 流式文字纯函数（唯一 TDD 对象）
│   └── style.css
└── sdk/                   # avatar-sdk-web_3.2.3.1002（artifact-download）
```

Express 同时托管 `public/` 与 `sdk/`，前端用 ESM `import` SDK，禁止把密钥写进 HTML/JS。

---

## 实施步骤

### Step 1: SDK 安装与引入

**Playbook 映射**: §2 Step 2（下载 SDK）；前置完成 §2 Step 1（凭据核对）

**目标**: 将 `avatar-sdk-web_3.2.3.1002` 落到本仓库，前端能以 ESM 导入真实 `index.js`。

**预计时间**: 20 分钟

**前置**:
- [x] `.env` 六项 + `XF_WS_URL` 已存在
- [ ] executing 已 Read playbook 全文（197 行）
- [ ] 调用 `avatar-artifact-download`，不要手搓 SDK

**操作**:
1. 核对 `.env` 含：`XF_APP_ID` / `XF_API_KEY` / `XF_API_SECRET` / `XF_SCENE_ID` / `XF_AVATAR_ID` / `XF_VCN` / `XF_WS_URL`。缺项则停，回到 `avatar-credentials`。
2. 调用 `avatar-artifact-download`，目标目录 `D:\demo\dman\sdk\`，版本 `3.2.3.1002`。
3. 确认关键文件存在：`sdk/**/esm/index.js`（playbook 验证点）。
4. 前端最终按实际解压路径 ESM 导入，例如：
   ```javascript
   import AvatarPlatform, { SDKEvents, PlayerEvents } from '/sdk/avatar-sdk-web_3.2.3.1002/esm/index.js';
   ```
   实际子目录以下载结果为准，禁止猜路径。
5. `.gitignore` 已忽略 `sdk/`，不要把 SDK 提交进 git。

**产出**:
- 目录：`D:\demo\dman\sdk\`
- 内容：Web SDK ESM 包，含 `index.js`

**验证**:
- [ ] `sdk/**/esm/index.js` 文件存在
- [ ] 浏览器或 Node 能解析该模块（无 404）
- [ ] 未把 SDK 拷进 `public/` 导致重复与密钥误放

**风险**:
- OSS 下载失败 → 按 artifact-download 引导官网手动下载，禁止用错误版本替代
- ESM 路径写错 → 页面白屏 / MIME 错误；Express 必须 `express.static('sdk')` 挂到 `/sdk`

**回滚**: 删除不完整的 `sdk/` 目录，重新走 `avatar-artifact-download`。

**⚠️ 虚拟人陷阱**:
- SDK 是 ESM，必须 `<script type="module">` 或 `import`，禁止普通 `<script src>` 当 UMD 用
- 不要阅读 `index.d.ts` 来猜 `setGlobalParams` 结构；以 playbook §0/§3 反编译结论为准

---

### Step 2: 环境配置

**Playbook 映射**: §2 Step 1（凭据）+ Step 5（`package.json` + HTML/CSS）

**目标**: 形成可 `npm install` / `node server.js` 的工程骨架；开发环境满足 localhost 麦克风与 HTTPS 约束。

**预计时间**: 20 分钟

**前置**: Step 1 SDK 路径已知（导入语句可先占位，HTML 不依赖 SDK 文件内容）

**可并行**: 本步的 `package.json` / `public/index.html` / `public/style.css` 可与 Step 3 的 `server.js` 并行（P1）。

**操作**:
1. 生成 `package.json`：
   - `"type": "module"`
   - `"start": "node server.js"`
   - `"test": "node --test"`（仅给流式文字纯函数）
   - 依赖：`express`、`dotenv`。**不使用 Vite/Webpack**。
2. 确认 `.gitignore` 含 `.env`、`node_modules/`、`sdk/`、`*.log`（已存在则不要改掉）。
3. 生成 `public/index.html` + `public/style.css`：
   - 虚拟人容器 `.avatar-wrapper`（给 `start({ wrapper })`），`background: transparent`
   - 页面背景可见（用于验证透明叠加）
   - 流式文字区：播报区 +「用户说了」ASR 区（独立 DOM，不用云端字幕）
   - 按钮：启动、欢迎播报、文本输入+发送、按住说话、打断、欢迎挥手（独立动作预留）
   - UI 文案标明「播报 + 语音识别」，**不要**出现「智能问答」
4. 开发约定：用 `http://localhost:<port>`；生产必须 HTTPS。无 Vite，无 `VITE_*` 把密钥暴露到前端。
5. `npm install` 成功。

**产出**:
- 文件：`package.json`、`public/index.html`、`public/style.css`
- 内容：静态壳 + 透明画布容器 + 客服操作区

**验证**:
- [ ] `npm install` 无报错
- [ ] HTML 含 wrapper、播报区、ASR 区、打断按钮
- [ ] 前端文件 grep 不到 `apiSecret` / `XF_API_SECRET` / `apiKey`

**风险**:
- 容器无尺寸 → 出画异常；给 wrapper 明确宽高（如 720×1280 的显示缩放）
- 把密钥写进 HTML data 属性 → 泄露

**回滚**: 删除本步新增的 `package.json` / `public/` 骨架文件；保留 `.env`。

**⚠️ 虚拟人陷阱**:
- 录音必须 localhost 或 HTTPS，否则 `navigator.mediaDevices` 不可用
- 透明背景容器 CSS 必须 `background: transparent`，否则看起来像「没透」

---

### Step 3: SDK 初始化（服务端签名 + setApiInfo）

**Playbook 映射**: §2 Step 3（`server.js`）+ §4 初始化顺序第 1–2 步

**目标**: 后端用 HMAC-SHA256 下发一次性 `signedUrl`；前端 `setApiInfo` **不传** `apiKey` / `apiSecret`，并显式设置生产 `serverUrl`。

**预计时间**: 30 分钟

**前置**: Step 1 SDK 已下载；`.env` 可读。可与 Step 2 并行写 `server.js`（P1）。

**操作**:

1. 实现 `server.js`（ESM）：
   - `dotenv.config()` 只在服务端读环境变量
   - `GET /api/config`：返回 `{ appId, sceneId, avatarId, vcn, serverUrl }`，**禁止**返回 apiKey/apiSecret
   - `GET /api/avatar-auth`：返回 `{ signedUrl }`
   - `express.static('public')` + 将 `sdk/` 挂到 `/sdk`
2. 签名实现（对照 `avatar-webapi-protocol/references/auth.md`，Node `crypto`，禁止把这段放到 `public/`）：

```javascript
import crypto from 'node:crypto';

export function buildSignedUrl(wsUrl, apiKey, apiSecret) {
  const u = new URL(wsUrl);
  const host = u.host;
  const path = u.pathname || '/';
  const date = new Date().toUTCString(); // 必须 UTC GMT，禁止 toString()
  const origin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
  const signature = crypto.createHmac('sha256', apiSecret).update(origin).digest('base64');
  const authorization = [
    `api_key="${apiKey}"`,
    'algorithm="hmac-sha256"',
    'headers="host date request-line"',
    `signature="${signature}"`,
  ].join(', ');
  const authB64 = Buffer.from(authorization, 'utf8').toString('base64');
  const q = new URLSearchParams({ authorization: authB64, date, host });
  return `${wsUrl}?${q.toString()}`;
}
```

3. 前端 `app.js` 初始化顺序（playbook §4，缺一不可）：
   ```
   1. new AvatarPlatform()
   2. setApiInfo({ signedUrl, appId, sceneId, serverUrl })
      — serverUrl 必须是 wss://avatar.cn-huadong-1.xf-yun.com/v1/interact
      — 禁止传 apiSecret / apiKey
   3. setGlobalParams(...)          // Step 5，必须在 start 前
   4. avatar.on(...)                // 必须在 start 前
   5. await avatar.start({ wrapper })
   ```
4. `setApiInfo` 字段来自 `/api/config` + `/api/avatar-auth`，不要在前端拼 HMAC。

**产出**:
- 文件：`server.js`（及可选 `auth.js` 若拆分签名函数；仍仅服务端）
- 内容：签名 API + 静态托管；前端拿到 `signedUrl` 后 `setApiInfo`

**验证**:
- [ ] `node server.js` 启动无报错
- [ ] `curl http://localhost:<port>/api/config` 含 appId=`782a5949`、sceneId、avatarId、vcn，**不含** secret
- [ ] `curl http://localhost:<port>/api/avatar-auth` 的 `signedUrl` 含 `authorization`、`date`、`host`
- [ ] `public/` 下 `grep` 不到 `apiSecret` / `XF_API_SECRET` / `createHmac`

**风险**:
- date 非 UTC → 10113 / 握手 1008
- 漏 `serverUrl` → 600003（连到 SDK 内置测试地址）
- 前端误传 apiSecret → 密钥泄露且违反 HARD-GATE

**回滚**: 删除 `server.js`；不要回滚 `.env`。

**⚠️ 虚拟人陷阱**:
- `date` 必须 `toUTCString()`
- 签名原文三行用 `\n` 连接，第二段是 `GET ${path} HTTP/1.1`
- authorization 是**两次** Base64：先 HMAC 结果 Base64，再整串 authorization Base64
- `setApiInfo` 用 `signedUrl`，不要在浏览器里用 Web Crypto 重签（密钥不能到浏览器）

---

### Step 4: 播放器创建与配置

**Playbook 映射**: §2 Step 4（`app.js`）+ §4 `start({ wrapper })` + 自动播放处理

**目标**: 由 SDK `start({ wrapper })` 创建播放器；开启透明渲染；处理浏览器自动播放限制。

**预计时间**: 20 分钟

**前置**: Step 2 wrapper DOM 已存在；Step 3 签名可用。本步代码写入 `public/app.js`（与 Step 5–7 同一文件，**不可并行改同一文件**）。

**操作**:
1. **禁止** `createStreamPlayer` / 独立 `createPlayer` 工厂。正确方式：
   ```javascript
   const wrapper = document.querySelector('.avatar-wrapper');
   await avatar.start({ wrapper });
   const player = avatar.player;
   player.alpha = true; // 透明渲染，与 avatar.stream.alpha: 1 成对
   ```
2. 监听自动播放拦截（playbook §4 必须处理）：
   ```javascript
   player.on(PlayerEvents.playNotAllowed, () => {
     // 引导用户点击「启动/继续播放」后：
     player.resume();
   });
   ```
3. wrapper CSS：`background: transparent`；页面底层放可见背景，便于验收透明。
4. 用户点击「启动」后再 `start`（降低自动播放拦截概率）。

**产出**:
- 文件：`public/app.js`（播放器段）+ `public/style.css`（容器透明）
- 内容：`start({ wrapper })` → `player.alpha = true` → `playNotAllowed` / `resume`

**验证**:
- [ ] 启动后能取到 `avatar.player`
- [ ] `player.alpha === true`
- [ ] 无声音时出现可点击恢复，而不是静默失败
- [ ] 代码中无 `createStreamPlayer` / `sendText`

**风险**:
- 先 `start` 再设 `player.alpha` 过晚可能导致首帧不透明 → start 成功后立刻设置
- 忽略 `playNotAllowed` → 有画面无声

**回滚**: 去掉本步播放器逻辑，保留签名与 HTML；不要改 playbook 锁定字段来「试透明」。

**⚠️ 虚拟人陷阱**:
- 透明必须 **双重配置**：`avatar.stream.alpha = 1`（Step 5）**且** `player.alpha = true`（本步）
- 仅 XRTC + 标准形象支持透明；禁止改成 WebRTC 或超拟人 `cnr*`

---

### Step 5: 全局参数配置

**Playbook 映射**: §2 Step 4 HARD-GATE + **§3 字段锁定表（逐项对照，不允许偏离）**

**目标**: `setGlobalParams` 在 `start` 前写入；手写 `avatar.stream` 用真实 kbps，避开顶层 bitrate/1024 陷阱；打开 AIR、打断模式、全双工开关（运行时再降级）。

**预计时间**: 25 分钟

**前置**: Step 3 `setApiInfo` 已完成；本段仍在 `start` 之前。

**操作**:
1. **必须**按 playbook §3 生成下列结构。顶层 `stream.bitrate: 2000` **仅占位**（SDK 会 `/1024`）；**真实生效值是 `avatar.stream.bitrate`**（原样发送，WYSIWYG）。
2. 在锁定表之上**增量**加 `air`、`asr`、`avatar_dispatch.interactive_mode: 1`（设计文档客服打断）。字段名用 `avatar_dispatch`（playbook 锁定表），**不要**改成未锁定的顶层 `dispatch`。
3. **不要**只写顶层 `stream` 而省略 `avatar.stream`。
4. **不要**启用 `subtitle: true`（透明背景不支持云端字幕）。
5. `alpha` 必须为 `1`（整数），不是 `true`。

```javascript
avatar.setGlobalParams({
  stream: {
    protocol: 'xrtc',
    fps: 25,
    bitrate: 2000, // ⚠️ 顶层会被 SDK Math.floor(bitrate/1024)；不可当作生效码率
  },
  avatar: {
    avatar_id: config.avatarId, // 118801001
    width: 720,                 // 4 的倍数
    height: 1280,
    stream: {
      protocol: 'xrtc',         // 必填，与顶层一致；透明必须 xrtc
      fps: 25,
      bitrate: 2000,            // kbps，[200,20000]，平台实际收到的值
      alpha: 1,                 // 透明背景
    },
  },
  tts: {
    vcn: config.vcn,            // x4_lingxiaoqi_oral
    speed: 50,
    pitch: 50,
    volume: 50,
  },
  avatar_dispatch: {
    interactive_mode: 1,        // 客服：可被打断（0=追加 1=打断）
  },
  air: {
    air: true,                  // 播报自动动作
  },
  asr: {
    full_duplex: true,          // 未开通则 Step 7 降级短语音
  },
});
```

6. 生成后 **逐字段核对** playbook §3 表：`avatar.stream.protocol/fps/bitrate/alpha`、`avatar_id`、宽高、`tts.vcn`。
7. executing 违规检测（必须跑）：
   ```bash
   grep -q "bitrate" public/app.js
   grep -q "stream" public/app.js
   grep apiSecret public/ && echo FAIL
   ```

**产出**:
- 文件：`public/app.js` 中 `setGlobalParams`
- 内容：锁定表 + AIR + ASR 全双工开关 + 打断模式

**验证**:
- [ ] 存在完整 `avatar.stream`（protocol/fps/bitrate/alpha）
- [ ] `avatar.stream.alpha === 1`，`protocol === 'xrtc'`
- [ ] `avatar.stream.bitrate === 2000`（不是 1，也不是 2000*1024）
- [ ] 无 `'$.parameter.avatar.stream.bitrate' value must be larger or equal than 200`
- [ ] 无 `'$.parameter.avatar.stream.protocol' field is required`

**风险**:
- 只配顶层 bitrate 2000 → 平台收到 1 → 校验失败（playbook §0 根因）
- 漏 `avatar.stream.protocol` → field is required
- 用 WebRTC 想透明 → 无效

**回滚**: 不要「调大顶层 bitrate 试错」。恢复为 playbook §3 方案 A（手写 `avatar.stream`）。

**⚠️ 虚拟人陷阱**:
- Web SDK 对**顶层** `stream.bitrate` 执行 `Math.floor(bitrate/1024)`；`avatar` 里手写的 `stream` 会 Object.assign **覆盖**计算结果且**不再 /1024**
- 因此本项目采用 playbook **方案 A**：手写 `avatar.stream`，`bitrate: 2000` 即平台 2000 kbps
- 宽高必须是 4 的倍数；形象必须是已授权的 `118801001`

---

### Step 6: 启动虚拟人

**Playbook 映射**: §2 Step 4 顺序第 5 步 + §2 Step 6 连接/首帧验证 + §5 清单前半

**目标**: 用户点击启动后建立 WSS、拉 XRTC 流、看到透明形象首帧。

**预计时间**: 20 分钟

**前置**: Step 3–5 均已在 `start` 前完成（setApiInfo → setGlobalParams → on → start）。

**操作**:
1. 在 start **之前**注册 playbook 必听 4 事件：`connected` / `error` / `disconnected` / `stream_start`。
2. 业务事件一并在 start 前注册（否则漏事件）：
   - `frame_start` / `frame_stop`（流式文字对齐）
   - `asr`（识别上屏）
   - `action_start` / `action_stop`
   - `avatar_ready`（读 `data.actions`，确认动作能力；空则禁用独立动作按钮）
   - `PlayerEvents.playNotAllowed`（挂到 player，start 后立刻绑）
3. 启动：
   ```javascript
   try {
     await avatar.start({ wrapper: document.querySelector('.avatar-wrapper') });
     avatar.player.alpha = true;
   } catch (err) {
     // 展示友好错误，日志脱敏
   }
   ```
4. 默认 1 路并发；关页/重连必须先释放（见 Step 8），否则 11203。

**产出**:
- 文件：`public/app.js` 启动流程
- 内容：事件 + `start({ wrapper })` + 首帧

**验证**（playbook §5 浏览器段）:
- [ ] 点击启动 → `SDKEvents.connected`
- [ ] `SDKEvents.stream_start`
- [ ] 播放器首帧（`PlayerEvents.play` / `playing` 如 SDK 提供则监听）
- [ ] 画布下能看见页面背景（透明生效）
- [ ] 无 bitrate/protocol 校验报错
- [ ] 无 600003 / 10113 / 10120 / 10121

**风险**:
- 事件在 start 后才注册 → 漏掉 connected
- 上一会话未 destroy → 11203
- 弱网 XRTC 首帧慢 → 需要 loading，不要当成失败立刻重连叠会话

**回滚**: `stopRecord`（若已录音）→ `avatar.stop()` → `avatar.destroy()` 后单路重试；不要开第二路「试一下」。

**⚠️ 虚拟人陷阱**:
- 初始化顺序错误必然连接失败（playbook §4）
- `serverUrl` 未显式生产地址 → 600003
- 形象未授权 → 10120；场景未发布 → 10121

---

### Step 7: 实现核心功能

**Playbook 映射**: §2 Step 4 业务 API + §5 功能验证（文本驱动；语音按「无 NLP」改写）

**目标**: 文本播报、ASR 上屏、打断、AIR、独立动作预留、客户端流式文字；全双工失败则降级短语音。全部 `nlp: false`。

**预计时间**: 45 分钟

**前置**: Step 6 已 connected 且有首帧。流式文字纯函数可在本步之前用 TDD 并行完成（P2）。

**操作**:

#### 7.1 文本驱动（`writeText`，禁止 `sendText`）
```javascript
await avatar.writeText(text, { nlp: false });
```
- 欢迎按钮、输入框发送都走这条
- **禁止** `nlp: true` / `stream_nlp`（本期无大模型授权）

#### 7.2 客户端流式文字（TDD 仅此纯函数）
- 新建 `public/streamText.js`：拼接 ASR 增量、播报打字机截断（纯函数，无 DOM、无 SDK）
- 测试：`public/streamText.test.js` 或 `test/streamText.test.js`，`node --test`
- 播报：用即将 `writeText` 的全文做打字机，用 `frame_start` / `frame_stop`（`vmr_status === 2` 表示结束）对齐显示/清空
- ASR：监听 `SDKEvents.asr`，把 `data.text` 追加到「用户说了」区域（partial 覆盖、final 定稿，由纯函数处理）
- **不要** `subtitle: true` / `subtitle_info`

#### 7.3 语音采集 + ASR 上屏（无 NLP）
```javascript
const recorder = avatar.createRecorder({ sampleRate: 16000 });

// 全双工尝试（nlp 必须 false）
await avatar.writeText('', { nlp: false, full_duplex: true });
recorder.startRecord(60 * 1000, null, { nlp: false, vad: true });
```
- 采样率 **16000**，PCM 16bit
- 权限：`getUserMedia({ audio: true })`；拒绝则提示并回退「仅文本播报」
- 可选 echo：识别定稿后 `writeText(asrText, { nlp: false })`（复读，不是问答）

#### 7.4 全双工失败 → 短语音降级
- 开启全双工后数秒内若无实时 `asr` 增量，切 UI 为「按住说话」
- 短语音：`startRecord(60 * 1000, onEnd, { nlp: false })`，松开 `stopRecord()`（必须发尾帧）
- 单次最长 60s
- UI 提示「实时识别未开通，已切换为按住说话」

#### 7.5 打断
```javascript
avatar.interrupt();
```
- 「打断」按钮调用；`interactive_mode: 1` 已在 Step 5
- 仅在播报中有效；可结合 `frame_start`/`frame_stop` 禁用按钮

#### 7.6 AIR + 独立动作预留
- AIR：Step 5 `air: { air: true }`，播报欢迎类话术即可自动匹配
- 独立动作（`writeCmds`，不是虚构 API）：
  ```javascript
  await avatar.writeCmds([{ cmd: 'action', params: { action_id: 'wave' } }]);
  ```
  `action_id` 必须来自 `avatar_ready` 的 `data.actions`，不要写死不存在的 id

**产出**:
- 文件：`public/app.js`（业务）、`public/streamText.js`、对应 `node --test` 用例
- 内容：writeText / recorder / interrupt / writeCmds / 流式文字

**验证**:
- [ ] `writeText(..., { nlp: false })` 后口型 + 客户端文字
- [ ] 所有 `writeText` / `startRecord` 均为 `nlp: false`（grep `nlp:\s*true` 应为 0）
- [ ] 授权麦克风后 ASR 文本上屏
- [ ] 播报中点打断，播报停止
- [ ] AIR：欢迎播报时有动作（或 `action_start` 日志）；`data.actions` 非空
- [ ] 挥手按钮仅在 actions 包含对应 id 时可用
- [ ] 全双工无 ASR 时自动出现按住说话，且 `stopRecord` 后仍能再录
- [ ] 无 `sendText` / `createStreamPlayer`

**风险**:
- 误写 `nlp: true` → 无授权链路失败或空回复
- 忘记 `stopRecord` → 尾帧缺失、识别不完整、占并发
- 全双工未开通却不降级 → 用户以为麦克风坏了

**回滚**:
- 语音失败 → 隐藏录音，只留文本 `writeText`
- 全双工失败 → 短语音（本步已含）
- 动作无效 → 关掉独立动作按钮，保留 AIR 或纯播报
- 透明失败（非本步主责）→ 设计文档回退 `alpha: 0` 并提示，须改 Step 5+4 两处

**⚠️ 虚拟人陷阱**:
- Web 录音 API 是 `avatar.createRecorder` + `startRecord` / `stopRecord`，不要发明 `startAudioInteract`
- 透明背景必须客户端渲染文字，云端字幕不可用
- `interrupt()` 在未播报时调用无效果，不要当成错误

---

### Step 8: 错误处理与资源释放

**Playbook 映射**: §2 Step 6 全清单 + §6 错误码速查 + sdk-conventions 释放顺序

**目标**: 错误可理解、日志脱敏、关页不占并发；playbook §5 全绿才算完成。

**预计时间**: 20 分钟

**前置**: Step 1–7 代码已生成。

**操作**:

1. `SDKEvents.error` 按码提示（playbook §6 + 设计文档 5.4），日志对 key/secret/signedUrl 脱敏：

| 码 | 含义 | 处理 |
|----|------|------|
| 10110 | appId 错误 | 查 `.env` `XF_APP_ID` |
| 10113 | 认证失败 | 查服务端 HMAC、`toUTCString()`、勿把密钥放前端 |
| 10114 / 10121 | sceneId | 使用 `351920069200187392`，确认已发布 |
| 10120 | 形象未授权 | 保持 `118801001`，勿改超拟人 |
| 10200 / 10201 | 网络/握手 | 查防火墙与生产 WSS |
| 11203 | 超并发 | 先 destroy 再重连，默认 1 路 |
| 600003 | 连测试地址 | `setApiInfo` 显式 `serverUrl` |
| bitrate/protocol 校验 | 字段结构 | 回到 playbook §0/§3，禁止盲改数字 |

2. 资源释放（强制顺序）：
   ```javascript
   window.addEventListener('beforeunload', () => {
     try { recorder?.stopRecord(); } catch (_) {}
     try { avatar.stop(); } catch (_) {}
     try { avatar.destroy(); } catch (_) {}
   });
   ```
3. 重连：必须先走完上述释放，再 `new AvatarPlatform()` 新实例，禁止未 destroy 再 start。
4. 安全复查：`public/` grep `apiSecret`、`apiKey`、`XF_API_SECRET` 必须为空。
5. 跑 playbook §5 端到端清单（浏览器 localhost）。语音项改为「录音 → asr 上屏」，**不要**验证 nlp 回复。

**产出**:
- 文件：`public/app.js` 错误与销毁；可选执行记录（不要改其它无关文件）
- 内容：错误码分支 + 释放 + grep 安全门禁

**验证**:
- [ ] 错误有用户可见文案，无密钥明文
- [ ] 关页后再开可 connected（不 11203）
- [ ] playbook §5 后端 4 项 + 浏览器连接/首帧/文本驱动/无校验报错
- [ ] 麦克风拒绝时有文案且可纯文本播报
- [ ] 前端产物无 apiSecret

**风险**:
- 录音中直接 destroy → 必须先 `stopRecord`
- 为「修 11203」开多路 → 更糟

**回滚**: 停止进程；destroy 会话；保留设计文档与本计划，按 playbook 从失败步重做，禁止试错改 bitrate。

**⚠️ 虚拟人陷阱**:
- 默认 1 路授权；未 destroy 的刷新会超并发
- 参数类报错查 §0 根因表，不要把 2000 改成 2000000 当顶层唯一修复

---

## 验证清单

### 编译 / 工程
- [ ] 无语法错误，ESM `"type": "module"`
- [ ] `npm install` 成功，依赖仅 express + dotenv（测试用 Node 内置 test）
- [ ] SDK 从 `/sdk/.../esm/index.js` 导入成功

### 运行
- [ ] `node server.js` 正常启动
- [ ] `/api/config` 无密钥；`/api/avatar-auth` 有 signedUrl
- [ ] localhost 打开页面无运行时白屏

### 功能（对照设计文档 + playbook §5）
- [ ] SDK 初始化成功，`setApiInfo` 含生产 `serverUrl`
- [ ] `connected` → `stream_start` → 首帧
- [ ] `avatar.stream` 完整且 `alpha: 1`；`player.alpha === true`
- [ ] 文本驱动 `writeText` + `nlp: false`，口型与客户端文字
- [ ] ASR 上屏；`startRecord` 为 `nlp: false`
- [ ] `interrupt()` 可停播报
- [ ] AIR 或独立 `writeCmds` 动作可见/可降级
- [ ] 全双工失败有短语音降级
- [ ] 无 NLP UI；grep `nlp:\s*true` 为空
- [ ] grep 黑名单 API 为空；grep 前端 apiSecret 为空

### 用户体验
- [ ] 错误提示友好、脱敏
- [ ] 加载 / 连接中状态清晰
- [ ] 自动播放拦截可点击恢复
- [ ] 麦克风拒绝可回退文本播报
- [ ] 文案为「播报 + 语音识别」

---

## 回滚方案

| 范围 | 做法 |
|------|------|
| 单步失败 | 停在该 playbook 步，对照 §0/§3/§6，不进入下一步 |
| 连接失败 | destroy 会话；检查 signedUrl、serverUrl、锁定表；不要改形象 id 试错 |
| 透明失败 | 将 `avatar.stream.alpha` 改为 `0` 且 `player.alpha = false`，提示不支持后记录，再查 XRTC/标准形象 |
| 语音失败 | 关闭录音 UI，仅 `writeText` |
| 全双工失败 | 短语音按住说话（Step 7.4） |
| 完全失败 | 保留 `avatar-integration-spec.md` 与本计划；删除生成的 `server.js`/`public/`/`package.json`（保留 `.env`）；重新走 avatar-executing + playbook，禁止主 agent 手写 |

---

## 风险和缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 无大模型授权，不能问答 | 已知 | 本期跳过 NLP；UI 不承诺智能回答 |
| 全双工未开通 | 中 | `asr.full_duplex: true` 尝试后无 ASR 则短语音 |
| 顶层 bitrate/1024 | 高 | 强制手写 `avatar.stream`，禁止只配顶层 |
| 前端泄露 apiSecret | 高 | 仅 `server.js` HMAC；executing grep 门禁 |
| 自动播放限制 | 中 | `playNotAllowed` + `player.resume()` |
| 11203 超并发 | 中 | 1 路；stopRecord → stop → destroy |
| 600003 测试地址 | 高 | 显式 `serverUrl` 生产 WSS |
| 主 agent 绕过 playbook | 高 | **下一步必须 avatar-executing** |

---

## 下一步（HARD-GATE）

实现计划已完成。**必须立即调用 `avatar-executing` 执行实现，严禁主 agent 手动编写业务代码绕过 playbook。**

```
调用 avatar-executing：
- plan_path: D:\demo\dman\avatar-implementation-plan.md
- platform: web
- task_type: first_integration
```

avatar-executing 必须：
1. **先 Read** `web-sdk-build-playbook.md` 全文
2. 按 playbook §2 六步顺序执行（本文 Step 1–8 映射到这六步）
3. 派发 `avatar-code-writer` 时 prompt 带上 playbook 全路径，要求子 agent 自己先 Read
4. 写完 grep 失真 API 与前端 apiSecret
5. 对照 §3 锁定表与 §5 验证清单，一次生成可运行，禁止靠报错打补丁

错误流程（禁止）：planning 完成 → 主 agent 手写 `app.js` / 发明 `createStreamPlayer`/`sendText` → 连接失败或密钥泄露。
