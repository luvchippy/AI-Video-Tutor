# Generate Chrome Web Store listing assets (screenshots + promotional tiles).
# Requires the source screenshots (屏幕截图*.png) at the repo root and the
# generated icon at public/icons/icon-128.png.
#
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-store-assets.ps1
#
# Outputs into store/:
#   screenshot-01..05.jpg        1280x800 (browser chrome + video area + Side Panel)
#   promo-tile-440x280.jpg       440x280  small promotional tile
#   promo-marquee-1400x560.jpg   1400x560 marquee promotional tile
# All outputs are JPEG (no alpha), per Chrome Web Store requirements.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = $PSScriptRoot | Split-Path -Parent
$storeDir = Join-Path $root 'store'
if (-not (Test-Path $storeDir)) { New-Item -ItemType Directory -Force -Path $storeDir | Out-Null }

$icon128 = Join-Path $root 'public\icons\icon-128.png'

$brandTop    = [System.Drawing.Color]::FromArgb(255, 0x8B, 0x5C, 0xF6)  # #8B5CF6
$brandBottom = [System.Drawing.Color]::FromArgb(255, 0x4F, 0x46, 0xE5)  # #4F46E5
$chromeBar   = [System.Drawing.Color]::FromArgb(255, 0x20, 0x24, 0x2B)  # browser chrome
$addrBar     = [System.Drawing.Color]::FromArgb(255, 0x2A, 0x2F, 0x38)
$videoBg     = [System.Drawing.Color]::FromArgb(255, 0x0B, 0x0E, 0x14)  # video area
$white       = [System.Drawing.Color]::White

function Get-Font([float]$size, [bool]$bold = $false) {
    $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    foreach ($name in @('Microsoft YaHei', 'Microsoft YaHei UI', 'Segoe UI', 'Arial')) {
        try { return New-Object System.Drawing.Font($name, $size, $style, [System.Drawing.GraphicsUnit]::Pixel) } catch {}
    }
    return New-Object System.Drawing.Font('Arial', $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
}

function New-Bitmap([int]$w, [int]$h) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    return @($bmp, $g)
}

function Fill-BrandGradient($g, [int]$w, [int]$h, [float]$angle = 45) {
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $brandTop, $brandBottom, $angle)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()
}

function Save-Jpeg($bmp, [string]$path, [long]$quality = 92) {
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $enc = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $enc.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, $quality)
    $bmp.Save($path, $codec, $enc)
    $enc.Dispose()
}

function Draw-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function Draw-PlayGlyph($g, [float]$cx, [float]$cy, [float]$radius, [System.Drawing.Color]$color) {
    # translucent circle + white triangle
    $a = [int]($color.A * 0.28)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a, $color.R, $color.G, $color.B))
    $g.FillEllipse($brush, $cx - $radius, $cy - $radius, $radius * 2, $radius * 2)
    $brush.Dispose()
    $pen = New-Object System.Drawing.Pen($color, [float]($radius * 0.06))
    $g.DrawEllipse($pen, $cx - $radius, $cy - $radius, $radius * 2, $radius * 2)
    $pen.Dispose()
    $tr = [System.Drawing.Point[]]@(
        [System.Drawing.Point]::new([int]($cx - $radius * 0.32), [int]($cy - $radius * 0.48)),
        [System.Drawing.Point]::new([int]($cx - $radius * 0.32), [int]($cy + $radius * 0.48)),
        [System.Drawing.Point]::new([int]($cx + $radius * 0.56), [int]($cy))
    )
    $g.FillPolygon((New-Object System.Drawing.SolidBrush($color)), $tr)
}

function New-Screenshot([string]$srcPath, [string]$outPath) {
    $src = New-Object System.Drawing.Bitmap($srcPath)
    $pair = New-Bitmap 1280 800
    $bmp = $pair[0]; $g = $pair[1]

    # Browser chrome bar
    $g.FillRectangle((New-Object System.Drawing.SolidBrush($chromeBar)), 0, 0, 1280, 60)
    $dotColors = @('#FF5F57', '#FFBD2E', '#28C840')
    $x = 22
    foreach ($c in $dotColors) {
        $b = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($c))
        $g.FillEllipse($b, $x, 22, 16, 16); $b.Dispose(); $x += 30
    }
    $addrPath = Draw-RoundedPath 120 16 1120 28 14
    $g.FillPath((New-Object System.Drawing.SolidBrush($addrBar)), $addrPath)
    $addrPath.Dispose()
    $furl = Get-Font 13 $false
    $g.DrawString('https://example.com/video', $furl, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180,255,255,255))), 136, 22)
    $furl.Dispose()

    # Video area (left)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush($videoBg)), 0, 60, 960, 740)
    Draw-PlayGlyph $g 480 430 90 $white

    # Side Panel screenshot (right) - center-crop to 320x744
    $dst = New-Object System.Drawing.Rectangle(960, 60, 320, 740)
    $dstRatio = 320.0 / 740.0
    $srcRatio = $src.Width / [double]$src.Height
    $srcRect = New-Object System.Drawing.Rectangle
    if ($srcRatio -gt $dstRatio) {
        $srcRect.Height = $src.Height
        $srcRect.Width = [int]($src.Height * $dstRatio)
        $srcRect.X = [int](($src.Width - $srcRect.Width) / 2)
        $srcRect.Y = 0
    } else {
        $srcRect.Width = $src.Width
        $srcRect.Height = [int]($src.Width / $dstRatio)
        $srcRect.X = 0
        $srcRect.Y = [int](($src.Height - $srcRect.Height) / 2)
    }
    $g.DrawImage($src, $dst, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

    # Divider shadow between video area and side panel
    $shadow = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Rectangle(940, 60, 20, 740)), [System.Drawing.Color]::Transparent,
        [System.Drawing.Color]::FromArgb(70, 0, 0, 0), 0.0)
    $g.FillRectangle($shadow, 940, 60, 20, 740)
    $shadow.Dispose()

    $g.Dispose(); $src.Dispose()
    Save-Jpeg $bmp $outPath
    $bmp.Dispose()
    Write-Output "wrote $outPath"
}

function New-PromoTile([string]$outPath) {
    $pair = New-Bitmap 440 280
    $bmp = $pair[0]; $g = $pair[1]
    Fill-BrandGradient $g 440 280 55

    $icon = New-Object System.Drawing.Bitmap($icon128)
    # rounded icon backdrop
    $bp = Draw-RoundedPath 30 76 128 128 30
    $g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40,255,255,255))), $bp)
    $bp.Dispose()
    $g.DrawImage($icon, 30, 76, 128, 128)

    $fname = Get-Font 34 $true
    $fsub = Get-Font 16 $false
    $g.DrawString('AI Video Tutor', $fname, (New-Object System.Drawing.SolidBrush($white)), 178, 100)
    $g.DrawString('陪伴你观看视频的', $fsub, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235,255,255,255))), 178, 160)
    $g.DrawString('一对一 AI 学习助教', $fsub, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235,255,255,255))), 178, 186)
    $fname.Dispose(); $fsub.Dispose()

    $g.Dispose(); $icon.Dispose()
    Save-Jpeg $bmp $outPath
    $bmp.Dispose()
    Write-Output "wrote $outPath"
}

function New-Marquee([string]$outPath) {
    $pair = New-Bitmap 1400 560
    $bmp = $pair[0]; $g = $pair[1]
    Fill-BrandGradient $g 1400 560 15

    # soft radial highlight
    $icon = New-Object System.Drawing.Bitmap($icon128)
    $bp = Draw-RoundedPath 90 90 380 380 90
    $g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(45,255,255,255))), $bp)
    $bp.Dispose()
    $g.DrawImage($icon, 90, 90, 380, 380)

    $fname = Get-Font 72 $true
    $fsub  = Get-Font 34 $false
    $ftag  = Get-Font 24 $false
    $g.DrawString('AI Video Tutor', $fname, (New-Object System.Drawing.SolidBrush($white)), 540, 150)
    $g.DrawString('陪伴你观看视频的一对一 AI 学习助教', $fsub, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(240,255,255,255))), 544, 290)
    $g.DrawString('Watch · Pause · Ask · Learn', $ftag, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(210,224,231,255))), 544, 390)
    $fname.Dispose(); $fsub.Dispose(); $ftag.Dispose()

    $g.Dispose(); $icon.Dispose()
    Save-Jpeg $bmp $outPath
    $bmp.Dispose()
    Write-Output "wrote $outPath"
}

New-PromoTile (Join-Path $storeDir 'promo-tile-440x280.jpg')
New-Marquee (Join-Path $storeDir 'promo-marquee-1400x560.jpg')

$shots = Get-ChildItem (Join-Path $root '屏幕截图*.png') | Sort-Object Name
$i = 1
foreach ($s in $shots) {
    $out = Join-Path $storeDir ('screenshot-{0:D2}.jpg' -f $i)
    New-Screenshot $s.FullName $out
    $i++
}
Write-Output "done. $($shots.Count) screenshots processed."