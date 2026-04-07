---
name: fact-application-type
description: Determine the type of application (Web App, API, Service, etc.)
---

# Application Type Analysis

## Purpose
Identify the type of application based on code structure and dependencies.

## Automated Analysis

This SKILL includes executable scripts that automatically determine the application type.

### Usage

**Bash:**
```bash
bash analyze.sh /path/to/project
```

**PowerShell:**
```powershell
pwsh analyze.ps1 -ProjectPath C:\path\to\project
```

### Detected Application Types

- **Web App / REST API**: Spring Boot, ASP.NET Core, Express, Flask, FastAPI
- **gRPC Service**: gRPC dependencies detected
- **Background Service**: BackgroundService, worker processes
- **Batch Job**: Scheduled tasks, cron jobs

### Script Output Format

```json
{
  "input_name": "Application Type",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "REST API",
    "confidence": "high",
    "evidence": [
      "Spring Boot REST found"
    ],
    "values": ["REST API"],
    "script_output": {
      "application_type": "REST API"
    }
  },
  "execution_time_seconds": 0.5,
  "timestamp": "2026-02-28T10:30:00Z"
}
```

## Manual Analysis Steps (for AI interpretation)

If scripts are unavailable:

### 1. Check for Web Frameworks
