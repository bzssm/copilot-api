# Architecture Diagram

This project is a single Node.js/Bun service that exposes OpenAI and Anthropic compatible APIs and proxies requests to GitHub Copilot backend services. It also includes local usage/session persistence and a built-in dashboard.

## Application Architecture

```mermaid
flowchart TD
    subgraph Client["Client Layer"]
        CLI["CLI Users"]
        APIClient["API Clients"]
        Browser["Dashboard Browser"]
    end

    subgraph App["Application Layer - Hono on Bun"]
        Router["Hono Routes"]
        Handlers["Request Translation Handlers"]
        Services["Copilot and GitHub Service Clients"]
        TokenMgmt["Token Management"]
    end

    subgraph Data["Data Layer"]
        SessionFiles[("sessions/*.json")]
        UsageFile[("token-usage.json")]
        TokenFile[("github_token")]
    end

    subgraph External["External Services"]
        CopilotAPI["api.githubcopilot.com"]
        GitHubAPI["api.github.com"]
    end

    CLI -->|"CLI command"| Router
    APIClient -->|"HTTP requests"| Router
    Browser -->|"Dashboard and API calls"| Router
    Router -->|"delegate"| Handlers
    Handlers -->|"fetch tokens"| TokenMgmt
    Handlers -->|"proxy requests"| Services
    Services -->|"Copilot requests"| CopilotAPI
    Services -->|"GitHub usage and auth"| GitHubAPI
    Handlers -->|"session logging"| SessionFiles
    Handlers -->|"usage aggregation"| UsageFile
    TokenMgmt -->|"read and write"| TokenFile
```

### Technology Stack Summary

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Presentation | Static HTML dashboard | N/A | Display usage and session records |
| API | Hono | ^4.9.9 | REST endpoint routing |
| Runtime | Bun | >=1.2.x | JavaScript runtime and package management |
| Service Integration | Undici and fetch-event-stream | ^7.16.0 / ^0.1.5 | Upstream HTTP and streaming requests |
| Validation | Zod | ^4.1.11 | Request validation and schema parsing |
| Persistence | Local JSON files via Node fs | Built-in | Session, usage, and token persistence |

### Data Storage & External Services

The service persists operational data in local JSON files (`sessions/`, `token-usage.json`, and a token file in the user app directory) rather than a relational database. It integrates with GitHub APIs for authentication and usage checks and with GitHub Copilot backend APIs for inference and model operations.

### Key Architectural Decisions

- Uses a single-process proxy architecture with route-specific translation logic for OpenAI, Responses, and Anthropic compatibility.
- Keeps persistence lightweight through file-based storage instead of external databases.
- Centralizes authentication/token lifecycle in shared token utilities used by all outbound service calls.

## Component Relationships

```mermaid
flowchart LR
    subgraph Presentation["Presentation"]
        StartCmd["CLI start command"]
        Dashboard["Dashboard page"]
        RouteModules["Route modules"]
    end

    subgraph Business["Business Logic"]
        ChatHandler["Chat completion handler"]
        ResponsesHandler["Responses handler"]
        MessagesHandler["Messages handler"]
        ModelHandler["Models handler"]
        EmbeddingHandler["Embeddings handler"]
        UsageHandler["Usage and token handlers"]
    end

    subgraph DataAccess["Data Access"]
        SessionStore["session-store"]
        UsageTracker["usage-tracker"]
        PathsLib["paths and state libs"]
    end

    subgraph Infra["Infrastructure"]
        ErrorForward["forwardError"]
        TokenLib["token setup and refresh"]
        CopilotSvc["services/copilot/*"]
        GitHubSvc["services/github/*"]
    end

    StartCmd -->|"bootstraps"| RouteModules
    Dashboard -->|"calls"| RouteModules
    RouteModules -->|"dispatch"| ChatHandler
    RouteModules -->|"dispatch"| ResponsesHandler
    RouteModules -->|"dispatch"| MessagesHandler
    RouteModules -->|"dispatch"| ModelHandler
    RouteModules -->|"dispatch"| EmbeddingHandler
    RouteModules -->|"dispatch"| UsageHandler

    ChatHandler -->|"logs"| SessionStore
    MessagesHandler -->|"logs"| SessionStore
    ChatHandler -->|"tracks usage"| UsageTracker
    ResponsesHandler -->|"tracks usage"| UsageTracker

    ChatHandler -->|"calls"| CopilotSvc
    ResponsesHandler -->|"calls"| CopilotSvc
    MessagesHandler -->|"calls"| CopilotSvc
    UsageHandler -->|"calls"| GitHubSvc
    ModelHandler -->|"calls"| CopilotSvc

    TokenLib -.->|"provides auth context"| CopilotSvc
    TokenLib -.->|"provides auth context"| GitHubSvc
    ErrorForward -.->|"cross-cutting error mapping"| RouteModules
    PathsLib -.->|"file path config"| SessionStore
```

### Component Inventory

| Component | Layer | Type | Responsibility |
|---|---|---|---|
| `src/start.ts` | Presentation | CLI command module | Parses options and starts the server runtime |
| `src/server.ts` | Presentation | Route composition module | Registers public routes and API compatibility routes |
| `src/routes/*/route.ts` | Presentation | Route modules | Exposes endpoint handlers per API domain |
| `src/routes/*/handler.ts` | Business Logic | Request translator/handler | Validates input and translates provider formats |
| `src/services/copilot/*` | Infrastructure | HTTP service clients | Sends model and generation requests to Copilot backend |
| `src/services/github/*` | Infrastructure | HTTP service clients | Handles GitHub usage and auth-related API calls |
| `src/lib/token.ts` | Infrastructure | Token lifecycle module | Loads, refreshes, and stores auth tokens |
| `src/lib/session-store.ts` | Data Access | File persistence module | Stores and retrieves session request and response logs |
| `src/lib/usage-tracker.ts` | Data Access | Usage aggregator module | Persists token usage statistics by model |
| `src/lib/error.ts` | Infrastructure | Error normalization module | Converts internal errors to HTTP responses |
