# 虚拟人集成验证报告

## 执行摘要

- 项目: dman（Web 客服形象：播报 + 语音识别）
- 平台: Web
- 路径: `D:\demo\dman`
- 状态: 部分成功（后端与静态资源已绿；浏览器首帧需用户在 localhost 点击「启动」）
- 交付形态: SDK 自建（接口能力 appType=1；官方模板不可用）

## 实施步骤

### Step 1: SDK 安装与引入
- 状态: 完成
- 验证: `sdk/avatar-web-sdk/avatar-sdk-web_3.2.3.1002/esm/index.js` 存在；HTTP `/sdk/.../index.js` 返回 200

### Step 2: 环境配置
- 状态: 完成
- 验证: `.env` 六项凭据 + `XF_WS_URL`；`.gitignore` 含 `.env`

### Step 3–6: 后端签名 / 前端 SDK / HTML
- 状态: 完成
- 文件: `server.js`、`public/app.js`、`public/index.html`、`public/style.css`
- 验证:
  - `GET /api/config` 返回 appId/sceneId/avatarId/vcn/serverUrl，无 apiSecret
  - `GET /api/avatar-auth` 返回 signedUrl，含 authorization / date(GMT) / host
  - 首页 HTTP 200
  - `public/` 无 apiSecret；`app.js` 含手写 `avatar.stream`、`bitrate: 2000`、`alpha: 1`

### Step 7: 核心功能代码
- 状态: 完成（代码侧）
- 文本播报 `writeText(..., { nlp: false })`
- ASR 上屏；全双工失败降级按住说话
- 打断、AIR、writeCmd 动作、客户端流式文字
- `node --test`：streamText 14 passed

### Step 8: 错误处理与释放
- 状态: 完成
- teardown：stopRecord → stop → destroy
- 错误码提示脱敏

## 功能验证

### 核心功能
- [x] SDK 文件与 ESM 引入
- [x] 服务端 HMAC 签名
- [ ] WebSocket connected / 首帧（需浏览器点击启动）
- [ ] 文本驱动口型（需浏览器）
- [x] 文本交互 NLP — 本期不做（无大模型授权）
- [ ] 语音 ASR（需浏览器麦克风）
- [ ] 透明背景实拍（需浏览器）

### 代码评审
- avatar-code-reviewer: pass（0 critical/high）
- 黑名单 API: 零命中
- playbook §3 字段锁定: 通过

### 性能指标
浏览器联调前无法测首帧延迟。

## 已知限制
- 接口应用无 LLM，不能智能问答
- 全双工可能未开通，已做短语音降级
- 本次会话无浏览器自动化工具，首帧需你在本地点击验证

## 启动方式
```
cd D:\demo\dman
node server.js
```
打开 http://localhost:3000 ，点击「启动」。
