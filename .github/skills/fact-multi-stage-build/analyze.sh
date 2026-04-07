#!/bin/bash
# analyze.sh - Check if Dockerfile uses multi-stage builds
# Usage: bash analyze.sh /path/to/project

set -euo pipefail

# Input validation
if [ $# -ne 1 ]; then
    echo '{"task_id":"013","input_name":"Multi-stage Build","analysis_method":"Code","status":"error","result":{"finding":"Invalid arguments","confidence":"high","evidence":["Usage: bash analyze.sh /path/to/project"],"values":[]}}' >&2
    exit 1
fi

PROJECT_PATH="$1"

if [ ! -d "$PROJECT_PATH" ]; then
    echo "{\"task_id\":\"013\",\"input_name\":\"Multi-stage Build\",\"analysis_method\":\"Code\",\"status\":\"error\",\"result\":{\"finding\":\"Project path does not exist: $PROJECT_PATH\",\"confidence\":\"high\",\"evidence\":[],\"values\":[]}}" >&2
    exit 1
fi

START_TIME=$(date +%s)

# Arrays to collect findings
declare -a EVIDENCE=()
declare -a DOCKERFILES=()

# Helper function to escape JSON strings
escape_json() {
    local str="$1"
    echo "$str" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g; s/\n/\\n/g'
}

# Find all Dockerfiles
while IFS= read -r dockerfile; do
    DOCKERFILES+=("$dockerfile")
done < <(find "$PROJECT_PATH" -maxdepth 5 \( -name "Dockerfile" -o -name "Dockerfile.*" -o -name "*.Dockerfile" -o -name "Containerfile" \) 2>/dev/null)

# Check if any Dockerfiles found
if [ ${#DOCKERFILES[@]} -eq 0 ]; then
    END_TIME=$(date +%s)
    EXECUTION_TIME=$((END_TIME - START_TIME))
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    cat <<EOF
{
  "task_id": "013",
  "input_name": "Multi-stage Build",
  "analysis_method": "Code",
  "status": "not_applicable",
  "result": {
    "finding": "No Dockerfile found",
    "confidence": "high",
    "evidence": [],
    "values": [],
    "script_output": {
      "dockerfiles_found": 0,
      "multi_stage_builds": 0
    }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
    exit 0
fi

# Check each Dockerfile for multi-stage builds
MULTI_STAGE_COUNT=0
TOTAL_FROM_COUNT=0

for dockerfile in "${DOCKERFILES[@]}"; do
    # Count FROM instructions
    FROM_COUNT=$(grep -c "^FROM " "$dockerfile" 2>/dev/null || echo "0")
    TOTAL_FROM_COUNT=$((TOTAL_FROM_COUNT + FROM_COUNT))

    if [ "$FROM_COUNT" -gt 1 ]; then
        MULTI_STAGE_COUNT=$((MULTI_STAGE_COUNT + 1))

        # Extract stage names (FROM ... AS stage_name)
        STAGES=$(grep "^FROM.*AS " "$dockerfile" 2>/dev/null | sed -E 's/.*AS[[:space:]]+([^[:space:]]+).*/\1/' | tr '\n' ', ' | sed 's/,$//')

        if [ -n "$STAGES" ]; then
            EVIDENCE+=("$dockerfile: Multi-stage build with $FROM_COUNT stages (named stages: $STAGES)")
        else
            EVIDENCE+=("$dockerfile: Multi-stage build with $FROM_COUNT stages")
        fi
    else
        EVIDENCE+=("$dockerfile: Single-stage build ($FROM_COUNT FROM instruction)")
    fi
done

# Calculate execution time
END_TIME=$(date +%s)
EXECUTION_TIME=$((END_TIME - START_TIME))
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Build result
if [ "$MULTI_STAGE_COUNT" -gt 0 ]; then
    # Multi-stage builds found
    EVIDENCE_JSON=$(printf '%s\n' "${EVIDENCE[@]}" | while IFS= read -r line; do echo "\"$(escape_json "$line")\""; done | paste -sd ',' -)

    if [ "$MULTI_STAGE_COUNT" -eq 1 ]; then
        FINDING="Multi-stage build detected in 1 Dockerfile"
    else
        FINDING="Multi-stage builds detected in $MULTI_STAGE_COUNT Dockerfiles"
    fi

    cat <<EOF
{
  "task_id": "013",
  "input_name": "Multi-stage Build",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "$FINDING",
    "confidence": "high",
    "evidence": [$EVIDENCE_JSON],
    "values": ["Multi-stage build", "$MULTI_STAGE_COUNT of ${#DOCKERFILES[@]} Dockerfiles use multi-stage builds"],
    "script_output": {
      "dockerfiles_found": ${#DOCKERFILES[@]},
      "multi_stage_builds": $MULTI_STAGE_COUNT,
      "total_from_instructions": $TOTAL_FROM_COUNT
    }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
else
    # No multi-stage builds
    EVIDENCE_JSON=$(printf '%s\n' "${EVIDENCE[@]}" | while IFS= read -r line; do echo "\"$(escape_json "$line")\""; done | paste -sd ',' -)

    cat <<EOF
{
  "task_id": "013",
  "input_name": "Multi-stage Build",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "No multi-stage builds detected",
    "confidence": "high",
    "evidence": [$EVIDENCE_JSON],
    "values": ["Single-stage build"],
    "script_output": {
      "dockerfiles_found": ${#DOCKERFILES[@]},
      "multi_stage_builds": 0,
      "total_from_instructions": $TOTAL_FROM_COUNT
    }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
fi

exit 0
