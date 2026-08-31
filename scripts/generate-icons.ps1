# Generate PNG extension icons from a master design.
# Design: rounded square with indigo->violet gradient, white play triangle,
# and a white "sparkle" (4-point star) marking the AI assistant.
#
# Run:  powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
#
# Outputs public/icons/icon-{16,32,48,128,512}.png (the SVG at icon.svg is the
# editable source; these PNGs are rasterizations for the extension manifest).

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\public\icons'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Get-MasterBitmap {
    $size = 512
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    # Background: rounded square, gradient top (#8B5CF6) -> bottom (#4F46E5)
    $rect = New-Object System.Drawing.Rectangle(16, 16, 480, 480)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 0x8B, 0x5C, 0xF6),
        [System.Drawing.Color]::FromArgb(255, 0x4F, 0x46, 0xE5),
        [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $bgPath = New-RoundedRectPath 16 16 480 480 112
    $g.FillPath($brush, $bgPath)
    $brush.Dispose()
    $bgPath.Dispose()

    $white = [System.Drawing.Brushes]::White

    # Play triangle (pointing right; integer coords)
    $tri = [System.Drawing.Point[]]@(
        [System.Drawing.Point]::new(190, 168),
        [System.Drawing.Point]::new(190, 344),
        [System.Drawing.Point]::new(370, 256)
    )
    $g.FillPolygon($white, $tri)

    # Sparkle (4-point star) - AI accent; integer coords
    $star = [System.Drawing.Point[]]@(
        [System.Drawing.Point]::new(350, 72),
        [System.Drawing.Point]::new(367, 133),
        [System.Drawing.Point]::new(428, 150),
        [System.Drawing.Point]::new(367, 167),
        [System.Drawing.Point]::new(350, 228),
        [System.Drawing.Point]::new(333, 167),
        [System.Drawing.Point]::new(272, 150),
        [System.Drawing.Point]::new(333, 133)
    )
    $g.FillPolygon($white, $star)

    $g.Dispose()
    return $bmp
}

function Save-Resized($srcBmp, [int]$size, [string]$path) {
    $out = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($srcBmp, 0, 0, $size, $size)
    $g.Dispose()
    $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
}

$master = Get-MasterBitmap

foreach ($size in @(16, 32, 48, 128, 512)) {
    $path = Join-Path $outDir "icon-$size.png"
    Save-Resized $master $size $path
    Write-Output "wrote $path"
}

$master.Dispose()
Write-Output 'done.'