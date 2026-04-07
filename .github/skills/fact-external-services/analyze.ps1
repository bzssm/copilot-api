# analyze.ps1 - Identify external service dependencies
# Usage: pwsh analyze.ps1 -ProjectPath C:\path\to\project

param([Parameter(Mandatory=$true)][string]$ProjectPath)
$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path $ProjectPath -PathType Container)) {
    Write-Error '{"task_id":"019","input_name":"External Services","analysis_method":"Code","status":"error","result":{"finding":"Path not found"}}'
    exit 1
}

$startTime = Get-Date
$services = @()
$evidence = @()

function Add-Service { param([string]$svc); if ($script:services -notcontains $svc) { $script:services += $svc } }

# Check docker-compose files
$composeFiles = Get-ChildItem -Path $ProjectPath -Filter "docker-compose*.y*ml" -Recurse -Depth 3 -ErrorAction SilentlyContinue
foreach ($file in $composeFiles) {
    $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "postgres:|postgresql:") { Add-Service "PostgreSQL"; $script:evidence += "$($file.FullName): PostgreSQL" }
    if ($content -match "mysql:|mariadb:") { Add-Service "MySQL"; $script:evidence += "$($file.FullName): MySQL" }
    if ($content -match "redis:") { Add-Service "Redis"; $script:evidence += "$($file.FullName): Redis" }
    if ($content -match "mongo:") { Add-Service "MongoDB"; $script:evidence += "$($file.FullName): MongoDB" }
    if ($content -match "rabbitmq:") { Add-Service "RabbitMQ"; $script:evidence += "$($file.FullName): RabbitMQ" }
    if ($content -match "kafka:|confluent") { Add-Service "Kafka"; $script:evidence += "$($file.FullName): Kafka" }
    if ($content -match "elasticsearch:") { Add-Service "Elasticsearch"; $script:evidence += "$($file.FullName): Elasticsearch" }
}

# Check config files
$configFiles = Get-ChildItem -Path $ProjectPath -Include "application*.properties","application*.yml",".env*" -Recurse -Depth 3 -ErrorAction SilentlyContinue
foreach ($file in $configFiles) {
    $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "jdbc:postgresql|postgres://|POSTGRES") { Add-Service "PostgreSQL"; $script:evidence += "$($file.FullName): PostgreSQL config" }
    if ($content -match "jdbc:mysql|mysql://|MYSQL") { Add-Service "MySQL"; $script:evidence += "$($file.FullName): MySQL config" }
    if ($content -match "redis://|REDIS_URL") { Add-Service "Redis"; $script:evidence += "$($file.FullName): Redis config" }
    if ($content -match "mongodb://|MONGO") { Add-Service "MongoDB"; $script:evidence += "$($file.FullName): MongoDB config" }
    if ($content -match "amqp://|RABBITMQ") { Add-Service "RabbitMQ"; $script:evidence += "$($file.FullName): RabbitMQ config" }
}

$executionTime = [math]::Round(($( Get-Date) - $startTime).TotalSeconds, 2)
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

if ($services.Count -eq 0) {
    @{ task_id="019"; input_name="External Services"; analysis_method="Code"; status="not_applicable";
       result=@{ finding="No external services detected"; confidence="high"; evidence=@(); values=@(); script_output=@{services=@(); count=0} };
       execution_time_seconds=$executionTime; timestamp=$timestamp } | ConvertTo-Json -Depth 10
} else {
    $finding = $services -join ", "
    @{ task_id="019"; input_name="External Services"; analysis_method="Code"; status="success";
       result=@{ finding=$finding; confidence="high"; evidence=$evidence; values=$services; script_output=@{services=$services; count=$services.Count} };
       execution_time_seconds=$executionTime; timestamp=$timestamp } | ConvertTo-Json -Depth 10
}
exit 0
