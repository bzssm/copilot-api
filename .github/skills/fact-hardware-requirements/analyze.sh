#!/bin/bash
# analyze.sh - Extract hardware requirements
# Usage: bash analyze.sh /path/to/project

set -euo pipefail

if [ $# -ne 1 ]; then
    echo '{"task_id":"033","input_name":"Hardware Requirements","analysis_method":"Code","status":"error","result":{"finding":"Invalid arguments"}}' >&2
    exit 1
fi

PROJECT_PATH="$1"
if [ ! -d "$PROJECT_PATH" ]; then
    echo '{"task_id":"033","input_name":"Hardware Requirements","analysis_method":"Code","status":"error","result":{"finding":"Path not found"}}' >&2
    exit 1
fi

START_TIME=$(date +%s)
declare -a EVIDENCE=()
RAM=""
CPU=""
DISK=""
CONFIDENCE="low"

escape_json() { echo "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g; s/\n/\\n/g'; }

# Check documentation for hardware requirements
for doc in README.md INSTALL.md REQUIREMENTS.md requirements.md docs/README.md; do
    if [ -f "$PROJECT_PATH/$doc" ]; then
        # Look for RAM requirements
        RAM_MATCH=$(grep -iE "[0-9]+\s*(GB|GiB|MB|MiB)\s*(RAM|memory|of memory)" "$PROJECT_PATH/$doc" 2>/dev/null | head -1 || echo "")
        if [ -n "$RAM_MATCH" ]; then
            RAM=$(echo "$RAM_MATCH" | grep -oE "[0-9]+\s*(GB|GiB|MB|MiB)" | head -1)
            EVIDENCE+=("$doc: $RAM_MATCH")
            CONFIDENCE="high"
        fi

        # Look for CPU requirements
        CPU_MATCH=$(grep -iE "[0-9]+\s*(core|cores|CPU|vCPU)" "$PROJECT_PATH/$doc" 2>/dev/null | head -1 || echo "")
        if [ -n "$CPU_MATCH" ]; then
            CPU=$(echo "$CPU_MATCH" | grep -oE "[0-9]+\s*(core|cores|CPU)" | head -1)
            EVIDENCE+=("$doc: $CPU_MATCH")
            CONFIDENCE="high"
        fi

        # Look for disk requirements
        DISK_MATCH=$(grep -iE "[0-9]+\s*(GB|GiB|TB|TiB)\s*(disk|storage|space)" "$PROJECT_PATH/$doc" 2>/dev/null | head -1 || echo "")
        if [ -n "$DISK_MATCH" ]; then
            DISK=$(echo "$DISK_MATCH" | grep -oE "[0-9]+\s*(GB|GiB|TB|TiB)" | head -1)
            EVIDENCE+=("$doc: $DISK_MATCH")
            CONFIDENCE="high"
        fi
    fi
done

# Check docker-compose resource limits
while IFS= read -r compose; do
    MEM_LIMIT=$(grep -E "mem_limit:|memory:" "$compose" 2>/dev/null | head -1 || echo "")
    if [ -n "$MEM_LIMIT" ]; then
        RAM=$(echo "$MEM_LIMIT" | grep -oE "[0-9]+[GMgm]" | head -1)
        EVIDENCE+=("$compose: Memory limit $RAM")
        if [ "$CONFIDENCE" = "low" ]; then
            CONFIDENCE="medium"
        fi
    fi

    CPU_LIMIT=$(grep -E "cpus:" "$compose" 2>/dev/null | head -1 || echo "")
    if [ -n "$CPU_LIMIT" ]; then
        CPU=$(echo "$CPU_LIMIT" | grep -oE "[0-9\.]+" | head -1)
        EVIDENCE+=("$compose: CPU limit $CPU")
        if [ "$CONFIDENCE" = "low" ]; then
            CONFIDENCE="medium"
        fi
    fi
done < <(find "$PROJECT_PATH" -maxdepth 3 -name "docker-compose*.y*ml" 2>/dev/null)

# Check K8s resource specs
while IFS= read -r k8s; do
    if grep -qE "resources:" "$k8s" 2>/dev/null; then
        MEM=$(grep -A5 "requests:" "$k8s" 2>/dev/null | grep "memory:" | head -1 | grep -oE "[0-9]+[GMgm]i?" || echo "")
        if [ -n "$MEM" ]; then
            RAM="$MEM"
            EVIDENCE+=("$k8s: Memory request $MEM")
            if [ "$CONFIDENCE" = "low" ]; then
                CONFIDENCE="medium"
            fi
        fi

        CPU_K8S=$(grep -A5 "requests:" "$k8s" 2>/dev/null | grep "cpu:" | head -1 | grep -oE "[0-9]+m?|[0-9\.]+" || echo "")
        if [ -n "$CPU_K8S" ]; then
            CPU="$CPU_K8S"
            EVIDENCE+=("$k8s: CPU request $CPU_K8S")
            if [ "$CONFIDENCE" = "low" ]; then
                CONFIDENCE="medium"
            fi
        fi
    fi
done < <(find "$PROJECT_PATH" -maxdepth 5 -name "*.yaml" -o -name "*.yml" 2>/dev/null | grep -i k8s)

END_TIME=$(date +%s)
EXECUTION_TIME=$((END_TIME - START_TIME))
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ -z "$RAM" ] && [ -z "$CPU" ] && [ -z "$DISK" ]; then
    cat <<EOF
{
  "task_id": "033",
  "input_name": "Hardware Requirements",
  "analysis_method": "Code",
  "status": "not_applicable",
  "result": {
    "finding": "No hardware requirements found",
    "confidence": "high",
    "evidence": [],
    "values": [],
    "script_output": { "ram": null, "cpu": null, "disk": null }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
else
    EVIDENCE_JSON=$(printf '%s\n' "${EVIDENCE[@]}" | while IFS= read -r line; do echo "\"$(escape_json "$line")\""; done | paste -sd ',' -)
    VALUES=""
    [ -n "$RAM" ] && VALUES="\"RAM: $RAM\""
    [ -n "$CPU" ] && [ -n "$VALUES" ] && VALUES="$VALUES, \"CPU: $CPU\"" || VALUES="\"CPU: $CPU\""
    [ -n "$DISK" ] && [ -n "$VALUES" ] && VALUES="$VALUES, \"Disk: $DISK\"" || VALUES="\"Disk: $DISK\""

    FINDING="RAM: ${RAM:-N/A}, CPU: ${CPU:-N/A}, Disk: ${DISK:-N/A}"

    cat <<EOF
{
  "task_id": "033",
  "input_name": "Hardware Requirements",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "$FINDING",
    "confidence": "$CONFIDENCE",
    "evidence": [$EVIDENCE_JSON],
    "values": [$VALUES],
    "script_output": { "ram": "${RAM:-unknown}", "cpu": "${CPU:-unknown}", "disk": "${DISK:-unknown}" }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
fi

exit 0
