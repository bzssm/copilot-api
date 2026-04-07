#!/bin/bash
# analyze.sh - Detect testing frameworks in a project
# Usage: bash analyze.sh /path/to/project

set -euo pipefail

# Input validation
if [ $# -ne 1 ]; then
    echo '{"task_id":"003","input_name":"Testing Framework","analysis_method":"Code","status":"error","result":{"finding":"Invalid arguments","confidence":"high","evidence":["Usage: bash analyze.sh /path/to/project"],"values":[]}}' >&2
    exit 1
fi

PROJECT_PATH="$1"

if [ ! -d "$PROJECT_PATH" ]; then
    echo "{\"task_id\":\"003\",\"input_name\":\"Testing Framework\",\"analysis_method\":\"Code\",\"status\":\"error\",\"result\":{\"finding\":\"Project path does not exist: $PROJECT_PATH\",\"confidence\":\"high\",\"evidence\":[],\"values\":[]}}" >&2
    exit 1
fi

START_TIME=$(date +%s)

# Arrays to collect findings
declare -a FRAMEWORKS=()
declare -a EVIDENCE=()

# Helper function to add framework if not already present
add_framework() {
    local fw="$1"
    if [[ ! " ${FRAMEWORKS[@]} " =~ " ${fw} " ]]; then
        FRAMEWORKS+=("$fw")
    fi
}

# Helper function to escape JSON strings
escape_json() {
    local str="$1"
    echo "$str" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g; s/\n/\\n/g'
}

# 1. Check Maven (pom.xml) for Java testing frameworks
if find "$PROJECT_PATH" -maxdepth 3 -name "pom.xml" 2>/dev/null | grep -q .; then
    while IFS= read -r pom; do
        if grep -q "junit-jupiter" "$pom" 2>/dev/null; then
            add_framework "JUnit 5"
            version=$(grep -oP 'junit-jupiter[^<]*</artifactId>.*?<version>\K[^<]+' "$pom" 2>/dev/null | head -1)
            if [ -n "$version" ]; then
                EVIDENCE+=("$pom: JUnit Jupiter $version")
            else
                EVIDENCE+=("$pom: JUnit Jupiter detected")
            fi
        fi
        if grep -q "junit.*<artifactId>junit</artifactId>" "$pom" 2>/dev/null; then
            add_framework "JUnit 4"
            EVIDENCE+=("$pom: JUnit 4 detected")
        fi
        if grep -q "testng" "$pom" 2>/dev/null; then
            add_framework "TestNG"
            EVIDENCE+=("$pom: TestNG detected")
        fi
        if grep -q "mockito" "$pom" 2>/dev/null; then
            add_framework "Mockito"
            EVIDENCE+=("$pom: Mockito detected")
        fi
    done < <(find "$PROJECT_PATH" -maxdepth 3 -name "pom.xml" 2>/dev/null)
fi

# 2. Check Gradle (build.gradle, build.gradle.kts)
if find "$PROJECT_PATH" -maxdepth 3 -name "build.gradle*" 2>/dev/null | grep -q .; then
    while IFS= read -r gradle; do
        if grep -qE "(junit-jupiter|'org.junit.jupiter)" "$gradle" 2>/dev/null; then
            add_framework "JUnit 5"
            EVIDENCE+=("$gradle: JUnit 5 detected")
        fi
        if grep -qE "(junit:junit|'junit:junit')" "$gradle" 2>/dev/null; then
            add_framework "JUnit 4"
            EVIDENCE+=("$gradle: JUnit 4 detected")
        fi
        if grep -q "testng" "$gradle" 2>/dev/null; then
            add_framework "TestNG"
            EVIDENCE+=("$gradle: TestNG detected")
        fi
        if grep -q "mockito" "$gradle" 2>/dev/null; then
            add_framework "Mockito"
            EVIDENCE+=("$gradle: Mockito detected")
        fi
    done < <(find "$PROJECT_PATH" -maxdepth 3 -name "build.gradle*" 2>/dev/null)
fi

# 3. Check .NET (*.csproj)
if find "$PROJECT_PATH" -maxdepth 3 -name "*.csproj" 2>/dev/null | grep -q .; then
    while IFS= read -r csproj; do
        if grep -q "xunit" "$csproj" 2>/dev/null; then
            add_framework "xUnit"
            EVIDENCE+=("$csproj: xUnit detected")
        fi
        if grep -q "nunit" "$csproj" 2>/dev/null; then
            add_framework "NUnit"
            EVIDENCE+=("$csproj: NUnit detected")
        fi
        if grep -q "MSTest" "$csproj" 2>/dev/null; then
            add_framework "MSTest"
            EVIDENCE+=("$csproj: MSTest detected")
        fi
    done < <(find "$PROJECT_PATH" -maxdepth 3 -name "*.csproj" 2>/dev/null)
fi

# 4. Check Node.js (package.json)
if find "$PROJECT_PATH" -maxdepth 3 -name "package.json" 2>/dev/null | grep -q .; then
    while IFS= read -r pkg; do
        if grep -qE '"(jest|@types/jest)"' "$pkg" 2>/dev/null; then
            add_framework "Jest"
            EVIDENCE+=("$pkg: Jest detected")
        fi
        if grep -qE '"(mocha|@types/mocha)"' "$pkg" 2>/dev/null; then
            add_framework "Mocha"
            EVIDENCE+=("$pkg: Mocha detected")
        fi
        if grep -qE '"(chai|@types/chai)"' "$pkg" 2>/dev/null; then
            add_framework "Chai"
            EVIDENCE+=("$pkg: Chai detected")
        fi
        if grep -qE '"(jasmine|@types/jasmine)"' "$pkg" 2>/dev/null; then
            add_framework "Jasmine"
            EVIDENCE+=("$pkg: Jasmine detected")
        fi
        if grep -qE '"(vitest|@vitest)"' "$pkg" 2>/dev/null; then
            add_framework "Vitest"
            EVIDENCE+=("$pkg: Vitest detected")
        fi
    done < <(find "$PROJECT_PATH" -maxdepth 3 -name "package.json" 2>/dev/null)
fi

# 5. Check Python (requirements.txt, setup.py, pyproject.toml)
for pyfile in requirements.txt requirements-dev.txt setup.py pyproject.toml; do
    if find "$PROJECT_PATH" -maxdepth 3 -name "$pyfile" 2>/dev/null | grep -q .; then
        while IFS= read -r pyf; do
            if grep -qE "^pytest|pytest[>=<]" "$pyf" 2>/dev/null; then
                add_framework "pytest"
                EVIDENCE+=("$pyf: pytest detected")
            fi
            if grep -qE "^unittest|unittest[>=<]" "$pyf" 2>/dev/null; then
                add_framework "unittest"
                EVIDENCE+=("$pyf: unittest detected")
            fi
            if grep -qE "^nose|nose[>=<]" "$pyf" 2>/dev/null; then
                add_framework "nose"
                EVIDENCE+=("$pyf: nose detected")
            fi
        done < <(find "$PROJECT_PATH" -maxdepth 3 -name "$pyfile" 2>/dev/null)
    fi
done

# 6. Check Go (go.mod)
if find "$PROJECT_PATH" -maxdepth 3 -name "go.mod" 2>/dev/null | grep -q .; then
    while IFS= read -r gomod; do
        if grep -q "testify" "$gomod" 2>/dev/null; then
            add_framework "testify"
            EVIDENCE+=("$gomod: testify detected")
        fi
        if grep -q "ginkgo" "$gomod" 2>/dev/null; then
            add_framework "Ginkgo"
            EVIDENCE+=("$gomod: Ginkgo detected")
        fi
    done < <(find "$PROJECT_PATH" -maxdepth 3 -name "go.mod" 2>/dev/null)
fi

# 7. Count test files
TEST_FILES=0
if [ -d "$PROJECT_PATH" ]; then
    TEST_FILES=$(find "$PROJECT_PATH" \( -name "*Test.java" -o -name "*Test.cs" -o -name "*Tests.cs" -o -name "*.test.js" -o -name "*.test.ts" -o -name "*.spec.js" -o -name "*.spec.ts" -o -name "test_*.py" -o -name "*_test.go" \) 2>/dev/null | wc -l)
fi

if [ "$TEST_FILES" -gt 0 ]; then
    EVIDENCE+=("Found $TEST_FILES test files")
fi

# Calculate execution time
END_TIME=$(date +%s)
EXECUTION_TIME=$((END_TIME - START_TIME))
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Build JSON output
if [ ${#FRAMEWORKS[@]} -eq 0 ]; then
    # No frameworks found
    cat <<EOF
{
  "task_id": "003",
  "input_name": "Testing Framework",
  "analysis_method": "Code",
  "status": "not_applicable",
  "result": {
    "finding": "No testing frameworks detected",
    "confidence": "high",
    "evidence": [],
    "values": [],
    "script_output": {
      "frameworks_detected": [],
      "test_files_count": $TEST_FILES
    }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
else
    # Frameworks found
    FRAMEWORKS_JSON=$(printf '%s\n' "${FRAMEWORKS[@]}" | sed 's/^/"/' | sed 's/$/"/' | paste -sd ',' -)
    EVIDENCE_JSON=$(printf '%s\n' "${EVIDENCE[@]}" | while IFS= read -r line; do echo "\"$(escape_json "$line")\""; done | paste -sd ',' -)
    FINDING=$(IFS=', '; echo "${FRAMEWORKS[*]}")

    cat <<EOF
{
  "task_id": "003",
  "input_name": "Testing Framework",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "$FINDING",
    "confidence": "high",
    "evidence": [$EVIDENCE_JSON],
    "values": [$FRAMEWORKS_JSON],
    "script_output": {
      "frameworks_detected": [$FRAMEWORKS_JSON],
      "test_files_count": $TEST_FILES
    }
  },
  "execution_time_seconds": $EXECUTION_TIME,
  "timestamp": "$TIMESTAMP"
}
EOF
fi

exit 0
