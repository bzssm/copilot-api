# analyze.ps1 - Scan for data classification markers
# Usage: pwsh analyze.ps1 -ProjectPath C:\path\to\project

param([Parameter(Mandatory=$true)][string]$ProjectPath)
$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path $ProjectPath -PathType Container)) {
    Write-Error '{"input_name":"Data Classification","status":"error"}'
    exit 1
}

$startTime = Get-Date
$evidence = @()
$classifications = @()

function Add-Classification { param([string]$class); if ($script:classifications -notcontains $class) { $script:classifications += $class } }

$markers = "@PII|@PersonalData|@Confidential|@Restricted|@Public|@Internal|@Sensitive|@PHI|PersonalData|ProtectedPersonalData|ProtectedHealthInformation"

# Check source code for annotations
$codeFiles = Get-ChildItem -Path $ProjectPath -Include "*.java","*.cs","*.py","*.js","*.ts" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 100
foreach ($file in $codeFiles) {
    $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match $markers) {
        if ($content -match "@PII|@PersonalData|PersonalData|ProtectedPersonalData") {
            Add-Classification "PII"; $script:evidence += "$($file.FullName): PII markers"
        }
        if ($content -match "@Confidential") {
            Add-Classification "Confidential"; $script:evidence += "$($file.FullName): Confidential markers"
        }
        if ($content -match "@Restricted") {
            Add-Classification "Restricted"; $script:evidence += "$($file.FullName): Restricted markers"
        }
        if ($content -match "@Public") {
            Add-Classification "Public"; $script:evidence += "$($file.FullName): Public markers"
        }
        if ($content -match "@Internal") {
            Add-Classification "Internal"; $script:evidence += "$($file.FullName): Internal markers"
        }
        if ($content -match "@PHI|ProtectedHealthInformation") {
            Add-Classification "PHI"; $script:evidence += "$($file.FullName): PHI markers"
        }
    }
}

# Check schemas for sensitive fields
$schemaFiles = Get-ChildItem -Path $ProjectPath -Include "schema.sql","*migration*.sql","*.graphql","*.proto" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 50
foreach ($file in $schemaFiles) {
    $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "(?i)email|phone|address|ssn|credit_card|password|secret|medical|salary|tax_id") {
        if ($content -match "(?i)email|phone|address|ssn|tax_id") {
            Add-Classification "PII"; $script:evidence += "$($file.FullName): PII fields in schema"
        }
        if ($content -match "(?i)credit_card") {
            Add-Classification "PCI"; $script:evidence += "$($file.FullName): Payment card data"
        }
        if ($content -match "(?i)medical") {
            Add-Classification "PHI"; $script:evidence += "$($file.FullName): Health information"
        }
        if ($content -match "(?i)salary") {
            Add-Classification "Confidential"; $script:evidence += "$($file.FullName): Financial data"
        }
        if ($content -match "(?i)password|secret") {
            Add-Classification "Confidential"; $script:evidence += "$($file.FullName): Credentials"
        }
    }
}

# Check documentation
$docs = @("README.md", "SECURITY.md", "DATA_CLASSIFICATION.md")
foreach ($doc in $docs) {
    $files = Get-ChildItem -Path $ProjectPath -Filter $doc -Recurse -Depth 2 -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
        if ($content -match "(?i)data classification|sensitivity|confidential|restricted|public data") {
            $script:evidence += "$($file.FullName): Data classification policy"
        }
    }
}

$executionTime = [math]::Round(($(Get-Date) - $startTime).TotalSeconds, 2)
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

if ($classifications.Count -eq 0) {
    @{ input_name="Data Classification"; analysis_method="Code"; status="not_applicable";
       result=@{ finding="No data classification markers detected"; confidence="medium"; evidence=@(); values=@(); script_output=@{classifications=@()} };
       execution_time_seconds=$executionTime; timestamp=$timestamp } | ConvertTo-Json -Depth 10
} else {
    $finding = $classifications -join ", "
    @{ input_name="Data Classification"; analysis_method="Code"; status="success";
       result=@{ finding=$finding; confidence="high"; evidence=$evidence; values=$classifications; script_output=@{classifications=$classifications} };
       execution_time_seconds=$executionTime; timestamp=$timestamp } | ConvertTo-Json -Depth 10
}
exit 0
