#!/bin/bash
# analyze.sh - Extract health check configurations
# Usage: bash analyze.sh /path/to/project

set -euo pipefail

if [ $# -ne 1 ]; then
    echo '{"task_id":"025","input_name":"Health Checks","analysis_method":"Code","status":"error","result":{"finding":"Invalid arguments"}}' >&2
    exit 1
fi

PROJECT_PATH="$1"
if [ ! -d "$PROJECT_PATH" ]; then
    echo '{"task_id":"025","input_name":"Health Checks","analysis_method":"Code","status":"error","result":{"finding":"Path not found"}}' >&2
    exit 1
fi

START_TIME=$(date +%s)
declare -a EVIDENCE=()
declare -a CHECKS=()
FOUND_HEALTHCHECK=false

escape_json() { echo "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g; s/\n/\\n/g'; }

# Check Dockerfile HEALTHCHECK
while IFS= read -r dockerfile; do
    if grep -q "^HEALTHCHECK" "$dockerfile" 2>/dev/null; then
        FOUND_HEALTHCHECK=true
        HC=$(grep "^HEALTHCHECK" "$dockerfile" | head -1)
        EVIDENCE+=("$dockerfile: $HC")
        CHECKS+=("Dockerfile HEALTHCHECK")
    fi
done < <(find "$PROJECT_PATH" -maxdepth 3 -name "Dockerfile*" 2>/dev/null)

# Check docker-compose healthcheck
while IFS= read -r compose; do
    if grep -q "healthcheck:" "$compose" 2>/dev/null; then
        FOUND_HEALTHCHECK=true
        EVIDENCE+=("$compose: docker-compose healthcheck configured")
        CHECKS+=("docker-compose healthcheck")
    fi
done < <(find "$PROJECT_PATH" -maxdepth 3 -name "docker-compose*.y*ml" 2>/dev/null)

# Check K8s probes
while IFS= read -r k8sfile; do
    if grep -qE "livenessProbe:|readinessProbe:|startupProbe:" "$k8sfile" 2>/dev/null; then
        FOUND_HEALTHCHECK=true
        EVIDENCE+=("$k8sfile: Kubernetes probes configured")
        CHECKS+=("Kubernetes probes")
    fi
done < <(find "$PROJECT_PATH" -maxdepth 5 -path "*/k8s/*" -name "*.yaml" -o -name "*.yml" 2>/dev/null)

END_TIME=$(date +%s)
EXECUTION_TIME=$((END_TIME - START_TIME))
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ "$FOUND_HEALTHCHECK" = false ]; then
    cat <<EOF
{
  "task_id": "025",
  "input_name": "Health Checks",
  "analysis_method": "Code",
  "status": "not_applicable",
  "result": {
    "finding": "No health checks configured",
    "confidence": "high",
    "evidence": [],
    "values": [],
    "script_output": { "health_checks": [] }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
else
    CHECKS_JSON=$(printf '%s\n' "${CHECKS[@]}" | sed 's/^/"/' | sed 's/$/"/' | paste -sd ',' -)
    EVIDENCE_JSON=$(printf '%s\n' "${EVIDENCE[@]}" | while IFS= read -r line; do echo "\"$(escape_json "$line")\""; done | paste -sd ',' -)
    FINDING=$(IFS=', '; echo "${CHECKS[*]}")

    cat <<EOF
{
  "task_id": "025",
  "input_name": "Health Checks",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "$FINDING",
    "confidence": "high",
    "evidence": [$EVIDENCE_JSON],
    "values": [$CHECKS_JSON],
    "script_output": { "health_checks": [$CHECKS_JSON] }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
fi

exit 0
