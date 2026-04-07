# analyze.ps1 - Extract health check configurations
# Usage: pwsh analyze.ps1 -ProjectPath C:\path\to\project

param([Parameter(Mandatory=$true)][string]$ProjectPath)
$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path $ProjectPath -PathType Container)) {
    Write-Error '{"task_id":"025","input_name":"Health Checks","analysis_method":"Code","status":"error","result":{"finding":"Path not found"}}'
    exit 1
}

$startTime = Get-Date
$evidence = @()
$checks = @()
$foundHealthcheck = $false

# Check Dockerfiles
$dockerfiles = Get-ChildItem -Path $ProjectPath -Filter "Dockerfile*" -Recurse -Depth 3 -File -ErrorAction SilentlyContinue
foreach ($file in $dockerfiles) {
    $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "(?m)^HEALTHCHECK") {
        $foundHealthcheck = $true
        $script:evidence += "$($file.FullName): HEALTHCHECK instruction found"
        $script:checks += "Dockerfile HEALTHCHECK"
    }
}

# Check docker-compose
$composeFiles = Get-ChildItem -Path $ProjectPath -Filter "docker-compose*.y*ml" -Recurse -Depth 3 -ErrorAction SilentlyContinue
foreach ($file in $composeFiles) {
    $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "healthcheck:") {
        $foundHealthcheck = $true
        $script:evidence += "$($file.FullName): healthcheck configured"
        $script:checks += "docker-compose healthcheck"
    }
}

# Check K8s manifests
$k8sFiles = Get-ChildItem -Path $ProjectPath -Include "*.yaml","*.yml" -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match "\\k8s\\" }
foreach ($file in $k8sFiles) {
    $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "livenessProbe:|readinessProbe:|startupProbe:") {
        $foundHealthcheck = $true
        $script:evidence += "$($file.FullName): Kubernetes probes configured"
        if ($script:checks -notcontains "Kubernetes probes") {
            $script:checks += "Kubernetes probes"
        }
    }
}

$executionTime = [math]::Round(($(Get-Date) - $startTime).TotalSeconds, 2)
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

if (-not $foundHealthcheck) {
    @{ task_id="025"; input_name="Health Checks"; analysis_method="Code"; status="not_applicable";
       result=@{ finding="No health checks configured"; confidence="high"; evidence=@(); values=@(); script_output=@{health_checks=@()} };
       execution_time_seconds=$executionTime; timestamp=$timestamp } | ConvertTo-Json -Depth 10
} else {
    $finding = $checks -join ", "
    @{ task_id="025"; input_name="Health Checks"; analysis_method="Code"; status="success";
       result=@{ finding=$finding; confidence="high"; evidence=$evidence; values=$checks; script_output=@{health_checks=$checks} };
       execution_time_seconds=$executionTime; timestamp=$timestamp } | ConvertTo-Json -Depth 10
}
exit 0
