---
name: fact-multi-stage-build
description: Check if Dockerfile uses multi-stage build pattern
---

# Multi-stage Build Analysis

## Purpose
Determine if the project uses Docker multi-stage builds for image optimization.

## Automated Analysis

This SKILL includes executable scripts that automatically check for multi-stage Docker builds.

### Usage

**Bash:**
```bash
bash analyze.sh /path/to/project
```

**PowerShell:**
```powershell
pwsh analyze.ps1 -ProjectPath C:\path\to\project
```

### Detection Logic

The scripts search for Dockerfile/Containerfile and count FROM instructions:
- Multiple FROM statements = multi-stage build
- Extracts named stages (FROM ... AS stage_name)

### Script Output Format

```json
{
  "input_name": "Multi-stage Build",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "Multi-stage build detected in 1 Dockerfile",
    "confidence": "high",
    "evidence": [
      "Dockerfile: Multi-stage build with 3 stages (named stages: builder, tester)"
    ],
    "values": ["Multi-stage build"],
    "script_output": {
      "dockerfiles_found": 1,
      "multi_stage_builds": 1,
      "total_from_instructions": 3
    }
  },
  "execution_time_seconds": 0.2,
  "timestamp": "2026-02-28T10:30:00Z"
}
```

## Manual Analysis Steps (for AI interpretation)

If scripts are unavailable:

### 1. Search for Dockerfile
- **/Dockerfile, **/Containerfile

### 2. Check for Multiple FROM Statements
- Count FROM instructions
- Check for AS aliases
