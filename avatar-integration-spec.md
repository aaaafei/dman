# 虚拟人集成设计文档

## 1. 项目概述

### 1.1 工程信息
- 平台: Web
- 项目路径: `D:\demo\dman`
- 项目名称: dman（Web 客服形象：播报 + 语音识别；本期无大模型问答）
- 构建工具: Node.js + Express（服务端 HMAC 签名 + 静态前端），不使用 Vite/Webpack
- 语言: JavaScript（ESM，`"type": "module"`）
- Node.js: v18.20.6（已验证）
- npm: 8.19.4（已验证）

### 1.2 当前状态
- SDK 集成状态: 未集成（空目录，实施阶段由 `avatar-artifact-download` 下载 Web SDK）
- 已有功能: 无
- 缺失功能: 文本驱动播报、语音采集/ASR、动作控制、透明背景、客户端流式文字
- 交付形态: SDK 自建工程（非官方 Web 模板）
- 应用类型: appType=1 接口能力（已确认，模板路径不可用）

### 1.3 环境门禁摘要
- Layer 1 凭据: PASS。`.env` 六项 + 服务地址：`XF_APP_ID` / `XF_API_KEY` / `XF_API_SECRET` / `XF_SCENE_ID` / `XF_AVATAR_ID` / `XF_VCN` / `XF_WS_URL`。`apiKey` 与 `apiSecret` 只在 Node 后端做 HMAC 签名，禁止进前端。
- Layer 2 资源: PASS（avatarId `118801001`、vcn `x4_lingxiaoqi_oral` 已授权给 appId）
- Layer 3 SDK 文件: 延后到 executing（空工程，实施时下载 `avatar-sdk-web_3.2.3.1002`）
- Layer 4 网络: 目标地址 `wss://avatar.cn-huadong-1.xf-yun.com/v1/interact`（443）
- Layer 5 工具链: PASS（Node 18 / npm 8）
- Layer 6 最小链路: 延后到工程生成后浏览器验证
- LLM 对话授权: FAIL（用户已知风险并选择跳过）

## 2. 需求与目标

### 2.1 核心需求
在 Web 页面上创建智能客服形态的虚拟人：形象透明叠加、可朗读播报、可语音采集、可动作、页面接入流式文字。账号仅有接口能力订阅（appType=1），无可用标准产品（appType=2 应用已过期），因此不能使用官方 Web 对话模板，改为 SDK 自建。

用户明确选择：**本期不做大模型问答**（当前接口应用无 `LLM_DIALOG_NUM` / `LLM_DOC_NUM` / `LLM_TOKENS_NUM`）。客服智能回答能力不完整，后续补开大模型后再加 NLP。

### 2.2 功能目标
- [x] 文本驱动播报（`writeText`，`nlp: false`）
- [ ] 文本交互（NLP）— **本期不做**（缺大模型授权，用户选择跳过）
- [x] 语音交互：麦克风采集 + ASR 识别结果上屏（无 NLP 回复）
- [x] 全双工：配置 `asr.full_duplex: true` 与打断模式；若控制台未开通全双工则降级为短语音
- [x] 动作控制：启用 AIR 自动动作；预留独立动作按钮（欢迎挥手等）
- [x] 透明背景：XRTC + `avatar.stream.alpha: 1`，标准形象
- [x] 流式文字：客户端渲染播报文本与 ASR 文本（透明背景不支持云端字幕）

### 2.3 非功能需求
- 延迟要求: 中（播报优先稳定出画；全双工若开通则追求低延迟）
- 网络环境: 稳定宽带（透明背景 + XRTC）
- 设备兼容: 现代 Chromium 浏览器（Chrome/Edge），localhost 或 HTTPS
- 安全: `apiSecret` 只在 Node 后端签名，前端只拿一次性 `signedUrl`
- 并发: 默认 1 路，测试后立即释放连接

## 3. 技术选型

### 3.1 SDK 版本
- Web: `avatar-sdk-web_3.2.3.1002`（ESM）
- 架构: Express 后端签名 + `public/` 静态前端（遵循 `web-sdk-build-playbook.md`）
- 实施入口: `avatar-executing`（禁止主 agent 手写绕过 playbook）

### 3.2 协议选择
- 视频流协议: **XRTC**
- 选择理由: 用户需要透明背景，仅 XRTC + 标准虚拟人支持；WebRTC 不支持透明

### 3.3 资源配置
- appId: `782a5949`（大屏端数字人，appType=1，有效）
- sceneId: `351920069200187392`（已有接口场景「大屏介绍」，复用）
- avatarId: `118801001`（标准形象，支持透明背景与动作；禁止使用 cnr 超拟人）
- vcn: `x4_lingxiaoqi_oral`
- 服务地址: `wss://avatar.cn-huadong-1.xf-yun.com/v1/interact`（必须显式设置）
- 未使用: appId `cfedc51e`（appType=2 标准产品，已过期）

### 3.4 能力缺口（已知）
| 能力 | 状态 | 影响 |
|------|------|------|
| 大模型对话 NLP | 未授权 | 不能智能问答；`nlp: true` / `stream_nlp` 不可用 |
| 全双工服务 | 未在 auths 中确认 | 可能 `full_duplex: true` 不生效，需降级短语音 |
| Web 对话模板 | 无有效 appType=2 | 不能零代码出链接 |

补齐 NLP 路径：控制台为接口应用打开大模型对话开关后，再扩展文本交互。订阅页：https://virtual-man.xfyun.cn/console/applications/subscribe

## 4. 架构设计

### 4.1 模块划分
```
[用户界面层]  public/index.html + style.css
  虚拟人透明画布 / 流式文字区 / 欢迎播报 / 语音按钮 / 打断 / 动作
      ↓
[SDK 集成层]  public/app.js
  AvatarPlatform / Player / Recorder / 事件监听 / writeText / writeCmds
      ↓
[服务通信层]  server.js
  HMAC 签名 /api/avatar-auth  · 非敏感配置 /api/config  · 静态托管
      ↓
[虚拟人服务]  wss://avatar.cn-huadong-1.xf-yun.com/v1/interact
```

### 4.2 关键流程

**初始化流程**（顺序 HARD-GATE，错误则连接失败）:
1. `new AvatarPlatform()`
2. `setApiInfo({ signedUrl, appId, sceneId, serverUrl })` — `serverUrl` 必须为 `wss://avatar.cn-huadong-1.xf-yun.com/v1/interact`，否则会连测试地址报 600003；前端不传 apiSecret / apiKey
3. `setGlobalParams({...})` — 必须在 start 前，字段锁定见 5.2
4. `avatar.on(...)` — 必须在 start 前注册
5. `await avatar.start({ wrapper })`

**文本播报流程**:
1. 用户点击欢迎/输入文本
2. `writeText(text, { nlp: false })`
3. 监听 `frame_start` / `nlp` 不可用；用播报文本与 `frame_start`/`frame_stop` 驱动流式文字
4. AIR 自动匹配动作

**语音采集流程（无 NLP）**:
1. 申请麦克风（localhost/HTTPS）
2. 创建录音器，可选 VAD / 全双工
3. `recorder.startRecord(..., { nlp: false })`；全双工时 `writeText('', { nlp: false, full_duplex: true })`
4. 监听 `SDKEvents.asr` 将识别文本流式上屏；可选 echo：`writeText(asrText, { nlp: false })`
5. 若开启全双工后数秒无实时 ASR，降级为短语音（按住说话，最长 60s）

**打断**:
- `interactive_mode: 1`（客服可被用户打断）
- 提供「打断」按钮调用 `avatar.interrupt()`

## 5. 实现细节

### 5.1 权限处理

**Web**:
- 开发使用 `localhost`；生产必须 HTTPS
- `navigator.mediaDevices.getUserMedia({ audio: true })`
- 权限拒绝时提示，并提供纯文本播报回退
- 浏览器自动播放限制：监听 `PlayerEvents.playNotAllowed`，引导点击后 `player.resume()`

### 5.2 参数配置

实施时必须按 `web-sdk-build-playbook.md` §3 锁定表生成，**禁止只写顶层 stream**（Web SDK 会对顶层 `bitrate` 做 `Math.floor(bitrate/1024)`，`2000` 会变成 `1` 导致校验失败）。透明背景将 `avatar.stream.alpha` 设为 `1`。

```yaml
# 语义配置（真实代码字段以 playbook 锁定表为准）
AvatarParams:
  stream:
    protocol: "xrtc"
    fps: 25
    bitrate: 2000          # 顶层仅占位；平台实际值看 avatar.stream.bitrate
  avatar:
    avatar_id: "118801001"
    width: 720
    height: 1280
    stream:
      protocol: "xrtc"     # 必填，原样发送
      fps: 25
      bitrate: 2000        # kbps，[200,20000]，WYSIWYG
      alpha: 1             # 透明背景
  tts:
    vcn: "x4_lingxiaoqi_oral"
    speed: 50
    pitch: 50
    volume: 50
  avatar_dispatch:
    interactive_mode: 1    # 客服场景：打断
  air:
    air: true              # 播报自动动作
  asr:
    full_duplex: true      # 未开通则运行时降级
# start 拿到 player 后必须: player.alpha = true；容器 CSS background: transparent
# 关页/重连: stopRecord → avatar.stop()/destroy()
```

### 5.3 事件处理

**必需监听**:
- `connected`: 连接成功
- `error`: 错误提示与日志脱敏
- `disconnected`: 可重连提示
- `stream_start`: 推流开始

**业务监听**:
- `frame_start` / `frame_stop`: 播报起止，驱动客户端流式文字
- `asr`: 识别增量文本上屏
- `action_start` / `action_stop`: 动作状态
- `avatar_ready`: 读取 `data.actions`，确认动作能力
- `PlayerEvents.playNotAllowed`: 自动播放拦截

**不启用**:
- `subtitle: true` / `subtitle_info`（透明背景不支持云端字幕）
- `nlp: true` / `stream_nlp`（本期无大模型授权）

### 5.4 错误处理

**网络错误**:
- 10200 连接超时 → 检查网络和防火墙
- 10201 握手失败 → 检查服务地址是否显式设置为生产 WSS

**鉴权错误**:
- 10110 appId 错误 → 检查 `.env` 中 `XF_APP_ID`
- 10113 apiSecret 错误 → 检查服务端签名，勿把密钥放到前端
- 10114 sceneId 不存在或未发布 → 使用已有 `351920069200187392`

**资源错误**:
- 10120 avatarId 未授权 → 已对 `118801001` 授权；勿改成超拟人
- 10121 sceneId 未发布 → 确认场景「大屏介绍」已发布
- 600003 Expected HTTP 101 but was 200 → 未显式设置生产 `serverUrl`
- 11203 超并发 → 默认 1 路；关页/重连前先 `stopRecord` 再 `avatar.stop()`/`destroy()`

**参数错误**:
- `'$.parameter.avatar.stream.bitrate' value must be larger or equal than 200` → 未按 playbook 写 `avatar.stream`
- `'$.parameter.avatar.stream.protocol' field is required` → 漏写 `avatar.stream.protocol`

### 5.5 流式文字（客户端）
- 播报：用即将 `writeText` 的文本做打字机/逐段展示，并用 `frame_start`/`frame_stop` 对齐起止
- ASR：监听识别事件增量追加到「用户说了」区域
- 透明画布叠在页面背景上；文字在独立 DOM，不依赖云端字幕

### 5.6 安全
- `.env` 已加入 `.gitignore`
- 前端 `app.js` 禁止出现 `apiSecret` / `XF_API_SECRET`
- 日志对 key/secret 脱敏

## 6. 测试与验证

### 6.1 单元测试
- 服务端签名函数：给定固定密钥与时间戳可测 HMAC 输出格式（不含真实密钥提交仓库）
- 流式文字拼接/截断纯函数（可 TDD）
- SDK 真机交互不套 TDD，走运行时验证

### 6.2 集成测试
- `GET /api/config` 返回 appId/sceneId/avatarId/vcn，不含 apiSecret
- `GET /api/avatar-auth` 返回 signedUrl（含 authorization/date/host）
- 浏览器：connected → stream_start → 首帧
- 文本驱动播报可见口型与客户端文字
- 语音：授权麦克风后 ASR 上屏
- 打断：播报中 interrupt 停止
- 透明：`avatar.stream.alpha === 1` 且 `player.alpha = true`，容器背景 transparent，画布下可见页面背景
- 关页后可再次连接（已 destroy，不占并发）
- 前端产物 grep 不到 apiSecret

### 6.3 兼容性测试
- Chrome / Edge 最新版
- localhost HTTP 开发；提醒生产 HTTPS
- 麦克风拒绝时的文案与回退

## 7. 部署与上线

### 7.1 环境要求
- Web: 生产 HTTPS；开发 localhost
- 进程: `node server.js`（Express 托管 `public/` 与 `sdk/`）
- 凭据: 仅服务器环境变量 / `.env`

### 7.2 上线检查
- [ ] 凭据不进前端 bundle
- [ ] `.env` 不入库
- [ ] 麦克风权限引导完整
- [ ] 错误处理和用户提示
- [ ] 日志脱敏
- [ ] 透明背景在目标分辨率下无黑边
- [ ] 未开通 NLP 时 UI 不展示「智能问答」以免预期不符

## 8. 风险与注意事项

### 8.1 已知风险
- **无大模型授权**：不能做真正智能客服问答；用户已接受本期跳过
- **全双工可能未开通**：实时边说边识可能不生效
- 浏览器自动播放限制
- 弱网下 XRTC 首帧延迟
- 透明背景与云端字幕不兼容
- Web SDK `bitrate/1024` 陷阱（必须按 playbook 写 `avatar.stream`）
- 前端硬编码 apiSecret 会导致密钥泄露

### 8.2 规避措施
- UI 标明「播报 + 语音识别」，不承诺大模型回答
- 全双工失败时回退短语音 / 仅文本播报
- 用户点击后再 start / resume
- 字段锁定表与 playbook 由 `avatar-executing` 强制执行
- 服务端签名

### 8.3 回退方案
- 播放失败：显示静态形象图 + 文字
- 语音失败：回退文本输入后 `writeText` 播报
- 透明失败：将 `alpha` 改为 0 并提示
- 需要智能问答：补开 LLM 后增量加 `nlp: true` + `stream_nlp: true`

## 9. 文档与资源

### 9.1 相关文档
- [Web SDK 接入指南](https://www.xfyun.cn/doc/avatar/webSDK.html)
- 控制台：https://virtual-man.xfyun.cn/console/projects
- 订阅（补开大模型）：https://virtual-man.xfyun.cn/console/applications/subscribe
- 实施 playbook: `avatar-executing/references/web-sdk-build-playbook.md`

### 9.2 示例代码
- Demo / SDK：实施时由 `avatar-artifact-download` 下载到 `D:\demo\dman\sdk\`
- 参考：playbook 强制架构（server.js + public/app.js）

## 10. 变更记录
- 2026-08-29: 初始设计。因无有效 appType=2，走 SDK 自建；因接口应用无 LLM，本期跳过 NLP；透明背景锁定 XRTC + 标准形象 118801001。
