---
name: fact-hardware-requirements
description: Identify minimum hardware requirements (RAM, CPU, disk)
---

# Hardware Requirements Analysis

## Purpose
Extract minimum hardware requirements from documentation, resource configurations, and deployment files.

## Automated Analysis

This SKILL includes executable scripts that automatically extract hardware requirements.

### Usage

**Bash:**
```bash
bash analyze.sh /path/to/project
```

**PowerShell:**
```powershell
pwsh analyze.ps1 -ProjectPath C:\path\to\project
```

### Detection Sources

- **Documentation**: README.md, INSTALL.md, REQUIREMENTS.md (searches for RAM, CPU, disk mentions)
- **docker-compose**: mem_limit, cpus
- **Kubernetes**: resources.requests, resources.limits

### Script Output Format

```json
{
  "input_name": "Hardware Requirements",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "RAM: 4GB, CPU: 2 cores, Disk: 10GB",
    "confidence": "high",
    "evidence": [
      "README.md: 4GB RAM minimum",
      "README.md: 2 CPU cores recommended"
    ],
    "values": ["RAM: 4GB", "CPU: 2 cores", "Disk: 10GB"],
    "script_output": {
      "ram": "4GB",
      "cpu": "2 cores",
      "disk": "10GB"
    }
  },
  "execution_time_seconds": 0.6,
  "timestamp": "2026-02-28T10:30:00Z"
}
```

## Manual Analysis Steps (for AI interpretation)

If scripts are unavailable:
- **/README.md, **/docs/**/*.md (system requirements)
- **/docker-compose*.yml (resource limits)
- **/k8s/**/*.yaml (resource requests/limits)
- **/INSTALL.md, **/REQUIREMENTS.md

## Example Patterns
- "4GB RAM minimum"
- "2 CPU cores recommended"
- "10GB disk space required"
- `limits: memory: "4Gi", cpu: "2"`

## Analysis Steps

### 1. Check Documentation
```
Use Read: **/README.md, **/INSTALL.md, **/REQUIREMENTS.md
Search for:
- "System Requirements" section
- "Hardware Requirements" section
- RAM/memory mentions (GB, GiB)
- CPU mentions (cores, GHz)
- Disk mentions (GB storage)

Use Grep: "[0-9]+\\s*(GB|GiB|MB|MiB)|[0-9]+\\s*(cores?|CPU)|disk|storage"
Context: -B 2 -A 2
```

### 2. Check Container Resource Limits
```
Use Read: **/docker-compose*.yml
Look for deploy.resources.limits/reservations

Use Grep: "memory:|cpu:"
Files: **/k8s/**/*.yaml
Context: -B 3 -A 1

Extract resource specifications:
- Memory: 2Gi, 4Gi, 512Mi
- CPU: 1000m, 2, 500m
```

### 3. Analyze Resource Patterns
```
From K8s/Compose:
- limits = maximum resources
- requests/reservations = minimum required

Calculate totals for multi-container apps
```

### 4. Check Database Requirements
```
If database used, estimate:
- PostgreSQL: ~1GB RAM minimum
- MySQL: ~512MB RAM minimum
- MongoDB: ~1GB RAM minimum
- Plus storage for data
```

## Confidence Determination

### High Confidence
- ✅ Requirements explicitly documented
- ✅ Resource limits configured match docs
- **Example**: "4GB RAM, 2 CPU cores, 10GB disk from README and matching K8s resource requests"

### Medium Confidence
- ⚠️ Requirements in one source only
- **Example**: "4GB memory limit in docker-compose, no documentation"

### Low Confidence
- ⚠️ Requirements estimated from resources used
- **Example**: "Estimated 2GB RAM based on container limits, not documented"

### Not Applicable
- ❌ Serverless or managed platform
- **Example**: "AWS Lambda deployment, hardware not directly specified"

## Output Format

```json
{
  "input_name": "Hardware Requirements",
  "analysis_method": "Code",
  "status": "success|not_applicable",
  "result": {
    "finding": "{Hardware summary}",
    "confidence": "high|medium|low",
    "evidence": [
      "{Documentation sections}",
      "{Container resource limits}",
      "{Calculations}"
    ],
    "values": [
      "{RAM: minimum and recommended}",
      "{CPU: cores or millicores}",
      "{Disk: storage requirements}",
      "{Network: if specified}"
    ]
  },
  "execution_time_seconds": {elapsed},
  "timestamp": "{ISO 8601}"
}
```
