---
name: fact-external-services
description: Identify external service dependencies (Database, Redis, Message queues)
---

# External Services Analysis

## Purpose
Detect external service dependencies like databases, caches, message queues, and other backend services the application connects to.

## Automated Analysis

This SKILL includes executable scripts that automatically detect external service dependencies.

### Usage

**Bash:**
```bash
bash analyze.sh /path/to/project
```

**PowerShell:**
```powershell
pwsh analyze.ps1 -ProjectPath C:\path\to\project
```

### Detected Services

- **Databases**: PostgreSQL, MySQL, MariaDB, MongoDB
- **Caching**: Redis
- **Message Queues**: RabbitMQ, Kafka
- **Search**: Elasticsearch

### Script Output Format

```json
{
  "input_name": "External Services",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "PostgreSQL, Redis, RabbitMQ",
    "confidence": "high",
    "evidence": [
      "docker-compose.yml: PostgreSQL service",
      "docker-compose.yml: Redis service",
      "application.properties: RabbitMQ connection config"
    ],
    "values": ["PostgreSQL", "Redis", "RabbitMQ"],
    "script_output": {
      "services": ["PostgreSQL", "Redis", "RabbitMQ"],
      "count": 3
    }
  },
  "execution_time_seconds": 0.4,
  "timestamp": "2026-02-28T10:30:00Z"
}
```

## Manual Analysis Steps (for AI interpretation)

If scripts are unavailable:
- **/docker-compose*.yml** (services section)
- **/k8s/**/*.yaml** (Service, StatefulSet)
- **/application.{properties,yml}**
- **/*.env**, **/.env.example**

## Example Patterns
- `postgres:13`, `redis:alpine`, `rabbitmq:3-management`
- `spring.datasource.url`, `REDIS_URL`, `MONGODB_URI`

## Analysis Steps

### 1. Check docker-compose Services
```
Use Read: **/docker-compose*.yml
Look for services: beyond the main app (postgres, redis, mongo, rabbitmq, elasticsearch, etc.)
```

### 2. Analyze Application Configuration
```
Use Grep: "datasource|database|redis|mongo|rabbit|kafka|elasticsearch"
Files: **/application.{properties,yml}
Context: -B 1 -A 2
```

### 3. Check Environment Variables
```
Use Grep: "DATABASE_URL|REDIS_URL|MONGO|RABBITMQ|KAFKA"
Files: **/.env.example, **/Dockerfile, **/k8s/**/*.yaml
```

### 4. Search for Connection Strings in Code
```
Use Grep: "jdbc:|redis://|mongodb://|amqp://"
Files: **/*.{java,cs,js,py}
Context: -B 2 -A 1
```

## Confidence Determination

### High Confidence
- ✅ Services in docker-compose + connection config
- ✅ Connection strings in application config
- **Example**: "External services: PostgreSQL 13, Redis 6, RabbitMQ 3 from docker-compose and connection strings"

### Medium Confidence
- ⚠️ References to services but no explicit config
- **Example**: "Database referenced in code but connection details unclear"

### Low Confidence
- ⚠️ Possible service usage, not confirmed
- **Example**: "May use database based on ORM dependency"

### Not Applicable
- ❌ Standalone app with no external services
- **Example**: "Static file server, no external dependencies"

## Output Format

```json
{
  "input_name": "External Services",
  "analysis_method": "Code",
  "status": "success|not_applicable",
  "result": {
    "finding": "{Services summary}",
    "confidence": "high|medium|low",
    "evidence": [
      "{docker-compose services}",
      "{Connection configs}",
      "{Environment variables}"
    ],
    "values": [
      "{Service types: PostgreSQL, Redis, etc.}",
      "{Versions}",
      "{Count: N services}"
    ]
  },
  "execution_time_seconds": {elapsed},
  "timestamp": "{ISO 8601}"
}
```
