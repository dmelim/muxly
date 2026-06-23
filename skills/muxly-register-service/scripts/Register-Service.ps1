param(
  [switch]$Stdin,
  [switch]$Replace,
  [switch]$PrintPath,
  [string]$ServiceJson,
  [string]$Config,
  [string]$Id,
  [string]$Name,
  [string]$Program,
  [string]$Cwd,
  [string[]]$Arg = @(),
  [string]$Args,
  [string[]]$Env = @(),
  [int]$Port = 0,
  [string]$Group,
  [string]$IconJson,
  [switch]$AutoRestart
)

$ErrorActionPreference = "Stop"

function Get-MuxlyConfigPath {
  if ($Config) {
    return $Config
  }

  $base = $env:APPDATA
  if (-not $base) {
    $base = Join-Path $HOME "AppData\Roaming"
  }

  return Join-Path $base "com.diethos.muxly\services.json"
}

function Read-Services {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return @()
  }

  $raw = [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))
  $raw = $raw.TrimStart([char]0xFEFF).Trim()
  if (-not $raw) {
    return @()
  }

  # Gate the array check on the raw text, not the parsed value: ConvertFrom-Json
  # unwraps a single-element JSON array to a scalar in some PowerShell versions,
  # so `-is [array]` is unreliable for a valid one-entry config.
  if ($raw[0] -ne '[') {
    throw "$Path must contain a JSON array"
  }

  $parsed = $raw | ConvertFrom-Json
  if ($null -eq $parsed) {
    return @()
  }

  return @($parsed)
}

function ConvertTo-HashtableDeep {
  param($Value)

  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    $hash = [ordered]@{}
    foreach ($property in $Value.PSObject.Properties) {
      # Rebuild array-valued properties inline. Passing an empty array as a
      # positional argument collapses it to $null in PowerShell, which would
      # round-trip an empty `args: []` back out as `args: {}` and make Muxly
      # reject the whole config (args is typed Vec<String>).
      if ($property.Value -is [array]) {
        $hash[$property.Name] = @($property.Value | ForEach-Object { ConvertTo-HashtableDeep $_ })
      } else {
        $hash[$property.Name] = ConvertTo-HashtableDeep $property.Value
      }
    }
    return $hash
  }

  if ($Value -is [array]) {
    return @($Value | ForEach-Object { ConvertTo-HashtableDeep $_ })
  }

  return $Value
}

function New-ServiceFromFlags {
  $service = [ordered]@{
    args = @()
    env = [ordered]@{}
  }

  if ($Id) { $service.id = $Id }
  if ($Name) { $service.name = $Name }
  if ($Program) { $service.program = $Program }
  if ($Cwd) { $service.cwd = $Cwd }
  if ($Args) { $service.args = @($service.args + ($Args.Trim() -split "\s+" | Where-Object { $_ })) }
  if ($Arg) { $service.args = @($service.args + $Arg) }
  foreach ($entry in $Env) {
    $index = $entry.IndexOf("=")
    if ($index -le 0) {
      throw "--Env values must be KEY=VALUE"
    }
    $service.env[$entry.Substring(0, $index)] = $entry.Substring($index + 1)
  }
  if ($Port -gt 0) { $service.port = $Port }
  if ($Group) { $service.group = $Group }
  if ($IconJson) { $service.icon = ConvertTo-HashtableDeep ($IconJson | ConvertFrom-Json) }
  $service.autoRestart = [bool]$AutoRestart

  return $service
}

# Coerce a JSON value to a real boolean. Muxly's serde fields (usePty,
# autoPort, sensitive, autoRestart) are typed `bool`, so a stringified
# "true"/"false" -- a realistic LLM slip -- makes serde drop the whole entry
# silently. Accept the common string/number forms and normalize. Keep this in
# sync with register-service.sh's coerceBool.
function Coerce-Bool {
  param($Value, [string]$Field)

  if ($Value -is [bool]) { return $Value }
  if ($Value -is [string]) {
    switch ($Value.Trim().ToLowerInvariant()) {
      "true"  { return $true }
      "1"     { return $true }
      "false" { return $false }
      "0"     { return $false }
      ""      { return $false }
    }
  }
  if ($Value -is [int] -or $Value -is [long] -or $Value -is [double]) {
    if ($Value -eq 1) { return $true }
    if ($Value -eq 0) { return $false }
  }
  throw "Service field $Field must be a boolean"
}

function Normalize-Service {
  param($Service)

  $service = ConvertTo-HashtableDeep $Service

  foreach ($field in @("id", "name", "program", "cwd")) {
    if (-not $service.Contains($field) -or $service[$field] -isnot [string] -or -not $service[$field].Trim()) {
      throw "Service field $field is required"
    }
    $service[$field] = $service[$field].Trim()
  }

  if ($service.id -notmatch "^[a-zA-Z0-9._-]+$") {
    throw "Service field id may only contain letters, numbers, dot, underscore, and hyphen"
  }

  if (-not $service.Contains("args") -or $null -eq $service.args) {
    $service.args = @()
  }
  if ($service.args -isnot [array]) {
    throw "Service field args must be an array of strings"
  }

  if (-not $service.Contains("env") -or $null -eq $service.env) {
    $service.env = [ordered]@{}
  }
  if ($service.env -isnot [System.Collections.IDictionary]) {
    throw "Service field env must be an object"
  }

  if ($service.Contains("port") -and $null -ne $service.port) {
    $portValue = [int]$service.port
    if ($portValue -lt 1 -or $portValue -gt 65535) {
      throw "Service field port must be an integer from 1 to 65535"
    }
    $service.port = $portValue
  }

  if ($service.Contains("group") -and $null -ne $service.group -and $service.group -isnot [string]) {
    throw "Service field group must be a string"
  }

  if ($service.Contains("icon") -and $null -ne $service.icon) {
    if ($service.icon -isnot [System.Collections.IDictionary]) {
      throw "Service field icon must be an object"
    }
    if (-not $service.icon.Contains("type") -or $service.icon.type -isnot [string]) {
      throw "Service field icon.type must be a string"
    }
  }

  if (-not $service.Contains("autoRestart") -or $null -eq $service.autoRestart) {
    $service.autoRestart = $false
  } else {
    $service.autoRestart = Coerce-Bool $service.autoRestart "autoRestart"
  }

  foreach ($field in @("usePty", "autoPort", "sensitive")) {
    if ($service.Contains($field) -and $null -ne $service[$field]) {
      $service[$field] = Coerce-Bool $service[$field] $field
    }
  }

  foreach ($field in @("portEnvVar", "profile", "preRun")) {
    if ($service.Contains($field) -and $null -ne $service[$field] -and $service[$field] -isnot [string]) {
      throw "Service field $field must be a string"
    }
  }

  return $service
}

$configPath = Get-MuxlyConfigPath
if ($PrintPath) {
  Write-Output $configPath
  exit 0
}

if ($Stdin) {
  $inputText = [Console]::In.ReadToEnd()
  $service = ConvertTo-HashtableDeep ($inputText | ConvertFrom-Json)
} elseif ($ServiceJson) {
  $service = ConvertTo-HashtableDeep ($ServiceJson | ConvertFrom-Json)
} else {
  $service = New-ServiceFromFlags
}

$service = Normalize-Service $service
$services = @(Read-Services $configPath)
$existingIndex = -1
for ($i = 0; $i -lt $services.Count; $i++) {
  if ($services[$i].id -eq $service.id) {
    $existingIndex = $i
    break
  }
}

if ($existingIndex -ge 0 -and -not $Replace) {
  throw "Service id already exists: $($service.id). Use -Replace only when replacing is intended."
}

$next = [System.Collections.Generic.List[object]]::new()
foreach ($item in $services) {
  [void]$next.Add((ConvertTo-HashtableDeep $item))
}
if ($existingIndex -ge 0) {
  $next[$existingIndex] = $service
} else {
  [void]$next.Add($service)
}

$configDir = Split-Path -Parent $configPath
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
# Serialize each entry and wrap the array by hand. `$next | ConvertTo-Json`
# emits a bare object (not an array) when the list has exactly one element, so
# registering the first/only service would write a non-array config that both
# Muxly and the read-back below reject.
$items = @($next | ForEach-Object { ConvertTo-Json -InputObject $_ -Depth 20 })
if ($items.Count -eq 0) {
  $json = "[]"
} else {
  $json = "[`n" + ($items -join ",`n") + "`n]"
}
$tempPath = "$configPath.$PID.tmp"
[System.IO.File]::WriteAllText($tempPath, "$json`n", [System.Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $tempPath -Destination $configPath -Force

$writtenServices = @(Read-Services $configPath)
$writtenService = $writtenServices | Where-Object { $_.id -eq $service.id } | Select-Object -First 1
if (-not $writtenService) {
  throw "Service id was not found after write: $($service.id)"
}

[ordered]@{
  configPath = $configPath
  id = $service.id
  replaced = ($existingIndex -ge 0)
  isArray = $true
  count = $writtenServices.Count
  ids = @($writtenServices | ForEach-Object { $_.id })
  service = $writtenService
} | ConvertTo-Json -Depth 20
