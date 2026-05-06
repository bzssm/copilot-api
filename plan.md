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

`supported_endpoints` 字段在 `Model` 顶层（不在 `capabilities` 内），例如：
```json
{
  "id": "claude-opus-4.6-1m",
  "supported_endpoints": ["/v1/messages", "/chat/completions"],
  "vendor": "Anthropic",
  "capabilities": { ... }
}
```

可能的 endpoint 值：`/v1/messages`、`/chat/completions`、`/responses`

### 问题

目前代码忽略 `supported_endpoints`，所有请求都走 `/chat/completions`。如果某个模型只支持 `/responses` 或 `/v1/messages`，请求会失败。

---

## 三种 Endpoint 的请求/响应格式

### 1. `/chat/completions` (OpenAI Chat Completions)

**请求格式：**
```json
{
  "model": "gpt-4o",
  "messages": [
    { "role": "system", "content": "You are helpful." },
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi there!" },
    { "role": "user", "content": [
      { "type": "text", "text": "What's this?" },
      { "type": "image_url", "image_url": { "url": "...", "detail": "auto" } }
    ]}
  ],
  "max_tokens": 4096,
  "temperature": 0.7,
  "stream": true,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather",
        "parameters": { "type": "object", "properties": { "city": { "type": "string" } } }
      }
    }
  ],
  "tool_choice": "auto"
}
```

**Non-streaming 响应：**
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello!",
        "tool_calls": [
          {
            "id": "call_xxx",
            "type": "function",
            "function": { "name": "get_weather", "arguments": "{\"city\":\"NYC\"}" }
          }
        ]
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

**Streaming 响应（SSE）：**
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### 2. `/v1/messages` (Anthropic Messages)

**请求格式：**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "system": "You are helpful.",
  "messages": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi there!" },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "What's this?" },
        { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } }
      ]
    }
  ],
  "stream": true,
  "temperature": 0.7,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get weather",
      "input_schema": { "type": "object", "properties": { "city": { "type": "string" } } }
    }
  ],
  "tool_choice": { "type": "auto" },
  "thinking": { "type": "enabled", "budget_tokens": 10000 },
  "metadata": { "user_id": "..." }
}
```

**与 Chat Completions 的关键差异：**
- `system` 是顶层字段，不在 messages 数组中
- 图片用 `type: "image"` + `source.type: "base64"`，不是 `image_url`
- tools 用 `input_schema`，不是 `parameters`；tool 不包在 `function` 对象里
- 支持 `thinking`（extended thinking）
- `tool_choice` 是对象 `{ type: "auto" }`，不是字符串 `"auto"`

**Non-streaming 响应：**
```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "Let me think..." },
    { "type": "text", "text": "Hello!" },
    {
      "type": "tool_use",
      "id": "toolu_xxx",
      "name": "get_weather",
      "input": { "city": "NYC" }
    }
  ],
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 20,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

**与 Chat Completions 响应的关键差异：**
- 没有 `choices` 数组，content 直接在顶层
- `stop_reason` 值不同：`end_turn`/`max_tokens`/`stop_sequence`/`tool_use`（vs `stop`/`length`/`tool_calls`/`content_filter`）
- tool 调用是 `tool_use` content block，不是 `message.tool_calls`
- 支持 `thinking` content block
- usage 有 `cache_creation_input_tokens` 和 `cache_read_input_tokens`

**Streaming 响应（SSE）：**
```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-20250514","stop_reason":null,"usage":{"input_tokens":10,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}

event: message_stop
data: {"type":"message_stop"}
```

**与 Chat Completions streaming 的关键差异：**
- 有 `event:` 字段（named events），不是只有 `data:`
- 使用 content block 生命周期：`content_block_start` → `content_block_delta` → `content_block_stop`
- 没有 `[DONE]`，以 `message_stop` 事件结束

### 3. `/responses` (OpenAI Responses API)

**请求格式：**
```json
{
  "model": "gpt-4o",
  "input": [
    { "role": "developer", "content": "You are helpful." },
    { "role": "user", "content": "Hello" },
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "What's this?" },
        { "type": "input_image", "image_url": "..." }
      ]
    }
  ],
  "max_output_tokens": 4096,
  "temperature": 0.7,
  "stream": true,
  "instructions": "System-level instructions (alternative to developer message)",
  "tools": [
    {
      "type": "function",
      "name": "get_weather",
      "description": "Get weather",
      "parameters": { "type": "object", "properties": { "city": { "type": "string" } } }
    }
  ],
  "tool_choice": "auto",
  "reasoning": { "effort": "medium" },
  "text": { "format": { "type": "text" } },
  "store": false
}
```

**与 Chat Completions 的关键差异：**
- `input` 代替 `messages`
- `instructions` 顶层字段代替 system message（也可以用 `developer` role 的 input item）
- 内容类型不同：`input_text` / `input_image`（vs `text` / `image_url`）
- `max_output_tokens` 代替 `max_tokens`
- tool 的 `name` 在顶层，不在 `function` 对象里
- `reasoning` 代替思维链相关配置
- 有 `store`、`previous_response_id` 等状态管理字段

**Non-streaming 响应：**
```json
{
  "id": "resp_xxx",
  "object": "response",
  "created_at": 1741386163,
  "status": "completed",
  "model": "gpt-4o",
  "output": [
    {
      "type": "message",
      "id": "msg_xxx",
      "status": "completed",
      "role": "assistant",
      "content": [
        { "type": "output_text", "text": "Hello!", "annotations": [] }
      ]
    }
  ],
  "usage": {
    "input_tokens": 10,
    "input_tokens_details": { "cached_tokens": 0 },
    "output_tokens": 20,
    "output_tokens_details": { "reasoning_tokens": 0 },
    "total_tokens": 30
  }
}
```

**与 Chat Completions 响应的关键差异：**
- `output` 数组代替 `choices` 数组
- output items 有 `type` 字段（`message`、`function_call` 等）
- 内容用 `output_text` 类型（vs `content` 字符串）
- `status` 字段代替 `finish_reason`（`completed`/`incomplete`/`failed`）
- usage 结构更详细，有 `input_tokens_details` 和 `output_tokens_details`
- 有 `created_at`（时间戳秒）而非 `created`

**Streaming 响应（SSE）：**
```
event: response.created
data: {"type":"response.created","response":{"id":"resp_xxx","status":"in_progress",...}}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant",...}}

event: response.content_part.added
data: {"type":"response.content_part.added","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"Hello"}

event: response.content_part.done
data: {"type":"response.content_part.done","output_index":0,"content_index":0,"part":{"type":"output_text","text":"Hello!"}}

event: response.output_item.done
data: {"type":"response.output_item.done","output_index":0,"item":{...}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_xxx","status":"completed",...}}
```

**与 Chat Completions streaming 的关键差异：**
- 使用层级化的生命周期事件：`response.created` → `output_item.added` → `content_part.added` → `delta` → `content_part.done` → `output_item.done` → `response.completed`
- event 名称更丰富、粒度更细
- 每个 delta 都包含 `output_index` 和 `content_index` 用于定位

---

## 目标

根据模型的 `supported_endpoints` 和请求来源格式，智能选择上游 Copilot endpoint。

### Endpoint 选择逻辑

**规则 1：请求格式与模型支持匹配 → 直接转发（无需翻译）**
- 请求是 `/v1/messages` 且模型支持 `/v1/messages` → 直接用 `/v1/messages`
- 请求是 `/chat/completions` 且模型支持 `/chat/completions` → 直接用 `/chat/completions`

**规则 2：请求格式与模型支持不匹配 → 选择一个支持的 endpoint 并做格式转换**
- 优先级：`/responses` > `/v1/messages` > `/chat/completions`
- 从模型的 `supported_endpoints` 中按优先级选第一个支持的
- 例如：请求是 `/v1/messages`，但模型只支持 `/responses` + `/chat/completions` → 选 `/responses`

**规则 3：无 `supported_endpoints` 字段 → fallback 到 `/chat/completions`（保持向后兼容）**

### 错误处理策略

- endpoint 选择后上游返回错误 → 直接返回错误给客户端，不做 fallback 重试
- 理由：如果模型声称支持某 endpoint 但实际失败，fallback 可能产生难以排查的问题

---

## 实施步骤

### Phase 1: 基础设施（2个文件）

**任务 1.1: 更新 Model 类型定义**
- 文件：`src/services/copilot/get-models.ts`
- 在 `Model` interface 顶层添加 `supported_endpoints?: string[]`

**任务 1.2: 添加 endpoint 选择工具函数**
- 新建文件：`src/lib/endpoint-selector.ts`
- 实现 `selectEndpoint(requestFormat: "messages" | "chat-completions", model: Model): "/v1/messages" | "/chat/completions" | "/responses"`
- 包含优先级逻辑和 fallback

### Phase 2: 添加 Copilot `/v1/messages` 直接转发能力（2-3个文件）

**任务 2.1: 新建 messages service**
- 新建文件：`src/services/copilot/create-messages.ts`
- 实现 `createMessages(payload)` — 直接发送 Anthropic 格式请求到 Copilot `/v1/messages`
- 处理 streaming 和 non-streaming

**任务 2.2: 修改 messages handler 使用 endpoint 选择**
- 文件：`src/routes/messages/handler.ts`
- 当模型支持 `/v1/messages` 时，直接转发 Anthropic payload 到 Copilot `/v1/messages`，不经过 OpenAI 翻译
- 当模型不支持时，走原有翻译逻辑

注意：`createChatCompletions` 保持不变，新 endpoint 各建独立 service 函数。

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
3. Phase 3 最后 — `/responses` 格式最复杂，但作为最新 API 应优先支持
4. 每个 Phase 独立可测试

## 注意事项

- `/responses` 是 OpenAI 的新 API（2025年新增），格式与 chat completions 差异较大，需要确认 Copilot 上游的具体实现是否完全兼容 OpenAI 官方格式
- 建议先跑一下 `bun run dev`，找一个只支持 `/responses` 的模型，手动测试一下 Copilot 端的实际请求/响应格式
- Copilot 的 `/responses` 可能不支持 `store`、`previous_response_id` 等状态管理功能，需要实测确认
