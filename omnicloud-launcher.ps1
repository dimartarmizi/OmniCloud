$ProjectPath = "W:\DEVELOPMENT\OmniCloud"
$FrontendUrl = "http://localhost:5173/"
$FrontendPort = 5173

$ChromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

Set-Location $ProjectPath

# Start dev server di window terminal terpisah
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/k", "cd /d `"$ProjectPath`" && npm run dev" `
    -WorkingDirectory $ProjectPath

# Tunggu sampai Vite aktif di port 5173
$deadline = (Get-Date).AddSeconds(45)
$ready = $false

while ((Get-Date) -lt $deadline) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect("127.0.0.1", $FrontendPort, $null, $null)
        $connected = $async.AsyncWaitHandle.WaitOne(500)

        if ($connected) {
            $client.EndConnect($async)
            $client.Close()
            $ready = $true
            break
        }

        $client.Close()
    } catch {
        Start-Sleep -Milliseconds 500
    }

    Start-Sleep -Milliseconds 500
}

# Buka Chrome atau browser default
if ($ready) {
    $chrome = $ChromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($chrome) {
        Start-Process -FilePath $chrome -ArgumentList "--new-tab", $FrontendUrl
    } else {
        Start-Process $FrontendUrl
    }
} else {
    Start-Process $FrontendUrl
}