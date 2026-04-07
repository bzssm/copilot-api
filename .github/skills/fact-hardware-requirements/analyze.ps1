# analyze.ps1 - Extract hardware requirements
# Usage: pwsh analyze.ps1 -ProjectPath C:\path\to\project

param([Parameter(Mandatory=$true)][string]$ProjectPath)
$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path $ProjectPath -PathType Container)) {
    Write-Error '{"task_id":"033","input_name":"Hardware Requirements","status":"error"}'
    exit 1
}

$startTime = Get-Date
$evidence = @()
$ram = $null
$cpu = $null
$disk = $null
$confidence = "low"

# Check documentation
$docs = @("README.md", "INSTALL.md", "REQUIREMENTS.md", "requirements.md", "docs\README.md")
foreach ($doc in $docs) {
    $path = Join-Path $ProjectPath $doc
    if (Test-Path $path) {
        $content = Get-Content -Path $path -Raw -ErrorAction SilentlyContinue

        if ($content -match "(\d+)\s*(GB|GiB|MB|MiB)\s*(RAM|memory|of memory)") {
            $ram = $matches[1] + $matches[2]
            $script:evidence += "$doc: RAM requirement $ram"
            $confidence = "high"
        }

        if ($content -match "(\d+)\s*(core|cores|CPU|vCPU)") {
            $cpu = $matches[1] + " " + $matches[2]
            $script:evidence += "$doc: CPU requirement $cpu"
            $confidence = "high"
        }

        if ($content -match "(\d+)\s*(GB|GiB|TB|TiB)\s*(disk|storage|space)") {
            $disk = $matches[1] + $matches[2]
            $script:evidence += "$doc: Disk requirement $disk"
            $confidence = "high"
        }
    }
}

# Check docker-compose
$composeFiles = Get-ChildItem -Path $ProjectPath -Filter "docker-compose*.y*ml" -Recurse -Depth 3 -ErrorAction SilentlyContinue
foreach ($file in $composeFiles) {
    $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "mem_limit:|memory:.*?(\d+[GMgm])") {
        $ram = $matches[1]
        $script:evidence += "$($file.FullName): Memory limit $ram"
        if ($confidence -eq "low") { $confidence = "medium" }
    }
    if ($content -match "cpus:.*?([0-9\.]+)") {
        $cpu = $matches[1]
        $script:evidence += "$($file.FullName): CPU limit $cpu"
        if ($confidence -eq "low") { $confidence = "medium" }
    }
}

# Check K8s
$k8sFiles = Get-ChildItem -Path $ProjectPath -Include "*.yaml","*.yml" -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match "\\k8s\\" }
foreach ($file in $k8sFiles) {
    $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "resources:") {
        if ($content -match "memory:\s*[`"']?(\d+[GMgm]i?)[`"']?") {
            $ram = $matches[1]
            $script:evidence += "$($file.FullName): Memory request $ram"
            if ($confidence -eq "low") { $confidence = "medium" }
        }
        if ($content -match "cpu:\s*[`"']?(\d+m?|\d+\.\d+)[`"']?") {
            $cpu = $matches[1]
            $script:evidence += "$($file.FullName): CPU request $cpu"
            if ($confidence -eq "low") { $confidence = "medium" }
        }
    }
}

$executionTime = [math]::Round(($(Get-Date) - $startTime).TotalSeconds, 2)
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

if (-not $ram -and -not $cpu -and -not $disk) {
    @{ task_id="033"; input_name="Hardware Requirements"; analysis_method="Code"; status="not_applicable";
       result=@{ finding="No hardware requirements found"; confidence="high"; evidence=@(); values=@(); script_output=@{ram=$null; cpu=$null; disk=$null} };
       execution_time_seconds=$executionTime; timestamp=$timestamp } | ConvertTo-Json -Depth 10
} else {
    $values = @()
    if ($ram) { $values += "RAM: $ram" }
    if ($cpu) { $values += "CPU: $cpu" }
    if ($disk) { $values += "Disk: $disk" }
    $finding = "RAM: $(if($ram){$ram}else{'N/A'}), CPU: $(if($cpu){$cpu}else{'N/A'}), Disk: $(if($disk){$disk}else{'N/A'})"

    @{ task_id="033"; input_name="Hardware Requirements"; analysis_method="Code"; status="success";
       result=@{ finding=$finding; confidence=$confidence; evidence=$evidence; values=$values; script_output=@{ram=$(if($ram){$ram}else{"unknown"}); cpu=$(if($cpu){$cpu}else{"unknown"}); disk=$(if($disk){$disk}else{"unknown"})} };
       execution_time_seconds=$executionTime; timestamp=$timestamp } | ConvertTo-Json -Depth 10
}
exit 0
