#!/bin/bash
# analyze.sh - Detect runtime environment (Node.js, Python, Java, .NET, Go, Ruby)
# Usage: bash analyze.sh /path/to/project

set -euo pipefail

# Input validation
if [ $# -ne 1 ]; then
    echo '{"task_id":"014","input_name":"Runtime Environment","analysis_method":"Code","status":"error","result":{"finding":"Invalid arguments","confidence":"high","evidence":["Usage: bash analyze.sh /path/to/project"],"values":[]}}' >&2
    exit 1
fi

PROJECT_PATH="$1"

if [ ! -d "$PROJECT_PATH" ]; then
    echo "{\"task_id\":\"014\",\"input_name\":\"Runtime Environment\",\"analysis_method\":\"Code\",\"status\":\"error\",\"result\":{\"finding\":\"Project path does not exist: $PROJECT_PATH\",\"confidence\":\"high\",\"evidence\":[],\"values\":[]}}" >&2
    exit 1
fi

START_TIME=$(date +%s)

declare -a EVIDENCE=()
declare -a RUNTIMES=()
RUNTIME=""
VERSION=""
VARIANT=""
CONFIDENCE="medium"

# Helper function to escape JSON strings
escape_json() {
    local str="$1"
    echo "$str" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g; s/\n/\\n/g'
}

# 1. Check Dockerfile for base image
DOCKERFILE=$(find "$PROJECT_PATH" -maxdepth 3 -name "Dockerfile" -o -name "Containerfile" 2>/dev/null | head -1)
if [ -n "$DOCKERFILE" ] && [ -f "$DOCKERFILE" ]; then
    BASE_IMAGE=$(grep "^FROM " "$DOCKERFILE" 2>/dev/null | head -1 | awk '{print $2}')

    if [ -n "$BASE_IMAGE" ]; then
        EVIDENCE+=("Base image: $BASE_IMAGE")

        # Detect runtime from base image
        if echo "$BASE_IMAGE" | grep -qE "node:"; then
            RUNTIME="Node.js"
            VERSION=$(echo "$BASE_IMAGE" | grep -oP 'node:\K[0-9]+' || echo "")
            VARIANT=$(echo "$BASE_IMAGE" | grep -oP '-(alpine|slim|bullseye)' | sed 's/^-//' || echo "")
            CONFIDENCE="high"
        elif echo "$BASE_IMAGE" | grep -qE "python:"; then
            RUNTIME="Python"
            VERSION=$(echo "$BASE_IMAGE" | grep -oP 'python:\K[0-9]+\.[0-9]+' || echo "")
            VARIANT=$(echo "$BASE_IMAGE" | grep -oP '-(alpine|slim|bullseye)' | sed 's/^-//' || echo "")
            CONFIDENCE="high"
        elif echo "$BASE_IMAGE" | grep -qE "openjdk:|eclipse-temurin:|amazoncorretto:"; then
            RUNTIME="Java"
            VERSION=$(echo "$BASE_IMAGE" | grep -oP ':(jdk-)?([0-9]+)' | sed 's/^://; s/^jdk-//' | head -1 || echo "")
            VARIANT=$(echo "$BASE_IMAGE" | grep -oP '-(alpine|jre|jdk)' | sed 's/^-//' || echo "")
            CONFIDENCE="high"
        elif echo "$BASE_IMAGE" | grep -qE "mcr.microsoft.com/dotnet/"; then
            RUNTIME=".NET"
            VERSION=$(echo "$BASE_IMAGE" | grep -oP 'dotnet/[^:]+:\K[0-9]+\.[0-9]+' || echo "")
            if echo "$BASE_IMAGE" | grep -q "runtime"; then
                VARIANT="runtime"
            elif echo "$BASE_IMAGE" | grep -q "aspnet"; then
                VARIANT="aspnet"
            elif echo "$BASE_IMAGE" | grep -q "sdk"; then
                VARIANT="sdk"
            fi
            CONFIDENCE="high"
        elif echo "$BASE_IMAGE" | grep -qE "golang:|go:"; then
            RUNTIME="Go"
            VERSION=$(echo "$BASE_IMAGE" | grep -oP 'go(lang)?:\K[0-9]+\.[0-9]+' || echo "")
            VARIANT=$(echo "$BASE_IMAGE" | grep -oP '-(alpine)' | sed 's/^-//' || echo "")
            CONFIDENCE="high"
        elif echo "$BASE_IMAGE" | grep -qE "ruby:"; then
            RUNTIME="Ruby"
            VERSION=$(echo "$BASE_IMAGE" | grep -oP 'ruby:\K[0-9]+\.[0-9]+' || echo "")
            VARIANT=$(echo "$BASE_IMAGE" | grep -oP '-(alpine|slim)' | sed 's/^-//' || echo "")
            CONFIDENCE="high"
        fi
    fi
fi

# 2. Check for dependency files if no Dockerfile or unclear runtime
if [ -z "$RUNTIME" ] || [ "$CONFIDENCE" != "high" ]; then
    # Node.js
    if find "$PROJECT_PATH" -maxdepth 2 -name "package.json" 2>/dev/null | grep -q .; then
        RUNTIME="Node.js"
        EVIDENCE+=("package.json found")
        if [ "$CONFIDENCE" != "high" ]; then
            CONFIDENCE="medium"
        fi

        # Try to get version from package.json engines
        PKG_JSON=$(find "$PROJECT_PATH" -maxdepth 2 -name "package.json" 2>/dev/null | head -1)
        if [ -n "$PKG_JSON" ]; then
            NODE_VER=$(grep -oP '"node":\s*"[>=~^]*\K[0-9]+' "$PKG_JSON" 2>/dev/null | head -1 || echo "")
            if [ -n "$NODE_VER" ]; then
                VERSION="$NODE_VER"
            fi
        fi
    # Python
    elif find "$PROJECT_PATH" -maxdepth 2 -name "requirements.txt" -o -name "Pipfile" -o -name "pyproject.toml" 2>/dev/null | grep -q .; then
        RUNTIME="Python"
        EVIDENCE+=("Python dependency file found")
        if [ "$CONFIDENCE" != "high" ]; then
            CONFIDENCE="medium"
        fi
    # Java (Maven or Gradle)
    elif find "$PROJECT_PATH" -maxdepth 2 -name "pom.xml" -o -name "build.gradle" 2>/dev/null | grep -q .; then
        RUNTIME="Java"
        EVIDENCE+=("Maven/Gradle build file found")
        if [ "$CONFIDENCE" != "high" ]; then
            CONFIDENCE="medium"
        fi

        # Try to get Java version from pom.xml
        POM_XML=$(find "$PROJECT_PATH" -maxdepth 2 -name "pom.xml" 2>/dev/null | head -1)
        if [ -n "$POM_XML" ]; then
            JAVA_VER=$(grep -oP '<java.version>\K[0-9]+' "$POM_XML" 2>/dev/null | head -1 || echo "")
            if [ -n "$JAVA_VER" ]; then
                VERSION="$JAVA_VER"
            fi
        fi
    # .NET
    elif find "$PROJECT_PATH" -maxdepth 2 -name "*.csproj" -o -name "*.sln" 2>/dev/null | grep -q .; then
        RUNTIME=".NET"
        EVIDENCE+=(".NET project file found")
        if [ "$CONFIDENCE" != "high" ]; then
            CONFIDENCE="medium"
        fi

        # Try to get .NET version from csproj
        CSPROJ=$(find "$PROJECT_PATH" -maxdepth 2 -name "*.csproj" 2>/dev/null | head -1)
        if [ -n "$CSPROJ" ]; then
            DOTNET_VER=$(grep -oP '<TargetFramework>net\K[0-9]+\.[0-9]+' "$CSPROJ" 2>/dev/null | head -1 || echo "")
            if [ -n "$DOTNET_VER" ]; then
                VERSION="$DOTNET_VER"
            fi
        fi
    # Go
    elif find "$PROJECT_PATH" -maxdepth 2 -name "go.mod" 2>/dev/null | grep -q .; then
        RUNTIME="Go"
        EVIDENCE+=("go.mod found")
        if [ "$CONFIDENCE" != "high" ]; then
            CONFIDENCE="medium"
        fi

        # Try to get Go version from go.mod
        GO_MOD=$(find "$PROJECT_PATH" -maxdepth 2 -name "go.mod" 2>/dev/null | head -1)
        if [ -n "$GO_MOD" ]; then
            GO_VER=$(grep -oP '^go \K[0-9]+\.[0-9]+' "$GO_MOD" 2>/dev/null | head -1 || echo "")
            if [ -n "$GO_VER" ]; then
                VERSION="$GO_VER"
            fi
        fi
    # Ruby
    elif find "$PROJECT_PATH" -maxdepth 2 -name "Gemfile" 2>/dev/null | grep -q .; then
        RUNTIME="Ruby"
        EVIDENCE+=("Gemfile found")
        if [ "$CONFIDENCE" != "high" ]; then
            CONFIDENCE="medium"
        fi
    fi
fi

# Calculate execution time
END_TIME=$(date +%s)
EXECUTION_TIME=$((END_TIME - START_TIME))
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Build result
if [ -z "$RUNTIME" ]; then
    # No runtime detected
    cat <<EOF
{
  "task_id": "014",
  "input_name": "Runtime Environment",
  "analysis_method": "Code",
  "status": "not_applicable",
  "result": {
    "finding": "Runtime environment could not be determined",
    "confidence": "high",
    "evidence": [],
    "values": [],
    "script_output": {
      "runtime": null,
      "version": null,
      "variant": null
    }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
else
    # Runtime detected
    EVIDENCE_JSON=$(printf '%s\n' "${EVIDENCE[@]}" | while IFS= read -r line; do echo "\"$(escape_json "$line")\""; done | paste -sd ',' -)
    VALUES="\"$RUNTIME\""
    if [ -n "$VERSION" ]; then
        VALUES="$VALUES, \"Version: $VERSION\""
    fi
    if [ -n "$VARIANT" ]; then
        VALUES="$VALUES, \"Variant: $VARIANT\""
    fi

    FINDING="$RUNTIME"
    if [ -n "$VERSION" ]; then
        FINDING="$FINDING $VERSION"
    fi
    if [ -n "$VARIANT" ]; then
        FINDING="$FINDING ($VARIANT)"
    fi

    cat <<EOF
{
  "task_id": "014",
  "input_name": "Runtime Environment",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "$FINDING",
    "confidence": "$CONFIDENCE",
    "evidence": [$EVIDENCE_JSON],
    "values": [$VALUES],
    "script_output": {
      "runtime": "$RUNTIME",
      "version": "${VERSION:-unknown}",
      "variant": "${VARIANT:-standard}"
    }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
fi

exit 0
