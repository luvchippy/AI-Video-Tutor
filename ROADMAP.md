# ROADMAP

本文件记录已确认但尚未实现的方向，以及有意推迟的清理项。每条都标注了代码中已经存在的可复用部件，避免重新设计。

---

## 一、原生视频理解接入

**为什么优先**：这是成本最低、收益最大的一条。provider 层的视频能力其实已经写好，只是没有任何代码调用它。

**已经存在的部分**

- `src/providers/ai/dots.ts:72-111` — `DotsProvider.serializePart` 已实现原生 `video_url` / `audio_url` 序列化；Dots 是当前唯一真正支持视频输入的已接入 provider。
- `src/data/model-overrides.json` 与 `src/data/model-registry.json` 里的 Dots 条目已声明 `videoInput` / `directVideoUrl: true`，这些是模型事实，没有被改动。
- `src/services/frame-capture.ts` + `timeline/sparse-analysis.ts` — 现有的整片分析走逐帧抽帧 + 视觉模型，可作为降级路径保留。

**缺失的部分**

- `src/services/tutor-engine.ts` 的 `answer()` 只有纯文本 prompt 与 `analyzeImage()`（单图）两条路径，从不构造视频内容部分。
- `src/services/context-assembly.ts` 只拼接字符串，没有多模态部分。
- `src/providers/ai/openai-compatible.ts:128-131` 会把 `video_url` 降级成一行文本——这是给不支持视频的端点兜底用的，接入时需要按 provider 能力区分。

**做法**

1. 在 `AiProvider` 上增加一个视频分析方法（对齐现有 `analyzeImage` 的形状），只在 `capabilities.directVideoUrl` 为真的 provider 上实现。
2. `TutorEngine` 在 `VIDEO_CONTENT` 意图且模型声明支持时改走该方法，失败则回落到现在抽帧的路径。
3. 从 `src/registry/capability-resolver.ts` 的 `UNWIRED_CAPABILITIES` 中移除对应条目，并在设置页恢复「视频理解」角色槽位。
4. Gemini 的原生视频用的是另一套请求结构（`fileData` / YouTube），需要单独实现，不要复用 Dots 的路径。

---

## 二、时间戳笔记 + AI 代笔

**已经存在的部分**

- `src/types/knowledge.ts:73-80` — `LearningNote` 已有 `videoId` / `chunkId` / `timestamp` / `text` 字段，正是时间戳锚定所需的形状。
- `src/storage/repositories.ts:76` — `addLearningNote` 已实现写入。
- `src/timeline/chunker.ts` + `KnowledgeChunk.startTime/endTime` — 可用来把笔记锚到具体片段。
- `src/storage/db.ts` — Dexie 表结构已注册 `learningNotes`。

**缺失的部分**

- **没有读取路径**：`repositories.ts` 里只有写入，没有 `listLearningNotes`，也没有任何界面能展示已保存的笔记。这是先决条件，先确认笔记能否被读出来。
- 没有笔记界面，没有 AI 整理/续写。

**做法**

1. 补 `listLearningNotes(videoId)` 与所需索引，在侧边栏增加笔记页。
2. 播放中加入「在此处记笔记」，自动带上当前播放时间与命中的 `chunkId`。
3. 「让 AI 整理 / 续写」把选中笔记与邻近片段一并发给主助教模型。

---

## 三、技法拆解模式

面向「跟着视频学剪辑手法与特效」的使用场景。

**已经存在的部分**

- `src/types/knowledge.ts:22-33` — `Keyframe` 已有 `visualSummary` / `ocr` / `technicalTerms` / `diagramType` / `importantObjects`。`diagramType` 与 `technicalTerms` 正好是技法分析要写入的字段，目前仅由稀疏分析流程写入。
- `src/timeline/sparse-analysis.ts` — 已有关键帧采样节流逻辑。
- `src/prompts/` 下已有 `tutor.ts` / `vision.ts` / `sparse.ts` 三个提示词模块，可照此新增。

**缺失的部分**

- 没有分析镜头语言的提示词，也没有输出「技法清单 + 复现步骤」的模式。
- 缺少触发入口（例如「拆解这一段」按钮）。

**做法**

1. 新增 `prompts/craft.ts`，让视觉模型对关键帧输出：景别、运镜、转场方式、调色倾向、特效类型，以及可复现的操作步骤。
2. 扩展后台的 `ANALYZE_FRAME` 处理，支持传入分析模式。
3. 在侧边栏加「拆解这一段」，对当前时间附近的若干关键帧运行该模式。

---

## 暂不计划

- **思维导图** — 代码中不存在任何相关类型、组件或存储结构。商店文案中同样不要提及。
- **`<all_urls>` 收窄为站点白名单** — 能改善审核观感，但会改变「任意网站可用」的产品定义，并需要引入 `optional_host_permissions` 与运行时授权流程，属重构级改动。
- **清理空转的 video / audio provider 解析** — `background.ts` 的 `buildProviderSet` 仍会解析这两个槽位，但 `computeCapabilityStatus` 已不再使用其结果。无审核收益，暂留以减少改动面；接入原生视频时一并处理。

## 待确认

- `deepseek-v4.1-flash` 的 `contextWindow` 未填（`src/data/model-registry.json`）。该条目的视觉能力依据模型方说明添加，未经本仓库实测——请在设置页用「保存并检测」实测一次 imageInput 后再决定是否补 `lastVerified`。
- **Dots 端点 `note3-prev-api.askdiandian.com` 域名带 `prev`，疑似预览端点**，存在随时变更或下线的风险。隐私政策已按当前地址披露；若端点变更，必须同步更新 `docs/index.html` 的中英两段服务商列表。
- `src/registry/remote-model-registry.ts` 的 `loadEffectiveRegistry`（拉取 `models.dev/catalog.json`）目前没有任何生产调用方。要么接入，要么删除。**若接入，必须同时更新隐私政策的「其他网络请求」一节**——该节现在明确写着不存在这类请求。