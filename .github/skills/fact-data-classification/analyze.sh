#!/bin/bash
# analyze.sh - Scan for data classification markers
# Usage: bash analyze.sh /path/to/project

set -euo pipefail

if [ $# -ne 1 ]; then
    echo '{"input_name":"Data Classification","analysis_method":"Code","status":"error","result":{"finding":"Invalid arguments"}}' >&2
    exit 1
fi

PROJECT_PATH="$1"
if [ ! -d "$PROJECT_PATH" ]; then
    echo '{"input_name":"Data Classification","analysis_method":"Code","status":"error","result":{"finding":"Path not found"}}' >&2
    exit 1
fi

START_TIME=$(date +%s)
declare -a EVIDENCE=()
declare -a CLASSIFICATIONS=()

escape_json() { echo "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g; s/\n/\\n/g'; }

add_classification() {
    local class="$1"
    if [[ ! " ${CLASSIFICATIONS[@]} " =~ " ${class} " ]]; then
        CLASSIFICATIONS+=("$class")
    fi
}

# Search for data classification markers in code
MARKERS="@PII|@PersonalData|@Confidential|@Restricted|@Public|@Internal|@Sensitive|@PHI|PersonalData|ProtectedPersonalData|ProtectedHealthInformation"

# Check source code for annotations
while IFS= read -r codefile; do
    MATCHES=$(grep -E "$MARKERS" "$codefile" 2>/dev/null | head -5 || echo "")
    if [ -n "$MATCHES" ]; then
        if echo "$MATCHES" | grep -qE "@PII|@PersonalData|PersonalData|ProtectedPersonalData"; then
            add_classification "PII"
            EVIDENCE+=("$codefile: PII markers detected")
        fi
        if echo "$MATCHES" | grep -qE "@Confidential"; then
            add_classification "Confidential"
            EVIDENCE+=("$codefile: Confidential markers detected")
        fi
        if echo "$MATCHES" | grep -qE "@Restricted"; then
            add_classification "Restricted"
            EVIDENCE+=("$codefile: Restricted markers detected")
        fi
        if echo "$MATCHES" | grep -qE "@Public"; then
            add_classification "Public"
            EVIDENCE+=("$codefile: Public markers detected")
        fi
        if echo "$MATCHES" | grep -qE "@Internal"; then
            add_classification "Internal"
            EVIDENCE+=("$codefile: Internal markers detected")
        fi
        if echo "$MATCHES" | grep -qE "@PHI|ProtectedHealthInformation"; then
            add_classification "PHI"
            EVIDENCE+=("$codefile: PHI markers detected")
        fi
    fi
done < <(find "$PROJECT_PATH" -maxdepth 5 \( -name "*.java" -o -name "*.cs" -o -name "*.py" -o -name "*.js" -o -name "*.ts" \) 2>/dev/null | head -100)

# Check database schemas for sensitive fields
while IFS= read -r schemafile; do
    SENSITIVE=$(grep -iE "email|phone|address|ssn|credit_card|password|secret|medical|salary|tax_id" "$schemafile" 2>/dev/null | head -5 || echo "")
    if [ -n "$SENSITIVE" ]; then
        if echo "$SENSITIVE" | grep -qiE "email|phone|address|ssn|tax_id"; then
            add_classification "PII"
            EVIDENCE+=("$schemafile: PII fields in schema (email, phone, address)")
        fi
        if echo "$SENSITIVE" | grep -qiE "credit_card"; then
            add_classification "PCI"
            EVIDENCE+=("$schemafile: Payment card data in schema")
        fi
        if echo "$SENSITIVE" | grep -qiE "medical"; then
            add_classification "PHI"
            EVIDENCE+=("$schemafile: Health information in schema")
        fi
        if echo "$SENSITIVE" | grep -qiE "salary"; then
            add_classification "Confidential"
            EVIDENCE+=("$schemafile: Confidential financial data in schema")
        fi
        if echo "$SENSITIVE" | grep -qiE "password|secret"; then
            add_classification "Confidential"
            EVIDENCE+=("$schemafile: Credentials in schema")
        fi
    fi
done < <(find "$PROJECT_PATH" -maxdepth 5 \( -name "schema.sql" -o -name "*migration*.sql" -o -name "*.graphql" -o -name "*.proto" \) 2>/dev/null | head -50)

# Check documentation for data classification policy
for doc in README.md SECURITY.md DATA_CLASSIFICATION.md docs/security.md; do
    if [ -f "$PROJECT_PATH/$doc" ]; then
        if grep -qiE "data classification|sensitivity|confidential|restricted|public data" "$PROJECT_PATH/$doc" 2>/dev/null; then
            EVIDENCE+=("$PROJECT_PATH/$doc: Data classification policy documented")
        fi
    fi
done

END_TIME=$(date +%s)
EXECUTION_TIME=$((END_TIME - START_TIME))
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ ${#CLASSIFICATIONS[@]} -eq 0 ]; then
    cat <<EOF
{
  "input_name": "Data Classification",
  "analysis_method": "Code",
  "status": "not_applicable",
  "result": {
    "finding": "No data classification markers detected",
    "confidence": "medium",
    "evidence": [],
    "values": [],
    "script_output": { "classifications": [] }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
else
    CLASSIFICATIONS_JSON=$(printf '%s\n' "${CLASSIFICATIONS[@]}" | sed 's/^/"/' | sed 's/$/"/' | paste -sd ',' -)
    EVIDENCE_JSON=$(printf '%s\n' "${EVIDENCE[@]}" | while IFS= read -r line; do echo "\"$(escape_json "$line")\""; done | paste -sd ',' -)
    FINDING=$(IFS=', '; echo "${CLASSIFICATIONS[*]}")

    cat <<EOF
{
  "input_name": "Data Classification",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "$FINDING",
    "confidence": "high",
    "evidence": [$EVIDENCE_JSON],
    "values": [$CLASSIFICATIONS_JSON],
    "script_output": { "classifications": [$CLASSIFICATIONS_JSON] }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
fi

exit 0
