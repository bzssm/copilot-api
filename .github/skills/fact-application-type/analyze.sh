#!/bin/bash
# analyze.sh - Determine application type
# Usage: bash analyze.sh /path/to/project

set -euo pipefail

if [ $# -ne 1 ]; then
    echo '{"input_name":"Application Type","analysis_method":"Code","status":"error","result":{"finding":"Invalid arguments"}}' >&2
    exit 1
fi

PROJECT_PATH="$1"
if [ ! -d "$PROJECT_PATH" ]; then
    echo '{"input_name":"Application Type","analysis_method":"Code","status":"error","result":{"finding":"Path not found"}}' >&2
    exit 1
fi

START_TIME=$(date +%s)
declare -a EVIDENCE=()
APP_TYPE=""
CONFIDENCE="medium"

escape_json() { echo "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g; s/\n/\\n/g'; }

# Check for web frameworks and patterns
if find "$PROJECT_PATH" -maxdepth 3 \( -name "pom.xml" -o -name "build.gradle*" \) 2>/dev/null | grep -q .; then
    # Java project
    if grep -rE "spring-boot-starter-web|@RestController|@RequestMapping" "$PROJECT_PATH" --include="*.xml" --include="*.java" --include="*.gradle" 2>/dev/null | head -1 | grep -q .; then
        APP_TYPE="REST API"
        EVIDENCE+=("Spring Boot web/REST annotations found")
        CONFIDENCE="high"
    elif grep -rE "spring-boot-starter-webflux" "$PROJECT_PATH" --include="*.xml" --include="*.gradle" 2>/dev/null | grep -q .; then
        APP_TYPE="REST API"
        EVIDENCE+=("Spring WebFlux found")
        CONFIDENCE="high"
    elif grep -rE "grpc|io.grpc" "$PROJECT_PATH" --include="*.xml" --include="*.gradle" --include="*.proto" 2>/dev/null | grep -q .; then
        APP_TYPE="gRPC Service"
        EVIDENCE+=("gRPC dependencies found")
        CONFIDENCE="high"
    fi
elif find "$PROJECT_PATH" -maxdepth 2 -name "*.csproj" 2>/dev/null | grep -q .; then
    # .NET project
    if grep -rE "Microsoft.AspNetCore|<Project Sdk=\"Microsoft.NET.Sdk.Web\">" "$PROJECT_PATH" --include="*.csproj" 2>/dev/null | grep -q .; then
        APP_TYPE="Web App / REST API"
        EVIDENCE+=("ASP.NET Core web project")
        CONFIDENCE="high"
    elif grep -rE "Grpc.AspNetCore" "$PROJECT_PATH" --include="*.csproj" 2>/dev/null | grep -q .; then
        APP_TYPE="gRPC Service"
        EVIDENCE+=("ASP.NET Core gRPC")
        CONFIDENCE="high"
    elif grep -rE "Microsoft.Extensions.Hosting|BackgroundService" "$PROJECT_PATH" --include="*.cs" 2>/dev/null | grep -q .; then
        APP_TYPE="Background Service"
        EVIDENCE+=("BackgroundService implementation")
        CONFIDENCE="medium"
    fi
elif find "$PROJECT_PATH" -maxdepth 2 -name "package.json" 2>/dev/null | grep -q .; then
    # Node.js project
    if grep -E "express|fastify|koa|@nestjs" "$PROJECT_PATH"/package.json 2>/dev/null | grep -q .; then
        APP_TYPE="REST API / Web App"
        EVIDENCE+=("Express/Fastify/NestJS framework")
        CONFIDENCE="high"
    elif grep -E "@grpc/grpc-js|grpc" "$PROJECT_PATH"/package.json 2>/dev/null | grep -q .; then
        APP_TYPE="gRPC Service"
        EVIDENCE+=("gRPC dependencies")
        CONFIDENCE="high"
    fi
elif find "$PROJECT_PATH" -maxdepth 2 \( -name "requirements.txt" -o -name "Pipfile" \) 2>/dev/null | grep -q .; then
    # Python project
    if grep -E "flask|django|fastapi|tornado" "$PROJECT_PATH"/requirements.txt 2>/dev/null | grep -q .; then
        APP_TYPE="REST API / Web App"
        EVIDENCE+=("Flask/Django/FastAPI framework")
        CONFIDENCE="high"
    elif grep -E "grpcio" "$PROJECT_PATH"/requirements.txt 2>/dev/null | grep -q .; then
        APP_TYPE="gRPC Service"
        EVIDENCE+=("gRPC dependencies")
        CONFIDENCE="high"
    fi
fi

# Check for batch job indicators if no web app detected
if [ -z "$APP_TYPE" ]; then
    if find "$PROJECT_PATH" -maxdepth 3 -name "cron*" -o -name "*job*" -o -name "*batch*" 2>/dev/null | grep -qi .; then
        APP_TYPE="Batch Job"
        EVIDENCE+=("Batch/job file patterns detected")
        CONFIDENCE="low"
    else
        APP_TYPE="Unknown"
        EVIDENCE+=("Unable to determine application type")
        CONFIDENCE="low"
    fi
fi

END_TIME=$(date +%s)
EXECUTION_TIME=$((END_TIME - START_TIME))
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

EVIDENCE_JSON=$(printf '%s\n' "${EVIDENCE[@]}" | while IFS= read -r line; do echo "\"$(escape_json "$line")\""; done | paste -sd ',' -)

cat <<EOF
{
  "input_name": "Application Type",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "$APP_TYPE",
    "confidence": "$CONFIDENCE",
    "evidence": [$EVIDENCE_JSON],
    "values": ["$APP_TYPE"],
    "script_output": { "application_type": "$APP_TYPE" }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF

exit 0
