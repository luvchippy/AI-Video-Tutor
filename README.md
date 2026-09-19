# AI Video Tutor

一个运行在浏览器视频旁边的 **一对一 AI 学习助教**。你在看视频时可以随时暂停并提问 —— “这里是什么意思？”、“刚才没听懂”、“这个术语是什么？”、“博主说的是真的吗？” —— AI 会结合 **当前视频内容、播放时间、字幕、画面、你的学习背景**，给出教学式解释。

> **Watch → Pause → Ask → Explain → Verify → Learn**

这是 **0.1.0 版本**，目标是打通核心学习闭环，不是“AI 视频总结器”。

---

## 技术栈

- **WXT** (Web eXtension Tools) + **TypeScript** + **React 19** — Manifest V3
- **Chrome**（MV3 单一目标；Edge 内核相同，同一份产物可直接提交）
- **Dexie + IndexedDB** — 本地存储（字幕、知识片段、关键帧、对话）
- **Zod** — 模型注册表 / 设置校验
- **react-markdown + remark-gfm** — 回答渲染
- **Vitest** — 单元测试（运行在 node 环境，无 DOM，DOM 逻辑一律抽成纯函数或注入假对象）
- **0 后端 · BYOK** — 全部运行在浏览器里，用户自带 API Key

---

## 1. 项目目录结构

```
src/
├── entrypoints/
│   ├── background.ts          # Service Worker（可信上下文）：消息路由、Provider 调用、跨域抓取、截图裁剪
│   ├── content.ts             # Content Script：检测 <video>、播放状态、textTrack 字幕、canvas 截帧、创作者标记
│   └── sidepanel/             # Side Panel UI（React）
│       ├── App.tsx            # 外壳 + Chat/Timeline/Settings 三页导航
│       ├── AppContext.tsx     # 全局状态（设置、运行时上下文、本地视频、采样开关）
│       ├── useChat.ts         # 聊天状态 + Port 流式
│       ├── usePlaybackSampling.ts # 播放中 10s 边界采样（借 1s 轮询做心跳）
│       ├── lib.ts             # sendMessage / connect Port 封装
│       ├── components/        # ChatHeader / MessageList / QuickButtons / LocalVideoPlayer
│       └── pages/             # ChatPage / TimelinePage / SettingsPage
├── adapters/
│   ├── platform/              # 平台支持分两半：DOM 侧 + 网络侧
│   │   ├── youtube.ts         # YouTube 纯解析器（视频 ID / timedtext XML / creator）
│   │   ├── bilibili.ts        # Bilibili 纯解析器（BV 号 / view / player / 字幕 JSON）
│   │   ├── creator-meta.ts    # 创作者 meta map 构造器（纯函数）
│   │   ├── dom-adapter.ts     # DOM 侧 PlatformAdapter 工厂
│   │   ├── generic-html5.ts   # 兜底适配器（match() 恒 true）
│   │   ├── platform-sources.ts # 后台侧平台字幕抓取（跨域 fetch）
│   │   └── registry.ts        # DOM 侧注册表（YouTube / Bilibili / generic，generic 必须在最后）
│   └── media/
│       ├── page-video.ts      # PageVideoSource（评分选主视频）
│       ├── local-file.ts      # LocalFileSource（拖入本地视频）
│       └── direct-url.ts      # 视频 URL 分类（direct-media / platform-url）
├── playback/
│   ├── clock.ts               # PlaybackClock + 状态/置信度推导
│   └── format.ts              # 时间格式化
├── providers/
│   ├── ai/                    # Gemini（原生 REST）/ OpenAI-compatible / DeepSeek / Qwen / Dots / Mock
│   │   └── capability-probe.ts # 用两次最小请求实测文本与图像输入
│   └── search/                # NativeModelSearch / DisabledSearch / Tavily / Brave
├── registry/
│   ├── model-registry.ts      # 加载 + 查找模型能力
│   ├── protocol-registry.ts   # 协议档案（端点路径、鉴权头）
│   ├── capability-resolver.ts # 能力解析（模型表 → 覆盖表 → 协议默认值）
│   ├── remote-model-registry.ts # 远端目录（当前未接入，见「已知限制」）
│   └── schema.ts              # 模型注册表 Zod schema
├── router/intent.ts           # QuestionIntent 规则路由
├── rag/retriever.ts           # 时间 70% + 关键词 30% 的 Video RAG
├── timeline/
│   ├── chunker.ts             # 字幕 → 30–90s 知识片段
│   ├── sparse-analysis.ts     # 单帧稀疏视觉分析（Prompt + 结果解析）
│   └── sampling.ts            # 播放中采样决策（纯函数：边界去重 + 每视频上限）
├── storage/
│   ├── db.ts                  # Dexie: AI_VIDEO_TUTOR_DB
│   ├── settings.ts            # chrome.storage.local（API Key 只存这里）
│   ├── repositories.ts        # 表 CRUD
│   └── schema.ts              # 设置 Zod
├── services/
│   ├── tutor-engine.ts        # 编排：意图 → 路由 → RAG → 视觉/搜索 → 流式
│   ├── context-assembly.ts    # 组装 Tutor Prompt
│   ├── chunk-summarizer.ts    # AI 批量摘要（串行分批、失败隔离、永不抛异常）
│   ├── subtitle.ts            # TextTrack 字幕提取
│   ├── subtitle-parsers.ts    # .srt / .vtt 解析
│   ├── subtitle-resolver.ts   # 字幕来源优先级：外部文件 > HTML track > 平台字幕
│   ├── frame-capture.ts       # 视频截图（canvas + captureVisibleTab 裁剪 + 缩略图）
│   └── url-guard.ts           # 出网地址安全校验（拒绝环回/私网/内嵌凭据）
├── prompts/                   # tutor / vision / sparse / chunk-summary（Prompt 不散落在组件里）
├── types/                     # 所有共享类型 + 消息契约
└── data/                      # model-registry.json（模型能力表）/ model-overrides.json
```

---

## 2. 实际完成的能力

| 能力 | 状态 |
|---|---|
| Side Panel AI Chat（非 popup），Chat / Timeline / Settings 三页 | ✅ |
| 检测网页 `<video>`（评分：播放中 > 可见 > 面积 > 时长 > viewport） | ✅ |
| 持续读取播放位置 / duration / 播放状态 | ✅（1s 轮询） |
| 当前播放时间进 Prompt（`## 当前播放时间：08:43`） | ✅ |
| 本地视频拖入（MP4 / WebM / MOV / MKV / OGG，播放/暂停/拖动/currentTime/截图） | ✅ |
| 外部字幕文件（`.srt` / `.vtt`）加载 | ✅ |
| 文本字幕读取（`video.textTracks` / `<track>`） | ✅ |
| **YouTube / Bilibili 平台字幕抓取**（timedtext / CC 字幕 JSON） | ✅ |
| **创作者（频道 / UP 主）显示**（仅本地显示，不发送给模型） | ✅ |
| 时间轴知识索引（字幕 → 30–90s 片段，点击跳转） | ✅ |
| **AI 语义摘要**（批量生成 summary / keywords / concepts / claims，失败保留本地兜底） | ✅ |
| Video RAG（时间 70% + 关键词 30%，只发相关 Chunk） | ✅ |
| 多模型分工（主助教 / 视觉理解 / 联网核验可分别是不同模型） | ✅ |
| Question Intent Router（规则优先） | ✅ |
| Capability Router（全部按 capabilities 判断，不按模型名字符串） | ✅ |
| 能力状态显示（✓ 已实测 / ◐ 模型表已知 / ? 未实测 / × 不支持） | ✅ |
| **能力自动探测**（两次最小请求实测文本与图像输入） | ✅ |
| 自定义 OpenAI-Compatible 模型 | ✅ |
| API Key 安全（只存 `chrome.storage.local`，不进 DOM / 窗口 / Content Script） | ✅ |
| Mock Mode（无 Key 即可体验 UI + 流式 + 视觉 + 搜索模拟） | ✅ |
| 模型原生联网搜索（Gemini `google_search` grounding）+ 未联网核实的诚实降级 | ✅ |
| **独立搜索服务**（Tavily / Brave Search，自带 Key，优先于模型原生搜索） | ✅ |
| 网页视频截图（canvas + `tabs.captureVisibleTab` 裁剪降级） | ✅ |
| **播放中 10s 稀疏视觉采样**（显式开关，每时间点只分析一次，上限 240） | ✅ |
| **关键帧浏览**（缩略图 + 画面描述，点击跳转） | ✅ |

## 3. 仅 interface / placeholder 的能力

- **抖音 / 小红书适配器** —— 没有专用适配器；它们的 `<video>` 元素由 `GenericHtml5VideoAdapter` 兜底处理，创作者信息也只能拿到页面通用的 `meta[name=author]`。
- **Qwen 原生特性** —— 复用 OpenAI-compatible 通道；Qwen 特有的 `video_url` 输入 / Omni 音频输出（`modalities`）**尚未接入**，接口已预留。
- **视频 URL 直读** —— DirectUrlSource 只做分类；当前模型不支持直读时 UI 会诚实提示（不伪造“解析成功”）。
- **Bilibili 多分 P** —— `view` 接口只取 P1 的 `cid`，`?p=N` 的其余分 P 取不到字幕。
- **YouTube `fmt=srv3` / `fmt=json3` 字幕格式** —— 只解析默认 XML 形式；遇到其他格式会如实报“无法解析”，不猜测内容。
- **远端模型目录** —— `registry/remote-model-registry.ts` 的拉取函数已写好但未接入，模型清单随扩展打包、不联网下载。
- **内嵌字幕（MP4 container）** —— `services/container-subtitles.ts` 只有实现与测试，未接入 UI。

## 4. 加载扩展（开发者模式）

```bash
npm install
npm run build:chrome     # 输出到 .output/chrome-mv3/
```

1. 打开 `chrome://extensions`
2. 右上角打开 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `.output/chrome-mv3/` 目录
5. 点击工具栏的 **AI Video Tutor** 图标，即打开 Side Panel

## 5. 配置模型（设置页）

**没有独立的「API Keys」区块**：模型与 Key 在同一个表单里一起保存。

1. 侧边栏 → **Settings** → 「我的模型」→ **+ 添加模型**
2. 填写：
   - **模型名称**（如 `DeepSeek V4`，留空则用 Model ID）
   - **协议**（下拉）：OpenAI 兼容 / Dots API / Gemini (Google AI) / DeepSeek (官方) / Qwen (DashScope)
   - **Base URL**（可选；DeepSeek / Qwen / Dots 选中后会自动填入官方地址）
   - **Model ID**（如 `deepseek-chat` / `gemini-2.5-flash`）
   - **API Key**
3. 点击 **保存并检测** —— 会真实调用一次端点（`max_tokens: 8`）确认连通，并显示端点与错误分类
4. 在 **模型分工** 里分配角色：
   - **主助教（必选）** —— 需要文本输入
   - **视觉理解** —— 需要图像输入，用于「分析画面」与画面采样
   - **联网核验** —— 模型自带联网搜索时才出现在候选里
5. 模型卡上的 **自动探测能力** 按钮可用两次最小请求实测「文本输入 / 图像输入」，并把结果标为「已实测」

**可选：配置独立联网搜索**，「联网搜索服务」→ 选择 Tavily 或 Brave Search → 填入对应的 API Key。配置后联网核验优先用它，不依赖模型自带的联网能力；不配置则回退到支持联网的模型。

> **Gemini 走原生 REST**（`x-goog-api-key` 头，`generativelanguage.googleapis.com`），其余协议走 OpenAI 兼容通道。

## 6. Mock 模式（无需任何 API Key）

**尚未添加任何模型时就是 Mock 模式**。加载扩展后：

1. 打开任意带 HTML5 `<video>` 的网页（或拖入一个 MP4）
2. 打开 Side Panel，顶部会显示 **`DEMO / MOCK`** 徽标
3. 直接提问，会看到流式的模拟回答、模拟视觉结果、模拟联网来源
4. Mock 只用于体验 UI 与流程，**不会**被误认为真实 AI（界面有醒目徽标）

需要注意：Mock 不参与真实数据写入 —— 建立索引时会跳过 Mock 模型，只写本地截断摘要并在状态行说明原因。

## 7. 时间轴知识索引数据结构

```ts
interface KnowledgeChunk {
  id: string;           // `${videoId}#${index}`
  videoId: string;      // `page:<url>` 或 `local:<uuid>`
  startTime: number;
  endTime: number;
  transcript: string;   // 该片段合并后的字幕
  summary?: string;     // 由助教模型批量生成；失败时保留本地截断摘要
  keywords?: string[];  // 模型确实回答了才有值（有值 = 该片段已被 AI 覆盖）
  concepts?: string[];
  technicalTerms?: string[];
  claims?: string[];
  visualSummary?: string;
  ocr?: string[];
  importance?: number;
}

interface Keyframe {
  id: string;           // `${videoId}@${timestamp}` —— 同一时间点重复分析会覆盖
  videoId: string;
  timestamp: number;
  visualSummary?: string;
  ocr?: string[];
  technicalTerms?: string[];
  diagramType?: string | null;
  importantObjects?: string[];
  importance?: number;
  thumbnailDataUrl?: string;  // 160px 低分辨率预览
}
```

存储于 IndexedDB `AI_VIDEO_TUTOR_DB`，表：`videos / chunks / keyframes / conversations / messages / learningNotes`。不存完整视频、不长期存高清截图。

## 8. Provider Capability Router 的工作方式

- 每个已知模型在 `src/data/model-registry.json` 声明 `capabilities`（textInput / imageInput / nativeWebSearch …），经 Zod 校验。
- 业务代码**从不写** `if (model.includes("gemini"))`，而是：

```ts
if (model.capabilities.imageInput) enableVisualQuestion();
if (model.capabilities.nativeWebSearch) enableFactCheck();
```

- 能力来源按优先级解析（`registry/capability-resolver.ts`）：**本地覆盖表**（`model-overrides.json`）→ **内置模型表**（`model-registry.json`）→ 运行时**手动指定**（可与已知能力合并）→ **协议默认值**。用「自动探测能力」实测后，来源标记为「已实测」，实测结果覆盖以上推断。
- `buildProviderSet()` 在后台组装 Tutor / Vision / Video / Audio / Search 角色。Search 有两条路径：
  - 设置里选了独立搜索服务（Tavily / Brave）时**优先用它**；选了服务但没填 Key 会明确提示缺哪个 Key，而不是静默回退。
  - 否则回退顺序为：Search 槽 → Vision（有原生搜索时）→ Audio → Tutor → Disabled。
- UI 顶部的能力状态、快捷按钮的禁用与原因，全部由这个路由器驱动。

## 9. 字幕与画面的获取路径

**字幕**（`services/subtitle-resolver.ts`，优先级从高到低）：

1. 用户加载的 `.srt` / `.vtt` 文件
2. 页面的 `<track>` / `textTracks`
3. **平台字幕**：YouTube / Bilibili 页面自身没有字幕时，后台向该平台的公开接口请求（两次到四次网络请求）。失败会说明具体原因，绝不伪造字幕。

**画面**：

- 「分析画面」对当前时间点截图：先试 canvas 直读（同源视频），跨域被 taint 时降级到 `tabs.captureVisibleTab` 裁剪；仍失败则诚实提示「无法直接获取视频画面，可依字幕学习」。
- 「画面自动采样」在播放中每跨过一个 10s 边界截一帧交给视觉模型，**默认关闭**。每个时间点只分析一次，上限 240 个时间点。

## 10. 当前已知限制

- 无字幕的视频无法建立时间轴索引（会明确提示，不伪造）。平台字幕接口可能因同意页 / 风控 / 登录限制而失败，此时如实报错。
- 网页视频**不会**为了建索引而强制 seek 干扰观看；播放中采样只在用户显式开启后运行，且受 240 上限约束。
- 平台字幕抓取会向用户当前正在观看的站点发出匿名请求（`credentials: 'omit'`，不带 Cookie），见隐私政策第 4 节。
- YouTube / Bilibili 的解析依赖对方页面与接口结构，属于 best-effort：结构变化时会失败并报错，而不是给出错误结果。
- Gemini 协议目前忽略自定义 Base URL（走原生端点 `generativelanguage.googleapis.com`）。
- 本地视频「分析完整视频」的进度只存在于内存，刷新即丢失。
- 本地视频的时间轴与关键帧点击跳转需要在播放器里手动定位（侧边栏不持有本地 `<video>` 元素）。
- Chat 页的 Markdown 渲染依赖 `react-markdown`，产物中该依赖会触发安全扫描器的误报（见 `store/审核说明.md`）。
- Qwen 的视频 / Omni 音频、DeepSeek 的 reasoning 流式展示尚未完整接入。

## 11. 下一阶段

1. **Bilibili 多分 P 与登录态字幕**：`?p=N` 的 `cid` 选择，以及需要登录才返回地址的字幕轨。
2. **关键帧驱动的问答**：把已存的关键帧画面描述接入 RAG，让“刚才那个图是什么”可由时间轴直接回答。
3. **抖音 / 小红书适配器**：补齐这两个平台的创作者与字幕来源。
4. **YouTube 其他字幕格式**：`fmt=srv3`（`<p t= d=>` 毫秒形式）与 `fmt=json3`。
5. **内嵌字幕接入**：把 `container-subtitles.ts`（MP4 内嵌字幕检测）接进字幕解析链。

---

## 12. 打包发布到 Chrome Web Store

### 扩展图标（已就绪）

图标已内置，并在 `wxt.config.ts` 的 `manifest.icons` 中声明（16 / 32 / 48 / 128 px）：

- `public/icons/icon-16.png` / `icon-32.png` / `icon-48.png` / `icon-128.png` —— 商店与工具栏使用
- `public/icons/icon.svg` —— 可编辑的矢量源文件
- `scripts/generate-icons.ps1` —— 重新生成 PNG

### 打包与提交

```bash
npm run build:chrome       # 输出 .output/chrome-mv3/
npx wxt zip -b chrome      # 生成 .output/chrome-mv3-*.zip
```

1. 打开 [Chrome Web Store 开发者后台](https://chrome.google.com/webstore/devconsole) → 新建项目
2. 上传刚生成的 `.zip`
3. 填写商店信息：说明、截图（1280×800 或 640×400）、类别
4. 填写**隐私政策 URL**（见第 13 节）
5. 提交审核

商店文案素材（宣传图与截图）在 `store/`，可用 `scripts/generate-store-assets.ps1` 重新生成。

### 上架注意点

- **权限最小化**：manifest 只声明 `storage / activeTab`（外加 WXT 依据 sidepanel 入口自动加入的 `sidePanel`）与 `<all_urls>` host 权限。逐项理由：`storage` 存设置与 API Key；`activeTab` 在用户打开侧边栏后操作当前标签页并截取画面；`sidePanel` 承载 UI；`<all_urls>` 让声明式的 content script 能在任意网站的 `<video>` 上运行、让扩展能访问用户自己配置的 AI 与搜索端点，并在用户主动建立索引时访问 YouTube / Bilibili 的公开字幕接口。
- **不要添加 `scripting` 或 `tabs`**：content script 由 manifest 声明式注入，不需要 `scripting`；全部 `browser.tabs.*` 调用靠 `<all_urls>` + `activeTab` 即可完成。这两项曾被 Chrome 应用商店判定为「请求但不使用」而拒审。
- 完整的权限理由、审核员测试指引与数据披露表单建议回答见 `store/审核说明.md`，可直接粘贴进商店后台。
- 提交前用 `unzip -p <zip> manifest.json` 核对权限，**不要**用解压之外的旧包（历史上存在过仍含 `scripting` 的旧产物）。

---

## 13. 隐私政策

项目内置中英双语隐私政策页面（`docs/index.html`），通过 GitHub Pages 托管在线。

该仓库设置了 Pages 自定义域名，`https://luvchippy.github.io/AI-Video-Tutor/` 会 301 跳转过去，所以商店的「隐私政策 URL」**直接填自定义域名，避免跳转链**：

```
https://github.923577.xyz/AI-Video-Tutor/
```

**改了 `docs/index.html` 必须 push 才生效** —— 审核员读的是线上版本。

---

## 开发命令

```bash
npm run dev          # 开发模式（Chrome + HMR）
npm run typecheck    # tsc --noEmit
npm run test         # Vitest 单元测试
npm run lint         # ESLint
npm run build        # 生产构建（chrome-mv3）
npm run build:chrome # 同上，显式指定 Chrome 目标
npm run zip          # 打包成商店可上传的 zip
```