---
name: architecture-diagram
description: Generate architecture diagram with component relationship details from project analysis
---

# Architecture Diagram

This skill generates a two-layer architecture visualization: a high-level application architecture diagram and a detailed component relationship diagram. Produce both in a single pass and save to `.github/modernize/assessment/architecture-diagram.md`.

## Input Parameters

- `workspace-path` (optional): Path to the project to analyze (defaults to current directory)

## Execution Steps

### Step 1: Analyze Project Structure

- Examine build files (Java: pom.xml, build.gradle; .NET: *.csproj, *.sln; JS/TS: package.json, tsconfig.json)
- Review configuration files (application.properties, appsettings.json, .env, database/API configs)
- Scan key source files to extract: framework, major dependencies, data access patterns, external integrations, technology stack
- Identify application layers (UI, Business Logic, Data Access), data storage technologies, and external service dependencies

### Step 2: Generate Layer 1 — Application Architecture Diagram

Create a **Mermaid `flowchart TD`** diagram showing:
- Application layers with technology info (use `subgraph` for grouping)
- Data storage components (specific names like "PostgreSQL", "Redis")
- External service integrations
- Data flow with descriptive arrow labels

**Do NOT include**: individual classes/methods, migration directions, or any text/tables/lists outside the Mermaid block.

Example:

~~~mermaid
flowchart TD
    subgraph Client["Client Layer"]
        Browser["Web Browser"]
    end
    subgraph App["Application Layer - Spring Boot 2.7"]
        Web["Spring MVC + Thymeleaf"]
        Security["Spring Security"]
        Service["Business Services"]
    end
    subgraph Data["Data Layer"]
        JPA["Spring Data JPA"]
        DB[("PostgreSQL 14")]
        Cache[("Redis")]
    end
    subgraph External["External Services"]
        SMTP["SMTP Email Service"]
        S3["AWS S3 Storage"]
    end

    Browser -->|"HTTP requests"| Web
    Web --> Security -->|"authorized"| Service
    Service -->|"CRUD operations"| JPA
    JPA -->|"SQL queries"| DB
    Service -->|"session cache"| Cache
    Service -->|"send email"| SMTP
    Service -->|"file upload"| S3
~~~

### Step 3: Analyze Component Interactions

- Identify key component types by framework conventions:
  - Java (Spring): Controllers, Services, Repositories, Configurations, Entities, DTOs, Listeners, Filters
  - Java (Jakarta EE): Servlets, EJBs, CDI Beans, JPA Entities, JAX-RS Resources
  - .NET (ASP.NET Core): Controllers, Services, Middleware, DbContext, Entities, Hubs, Filters
  - .NET (Blazor/MVC): Pages, Components, ViewModels
  - JavaScript/TypeScript (Node.js): Routes, Controllers, Services, Middleware, Models
  - JavaScript/TypeScript (React/Angular/Vue): Components, Hooks, Services, Stores, Pages
- Trace dependency injection (constructor/field injection)
- Map communication patterns (REST, gRPC, message queues, events)
- Map data access patterns (service-to-repository, DbContext usage)
- Detect cross-cutting concerns (middleware, interceptors, filters)

### Step 4: Generate Layer 2 — Component Relationship Diagram

Create a **Mermaid `flowchart LR`** diagram showing:
- Components grouped by architectural layer using `subgraph` (Presentation, Business Logic, Data Access, Infrastructure)
- Interaction arrows with brief labels
- Cross-cutting concerns

**Do NOT include**: method signatures, private helpers, external dependencies (covered by dependency-map skill), or any text outside the Mermaid block.

Example:

~~~mermaid
flowchart LR
    subgraph Presentation
        UserCtrl["UserController"]
        OrderCtrl["OrderController"]
    end
    subgraph Business["Business Logic"]
        UserSvc["UserService"]
        OrderSvc["OrderService"]
        NotifSvc["NotificationService"]
    end
    subgraph DataAccess["Data Access"]
        UserRepo["UserRepository"]
        OrderRepo["OrderRepository"]
    end
    subgraph Infra["Infrastructure"]
        AuthFilter["AuthenticationFilter"]
        LogMiddleware["LoggingMiddleware"]
    end

    UserCtrl -->|"delegates"| UserSvc
    OrderCtrl -->|"delegates"| OrderSvc
    OrderSvc -->|"lookups"| UserSvc
    OrderSvc -->|"triggers"| NotifSvc
    UserSvc -->|"queries"| UserRepo
    OrderSvc -->|"queries"| OrderRepo
    AuthFilter -.->|"intercepts"| UserCtrl
    AuthFilter -.->|"intercepts"| OrderCtrl
    LogMiddleware -.->|"wraps"| Presentation
~~~

### Step 5: Save Output

Save the combined output to `.github/modernize/assessment/architecture-diagram.md` with this exact structure:

```
# Architecture Diagram

A brief introduction (1-2 sentences).

## Application Architecture

< Layer 1 Mermaid flowchart TD here >

## Component Relationships

< Layer 2 Mermaid flowchart LR here >
```

**The output file must contain ONLY the heading, one brief intro line, and two Mermaid diagram blocks. No other text, tables, or lists.**

## Scaling Rules

- If the project has **more than 30 components**, aggregate by package/namespace (e.g., show `com.example.orders` as one node instead of listing every class)
- Keep each diagram under **40 nodes** to ensure readability and GitHub rendering compatibility
- For multi-module projects, focus on inter-module boundaries in Layer 1 and key components within the most important modules in Layer 2

## Mermaid Syntax Rules

- Use `flowchart TD` for Layer 1 and `flowchart LR` for Layer 2
- Avoid special characters (`@`, `#`, `$`, `%`, `&`) in node labels — use plain text
- Always quote arrow labels with double quotes: `-->|"label"|`
- Use `subgraph` for grouping, with a display name in quotes if it contains spaces
- Verify all node IDs are unique across the entire diagram

## Error Handling

- **Unsupported project type**: Output a single line: `> ERROR: Unsupported project type. This skill supports Java, .NET, JavaScript, and TypeScript projects only.`
- **No source code found**: Output: `> ERROR: No recognized source files found at {workspace-path}. Verify the path is correct.`
- **Insufficient info**: Generate a best-effort diagram from available data. Add a note inside the diagram: `Note["Some components could not be identified"]`

## Success Criteria

- Layer 1 Mermaid diagram renders correctly showing architecture with technology names, data storage, and external dependencies
- Layer 2 Mermaid diagram renders correctly showing component interactions grouped by architectural layer
- Output file contains only headings and Mermaid blocks — no extra prose, tables, or lists
- File saved to `.github/modernize/assessment/architecture-diagram.md`
