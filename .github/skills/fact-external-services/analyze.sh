#!/bin/bash
# analyze.sh - Identify external service dependencies
# Usage: bash analyze.sh /path/to/project

set -euo pipefail

if [ $# -ne 1 ]; then
    echo '{"task_id":"019","input_name":"External Services","analysis_method":"Code","status":"error","result":{"finding":"Invalid arguments","confidence":"high","evidence":["Usage: bash analyze.sh /path/to/project"],"values":[]}}' >&2
    exit 1
fi

PROJECT_PATH="$1"
if [ ! -d "$PROJECT_PATH" ]; then
    echo "{\"task_id\":\"019\",\"input_name\":\"External Services\",\"analysis_method\":\"Code\",\"status\":\"error\",\"result\":{\"finding\":\"Project path does not exist: $PROJECT_PATH\",\"confidence\":\"high\",\"evidence\":[],\"values\":[]}}" >&2
    exit 1
fi

START_TIME=$(date +%s)
declare -a EVIDENCE=()
declare -a SERVICES=()

escape_json() {
    echo "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g; s/\n/\\n/g'
}

add_service() {
    local svc="$1"
    if [[ ! " ${SERVICES[@]} " =~ " ${svc} " ]]; then
        SERVICES+=("$svc")
    fi
}

# Check docker-compose files
while IFS= read -r compose_file; do
    if grep -qE "postgres:|postgresql:" "$compose_file" 2>/dev/null; then
        add_service "PostgreSQL"
        EVIDENCE+=("$compose_file: PostgreSQL service")
    fi
    if grep -qE "mysql:|mariadb:" "$compose_file" 2>/dev/null; then
        add_service "MySQL"
        EVIDENCE+=("$compose_file: MySQL/MariaDB service")
    fi
    if grep -qE "redis:" "$compose_file" 2>/dev/null; then
        add_service "Redis"
        EVIDENCE+=("$compose_file: Redis service")
    fi
    if grep -qE "mongo:" "$compose_file" 2>/dev/null; then
        add_service "MongoDB"
        EVIDENCE+=("$compose_file: MongoDB service")
    fi
    if grep -qE "rabbitmq:" "$compose_file" 2>/dev/null; then
        add_service "RabbitMQ"
        EVIDENCE+=("$compose_file: RabbitMQ service")
    fi
    if grep -qE "kafka:|confluent" "$compose_file" 2>/dev/null; then
        add_service "Kafka"
        EVIDENCE+=("$compose_file: Kafka service")
    fi
    if grep -qE "elasticsearch:" "$compose_file" 2>/dev/null; then
        add_service "Elasticsearch"
        EVIDENCE+=("$compose_file: Elasticsearch service")
    fi
done < <(find "$PROJECT_PATH" -maxdepth 3 -name "docker-compose*.yml" -o -name "docker-compose*.yaml" 2>/dev/null)

# Check application config files
while IFS= read -r config_file; do
    if grep -qE "jdbc:postgresql|postgres://|POSTGRES" "$config_file" 2>/dev/null; then
        add_service "PostgreSQL"
        EVIDENCE+=("$config_file: PostgreSQL connection config")
    fi
    if grep -qE "jdbc:mysql|mysql://|MYSQL" "$config_file" 2>/dev/null; then
        add_service "MySQL"
        EVIDENCE+=("$config_file: MySQL connection config")
    fi
    if grep -qE "redis://|REDIS_URL" "$config_file" 2>/dev/null; then
        add_service "Redis"
        EVIDENCE+=("$config_file: Redis connection config")
    fi
    if grep -qE "mongodb://|MONGO" "$config_file" 2>/dev/null; then
        add_service "MongoDB"
        EVIDENCE+=("$config_file: MongoDB connection config")
    fi
    if grep -qE "amqp://|RABBITMQ" "$config_file" 2>/dev/null; then
        add_service "RabbitMQ"
        EVIDENCE+=("$config_file: RabbitMQ connection config")
    fi
done < <(find "$PROJECT_PATH" -maxdepth 3 \( -name "application*.properties" -o -name "application*.yml" -o -name ".env*" \) 2>/dev/null)

END_TIME=$(date +%s)
EXECUTION_TIME=$((END_TIME - START_TIME))
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ ${#SERVICES[@]} -eq 0 ]; then
    cat <<EOF
{
  "task_id": "019",
  "input_name": "External Services",
  "analysis_method": "Code",
  "status": "not_applicable",
  "result": {
    "finding": "No external services detected",
    "confidence": "high",
    "evidence": [],
    "values": [],
    "script_output": {
      "services": [],
      "count": 0
    }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
else
    SERVICES_JSON=$(printf '%s\n' "${SERVICES[@]}" | sed 's/^/"/' | sed 's/$/"/' | paste -sd ',' -)
    EVIDENCE_JSON=$(printf '%s\n' "${EVIDENCE[@]}" | while IFS= read -r line; do echo "\"$(escape_json "$line")\""; done | paste -sd ',' -)
    FINDING=$(IFS=', '; echo "${SERVICES[*]}")

    cat <<EOF
{
  "task_id": "019",
  "input_name": "External Services",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "$FINDING",
    "confidence": "high",
    "evidence": [$EVIDENCE_JSON],
    "values": [$SERVICES_JSON],
    "script_output": {
      "services": [$SERVICES_JSON],
      "count": ${#SERVICES[@]}
    }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
fi

exit 0
