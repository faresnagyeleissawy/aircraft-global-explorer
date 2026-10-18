# Draws the app icons into icons/: a globe with a yellow plane on a blue
# background. Run with Windows PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File tools/icons.ps1

Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force $out | Out-Null

function Draw-Icon([int]$size, [double]$pad, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $back = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(11, 29, 51)), ([System.Drawing.Color]::FromArgb(31, 92, 143)), 45.0
  $g.FillRectangle($back, $rect)

  # The globe: outline, two meridians and three parallels.
  $s = $size * (1 - 2 * $pad)
  $cx = $size / 2.0
  $cy = $size / 2.0
  $r = $s * 0.42
  $line = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(140, 160, 205, 255)), ([Math]::Max(1.5, $size / 120.0))
  $g.DrawEllipse($line, [single]($cx - $r), [single]($cy - $r), [single](2 * $r), [single](2 * $r))
  foreach ($k in 0.35, 0.72) {
    $g.DrawEllipse($line, [single]($cx - $r * $k), [single]($cy - $r), [single](2 * $r * $k), [single](2 * $r))
  }
  foreach ($k in -0.5, 0, 0.5) {
    $y = $cy + $k * $r
    $half = [Math]::Sqrt($r * $r - ($k * $r) * ($k * $r))
    $g.DrawLine($line, [single]($cx - $half), [single]$y, [single]($cx + $half), [single]$y)
  }

  # The plane, nose to the top right.
  $u = $s / 100.0
  $pts = @(
    @(0, -40), @(4, -37), @(5, -22), @(5, -8), @(38, 8), @(38, 15), @(5, 6), @(5, 24), @(15, 32), @(15, 37),
    @(0, 33), @(-15, 37), @(-15, 32), @(-5, 24), @(-5, 6), @(-38, 15), @(-38, 8), @(-5, -8), @(-5, -22), @(-4, -37)
  )
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $points = foreach ($p in $pts) { New-Object System.Drawing.PointF ([single]($p[0] * $u)), ([single]($p[1] * $u)) }
  $path.AddPolygon([System.Drawing.PointF[]]$points)
  $turn = New-Object System.Drawing.Drawing2D.Matrix
  $turn.Translate([single]$cx, [single]$cy)
  $turn.Rotate(45)
  $path.Transform($turn)
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(240, 180, 41))), $path)
  $edge = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(11, 29, 51)), ([single]($u * 1.6))
  $edge.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPath($edge, $path)

  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

Draw-Icon 512 0.06 "icon-512.png"
Draw-Icon 192 0.06 "icon-192.png"
# Maskable: more room round the edge, which phones may crop to a circle.
Draw-Icon 512 0.14 "icon-maskable-512.png"
Draw-Icon 180 0.08 "apple-touch-icon.png"
Write-Output "icons written to $out"

# Feature graphic for the Google Play listing (1024 x 500): the icon and the name.
$feature = New-Object System.Drawing.Bitmap 1024, 500
$g = [System.Drawing.Graphics]::FromImage($feature)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$area = New-Object System.Drawing.Rectangle 0, 0, 1024, 500
$sky = New-Object System.Drawing.Drawing2D.LinearGradientBrush $area, ([System.Drawing.Color]::FromArgb(11, 29, 51)), ([System.Drawing.Color]::FromArgb(31, 92, 143)), 20.0
$g.FillRectangle($sky, $area)
$icon = [System.Drawing.Image]::FromFile((Join-Path $out "icon-512.png"))
$g.DrawImage($icon, 60, 90, 320, 320)
$icon.Dispose()
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$yellow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(240, 180, 41))
$g.DrawString("Aircraft Global", (New-Object System.Drawing.Font "Segoe UI", 52, ([System.Drawing.FontStyle]::Bold)), $white, 410, 130)
$g.DrawString("Explorer", (New-Object System.Drawing.Font "Segoe UI", 52, ([System.Drawing.FontStyle]::Bold)), $yellow, 410, 205)
$g.DrawString("Fly anywhere on Earth in 3D", (New-Object System.Drawing.Font "Segoe UI", 24), $white, 416, 300)
$store = Join-Path $PSScriptRoot "..\store"
New-Item -ItemType Directory -Force $store | Out-Null
$feature.Save((Join-Path $store "feature-graphic.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$feature.Dispose()
Write-Output "feature graphic written to $store"
