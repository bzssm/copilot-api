#!/bin/bash
# analyze.sh - Scan for compliance requirements
# Usage: bash analyze.sh /path/to/project

set -euo pipefail

if [ $# -ne 1 ]; then
    echo '{"input_name":"Compliance Requirements","analysis_method":"Code","status":"error","result":{"finding":"Invalid arguments"}}' >&2
    exit 1
fi

PROJECT_PATH="$1"
if [ ! -d "$PROJECT_PATH" ]; then
    echo '{"input_name":"Compliance Requirements","analysis_method":"Code","status":"error","result":{"finding":"Path not found"}}' >&2
    exit 1
fi

START_TIME=$(date +%s)
declare -a EVIDENCE=()
declare -a COMPLIANCE=()

escape_json() { echo "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g; s/\n/\\n/g'; }

add_compliance() {
    local comp="$1"
    if [[ ! " ${COMPLIANCE[@]} " =~ " ${comp} " ]]; then
        COMPLIANCE+=("$comp")
    fi
}

# Search for compliance keywords in documentation and code
SEARCH_PATTERN="GDPR|HIPAA|PCI-DSS|PCI DSS|SOX|Sarbanes-Oxley|ISO 27001|SOC 2|CCPA|FERPA"

# Check documentation files
for doc in README.md COMPLIANCE.md SECURITY.md security.md privacy-policy.md PRIVACY.md docs/*.md; do
    if [ -f "$PROJECT_PATH/$doc" ] || find "$PROJECT_PATH" -maxdepth 2 -name "$(basename "$doc")" 2>/dev/null | grep -q .; then
        DOC_PATH=$(find "$PROJECT_PATH" -maxdepth 2 -name "$(basename "$doc")" 2>/dev/null | head -1)
        if [ -n "$DOC_PATH" ] && [ -f "$DOC_PATH" ]; then
            MATCHES=$(grep -iE "$SEARCH_PATTERN" "$DOC_PATH" 2>/dev/null || echo "")
            if [ -n "$MATCHES" ]; then
                while IFS= read -r match; do
                    if echo "$match" | grep -qi "GDPR"; then
                        add_compliance "GDPR"
                        EVIDENCE+=("$DOC_PATH: GDPR mentioned")
                    fi
                    if echo "$match" | grep -qi "HIPAA"; then
                        add_compliance "HIPAA"
                        EVIDENCE+=("$DOC_PATH: HIPAA mentioned")
                    fi
                    if echo "$match" | grep -qiE "PCI-DSS|PCI DSS"; then
                        add_compliance "PCI-DSS"
                        EVIDENCE+=("$DOC_PATH: PCI-DSS mentioned")
                    fi
                    if echo "$match" | grep -qiE "SOX|Sarbanes-Oxley"; then
                        add_compliance "SOX"
                        EVIDENCE+=("$DOC_PATH: SOX mentioned")
                    fi
                    if echo "$match" | grep -qi "ISO 27001"; then
                        add_compliance "ISO 27001"
                        EVIDENCE+=("$DOC_PATH: ISO 27001 mentioned")
                    fi
                    if echo "$match" | grep -qi "SOC 2"; then
                        add_compliance "SOC 2"
                        EVIDENCE+=("$DOC_PATH: SOC 2 mentioned")
                    fi
                done <<< "$MATCHES"
            fi
        fi
    fi
done

# Check source code for compliance annotations/comments
while IFS= read -r codefile; do
    MATCHES=$(grep -iE "$SEARCH_PATTERN|@Confidential|@PII|@PHI|PersonalData|ProtectedHealthInformation" "$codefile" 2>/dev/null | head -3 || echo "")
    if [ -n "$MATCHES" ]; then
        if echo "$MATCHES" | grep -qi "GDPR\|@PII\|PersonalData"; then
            add_compliance "GDPR"
            EVIDENCE+=("$codefile: GDPR/PII markers in code")
        fi
        if echo "$MATCHES" | grep -qi "HIPAA\|@PHI\|ProtectedHealthInformation"; then
            add_compliance "HIPAA"
            EVIDENCE+=("$codefile: HIPAA/PHI markers in code")
        fi
    fi
done < <(find "$PROJECT_PATH" -maxdepth 5 \( -name "*.java" -o -name "*.cs" -o -name "*.py" -o -name "*.js" -o -name "*.ts" \) 2>/dev/null | head -100)

END_TIME=$(date +%s)
EXECUTION_TIME=$((END_TIME - START_TIME))
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ ${#COMPLIANCE[@]} -eq 0 ]; then
    cat <<EOF
{
  "input_name": "Compliance Requirements",
  "analysis_method": "Code",
  "status": "not_applicable",
  "result": {
    "finding": "No compliance requirements detected",
    "confidence": "medium",
    "evidence": [],
    "values": [],
    "script_output": { "compliance_requirements": [] }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
else
    COMPLIANCE_JSON=$(printf '%s\n' "${COMPLIANCE[@]}" | sed 's/^/"/' | sed 's/$/"/' | paste -sd ',' -)
    EVIDENCE_JSON=$(printf '%s\n' "${EVIDENCE[@]}" | while IFS= read -r line; do echo "\"$(escape_json "$line")\""; done | paste -sd ',' -)
    FINDING=$(IFS=', '; echo "${COMPLIANCE[*]}")

    cat <<EOF
{
  "input_name": "Compliance Requirements",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "$FINDING",
    "confidence": "high",
    "evidence": [$EVIDENCE_JSON],
    "values": [$COMPLIANCE_JSON],
    "script_output": { "compliance_requirements": [$COMPLIANCE_JSON] }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
fi

exit 0
