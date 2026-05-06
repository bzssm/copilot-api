# 多 Endpoint 路由支持计划

## 现状总结

### 当前架构

```
客户端请求                           Copilot 后端
─────────────────────────────────────────────────────────
POST /v1/messages (Anthropic格式)
  → translateToOpenAI()              → POST /chat/completions
  → createChatCompletions()
  ← translateToAnthropic()           ← chat completion response

POST /v1/chat/completions (OpenAI格式)
  → createChatCompletions()          → POST /chat/completions
  ← 直接返回                          ← chat completion response
```

**所有请求最终都走 `createChatCompletions()`，即 Copilot 的 `/chat/completions` endpoint。**

### 关键文件

| 文件 | 职责 |
|---|---|
| `src/routes/messages/handler.ts` | 处理 `/v1/messages` 请求，调用翻译层 |
| `src/routes/messages/non-stream-translation.ts` | Anthropic ↔ OpenAI 格式双向翻译 |
| `src/routes/messages/stream-translation.ts` | OpenAI streaming chunk → Anthropic SSE 事件翻译 |
| `src/routes/chat-completions/handler.ts` | 处理 `/v1/chat/completions` 请求，直接转发 |
| `src/services/copilot/create-chat-completions.ts` | 调用 Copilot `/chat/completions` |
| `src/lib/api-config.ts` | Copilot API base URL 和 headers |
| `src/lib/state.ts` | 全局状态，包含 models 缓存 |

### Models 数据结构

每个 model 有 `supported_endpoints` 字段，例如：
```json
{
  "id": "claude-opus-4.6-1m",
  "supported_endpoints": ["/v1/messages", "/chat/completions"],
  "vendor": "Anthropic"
}
```

可能的 endpoint 值：`/v1/messages`、`/chat/completions`、`/responses`

### 问题

目前代码忽略 `supported_endpoints`，所有请求都走 `/chat/completions`。如果某个模型只支持 `/responses` 或 `/v1/messages`，请求会失败。

---

## 目标

根据模型的 `supported_endpoints` 和请求来源格式，智能选择上游 Copilot endpoint。

### Endpoint 选择优先级

1. **请求格式与模型支持匹配** — 直接转发：
   - 请求是 `/v1/messages` 且模型支持 `/v1/messages` → 直接用 `/v1/messages`
   - 请求是 `/chat/completions` 且模型支持 `/chat/completions` → 直接用 `/chat/completions`

2. **请求格式与模型支持不匹配** — 按优先级选择并转换：
   - 优先级：`/responses` > `/v1/messages` > `/chat/completions`
   - 例如：模型同时支持三种 → 用 `/responses`
   - 例如：模型支持 responses + completions → 用 `/responses`

3. **无 `supported_endpoints` 字段** — fallback 到 `/chat/completions`（保持向后兼容）

---

## 实施步骤

### Phase 1: 基础设施（2个文件）

**任务 1.1: 更新 Model 类型定义**
- 文件：`src/services/copilot/get-models.ts`
- 在 `Model` interface 中添加 `supported_endpoints?: string[]`

**任务 1.2: 添加 endpoint 选择工具函数**
- 新建文件：`src/lib/endpoint-selector.ts`
- 实现 `selectEndpoint(requestFormat: "messages" | "chat-completions", model: Model): "/v1/messages" | "/chat/completions" | "/responses"`
- 包含优先级逻辑和 fallback

### Phase 2: 添加 Copilot `/v1/messages` 直接转发能力（2个文件）

**任务 2.1: 新建 messages service**
- 新建文件：`src/services/copilot/create-messages.ts`
- 实现 `createMessages(payload)` — 直接发送 Anthropic 格式请求到 Copilot `/v1/messages`
- 处理 streaming 和 non-streaming

**任务 2.2: 修改 messages handler 使用 endpoint 选择**
- 文件：`src/routes/messages/handler.ts`
- 当模型支持 `/v1/messages` 时，直接转发 Anthropic payload 到 Copilot `/v1/messages`，不经过 OpenAI 翻译
- 当模型不支持时，走原有翻译逻辑

### Phase 3: 添加 Copilot `/responses` 支持（3个文件）

**任务 3.1: 新建 responses service**
- 新建文件：`src/services/copilot/create-responses.ts`
- 实现 `createResponses(payload)` — 发送请求到 Copilot `/responses`

**任务 3.2: 添加 Anthropic ↔ Responses 格式转换**
- 新建文件：`src/routes/messages/responses-translation.ts`
- Anthropic messages payload → OpenAI Responses API payload
- OpenAI Responses API response → Anthropic response

**任务 3.3: 添加 Chat Completions ↔ Responses 格式转换**
- 新建文件：`src/routes/chat-completions/responses-translation.ts`
- Chat completions payload → Responses payload，以及反向
- 修改 `src/routes/chat-completions/handler.ts` 使用 endpoint 选择

### Phase 4: 集成和测试

**任务 4.1: 在两个 handler 中集成 endpoint 选择逻辑**
- 确保 messages handler 和 chat-completions handler 都使用 `selectEndpoint()`
- 添加日志输出实际选择的 endpoint

**任务 4.2: 测试**
- 测试 endpoint 选择逻辑
- 测试各种转换路径

---

## 建议执行顺序

1. Phase 1 先做，打好基础
2. Phase 2 次之 — 先解决 Anthropic 模型直接走 `/v1/messages` 的最常见场景
3. Phase 3 最后 — `/responses` 格式最复杂，需要了解 OpenAI Responses API 的具体结构
4. 每个 Phase 独立可测试

## 注意事项

- `/responses` 是 OpenAI 的新 API（2025年新增），格式与 chat completions 差异较大，需要确认 Copilot 上游的具体实现是否完全兼容 OpenAI 官方格式
- 建议先跑一下 `bun run dev`，找一个只支持 `/responses` 的模型，手动测试一下 Copilot 端的实际请求/响应格式
