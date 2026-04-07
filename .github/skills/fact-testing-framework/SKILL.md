---
name: fact-testing-framework
description: Analyze testing tools and frameworks used in the project
---

# Testing Framework Analysis

## Purpose
Detect testing frameworks and tools used in the codebase.

## Automated Analysis

This SKILL includes executable scripts that automatically scan the project for testing frameworks.

### Usage

**Bash:**
```bash
bash analyze.sh /path/to/project
```

**PowerShell:**
```powershell
pwsh analyze.ps1 -ProjectPath C:\path\to\project
```

### Detected Frameworks

The scripts detect the following testing frameworks:
- **Java**: JUnit 4, JUnit 5, TestNG, Mockito
- **.NET**: xUnit, NUnit, MSTest
- **Node.js**: Jest, Mocha, Chai, Jasmine, Vitest
- **Python**: pytest, unittest, nose
- **Go**: testify, Ginkgo

### Script Output Format

```json
{
  "input_name": "Testing Framework",
  "analysis_method": "Code",
  "status": "success",
  "result": {
    "finding": "JUnit 5, Mockito",
    "confidence": "high",
    "evidence": [
      "pom.xml: JUnit Jupiter detected",
      "Found 23 test files"
    ],
    "values": ["JUnit 5", "Mockito"],
    "script_output": {
      "frameworks_detected": ["JUnit 5", "Mockito"],
      "test_files_count": 23
    }
  },
  "execution_time_seconds": 0.5,
  "timestamp": "2026-02-28T10:30:00Z"
}
```

## Manual Analysis Steps (for AI interpretation)

If scripts are unavailable, perform manual analysis:

### 1. Search for Test Files
Use Glob tool:
- **/test/**/*.{java,cs,py,js,ts}
- **/*Test.{java,cs}
- **/*Tests.{java,cs}
- **/spec/**/*.{js,ts}

### 2. Search for Test Dependencies
Use Grep tool:
- Pattern: "junit|testng|mockito|xunit|nunit|pytest|jest|mocha"
- Files: **/pom.xml, **/build.gradle, **/*.csproj, **/package.json, **/requirements.txt

### 3. Analyze Test Patterns
Check for common test annotations/decorators:
- @Test, @TestMethod, [Fact], [Theory]
- describe(), it(), test()
