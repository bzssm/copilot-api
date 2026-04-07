# analyze.ps1 - Scan for compliance requirements
# Usage: pwsh analyze.ps1 -ProjectPath C:\path\to\project

param([Parameter(Mandatory=$true)][string]$ProjectPath)
$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path $ProjectPath -PathType Container)) {
    Write-Error '{"input_name":"Compliance Requirements","status":"error"}'
    exit 1
}

$startTime = Get-Date
$evidence = @()
$compliance = @()

function Add-Compliance { param([string]$comp); if ($script:compliance -notcontains $comp) { $script:compliance += $comp } }

$searchPattern = "GDPR|HIPAA|PCI-DSS|PCI DSS|SOX|Sarbanes-Oxley|ISO 27001|SOC 2|CCPA|FERPA"

# Check documentation
$docs = @("README.md", "COMPLIANCE.md", "SECURITY.md", "security.md", "privacy-policy.md", "PRIVACY.md")
foreach ($doc in $docs) {
    $files = Get-ChildItem -Path $ProjectPath -Filter $doc -Recurse -Depth 2 -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
        if ($content -match "(?i)$searchPattern") {
            if ($content -match "(?i)GDPR") { Add-Compliance "GDPR"; $script:evidence += "$($file.FullName): GDPR" }
            if ($content -match "(?i)HIPAA") { Add-Compliance "HIPAA"; $script:evidence += "$($file.FullName): HIPAA" }
            if ($content -match "(?i)PCI-DSS|PCI DSS") { Add-Compliance "PCI-DSS"; $script:evidence += "$($file.FullName): PCI-DSS" }
            if ($content -match "(?i)SOX|Sarbanes-Oxley") { Add-Compliance "SOX"; $script:evidence += "$($file.FullName): SOX" }
            if ($content -match "(?i)ISO 27001") { Add-Compliance "ISO 27001"; $script:evidence += "$($file.FullName): ISO 27001" }
            if ($content -match "(?i)SOC 2") { Add-Compliance "SOC 2"; $script:evidence += "$($file.FullName): SOC 2" }
        }
    }
}

# Check source code
$codeFiles = Get-ChildItem -Path $ProjectPath -Include "*.java","*.cs","*.py","*.js","*.ts" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 100
foreach ($file in $codeFiles) {
    $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "(?i)$searchPattern|@Confidential|@PII|@PHI|PersonalData|ProtectedHealthInformation") {
        if ($content -match "(?i)GDPR|@PII|PersonalData") { Add-Compliance "GDPR"; $script:evidence += "$($file.FullName): GDPR/PII in code" }
        if ($content -match "(?i)HIPAA|@PHI|ProtectedHealthInformation") { Add-Compliance "HIPAA"; $script:evidence += "$($file.FullName): HIPAA/PHI in code" }
    }
}

$executionTime = [math]::Round(($(Get-Date) - $startTime).TotalSeconds, 2)
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

if ($compliance.Count -eq 0) {
    @{ input_name="Compliance Requirements"; analysis_method="Code"; status="not_applicable";
       result=@{ finding="No compliance requirements detected"; confidence="medium"; evidence=@(); values=@(); script_output=@{compliance_requirements=@()} };
       execution_time_seconds=$executionTime; timestamp=$timestamp } | ConvertTo-Json -Depth 10
} else {
    $finding = $compliance -join ", "
    @{ input_name="Compliance Requirements"; analysis_method="Code"; status="success";
       result=@{ finding=$finding; confidence="high"; evidence=$evidence; values=$compliance; script_output=@{compliance_requirements=$compliance} };
       execution_time_seconds=$executionTime; timestamp=$timestamp } | ConvertTo-Json -Depth 10
}
exit 0
