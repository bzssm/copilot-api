# analyze.ps1 - Detect testing frameworks in a project
# Usage: pwsh analyze.ps1 -ProjectPath C:\path\to\project

param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectPath
)

$ErrorActionPreference = "Stop"

# Validate project path
if (-not (Test-Path -Path $ProjectPath -PathType Container)) {
    $errorResult = @{
        task_id = "003"
        input_name = "Testing Framework"
        analysis_method = "Code"
        status = "error"
        result = @{
            finding = "Project path does not exist: $ProjectPath"
            confidence = "high"
            evidence = @()
            values = @()
        }
    } | ConvertTo-Json -Depth 10 -Compress
    Write-Error $errorResult
    exit 1
}

$startTime = Get-Date

# Collections for findings
$frameworks = @()
$evidence = @()

# Helper function to add framework if not already present
function Add-Framework {
    param([string]$fw)
    if ($frameworks -notcontains $fw) {
        $script:frameworks += $fw
    }
}

# 1. Check Maven (pom.xml)
$pomFiles = Get-ChildItem -Path $ProjectPath -Filter "pom.xml" -Recurse -Depth 3 -ErrorAction SilentlyContinue
foreach ($pom in $pomFiles) {
    $content = Get-Content -Path $pom.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "junit-jupiter") {
        Add-Framework "JUnit 5"
        if ($content -match "<version>([^<]+)</version>") {
            $script:evidence += "$($pom.FullName): JUnit Jupiter detected"
        }
    }
    if ($content -match "<artifactId>junit</artifactId>") {
        Add-Framework "JUnit 4"
        $script:evidence += "$($pom.FullName): JUnit 4 detected"
    }
    if ($content -match "testng") {
        Add-Framework "TestNG"
        $script:evidence += "$($pom.FullName): TestNG detected"
    }
    if ($content -match "mockito") {
        Add-Framework "Mockito"
        $script:evidence += "$($pom.FullName): Mockito detected"
    }
}

# 2. Check Gradle (build.gradle, build.gradle.kts)
$gradleFiles = Get-ChildItem -Path $ProjectPath -Filter "build.gradle*" -Recurse -Depth 3 -ErrorAction SilentlyContinue
foreach ($gradle in $gradleFiles) {
    $content = Get-Content -Path $gradle.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "junit-jupiter|'org.junit.jupiter") {
        Add-Framework "JUnit 5"
        $script:evidence += "$($gradle.FullName): JUnit 5 detected"
    }
    if ($content -match "junit:junit|'junit:junit'") {
        Add-Framework "JUnit 4"
        $script:evidence += "$($gradle.FullName): JUnit 4 detected"
    }
    if ($content -match "testng") {
        Add-Framework "TestNG"
        $script:evidence += "$($gradle.FullName): TestNG detected"
    }
    if ($content -match "mockito") {
        Add-Framework "Mockito"
        $script:evidence += "$($gradle.FullName): Mockito detected"
    }
}

# 3. Check .NET (*.csproj)
$csprojFiles = Get-ChildItem -Path $ProjectPath -Filter "*.csproj" -Recurse -Depth 3 -ErrorAction SilentlyContinue
foreach ($csproj in $csprojFiles) {
    $content = Get-Content -Path $csproj.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "xunit") {
        Add-Framework "xUnit"
        $script:evidence += "$($csproj.FullName): xUnit detected"
    }
    if ($content -match "nunit") {
        Add-Framework "NUnit"
        $script:evidence += "$($csproj.FullName): NUnit detected"
    }
    if ($content -match "MSTest") {
        Add-Framework "MSTest"
        $script:evidence += "$($csproj.FullName): MSTest detected"
    }
}

# 4. Check Node.js (package.json)
$packageFiles = Get-ChildItem -Path $ProjectPath -Filter "package.json" -Recurse -Depth 3 -ErrorAction SilentlyContinue
foreach ($pkg in $packageFiles) {
    $content = Get-Content -Path $pkg.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match '"(jest|@types/jest)"') {
        Add-Framework "Jest"
        $script:evidence += "$($pkg.FullName): Jest detected"
    }
    if ($content -match '"(mocha|@types/mocha)"') {
        Add-Framework "Mocha"
        $script:evidence += "$($pkg.FullName): Mocha detected"
    }
    if ($content -match '"(chai|@types/chai)"') {
        Add-Framework "Chai"
        $script:evidence += "$($pkg.FullName): Chai detected"
    }
    if ($content -match '"(jasmine|@types/jasmine)"') {
        Add-Framework "Jasmine"
        $script:evidence += "$($pkg.FullName): Jasmine detected"
    }
    if ($content -match '"(vitest|@vitest)"') {
        Add-Framework "Vitest"
        $script:evidence += "$($pkg.FullName): Vitest detected"
    }
}

# 5. Check Python (requirements.txt, setup.py, pyproject.toml)
$pyFiles = @("requirements.txt", "requirements-dev.txt", "setup.py", "pyproject.toml")
foreach ($pyFile in $pyFiles) {
    $files = Get-ChildItem -Path $ProjectPath -Filter $pyFile -Recurse -Depth 3 -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
        if ($content -match "^pytest|pytest[>=<]") {
            Add-Framework "pytest"
            $script:evidence += "$($file.FullName): pytest detected"
        }
        if ($content -match "^unittest|unittest[>=<]") {
            Add-Framework "unittest"
            $script:evidence += "$($file.FullName): unittest detected"
        }
        if ($content -match "^nose|nose[>=<]") {
            Add-Framework "nose"
            $script:evidence += "$($file.FullName): nose detected"
        }
    }
}

# 6. Check Go (go.mod)
$goModFiles = Get-ChildItem -Path $ProjectPath -Filter "go.mod" -Recurse -Depth 3 -ErrorAction SilentlyContinue
foreach ($goMod in $goModFiles) {
    $content = Get-Content -Path $goMod.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "testify") {
        Add-Framework "testify"
        $script:evidence += "$($goMod.FullName): testify detected"
    }
    if ($content -match "ginkgo") {
        Add-Framework "Ginkgo"
        $script:evidence += "$($goMod.FullName): Ginkgo detected"
    }
}

# 7. Count test files
$testFilePatterns = @("*Test.java", "*Test.cs", "*Tests.cs", "*.test.js", "*.test.ts", "*.spec.js", "*.spec.ts", "test_*.py", "*_test.go")
$testFiles = @()
foreach ($pattern in $testFilePatterns) {
    $testFiles += Get-ChildItem -Path $ProjectPath -Filter $pattern -Recurse -ErrorAction SilentlyContinue
}
$testFilesCount = $testFiles.Count

if ($testFilesCount -gt 0) {
    $evidence += "Found $testFilesCount test files"
}

# Calculate execution time
$endTime = Get-Date
$executionTime = [math]::Round(($endTime - $startTime).TotalSeconds, 2)
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# Build result
if ($frameworks.Count -eq 0) {
    # No frameworks found
    $result = @{
        task_id = "003"
        input_name = "Testing Framework"
        analysis_method = "Code"
        status = "not_applicable"
        result = @{
            finding = "No testing frameworks detected"
            confidence = "high"
            evidence = @()
            values = @()
            script_output = @{
                frameworks_detected = @()
                test_files_count = $testFilesCount
            }
        }
        execution_time_seconds = $executionTime
        timestamp = $timestamp
    }
} else {
    # Frameworks found
    $finding = $frameworks -join ", "
    $result = @{
        task_id = "003"
        input_name = "Testing Framework"
        analysis_method = "Code"
        status = "success"
        result = @{
            finding = $finding
            confidence = "high"
            evidence = $evidence
            values = $frameworks
            script_output = @{
                frameworks_detected = $frameworks
                test_files_count = $testFilesCount
            }
        }
        execution_time_seconds = $executionTime
        timestamp = $timestamp
    }
}

# Output JSON
$result | ConvertTo-Json -Depth 10

exit 0
