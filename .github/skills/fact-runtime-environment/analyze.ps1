# analyze.ps1 - Detect runtime environment (Node.js, Python, Java, .NET, Go, Ruby)
# Usage: pwsh analyze.ps1 -ProjectPath C:\path\to\project

param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectPath
)

$ErrorActionPreference = "Stop"

# Validate project path
if (-not (Test-Path -Path $ProjectPath -PathType Container)) {
    $errorResult = @{
        task_id = "014"
        input_name = "Runtime Environment"
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

$evidence = @()
$runtime = $null
$version = $null
$variant = $null
$confidence = "medium"

# 1. Check Dockerfile for base image
$dockerfile = Get-ChildItem -Path $ProjectPath -Filter "Dockerfile" -Recurse -Depth 3 -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $dockerfile) {
    $dockerfile = Get-ChildItem -Path $ProjectPath -Filter "Containerfile" -Recurse -Depth 3 -File -ErrorAction SilentlyContinue | Select-Object -First 1
}

if ($dockerfile) {
    $content = Get-Content -Path $dockerfile.FullName -Raw -ErrorAction SilentlyContinue
    $fromMatch = [regex]::Match($content, "(?m)^FROM\s+(\S+)")

    if ($fromMatch.Success) {
        $baseImage = $fromMatch.Groups[1].Value
        $evidence += "Base image: $baseImage"

        # Detect runtime from base image
        if ($baseImage -match "node:") {
            $runtime = "Node.js"
            if ($baseImage -match "node:(\d+)") {
                $version = $matches[1]
            }
            if ($baseImage -match "-(alpine|slim|bullseye)") {
                $variant = $matches[1]
            }
            $confidence = "high"
        }
        elseif ($baseImage -match "python:") {
            $runtime = "Python"
            if ($baseImage -match "python:(\d+\.\d+)") {
                $version = $matches[1]
            }
            if ($baseImage -match "-(alpine|slim|bullseye)") {
                $variant = $matches[1]
            }
            $confidence = "high"
        }
        elseif ($baseImage -match "(openjdk|eclipse-temurin|amazoncorretto):") {
            $runtime = "Java"
            if ($baseImage -match ":(jdk-)?(\d+)") {
                $version = $matches[2]
            }
            if ($baseImage -match "-(alpine|jre|jdk)") {
                $variant = $matches[1]
            }
            $confidence = "high"
        }
        elseif ($baseImage -match "mcr.microsoft.com/dotnet/") {
            $runtime = ".NET"
            if ($baseImage -match "dotnet/[^:]+:(\d+\.\d+)") {
                $version = $matches[1]
            }
            if ($baseImage -match "runtime") {
                $variant = "runtime"
            }
            elseif ($baseImage -match "aspnet") {
                $variant = "aspnet"
            }
            elseif ($baseImage -match "sdk") {
                $variant = "sdk"
            }
            $confidence = "high"
        }
        elseif ($baseImage -match "(golang|go):") {
            $runtime = "Go"
            if ($baseImage -match "go(lang)?:(\d+\.\d+)") {
                $version = $matches[2]
            }
            if ($baseImage -match "-(alpine)") {
                $variant = $matches[1]
            }
            $confidence = "high"
        }
        elseif ($baseImage -match "ruby:") {
            $runtime = "Ruby"
            if ($baseImage -match "ruby:(\d+\.\d+)") {
                $version = $matches[1]
            }
            if ($baseImage -match "-(alpine|slim)") {
                $variant = $matches[1]
            }
            $confidence = "high"
        }
    }
}

# 2. Check for dependency files if no runtime determined
if (-not $runtime -or $confidence -ne "high") {
    # Node.js
    $packageJson = Get-ChildItem -Path $ProjectPath -Filter "package.json" -Recurse -Depth 2 -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($packageJson) {
        $runtime = "Node.js"
        $evidence += "package.json found"
        if ($confidence -ne "high") {
            $confidence = "medium"
        }

        # Try to get version from package.json
        $content = Get-Content -Path $packageJson.FullName -Raw -ErrorAction SilentlyContinue
        if ($content -match '"node":\s*"[>=~^]*(\d+)') {
            $version = $matches[1]
        }
    }
    # Python
    elseif ((Get-ChildItem -Path $ProjectPath -Filter "requirements.txt" -Recurse -Depth 2 -File -ErrorAction SilentlyContinue).Count -gt 0 -or
            (Get-ChildItem -Path $ProjectPath -Filter "Pipfile" -Recurse -Depth 2 -File -ErrorAction SilentlyContinue).Count -gt 0 -or
            (Get-ChildItem -Path $ProjectPath -Filter "pyproject.toml" -Recurse -Depth 2 -File -ErrorAction SilentlyContinue).Count -gt 0) {
        $runtime = "Python"
        $evidence += "Python dependency file found"
        if ($confidence -ne "high") {
            $confidence = "medium"
        }
    }
    # Java
    elseif ((Get-ChildItem -Path $ProjectPath -Filter "pom.xml" -Recurse -Depth 2 -File -ErrorAction SilentlyContinue).Count -gt 0 -or
            (Get-ChildItem -Path $ProjectPath -Filter "build.gradle*" -Recurse -Depth 2 -File -ErrorAction SilentlyContinue).Count -gt 0) {
        $runtime = "Java"
        $evidence += "Maven/Gradle build file found"
        if ($confidence -ne "high") {
            $confidence = "medium"
        }

        # Try to get Java version from pom.xml
        $pomXml = Get-ChildItem -Path $ProjectPath -Filter "pom.xml" -Recurse -Depth 2 -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($pomXml) {
            $content = Get-Content -Path $pomXml.FullName -Raw -ErrorAction SilentlyContinue
            if ($content -match "<java.version>(\d+)") {
                $version = $matches[1]
            }
        }
    }
    # .NET
    elseif ((Get-ChildItem -Path $ProjectPath -Filter "*.csproj" -Recurse -Depth 2 -File -ErrorAction SilentlyContinue).Count -gt 0 -or
            (Get-ChildItem -Path $ProjectPath -Filter "*.sln" -Recurse -Depth 2 -File -ErrorAction SilentlyContinue).Count -gt 0) {
        $runtime = ".NET"
        $evidence += ".NET project file found"
        if ($confidence -ne "high") {
            $confidence = "medium"
        }

        # Try to get .NET version from csproj
        $csproj = Get-ChildItem -Path $ProjectPath -Filter "*.csproj" -Recurse -Depth 2 -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($csproj) {
            $content = Get-Content -Path $csproj.FullName -Raw -ErrorAction SilentlyContinue
            if ($content -match "<TargetFramework>net(\d+\.\d+)") {
                $version = $matches[1]
            }
        }
    }
    # Go
    elseif ((Get-ChildItem -Path $ProjectPath -Filter "go.mod" -Recurse -Depth 2 -File -ErrorAction SilentlyContinue).Count -gt 0) {
        $runtime = "Go"
        $evidence += "go.mod found"
        if ($confidence -ne "high") {
            $confidence = "medium"
        }

        # Try to get Go version from go.mod
        $goMod = Get-ChildItem -Path $ProjectPath -Filter "go.mod" -Recurse -Depth 2 -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($goMod) {
            $content = Get-Content -Path $goMod.FullName -Raw -ErrorAction SilentlyContinue
            if ($content -match "(?m)^go\s+(\d+\.\d+)") {
                $version = $matches[1]
            }
        }
    }
    # Ruby
    elseif ((Get-ChildItem -Path $ProjectPath -Filter "Gemfile" -Recurse -Depth 2 -File -ErrorAction SilentlyContinue).Count -gt 0) {
        $runtime = "Ruby"
        $evidence += "Gemfile found"
        if ($confidence -ne "high") {
            $confidence = "medium"
        }
    }
}

# Calculate execution time
$endTime = Get-Date
$executionTime = [math]::Round(($endTime - $startTime).TotalSeconds, 2)
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# Build result
if (-not $runtime) {
    # No runtime detected
    $result = @{
        task_id = "014"
        input_name = "Runtime Environment"
        analysis_method = "Code"
        status = "not_applicable"
        result = @{
            finding = "Runtime environment could not be determined"
            confidence = "high"
            evidence = @()
            values = @()
            script_output = @{
                runtime = $null
                version = $null
                variant = $null
            }
        }
        execution_time_seconds = $executionTime
        timestamp = $timestamp
    }
} else {
    # Runtime detected
    $values = @($runtime)
    if ($version) {
        $values += "Version: $version"
    }
    if ($variant) {
        $values += "Variant: $variant"
    }

    $finding = $runtime
    if ($version) {
        $finding += " $version"
    }
    if ($variant) {
        $finding += " ($variant)"
    }

    $result = @{
        task_id = "014"
        input_name = "Runtime Environment"
        analysis_method = "Code"
        status = "success"
        result = @{
            finding = $finding
            confidence = $confidence
            evidence = $evidence
            values = $values
            script_output = @{
                runtime = $runtime
                version = if ($version) { $version } else { "unknown" }
                variant = if ($variant) { $variant } else { "standard" }
            }
        }
        execution_time_seconds = $executionTime
        timestamp = $timestamp
    }
}

# Output JSON
$result | ConvertTo-Json -Depth 10

exit 0
