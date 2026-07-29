[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repoRoot "assets\plezy.png"
$outputDirectory = Join-Path $repoRoot "roku\images"

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Plezy source artwork was not found: $sourcePath"
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$background = [System.Drawing.Color]::FromArgb(255, 9, 11, 16)
$panel = [System.Drawing.Color]::FromArgb(255, 17, 21, 31)
$muted = [System.Drawing.Color]::FromArgb(255, 174, 181, 196)
$foreground = [System.Drawing.Color]::FromArgb(255, 244, 246, 251)
$accent = [System.Drawing.Color]::FromArgb(255, 245, 166, 35)

function New-Canvas {
    param([int]$Width, [int]$Height)
    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height)
    $bitmap.SetResolution(96, 96)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    return @($bitmap, $graphics)
}

function Save-Jpeg {
    param(
        [System.Drawing.Bitmap]$Bitmap,
        [string]$Path
    )
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
        Where-Object { $_.MimeType -eq "image/jpeg" } |
        Select-Object -First 1
    $parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
    $parameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
        [System.Drawing.Imaging.Encoder]::Quality,
        [long]92
    )
    try {
        $Bitmap.Save($Path, $codec, $parameters)
    }
    finally {
        $parameters.Dispose()
    }
}

function Write-ChannelIcon {
    param(
        [System.Drawing.Image]$Source,
        [int]$Width,
        [int]$Height,
        [string]$Path
    )
    $canvas = New-Canvas -Width $Width -Height $Height
    $bitmap = $canvas[0]
    $graphics = $canvas[1]
    $backgroundBrush = [System.Drawing.SolidBrush]::new($background)
    $accentBrush = [System.Drawing.SolidBrush]::new($accent)
    $foregroundBrush = [System.Drawing.SolidBrush]::new($foreground)
    $mutedBrush = [System.Drawing.SolidBrush]::new($muted)
    $titleFont = [System.Drawing.Font]::new("Segoe UI Semibold", [single]($Height * 0.20), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $subtitleFont = [System.Drawing.Font]::new("Segoe UI", [single]($Height * 0.075), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    try {
        $graphics.FillRectangle($backgroundBrush, 0, 0, $Width, $Height)
        $graphics.FillRectangle($accentBrush, 0, 0, [int]($Width * 0.025), $Height)
        $markSize = [int]($Height * 0.66)
        $markX = [int]($Width * 0.09)
        $markY = [int](($Height - $markSize) / 2)
        $graphics.DrawImage($Source, $markX, $markY, $markSize, $markSize)
        $textX = [single]($markX + $markSize + ($Width * 0.055))
        $graphics.DrawString("PLEZY", $titleFont, $foregroundBrush, $textX, [single]($Height * 0.27))
        $graphics.DrawString("FOR ROKU", $subtitleFont, $mutedBrush, $textX + 2, [single]($Height * 0.58))
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $titleFont.Dispose()
        $subtitleFont.Dispose()
        $backgroundBrush.Dispose()
        $accentBrush.Dispose()
        $foregroundBrush.Dispose()
        $mutedBrush.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Write-Splash {
    param(
        [System.Drawing.Image]$Source,
        [int]$Width,
        [int]$Height,
        [string]$Path
    )
    $canvas = New-Canvas -Width $Width -Height $Height
    $bitmap = $canvas[0]
    $graphics = $canvas[1]
    $backgroundBrush = [System.Drawing.SolidBrush]::new($background)
    $panelBrush = [System.Drawing.SolidBrush]::new($panel)
    $accentBrush = [System.Drawing.SolidBrush]::new($accent)
    $foregroundBrush = [System.Drawing.SolidBrush]::new($foreground)
    $mutedBrush = [System.Drawing.SolidBrush]::new($muted)
    $titleFont = [System.Drawing.Font]::new("Segoe UI Semibold", [single]($Height * 0.075), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $subtitleFont = [System.Drawing.Font]::new("Segoe UI", [single]($Height * 0.027), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $centerFormat = [System.Drawing.StringFormat]::new()
    $centerFormat.Alignment = [System.Drawing.StringAlignment]::Center
    try {
        $graphics.FillRectangle($backgroundBrush, 0, 0, $Width, $Height)
        $graphics.FillEllipse($panelBrush, [int]($Width * 0.31), [int](-$Height * 0.36), [int]($Width * 0.72), [int]($Width * 0.72))
        $graphics.FillRectangle($accentBrush, 0, $Height - [int]($Height * 0.012), $Width, [int]($Height * 0.012))
        $markSize = [int]($Height * 0.28)
        $graphics.DrawImage($Source, [int](($Width - $markSize) / 2), [int]($Height * 0.20), $markSize, $markSize)
        $titleRect = [System.Drawing.RectangleF]::new(0, [single]($Height * 0.52), $Width, [single]($Height * 0.12))
        $subtitleRect = [System.Drawing.RectangleF]::new(0, [single]($Height * 0.66), $Width, [single]($Height * 0.08))
        $graphics.DrawString("PLEZY", $titleFont, $foregroundBrush, $titleRect, $centerFormat)
        $graphics.DrawString("YOUR MEDIA. YOUR TELEVISION.", $subtitleFont, $mutedBrush, $subtitleRect, $centerFormat)
        Save-Jpeg -Bitmap $bitmap -Path $Path
    }
    finally {
        $centerFormat.Dispose()
        $titleFont.Dispose()
        $subtitleFont.Dispose()
        $backgroundBrush.Dispose()
        $panelBrush.Dispose()
        $accentBrush.Dispose()
        $foregroundBrush.Dispose()
        $mutedBrush.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Write-ScaledPng {
    param(
        [System.Drawing.Image]$Source,
        [int]$Width,
        [int]$Height,
        [string]$Path,
        [System.Drawing.Color]$FillColor
    )
    $canvas = New-Canvas -Width $Width -Height $Height
    $bitmap = $canvas[0]
    $graphics = $canvas[1]
    $brush = [System.Drawing.SolidBrush]::new($FillColor)
    try {
        $graphics.FillRectangle($brush, 0, 0, $Width, $Height)
        $graphics.DrawImage($Source, 0, 0, $Width, $Height)
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $brush.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
    Write-ChannelIcon -Source $source -Width 290 -Height 218 -Path (Join-Path $outputDirectory "channel-icon_hd.png")
    Write-ChannelIcon -Source $source -Width 540 -Height 405 -Path (Join-Path $outputDirectory "channel-icon_fhd.png")
    Write-Splash -Source $source -Width 1280 -Height 720 -Path (Join-Path $outputDirectory "splash-screen_hd.jpg")
    Write-Splash -Source $source -Width 1920 -Height 1080 -Path (Join-Path $outputDirectory "splash-screen_fhd.jpg")
    Write-ScaledPng -Source $source -Width 256 -Height 256 -Path (Join-Path $outputDirectory "plezy-mark.png") -FillColor ([System.Drawing.Color]::Transparent)

    $posterCanvas = New-Canvas -Width 460 -Height 684
    $poster = $posterCanvas[0]
    $posterGraphics = $posterCanvas[1]
    $posterBackground = [System.Drawing.SolidBrush]::new($panel)
    try {
        $posterGraphics.FillRectangle($posterBackground, 0, 0, 460, 684)
        $posterGraphics.DrawImage($source, 102, 214, 256, 256)
        $poster.Save((Join-Path $outputDirectory "poster-placeholder.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $posterBackground.Dispose()
        $posterGraphics.Dispose()
        $poster.Dispose()
    }

    $focusCanvas = New-Canvas -Width 275 -Height 72
    $focus = $focusCanvas[0]
    $focusGraphics = $focusCanvas[1]
    $focusBrush = [System.Drawing.SolidBrush]::new($accent)
    try {
        $focusGraphics.FillRectangle($focusBrush, 0, 0, 275, 72)
        $focus.Save((Join-Path $outputDirectory "nav-focus.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $focusBrush.Dispose()
        $focusGraphics.Dispose()
        $focus.Dispose()
    }
}
finally {
    $source.Dispose()
}

Write-Host "Generated Roku assets in $outputDirectory"

