# analyze.ps1 - Check if Dockerfile uses multi-stage builds
# Usage: pwsh analyze.ps1 -ProjectPath C:\path\to\project

param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectPath
)

$ErrorActionPreference = "Stop"

# Validate project path
if (-not (Test-Path -Path $ProjectPath -PathType Container)) {
    $errorResult = @{
        task_id = "013"
        input_name = "Multi-stage Build"
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
$evidence = @()
$dockerfiles = @()

# Find all Dockerfiles
$dockerfilePatterns = @("Dockerfile", "Dockerfile.*", "*.Dockerfile", "Containerfile")
foreach ($pattern in $dockerfilePatterns) {
    $files = Get-ChildItem -Path $ProjectPath -Filter $pattern -Recurse -Depth 5 -File -ErrorAction SilentlyContinue
    $dockerfiles += $files
}

# Check if any Dockerfiles found
if ($dockerfiles.Count -eq 0) {
    $endTime = Get-Date
    $executionTime = [math]::Round(($endTime - $startTime).TotalSeconds, 2)
    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    $result = @{
        task_id = "013"
        input_name = "Multi-stage Build"
        analysis_method = "Code"
        status = "not_applicable"
        result = @{
            finding = "No Dockerfile found"
            confidence = "high"
            evidence = @()
            values = @()
            script_output = @{
                dockerfiles_found = 0
                multi_stage_builds = 0
            }
        }
        execution_time_seconds = $executionTime
        timestamp = $timestamp
    }

    $result | ConvertTo-Json -Depth 10
    exit 0
}

# Check each Dockerfile for multi-stage builds
$multiStageCount = 0
$totalFromCount = 0

foreach ($dockerfile in $dockerfiles) {
    $content = Get-Content -Path $dockerfile.FullName -Raw -ErrorAction SilentlyContinue

    # Count FROM instructions
    $fromMatches = [regex]::Matches($content, "(?m)^FROM ")
    $fromCount = $fromMatches.Count
    $totalFromCount += $fromCount

    if ($fromCount -gt 1) {
        $multiStageCount++

        # Extract stage names (FROM ... AS stage_name)
        $stageMatches = [regex]::Matches($content, "(?m)^FROM.*AS\s+(\S+)")
        if ($stageMatches.Count -gt 0) {
            $stages = ($stageMatches | ForEach-Object { $_.Groups[1].Value }) -join ", "
            $evidence += "$($dockerfile.FullName): Multi-stage build with $fromCount stages (named stages: $stages)"
        } else {
            $evidence += "$($dockerfile.FullName): Multi-stage build with $fromCount stages"
        }
    } else {
        $evidence += "$($dockerfile.FullName): Single-stage build ($fromCount FROM instruction)"
    }
}

# Calculate execution time
$endTime = Get-Date
$executionTime = [math]::Round(($endTime - $startTime).TotalSeconds, 2)
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# Build result
if ($multiStageCount -gt 0) {
    # Multi-stage builds found
    if ($multiStageCount -eq 1) {
        $finding = "Multi-stage build detected in 1 Dockerfile"
    } else {
        $finding = "Multi-stage builds detected in $multiStageCount Dockerfiles"
    }

    $result = @{
        task_id = "013"
        input_name = "Multi-stage Build"
        analysis_method = "Code"
        status = "success"
        result = @{
            finding = $finding
            confidence = "high"
            evidence = $evidence
            values = @("Multi-stage build", "$multiStageCount of $($dockerfiles.Count) Dockerfiles use multi-stage builds")
            script_output = @{
                dockerfiles_found = $dockerfiles.Count
                multi_stage_builds = $multiStageCount
                total_from_instructions = $totalFromCount
            }
        }
        execution_time_seconds = $executionTime
        timestamp = $timestamp
    }
} else {
    # No multi-stage builds
    $result = @{
        task_id = "013"
        input_name = "Multi-stage Build"
        analysis_method = "Code"
        status = "success"
        result = @{
            finding = "No multi-stage builds detected"
            confidence = "high"
            evidence = $evidence
            values = @("Single-stage build")
            script_output = @{
                dockerfiles_found = $dockerfiles.Count
                multi_stage_builds = 0
                total_from_instructions = $totalFromCount
            }
        }
        execution_time_seconds = $executionTime
        timestamp = $timestamp
    }
}

# Output JSON
$result | ConvertTo-Json -Depth 10

exit 0
