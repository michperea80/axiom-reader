Add-Type -AssemblyName System.Drawing

$newIconsDir = "C:\Users\micha\Documents\Dev\AXIOM Reader\New Icons"
$resDir = "C:\Users\micha\Documents\Dev\AXIOM Reader\mobile\android\app\src\main\res"
$pwaIconsDir = "C:\Users\micha\Documents\Dev\AXIOM Reader\icons"

function Resize-Image {
    param(
        [string]$SourcePath,
        [string]$TargetPath,
        [int]$TargetWidth,
        [int]$TargetHeight,
        [int]$CanvasWidth = 0,
        [int]$CanvasHeight = 0
    )

    if ($CanvasWidth -eq 0) { $CanvasWidth = $TargetWidth }
    if ($CanvasHeight -eq 0) { $CanvasHeight = $TargetHeight }

    $srcImg = [System.Drawing.Image]::FromFile($SourcePath)
    $destBmp = New-Object System.Drawing.Bitmap($CanvasWidth, $CanvasHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($destBmp)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $destX = [int](($CanvasWidth - $TargetWidth) / 2)
    $destY = [int](($CanvasHeight - $TargetHeight) / 2)
    $destRect = New-Object System.Drawing.Rectangle($destX, $destY, $TargetWidth, $TargetHeight)

    $graphics.DrawImage($srcImg, $destRect, 0, 0, $srcImg.Width, $srcImg.Height, [System.Drawing.GraphicsUnit]::Pixel)

    $graphics.Dispose()
    $srcImg.Dispose()

    $targetDir = Split-Path $TargetPath -Parent
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    if (Test-Path $TargetPath) {
        Remove-Item $TargetPath -Force
    }

    $destBmp.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $destBmp.Dispose()
    Write-Host "Generated: $TargetPath ($CanvasWidth x $CanvasHeight)"
}

# 1. Update PWA Icons in icons/
Write-Host "Updating PWA Web Icons..."
Copy-Item "$newIconsDir\icon_192x192.png" "$pwaIconsDir\icon-192.png" -Force
Write-Host "Copied: $pwaIconsDir\icon-192.png"
Copy-Item "$newIconsDir\icon_512x512.png" "$pwaIconsDir\icon-512.png" -Force
Write-Host "Copied: $pwaIconsDir\icon-512.png"

# 2. Update Android Auto / MediaSession app_icon.png (512x512)
Write-Host "Updating app_icon.png..."
Copy-Item "$newIconsDir\icon_512x512.png" "$resDir\drawable\app_icon.png" -Force
Write-Host "Copied: $resDir\drawable\app_icon.png"

# 3. Update Notification Icons (White monochrome)
Write-Host "Updating Notification Icons..."
$notifSource = "$newIconsDir\Notification.png"
Resize-Image -SourcePath $notifSource -TargetPath "$resDir\drawable\ic_notification.png" -TargetWidth 48 -TargetHeight 48
Resize-Image -SourcePath $notifSource -TargetPath "$resDir\drawable-mdpi\ic_notification.png" -TargetWidth 24 -TargetHeight 24
Resize-Image -SourcePath $notifSource -TargetPath "$resDir\drawable-hdpi\ic_notification.png" -TargetWidth 36 -TargetHeight 36
Resize-Image -SourcePath $notifSource -TargetPath "$resDir\drawable-xhdpi\ic_notification.png" -TargetWidth 48 -TargetHeight 48
Resize-Image -SourcePath $notifSource -TargetPath "$resDir\drawable-xxhdpi\ic_notification.png" -TargetWidth 72 -TargetHeight 72
Resize-Image -SourcePath $notifSource -TargetPath "$resDir\drawable-xxxhdpi\ic_notification.png" -TargetWidth 96 -TargetHeight 96

# 4. Update Launcher & Round Icons
Write-Host "Updating Launcher Icons..."
$iconSource = "$newIconsDir\icon_512x512.png"
$launcherSizes = @{
    "mdpi"    = 48
    "hdpi"    = 72
    "xhdpi"   = 96
    "xxhdpi"  = 144
    "xxxhdpi" = 192
}

foreach ($density in $launcherSizes.Keys) {
    $sz = $launcherSizes[$density]
    Resize-Image -SourcePath $iconSource -TargetPath "$resDir\mipmap-$density\ic_launcher.png" -TargetWidth $sz -TargetHeight $sz
    Resize-Image -SourcePath $iconSource -TargetPath "$resDir\mipmap-$density\ic_launcher_round.png" -TargetWidth $sz -TargetHeight $sz
}

# 5. Update Adaptive Launcher Foregrounds (108dp canvas with safe zone icon centered)
Write-Host "Updating Adaptive Launcher Foregrounds..."
$fgSizes = @{
    "mdpi"    = @{ Canvas = 108; Inner = 72 }
    "hdpi"    = @{ Canvas = 162; Inner = 108 }
    "xhdpi"   = @{ Canvas = 216; Inner = 144 }
    "xxhdpi"  = @{ Canvas = 324; Inner = 216 }
    "xxxhdpi" = @{ Canvas = 432; Inner = 288 }
}

foreach ($density in $fgSizes.Keys) {
    $info = $fgSizes[$density]
    Resize-Image -SourcePath $iconSource -TargetPath "$resDir\mipmap-$density\ic_launcher_foreground.png" -TargetWidth $info.Inner -TargetHeight $info.Inner -CanvasWidth $info.Canvas -CanvasHeight $info.Canvas
}

Write-Host "All icons updated successfully!"
