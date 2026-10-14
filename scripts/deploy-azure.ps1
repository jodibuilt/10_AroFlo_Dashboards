<#
Deploy AroFlo Dashboards to Azure App Service: one Linux B1 plan, one web app.

  .\scripts\deploy-azure.ps1 -InitSettings   # once: write deploy\appsettings.json from .env
  .\scripts\deploy-azure.ps1 -Check          # change nothing; say what a deploy would do
  .\scripts\deploy-azure.ps1                 # create what is missing, then deploy

  .\scripts\deploy-azure.ps1 -SettingsInPortal   # instead: the secrets are typed into the Azure portal

With -SettingsInPortal no settings file is used. The plain settings from
deploy\appsettings.example.json are applied (only those the app does not
have yet, so a value changed in the portal since is left alone), and the
AroFlo login and the admin sign-in are added by hand under the web app's
Environment variables. The app does not start until they are there.

Safe to run again: the plan and the web app are created only if they are not
there, so a second run is just a redeploy. Nothing in Azure is touched until
the settings file passes its checks: a public site with a placeholder for a
password is worse than no site.

Values from .env and from the settings file are never written to the screen;
only their names are.

Keep this file plain ASCII. Windows PowerShell 5.1 reads a script without a
byte-order mark as ANSI, and a stray curly quote ends a string early.
#>
param(
  [string]$ResourceGroup = 'rg-tts-integrations',
  [string]$Plan = 'plan-aroflo-dashboards-prod',
  [string]$App = 'app-aroflo-dashboards-tts-prod',
  [string]$Location = 'australiaeast',
  [string]$Sku = 'B1',
  [string]$Runtime = 'NODE:24-lts',
  [string]$SettingsFile,
  [string]$EnvFile,
  [switch]$InitSettings,
  [switch]$SettingsInPortal,
  [switch]$Check,
  [switch]$SkipPackage,
  [switch]$Force
)

$Repo = Split-Path -Parent $PSScriptRoot
$Example = Join-Path $Repo 'deploy\appsettings.example.json'
$EnvExample = Join-Path $Repo '.env.example'
if (-not $SettingsFile) { $SettingsFile = Join-Path $Repo 'deploy\appsettings.json' }
if (-not $EnvFile) { $EnvFile = Join-Path $Repo '.env' }
# Absolute, so .NET and az read the same file PowerShell means.
$SettingsFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SettingsFile)
$EnvFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($EnvFile)
$Zip = if ($env:AROFLO_DASHBOARDS_PKG_OUT) { $env:AROFLO_DASHBOARDS_PKG_OUT } else { 'C:\tmp\aroflo-dashboards-pkg.zip' }

# Without these the app cannot sign in to AroFlo, or will not start at all.
$Required = 'AROFLO_SECRET_KEY', 'AROFLO_UENCODED', 'AROFLO_PENCODED', 'AROFLO_ORG_ENCODED', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'
# Right for a PC, wrong for App Service: never carried over from .env.
# AROFLO_HOST_IP names the machine AroFlo expects requests from, and Azure
# calls from a different address.
$LocalOnly = 'PORT', 'COOKIE_SECURE', 'AUTH_DB_PATH', 'APP_DB_PATH', 'ADMIN_PASSWORD', 'AROFLO_HOST_IP', 'NODE_ENV'
$MinPasswordLength = 12

function Stop-With([string]$message) {
  Write-Host "STOPPED: $message" -ForegroundColor Red
  exit 1
}

function Step([string]$message) { Write-Host "`n== $message" -ForegroundColor Cyan }

# Runs az; a failure stops the script, with az's own message left on screen.
function Invoke-Az {
  $out = & az @args
  if ($LASTEXITCODE -ne 0) { Stop-With "az $($args[0]) $($args[1]) failed. See the message above." }
  $out
}

# KEY=VALUE lines, as dotenv reads them: quotes come off, and on an unquoted
# value anything after " #" is a comment.
function Read-EnvFile([string]$path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    $first = if ($value.Length) { $value.Substring(0, 1) } else { '' }
    if ($value.Length -ge 2 -and ($first -eq '"' -or $first -eq "'") -and $value.EndsWith($first)) {
      $value = $value.Substring(1, $value.Length - 2)
    } else {
      $value = ($value -replace '\s+#.*$', '').Trim()
    }
    $values[$name] = $value
  }
  $values
}

# Letters and digits only, so it survives JSON, a shell and being read aloud;
# no 0/O or 1/l/I. 24 of them is about 139 bits.
function New-Password([int]$length = 24) {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $limit = 256 - (256 % $alphabet.Length) # bytes at or above this would favour the first letters
  $byte = New-Object byte[] 1
  $chars = New-Object System.Text.StringBuilder
  while ($chars.Length -lt $length) {
    $rng.GetBytes($byte)
    if ($byte[0] -lt $limit) { [void]$chars.Append($alphabet[$byte[0] % $alphabet.Length]) }
  }
  $chars.ToString()
}

function Read-Settings([string]$path) {
  try { $parsed = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { Stop-With "$path is not valid JSON: $($_.Exception.Message)" }
  # One setting at a time: Windows PowerShell hands a JSON array back as a
  # single object, which a pipeline would then treat as one setting.
  foreach ($setting in $parsed) { $setting }
}

# What is wrong with a settings file, by setting name. Empty when it is fit to deploy.
function Test-Settings($settings) {
  $problems = @()
  $byName = @{}
  foreach ($s in $settings) { $byName[$s.name] = [string]$s.value }
  foreach ($name in $Required) {
    if (-not $byName.ContainsKey($name) -or -not $byName[$name].Trim()) { $problems += "$name is missing or empty" }
  }
  foreach ($name in ($byName.Keys | Sort-Object)) {
    if ($byName[$name] -match '^\s*<.*>\s*$') { $problems += "$name still holds the example's <placeholder>" }
  }
  if ($byName['ADMIN_PASSWORD'] -and $byName['ADMIN_PASSWORD'] -notmatch '^\s*<' -and $byName['ADMIN_PASSWORD'].Length -lt $MinPasswordLength) {
    $problems += "ADMIN_PASSWORD is shorter than $MinPasswordLength characters, and the site is on the public internet"
  }
  if ($byName['COOKIE_SECURE'] -ne 'true') { $problems += 'COOKIE_SECURE must be true: App Service is HTTPS, and the sign-in cookie should be HTTPS-only' }
  foreach ($name in 'AUTH_DB_PATH', 'APP_DB_PATH') {
    if (-not $byName[$name] -or -not $byName[$name].StartsWith('/home/')) { $problems += "$name must be under /home/ (anywhere else is wiped by every deploy, accounts and saved edits with it)" }
  }
  if ($byName.ContainsKey('PORT')) { $problems += 'PORT must not be set: App Service supplies it' }
  $problems
}

# ---------------------------------------------------------------- -InitSettings
if ($InitSettings) {
  if ((Test-Path -LiteralPath $SettingsFile) -and -not $Force) { Stop-With "$SettingsFile already exists. Delete it, or add -Force to write a new one (with a NEW admin password)." }
  if (-not (Test-Path -LiteralPath $EnvFile)) { Stop-With "$EnvFile was not found. Copy deploy\appsettings.example.json to deploy\appsettings.json and fill it in by hand instead." }
  $local = Read-EnvFile $EnvFile
  $settings = [ordered]@{}
  foreach ($s in (Read-Settings $Example)) { $settings[$s.name] = [string]$s.value }

  # What this app reads is what .env.example lists. Those come across, so the
  # deployed reports behave like the ones looked at here; anything else in
  # .env (it may be shared with other tools) stays where it is, and so does
  # what only makes sense on a PC.
  $known = (Read-EnvFile $EnvExample).Keys
  $carried = @()
  foreach ($name in ($local.Keys | Sort-Object)) {
    if ($known -notcontains $name -or $LocalOnly -contains $name -or -not $local[$name]) { continue }
    $settings[$name] = $local[$name]
    $carried += $name
  }
  if (-not $settings['ADMIN_USERNAME'] -or $settings['ADMIN_USERNAME'] -match '^<') { $settings['ADMIN_USERNAME'] = 'admin' }
  $settings['ADMIN_PASSWORD'] = New-Password

  $list = @($settings.Keys | ForEach-Object { [pscustomobject]@{ name = $_; value = $settings[$_]; slotSetting = $false } })
  $problems = @(Test-Settings $list)
  if ($problems.Count) { Stop-With ("the settings built from $EnvFile are not fit to deploy:`n  - " + ($problems -join "`n  - ")) }
  # No byte-order mark: az reads the file as plain JSON.
  [System.IO.File]::WriteAllText($SettingsFile, (ConvertTo-Json $list -Depth 3), (New-Object System.Text.UTF8Encoding $false))

  Write-Host "Wrote $SettingsFile (git-ignored; keep it that way)."
  Write-Host "  from $(Split-Path -Leaf $EnvFile):  $($carried -join ', ')"
  Write-Host "  set for Azure:  $(($settings.Keys | Where-Object { $carried -notcontains $_ -and $_ -ne 'ADMIN_PASSWORD' }) -join ', ')"
  Write-Host '  ADMIN_PASSWORD: a new 24-character password, made here. It is in the file: copy it somewhere' -ForegroundColor Yellow
  Write-Host '                  safe. You sign in to the deployed site with it. The local one is unchanged.' -ForegroundColor Yellow
  if ($local['AROFLO_HOST_IP']) {
    Write-Host '  NOTE: AROFLO_HOST_IP is set in .env and was left out. If AroFlo only accepts this API login from' -ForegroundColor Yellow
    Write-Host '        that address, the deployed app cannot refresh until the addresses Azure calls from are allowed:' -ForegroundColor Yellow
    Write-Host "        az webapp show -g $ResourceGroup -n $App --query outboundIpAddresses -o tsv" -ForegroundColor Yellow
  }
  Write-Host "`nNext: .\scripts\deploy-azure.ps1 -Check, then .\scripts\deploy-azure.ps1"
  exit 0
}

# ---------------------------------------------------------------- preflight
Step 'Checks before anything is changed'
if (-not (Get-Command az -ErrorAction SilentlyContinue)) { Stop-With 'the Azure CLI (az) is not installed.' }
$subscription = & az account show --query name -o tsv
if ($LASTEXITCODE -ne 0 -or -not $subscription) { Stop-With 'not signed in to Azure. Run: az login' }
Write-Host "Subscription:     $subscription"

if ($SettingsInPortal) {
  # The example's own values are the plain ones; its <placeholders> are the
  # secrets, which go in by hand.
  $settings = @(Read-Settings $Example | Where-Object { [string]$_.value -notmatch '^\s*<.*>\s*$' })
  $byHand = @(Read-Settings $Example | Where-Object { [string]$_.value -match '^\s*<.*>\s*$' } | ForEach-Object { $_.name })
  Write-Host "Settings:         $($settings.Count) plain ones from the example; by hand in the portal: $($byHand -join ', ')"
} else {
  if (-not (Test-Path -LiteralPath $SettingsFile)) { Stop-With "$SettingsFile does not exist. Run: .\scripts\deploy-azure.ps1 -InitSettings" }
  $settings = @(Read-Settings $SettingsFile)
  $problems = @(Test-Settings $settings)
  if ($problems.Count) { Stop-With ("$SettingsFile is not fit to deploy:`n  - " + ($problems -join "`n  - ")) }
  Write-Host "Settings file:    $($settings.Count) settings, checks passed"
}

if ((Invoke-Az group exists -n $ResourceGroup) -ne 'true') { Stop-With "resource group $ResourceGroup does not exist in $subscription." }
$planSku = Invoke-Az appservice plan list -g $ResourceGroup --query "[?name=='$Plan'].sku.name" -o tsv
$appHost = Invoke-Az webapp list -g $ResourceGroup --query "[?name=='$App'].defaultHostName" -o tsv
Write-Host "Resource group:   $ResourceGroup"
Write-Host ("App Service plan: ${Plan}: " +$(if ($planSku) { "exists ($planSku)" } else { "to be CREATED (Linux $Sku in $Location, billed by the hour from then on)" }))
Write-Host ("Web app:          ${App}: " + $(if ($appHost) { "exists (https://$appHost)" } else { "to be CREATED on $Runtime" }))
if ($planSku -and $planSku -ne $Sku) { Write-Host "NOTE: the plan is $planSku, not $Sku. It is left as it is." -ForegroundColor Yellow }

if ($Check) {
  Write-Host "`n-Check: nothing was changed. Run without -Check to deploy."
  exit 0
}

# ---------------------------------------------------------------- resources
if (-not $planSku) {
  Step "Creating App Service plan $Plan (Linux $Sku)"
  Invoke-Az appservice plan create -g $ResourceGroup -n $Plan --is-linux --sku $Sku --location $Location -o none
}
if (-not $appHost) {
  Step "Creating web app $App"
  Invoke-Az webapp create -g $ResourceGroup -p $Plan -n $App --runtime $Runtime -o none
}

Step 'Configuring the web app'
Invoke-Az webapp update -g $ResourceGroup -n $App --https-only true -o none
# Always On: the loaded AroFlo data lives in memory, and an unloaded app comes back empty.
Invoke-Az webapp config set -g $ResourceGroup -n $App --startup-file 'node src/server.js' --always-on true --min-tls-version 1.2 --ftps-state Disabled -o none
Invoke-Az webapp log config -g $ResourceGroup -n $App --docker-container-logging filesystem -o none
# Before the code, so the first start already has them. -o none keeps az
# from echoing the settings back to the screen.
if ($SettingsInPortal) {
  # Names only are read back. A setting the app already has is left as it
  # is: it may have been changed in the portal since.
  $present = @(Invoke-Az webapp config appsettings list -g $ResourceGroup -n $App --query '[].name' -o tsv)
  $new = @($settings | Where-Object { $present -notcontains $_.name })
  if ($new.Count) {
    $plain = Join-Path ([System.IO.Path]::GetTempPath()) "aroflo-dashboards-settings-$PID.json"
    [System.IO.File]::WriteAllText($plain, (ConvertTo-Json $new -Depth 3), (New-Object System.Text.UTF8Encoding $false))
    try { Invoke-Az webapp config appsettings set -g $ResourceGroup -n $App --settings "@$plain" -o none } finally { Remove-Item -LiteralPath $plain -Force -ErrorAction SilentlyContinue }
  }
  Write-Host "$($new.Count) app settings added: $(($new | ForEach-Object { $_.name }) -join ', ')"
  $present = @(Invoke-Az webapp config appsettings list -g $ResourceGroup -n $App --query '[].name' -o tsv)
  $missing = @($Required | Where-Object { $present -notcontains $_ })
} else {
  Invoke-Az webapp config appsettings set -g $ResourceGroup -n $App --settings "@$SettingsFile" -o none
  Write-Host "$($settings.Count) app settings applied."
  $missing = @()
}

# ---------------------------------------------------------------- code
if (-not $SkipPackage) {
  Step 'Building the package'
  & python (Join-Path $Repo 'scripts\package.py')
  if ($LASTEXITCODE -ne 0) { Stop-With 'the package did not build.' }
}
if (-not (Test-Path -LiteralPath $Zip)) { Stop-With "$Zip does not exist. Run without -SkipPackage." }

Step "Deploying $Zip"
if ($missing.Count) {
  # The app cannot start yet, so az is told not to wait for it to.
  Invoke-Az webapp deploy -g $ResourceGroup -n $App --src-path $Zip --type zip --track-status false -o none
} else {
  & az webapp deploy -g $ResourceGroup -n $App --src-path $Zip --type zip -o none
  # Not fatal: az can report "Site failed to start within 10 mins" while the
  # app is in fact up. /healthz below is the judge.
  if ($LASTEXITCODE -ne 0) { Write-Host 'az reported a problem with the deploy; checking the site itself.' -ForegroundColor Yellow }
}
$site = Invoke-Az webapp show -g $ResourceGroup -n $App --query defaultHostName -o tsv

if ($missing.Count) {
  Write-Host "`nDeployed to https://$site, but it will not start until these settings are added:" -ForegroundColor Yellow
  Write-Host "  $($missing -join ', ')"
  Write-Host "  Azure portal > $App > Settings > Environment variables > App settings > Add each one, then Apply."
  Write-Host "  ADMIN_PASSWORD: $MinPasswordLength characters or more. The site is on the public internet."
  Write-Host '  Saving restarts the app. Then: sign in, press "Refresh from AroFlo", add the two managers under Settings > Manage users.'
  Write-Host "  The log: az webapp log tail -g $ResourceGroup -n $App"
  exit 0
}

# ---------------------------------------------------------------- is it up?
Step 'Waiting for the site to answer'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$up = $false
for ($i = 0; $i -lt 40 -and -not $up; $i++) {
  try { $up = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 "https://$site/healthz").Content -match '"ok"\s*:\s*true' } catch { $up = $false }
  if (-not $up) { Start-Sleep -Seconds 8 }
}
if (-not $up) {
  Stop-With "https://$site/healthz did not answer within about five minutes. Look at the log: az webapp log tail -g $ResourceGroup -n $App"
}

Write-Host "`nDeployed: https://$site" -ForegroundColor Green
Write-Host ('  1. Sign in with ADMIN_USERNAME and the ADMIN_PASSWORD ' + $(if ($SettingsInPortal) { 'set in the portal.' } else { 'in the settings file.' }))
Write-Host '  2. Press "Refresh from AroFlo". Nothing is loaded until someone does, after every deploy or restart.'
Write-Host "  3. Watch it arrive: az webapp log tail -g $ResourceGroup -n $App"
Write-Host '  4. Add the two managers under Settings > Manage users.'
