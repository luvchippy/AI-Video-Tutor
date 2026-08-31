# AI Video Tutor

一个运行在浏览器视频旁边的 **一对一 AI 学习助教**。你在看视频时可以随时暂停并提问 —— “这里是什么意思？”、“刚才没听懂”、“这个术语是什么？”、“博主说的是真的吗？” —— AI 会结合 **当前视频内容、播放时间、字幕、画面、你的学习背景**，给出教学式解释。

> **Watch → Pause → Ask → Explain → Verify → Learn**

这是 **Demo 版本**，用于验证核心交互闭环。不是“AI 视频总结器”。

---

## 技术栈

- **WXT** (Web eXtension Tools) + **TypeScript** + **React 19** — Manifest V3
- **Chrome + Edge**（同一份代码，`-b chrome` / `-b edge` 构建）
- **Dexie + IndexedDB** — 本地存储（字幕、知识片段、关键帧、对话）
- **Zod** — 模型注册表 / 设置校验
- **0 后端 · BYOK** — 全部运行在浏览器里，用户自带 API Key

---

## 1. 项目目录结构

```
src/
├── entrypoints/
│   ├── background.ts          # Service Worker（可信上下文）：消息路由、Provider 调用、截图裁剪
│   ├── content.ts             # Content Script：检测 <video>、播放时间、字幕、截图
│   └── sidepanel/             # Side Panel UI（React）
│       ├── App.tsx            # 外壳 + Chat/Timeline/Settings 三页导航
│       ├── AppContext.tsx     # 全局状态（设置、运行时上下文、本地视频）
│       ├── useChat.ts         # 聊天状态 + Port 流式
│       ├── lib.ts             # sendMessage / connect Port 封装
│       ├── components/        # ChatHeader / MessageList / QuickButtons / LocalVideoPlayer
│       └── pages/             # ChatPage / TimelinePage / SettingsPage
├── adapters/
│   ├── platform/
│   │   ├── generic-html5.ts   # GenericHtml5VideoAdapter（真实实现）
│   │   ├── stubs.ts           # YouTube/Bilibili/Douyin/XHS —— 接口占位 + TODO
│   │   └── registry.ts        # 平台注册表（Demo 只激活 generic）
│   └── media/
│       ├── page-video.ts      # PageVideoSource（评分选主视频）
│       ├── local-file.ts      # LocalFileSource（拖入本地视频）
│       └── direct-url.ts      # 视频 URL 分类（direct-media / platform-url）
├── playback/
│   ├── clock.ts               # PlaybackClock + 状态/置信度推导
│   └── format.ts              # 时间格式化
├── providers/
│   ├── ai/                    # Gemini / OpenAI-compatible / DeepSeek / Qwen(stub) / Mock
│   └── search/                # NativeModelSearch / DisabledSearch
├── registry/
│   ├── schema.ts              # 模型注册表 Zod schema
│   └── model-registry.ts      # 加载 + 查找 + 3 个推荐配置
├── router/
│   ├── intent.ts              # QuestionIntent 规则路由
│   └── capability.ts          # 能力路由（capabilities 判断，不用模型名字符串）
├── rag/retriever.ts           # 时间 70% + 关键词 30% 的 Video RAG
├── timeline/
│   ├── chunker.ts             # 字幕 → 30–90s 知识片段
│   └── sparse-analysis.ts     # 关键帧采样 + 稀疏视觉分析
├── storage/
│   ├── db.ts                  # Dexie: AI_VIDEO_TUTOR_DB
│   ├── settings.ts            # chrome.storage.local（API Key 只存这里）
│   ├── repositories.ts        # 表 CRUD
│   └── schema.ts              # 设置 Zod
├── services/
│   ├── tutor-engine.ts        # 编排：意图 → 路由 → RAG → 视觉/搜索 → 流式
│   ├── context-assembly.ts    # 组装 Tutor Prompt
│   ├── frame-capture.ts       # 视频截图（canvas + captureVisibleTab 裁剪）
│   └── subtitle.ts            # TextTrack 字幕提取
├── prompts/                   # tutor / vision / sparse（Prompt 不散落在组件里）
├── types/                     # 所有共享类型 + 消息契约
└── data/model-registry.json   # 模型能力注册表
```

---

## 2. 实际完成的能力

| 能力 | 状态 |
|---|---|
| Side Panel AI Chat（非 popup） | ✅ |
| 检测网页 `<video>`（评分：播放中 > 可见 > 面积 > 时长 > viewport） | ✅ |
| 持续读取播放位置 / duration / 播放状态 | ✅（1s 轮询） |
| 当前时间作为 AI Context（`当前播放时间：08:43`） | ✅ |
| 本地视频拖入（MP4/WebM，播放/暂停/拖动/currentTime/截图） | ✅ |
| 文本字幕读取（`video.textTracks` / `<track>`） | ✅ |
| Timeline 知识索引（字幕 → 30–90s 片段，点击跳转） | ✅ |
| Video RAG（时间 70% + 关键词 30%，只发相关 Chunk） | ✅ |
| 多模型协作（Tutor / Vision / Video / Search 可不同模型） | ✅ |
| Question Intent Router（规则优先） | ✅ |
| Capability Router（全部按 capabilities 判断） | ✅ |
| 能力状态显示（✓/✕ + 禁用原因） | ✅ |
| 3 个推荐配置（高性价比 / Gemini 全能 / Qwen Omni 全能） | ✅ |
| 自定义 OpenAI-Compatible 模型 + 手动能力勾选 | ✅ |
| API Key 安全（只存 chrome.storage.local，不进 DOM/窗口/Content Script） | ✅ |
| Mock Mode（无 Key 即可体验 UI + 流式 + 视觉 + 搜索模拟） | ✅ |
| GeminiProvider / OpenAICompatibleProvider / DeepSeekProvider / MockProvider | ✅ |
| 联网搜索（NativeModelSearch via Gemini google_search）/ 未联网核实的诚实降级 | ✅ |
| 网页视频截图（canvas + `tabs.captureVisibleTab` 裁剪降级） | ✅ |

## 3. 仅 interface / placeholder 的能力

- **YouTube / Bilibili / Douyin / Xiaohongshu PlatformAdapter** —— 只有 `match()` + 返回 `null` 的 TODO 接口。它们的 `<video>` 元素当前由 `GenericHtml5VideoAdapter` 兜底处理。
- **QwenProvider** —— 复用 OpenAI-compatible 通道；Qwen 特有的 `video_url` 输入 / Omni 音频输出（`modalities`）**尚未接入**，接口已预留。
- **视频 URL 直读** —— DirectUrlSource 只做分类；当前模型不支持直读时 UI 会诚实提示（不伪造“解析成功”）。
- **全局稀疏视觉索引（完整视频 10s 采样）** —— 本地视频已实现离线 seek 采样；网页视频**不强制 seek**，仅“分析当前画面”。

## 4. Chrome 开发者模式加载

```bash
npm install
npm run build            # 输出到 .output/chrome-mv3/
```

1. 打开 `chrome://extensions`
2. 右上角打开 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `.output/chrome-mv3/` 目录
5. 点击工具栏的 **AI Video Tutor** 图标，即打开 Side Panel

## 5. Edge 开发者模式加载

```bash
npm run build:edge       # 输出到 .output/edge-mv3/
```

1. 打开 `edge://extensions`
2. 打开 **开发人员模式**
3. 点击 **加载解压缩的扩展**
4. 选择 `.output/edge-mv3/` 目录

## 6. 如何使用 Mock Mode（无需任何 API Key）

默认配置就是 Mock。加载扩展后：

1. 打开任意带 HTML5 `<video>` 的网页（或拖入一个 MP4）
2. 打开 Side Panel，顶部会显示 **`DEMO / MOCK`** 徽标
3. 直接提问，会看到流式的模拟回答、模拟视觉结果、模拟联网来源
4. Mock 只会用于体验 UI 与流程，**不会**被误认为真实 AI（界面有明显标识）

## 7. 如何配置 Gemini

1. 到 [Google AI Studio](https://aistudio.google.com/apikey) 创建 API Key
2. Side Panel → **Settings** → 找到 **API Keys** 的 `Gemini (Google AI)`，粘贴并保存
3. 在 **推荐配置** 点击 **Gemini 全能**（或用高级设置自由组合）

Gemini 直连 Google AI REST（`x-goog-api-key` 头），支持文本/图片/视频/原生联网搜索（`google_search` grounding）。

## 8. 如何配置 OpenAI-Compatible API

**DeepSeek / OpenAI / Qwen / 任意兼容端点**：

1. Settings → **API Keys** 粘贴对应 Key（DeepSeek / OpenAI / Qwen）
2. 用 **高级设置 → 自定义 OpenAI-Compatible 模型**：填 Base URL、Model ID、勾选能力、保存为 Tutor
3. 或直接选 **高性价比**（DeepSeek 做 Tutor + Gemini 做 Vision）

> 自定义模型的能力**不会自动探测**，需手动勾选（Demo 不做自动收费测试）。

## 9. Timeline Knowledge Index 数据结构

```ts
interface KnowledgeChunk {
  id: string;           // `${videoId}#${index}`
  videoId: string;      // `page:<url>` 或 `local:<uuid>`
  startTime: number;
  endTime: number;
  transcript: string;   // 该片段合并后的字幕
  summary?: string;     // Demo 阶段取首句（后续可由 Tutor 批量生成）
  keywords?: string[];
  concepts?: string[];
  technicalTerms?: string[];
  claims?: string[];
  visualSummary?: string;
  ocr?: string[];
  importance?: number;
}
```

存储于 IndexedDB `AI_VIDEO_TUTOR_DB`，表：`videos / chunks / keyframes / conversations / messages / learningNotes`。不存完整视频、不长期存高清截图。

## 10. Provider Capability Router 的工作方式

- 每个模型在 `src/data/model-registry.json` 声明 `capabilities`（textInput / imageInput / videoInput / nativeWebSearch …），经 Zod 校验。
- 业务代码**从不写** `if (model.includes("gemini"))`，而是：

```ts
if (model.capabilities.imageInput) enableVisualQuestion();
if (model.capabilities.nativeWebSearch) enableFactCheck();
```

- 多模型配置的**有效能力 = 各模型能力的并集**（`mergeCapabilities`）。
- `buildProviderSet()` 在后台组装 Tutor / Vision / Video / Search 四个角色；Search 回退顺序：Search 槽 → Vision（有原生搜索时）→ Tutor → Disabled。
- UI 顶部的能力状态、快捷按钮的禁用与原因，全部由这个路由器驱动。

## 11. 当前已知限制

- 跨域视频（YouTube/Bilibili 等）canvas 直读会 taint，自动降级到 `tabs.captureVisibleTab` 裁剪；仍失败则诚实提示“无法直接获取视频画面，可依字幕学习”。
- 无字幕的视频无法建立时间轴索引（会明确提示，不伪造）。
- 网页视频**不会**为了建索引而强制 seek 干扰观看。
- 本地视频与聊天跨 Tab 切换后，内存态消息会重置（已持久化到 DB，后续可回读）。
- Qwen 的视频 / Omni 音频、DeepSeek 的 reasoning 流式展示尚未完整接入。

## 12. 下一阶段最值得实现的 5 个功能

1. **平台专用 Adapter**：YouTube / Bilibili 的字幕抓取与创作者信息（接口已就绪）。
2. **联网搜索 Provider 扩展**：接入独立搜索 API（如 Tavily/Brave）作为 NativeModelSearch 之外的 SearchProvider。
3. **AI 语义分块 + 批量摘要**：用 Tutor 批量生成每个 Chunk 的 summary/keywords/concepts/claims。
4. **全局稀疏视觉索引补全**：网页视频“播放中跨 10s 采样”的完整闭环 + 关键帧浏览。
5. **能力自动探测**：自定义模型通过一次低成本测试调用自动判定 capabilities（替代手动勾选）。

---

## 13. 打包发布到 Edge / Chrome 商店

### 扩展图标（已就绪）

图标已内置，并在 `wxt.config.ts` 的 `manifest.icons` 中声明（16 / 32 / 48 / 128 px）：

- `public/icons/icon-16.png` / `icon-32.png` / `icon-48.png` / `icon-128.png` —— 商店与工具栏使用
- `public/icons/icon.svg` —— 可编辑的矢量源文件
- `scripts/generate-icons.ps1` —— 重新生成 PNG：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1`

如需更换图标，编辑 `icon.svg`（或脚本中的几何参数）后重新运行生成脚本即可。

### Chrome Web Store

1. 构建并打包：

```bash
npm run build              # 输出 .output/chrome-mv3/
npx wxt zip -b chrome      # 生成 .output/chrome-mv3-*.zip
```

2. 打开 [Chrome Web Store 开发者后台](https://chrome.google.com/webstore/devconsole) → 新建项目
3. 上传刚生成的 `.zip`
4. 填写商店信息：说明、截图（1280×800 或 640×400）、类别
5. 填写**隐私政策 URL**：填入第 14 章的在线隐私政策地址（GitHub Pages 托管，中英双语）
6. 提交审核

### Microsoft Edge Add-ons

1. 构建并打包：

```bash
npm run build:edge         # 输出 .output/edge-mv3/
npx wxt zip -b edge        # 生成 .output/edge-mv3-*.zip
```

2. 打开 [Microsoft Edge 加载项开发者后台](https://partner.microsoft.com/dashboard/microsoftedge) → 提交新扩展
3. 上传 `.zip`，填写说明、截图、隐私政策（同上）
4. 提交认证

### 上架注意点

- **权限最小化**：当前 manifest 声明了 `storage / tabs / activeTab / scripting` 与 `<all_urls>` 的 host 权限，商店审核会要求逐项说明用途，请准备好理由：截图取帧用 `activeTab`/`tabs`，`scripting` 用于注入 content script，`<all_urls>` 用于匹配任意站点的 `<video>`。
- Chrome 对 `<all_urls>` 权限审核更严；若被驳回，可考虑改为更具体的 hosts 或改用运行时 `activeTab` 授权。
- 两个商店对 MV3 `host_permissions` 的展示与授权策略略有差异，Edge 通常更宽松。

---

## 14. 隐私政策链接（商店上架必需）

Chrome 与 Edge 商店上架时都要求提供一个**在线可访问的隐私政策 URL**。本项目已内置中英双语隐私政策页面：`docs/index.html`。

### 用 GitHub Pages 托管（免费）

1. 打开仓库 → **Settings → Pages**
2. 在 **Build and deployment** 下，Source 选 **Deploy from a branch**
3. Branch 选 `master`，目录选 **`/docs`**，点 Save

约 1 分钟后即可访问，商店上架时填入此 URL：

```
https://luvchippy.github.io/AI-Video-Tutor/
```

> 前提：仓库需为 **public**（GitHub 免费版对私有仓库不提供 Pages）。若仓库为私有，可改用 Netlify / Vercel / Cloudflare Pages 托管 `docs/index.html`，或升级 GitHub 计划。

---

## 开发命令

```bash
npm run dev          # 开发模式（Chrome + HMR）
npm run dev:edge     # 开发模式（Edge）
npm run typecheck    # tsc --noEmit
npm run test         # Vitest 单元测试
npm run build        # 生产构建 chrome-mv3
npm run build:edge   # 生产构建 edge-mv3
```
