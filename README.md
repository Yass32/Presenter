# Happy Days Presenter (desktop)

Run sheets of images, videos and audio for live events, shown on a projector.

## Run from source
    npm install
    npm start

## Build installers
    npm run dist:win     # Windows installer + portable .exe
    npm run dist:mac     # macOS .dmg (build on a Mac)
    npm run dist:linux   # Linux AppImage

The projector window opens full screen on the second display automatically,
and moves there if the projector is connected later.

WMA and WMV files are converted to MP4/M4A on import using the bundled FFmpeg
(ffmpeg-static). When building for Windows from another OS, fetch the Windows
binary first:
    cd node_modules/ffmpeg-static && npm_config_platform=win32 npm_config_arch=x64 node install.js
