# Tiny static web server for play-testers on Windows. No install needed:
# Windows PowerShell 5.1 ships with every Windows 10/11 PC.
#
# Started by "Start Game.bat". Serves this folder on http://localhost:<port>/ and opens
# the browser there. Closing the black window stops the game server.
#
# Browsers refuse to load the game's ES modules from a double-clicked file (file://),
# which is why a server is needed at all. JS MUST go out as text/javascript or the
# browser rejects it as a module, so every type the game uses is mapped explicitly.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
  '.woff2' = 'font/woff2'
}

# 8936 is the game's usual port; if something else already has it, walk upwards.
$listener = $null
$port = 0
foreach ($p in 8936..8960) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://localhost:$p/")
  try { $l.Start(); $listener = $l; $port = $p; break }
  catch { $l.Close() }
}
if (-not $listener) {
  Write-Host 'Could not start the game server: ports 8936-8960 are all in use.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

$url = "http://localhost:$port/"
Write-Host ''
Write-Host '  CUT IT STRAIGHT is running.' -ForegroundColor Green
Write-Host ''
Write-Host "  Open this in your browser:  $url" -ForegroundColor Cyan
Write-Host ''
Write-Host '  Leave this window open while you play.'
Write-Host '  Close it (or press Ctrl+C) when you are done.'
Write-Host ''
# CUTIT_NO_BROWSER is for automated testing of this script only.
if (-not $env:CUTIT_NO_BROWSER) { Start-Process $url }

$rootFull = [System.IO.Path]::GetFullPath($root)
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $rel = 'index.html' }
      $path = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))
      # Never serve anything outside this folder.
      if (-not $path.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or
          -not [System.IO.File]::Exists($path)) {
        $res.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      } else {
        $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
        $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($path)
      }
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.KeepAlive = $false
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
      # A browser that hangs up mid-transfer is routine; keep serving.
    } finally {
      try { $res.OutputStream.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
