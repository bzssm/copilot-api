# analyze.ps1 - Determine application type
# Usage: pwsh analyze.ps1 -ProjectPath C:\path\to\project

param([Parameter(Mandatory=$true)][string]$ProjectPath)
$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path $ProjectPath -PathType Container)) {
    Write-Error '{"input_name":"Application Type","status":"error"}'
    exit 1
}

$startTime = Get-Date
$evidence = @()
$appType = ""
$confidence = "medium"

# Check Java
if ((Get-ChildItem -Path $ProjectPath -Include "pom.xml","build.gradle*" -Recurse -Depth 3 -ErrorAction SilentlyContinue).Count -gt 0) {
    $files = Get-ChildItem -Path $ProjectPath -Include "*.xml","*.java","*.gradle" -Recurse -ErrorAction SilentlyContinue
    $content = ($files | Get-Content -Raw -ErrorAction SilentlyContinue) -join "`n"
    if ($content -match "spring-boot-starter-web|@RestController|@RequestMapping") {
        $appType = "REST API"; $evidence += "Spring Boot REST found"; $confidence = "high"
    } elseif ($content -match "grpc|io.grpc") {
        $appType = "gRPC Service"; $evidence += "gRPC found"; $confidence = "high"
    }
}
# Check .NET
elseif ((Get-ChildItem -Path $ProjectPath -Filter "*.csproj" -Recurse -Depth 2 -ErrorAction SilentlyContinue).Count -gt 0) {
    $files = Get-ChildItem -Path $ProjectPath -Filter "*.csproj" -Recurse -Depth 2 -ErrorAction SilentlyContinue
    $content = ($files | Get-Content -Raw -ErrorAction SilentlyContinue) -join "`n"
    if ($content -match "Microsoft.AspNetCore|Microsoft.NET.Sdk.Web") {
        $appType = "Web App / REST API"; $evidence += "ASP.NET Core"; $confidence = "high"
    } elseif ($content -match "Grpc.AspNetCore") {
        $appType = "gRPC Service"; $evidence += "gRPC"; $confidence = "high"
    } elseif ($content -match "BackgroundService") {
        $appType = "Background Service"; $evidence += "BackgroundService"; $confidence = "medium"
    }
}
# Check Node.js
elseif ((Get-ChildItem -Path $ProjectPath -Filter "package.json" -Recurse -Depth 2 -ErrorAction SilentlyContinue).Count -gt 0) {
    $pkg = Get-ChildItem -Path $ProjectPath -Filter "package.json" -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
    $content = Get-Content -Path $pkg.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "express|fastify|koa|@nestjs") {
        $appType = "REST API / Web App"; $evidence += "Express/NestJS"; $confidence = "high"
    } elseif ($content -match "grpc") {
        $appType = "gRPC Service"; $evidence += "gRPC"; $confidence = "high"
    }
}
# Check Python
elseif ((Get-ChildItem -Path $ProjectPath -Include "requirements.txt","Pipfile" -Recurse -Depth 2 -ErrorAction SilentlyContinue).Count -gt 0) {
    $files = Get-ChildItem -Path $ProjectPath -Include "requirements.txt","Pipfile" -Recurse -Depth 2 -ErrorAction SilentlyContinue
    $content = ($files | Get-Content -Raw -ErrorAction SilentlyContinue) -join "`n"
    if ($content -match "flask|django|fastapi") {
        $appType = "REST API / Web App"; $evidence += "Flask/Django/FastAPI"; $confidence = "high"
    } elseif ($content -match "grpcio") {
        $appType = "gRPC Service"; $evidence += "gRPC"; $confidence = "high"
    }
}

if (-not $appType) {
    $appType = "Unknown"; $evidence += "Unable to determine"; $confidence = "low"
}

$executionTime = [math]::Round(($(Get-Date) - $startTime).TotalSeconds, 2)
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

@{ input_name="Application Type"; analysis_method="Code"; status="success";
   result=@{ finding=$appType; confidence=$confidence; evidence=$evidence; values=@($appType); script_output=@{application_type=$appType} };
   execution_time_seconds=$executionTime; timestamp=$timestamp } | ConvertTo-Json -Depth 10

exit 0
