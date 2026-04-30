# Start VoiceBot — kills any existing ARI connections first
Write-Host "[VoiceBot] Cleaning up old connections..." -ForegroundColor Yellow

# Kill all Node.js processes connected to Asterisk ARI port 8088
$ariPids = netstat -ano | Select-String ":8088\s.*ESTABLISHED" |
  ForEach-Object { ($_ -split '\s+') | Select-Object -Last 1 } |
  Where-Object { $_ -ne "3044" -and $_ -ne "0" } |
  Sort-Object -Unique

if ($ariPids) {
  foreach ($pid in $ariPids) {
    Stop-Process -Id ([int]$pid) -Force -ErrorAction SilentlyContinue
  }
  Write-Host "[VoiceBot] Killed $($ariPids.Count) old instance(s)" -ForegroundColor Yellow
  Start-Sleep -Seconds 2
} else {
  Write-Host "[VoiceBot] No old instances found" -ForegroundColor Green
}

Write-Host "[VoiceBot] Starting..." -ForegroundColor Green
npx pnpm@9.14.2 --filter @crm/voicebot dev
