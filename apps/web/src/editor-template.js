export const icons = {
  logo: '<path d="m5 4 14 8L5 20V4Z"/><path d="m13 4 6 3M13 20l6-3"/>',
  link: '<path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-5.7-5.7l4-4a4 4 0 0 1 5.7 0m2 2 1-1a4 4 0 0 1 5.7 5.7l-4 4a4 4 0 0 1-5.7 0" transform="translate(1.6 1.5) scale(.88)"/>',
  arrow: '<path d="M12 19V5m-5 5 5-5 5 5"/>',
  play: '<path d="m9 5 11 7-11 7V5Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  crop: '<path d="M7 3v14h14M3 7h14v14"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4m-4 6h4M17 9h4m-4 6h4"/>',
  text: '<path d="M4 5h16M12 5v15M8 20h8"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 12 12M8 16 20 4"/>',
  volume: '<path d="M11 4 6 8H3v8h3l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 4 6 8H3v8h3l5 4V4Zm5 5 6 6m-6 0 6-6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  redo: '<path d="m16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12"/>',
  pointer: '<path d="m5 3 14 9-7 2-3 7-4-18Z"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  marker: '<path d="M6 3h12v12l-6 6-6-6V3Z"/>',
  magnet: '<path d="M5 4v10a7 7 0 0 0 14 0V4h-5v10a2 2 0 0 1-4 0V4H5Zm0 5h5m4 0h5"/>',
  snap: '<path d="M3 4v16M21 4v16M7 8l4 4-4 4m10-8-4 4 4 4"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8"/>',
  minus: '<path d="M5 12h14"/>',
  previous: '<path d="M5 5v14m14-14L8 12l11 7V5Z"/>',
  next: '<path d="M19 5v14M5 5l11 7-11 7V5Z"/>',
  reverse: '<path d="M8 3 3 8l5 5M3 8h11a7 7 0 1 1-6 10"/>',
  freeze: '<path d="M12 2v20M3 7l18 10M3 17 21 7m-9-5-3 3m3-3 3 3m-3 17-3-3m3 3 3-3"/>',
  lefttrim: '<path d="M4 4v16M9 7v10m0-5h11m-4-4 4 4-4 4"/>',
  righttrim: '<path d="M20 4v16M15 7v10m0-5H4m4-4-4 4 4 4"/>',
  follow: '<path d="M3 6h18M3 18h18M9 9l6 3-6 3V9Z"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
};
export const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${icons[name]}</svg>`;
export const template = `
<header class="topbar">
  <a class="brand" href="/" aria-label="Frame Video Studio home" data-i18n-aria-label="ui.home"><span class="brand-icon">${icon('logo')}</span><strong>frame<span>studio</span></strong></a>
  <div class="project-heading"><span class="project-dot"></span><span id="project-name" data-i18n="ui.newProject">New project</span><span class="project-separator">/</span><span class="muted" data-i18n="ui.videoEditor">Video editor</span></div>
  <label class="language-picker"><span class="sr-only" data-i18n="ui.language">Language</span><select id="language-select" data-language-select aria-label="Language" data-i18n-aria-label="ui.language"><option value="en">English</option><option value="tr">Türkçe</option></select></label><button id="open-export" class="button accent" disabled="">${icon('arrow')}<span data-i18n="ui.export">Export</span></button>
</header>
<main class="workspace">
  <aside class="media-panel panel" aria-label="Media library" data-i18n-aria-label="ui.mediaLibrary">
    <div class="panel-heading"><h1 data-i18n="ui.media">Media</h1><span class="subtle-tag" data-i18n="ui.library">Library</span></div>
    <div class="media-content">
      <div class="section-label" data-i18n="ui.importHeading">IMPORT VIDEO</div>
      <form id="download-form" novalidate="">
        <label class="sr-only" for="video-url" data-i18n="ui.urlLabel">Instagram, YouTube, YouTube Shorts, X (Twitter), or direct video URL</label>
        <div class="url-field">${icon('link')}<input id="video-url" type="url" placeholder="Paste a video URL" maxlength="2048" autocomplete="off" spellcheck="false" required="" aria-describedby="import-help download-status" data-i18n-placeholder="ui.urlPlaceholder"></div>
        <button id="download-button" class="button accent full" type="submit">${icon('plus')}<span id="button-text" data-i18n="ui.importVideo">Import video</span></button>
      </form>
      <div class="import-divider"><span data-i18n="ui.or">or</span></div>
      <input id="video-file" type="file" accept="video/*,.mp4,.mov,.webm,.mkv,.avi,.m4v" hidden="">
      <button id="local-import-button" class="button secondary full" type="button">${icon('film')}<span data-i18n="ui.chooseLocal">Choose a local video</span></button>
      <p id="import-help" class="helper import-help">Instagram · YouTube / Shorts · X (Twitter)<br><span data-i18n="ui.importHelp">Direct video URL or local file · No size or duration limits.</span></p>
      <div id="download-status" class="import-status" data-state="idle" role="status" aria-live="polite"><span class="status-dot"></span><div><strong id="status-title" data-i18n="ui.startVideo">Start with a video</strong><p id="status-detail" data-i18n="ui.startVideoDetail">Add a URL or choose a video from your computer.</p></div></div>
      <button id="import-cancel" class="text-button import-cancel" type="button" hidden="" data-i18n="ui.cancelImport">Cancel import</button>
      <div class="library-divider"></div>
      <div class="library-header"><span data-i18n="ui.projectMedia">Project media</span><span id="media-count" class="count">0</span></div>
      <div id="library-empty" class="library-empty">${icon('film')}<p data-i18n="ui.libraryEmpty">Your story starts here</p><span data-i18n="ui.libraryEmptyDetail">Add your video and make it your own.</span><button id="sample-button" class="text-button" data-i18n="ui.sample">Use a sample URL ↗</button></div>
      <div id="media-card" class="media-card" hidden="">
        <div class="media-thumbnail"><img id="media-poster" alt="Imported video preview" data-i18n-alt="ui.importedPoster"><span id="media-duration"></span><span class="media-check">${icon('check')}</span></div>
        <p id="media-filename"></p><div class="media-meta"><span id="media-dimensions"></span><a id="source-download" download=""><span data-i18n="ui.download">Download video</span> ${icon('download')}</a></div>
      </div>
    </div>
    <div class="local-note"><span class="local-indicator"></span><span data-i18n="ui.localWorkspace">Local workspace</span><span class="local-note-detail" data-i18n="ui.localNote">One video. Endless ideas.</span></div>
  </aside>
  <section class="preview-panel panel" aria-label="Video preview" data-i18n-aria-label="ui.videoPreview">
    <div class="panel-heading preview-heading"><h2 data-i18n="ui.preview">Preview</h2><span id="preview-badge" class="subtle-tag" data-i18n="ui.canvas">Canvas</span></div>
    <div id="preview-stage" class="preview-stage">
      <div id="preview-empty" class="preview-empty"><div class="empty-symbol">${icon('play')}</div><h2 data-i18n="ui.previewEmpty">Turn an idea into a video.</h2><p data-i18n="ui.previewEmptyDetail">Import. Trim. Say something.</p><span data-i18n="ui.previewEmptyHelp">Add a video URL or choose a file to get started.</span></div>
      <div id="video-frame" class="video-frame" hidden="">
        <video id="video-player" playsinline="" preload="metadata"></video>
        <div id="text-overlay" class="text-overlay" hidden="" title="Drag to position text" data-i18n-title="ui.dragText"></div>
        <div id="crop-overlay" class="crop-overlay" hidden="" aria-label="Crop area; numeric settings are in the right panel" data-i18n-aria-label="ui.cropArea">
          <div class="crop-grid"><i></i><i></i></div>
          <span data-corner="nw" class="crop-handle nw"></span><span data-corner="ne" class="crop-handle ne"></span><span data-corner="sw" class="crop-handle sw"></span><span data-corner="se" class="crop-handle se"></span>
        </div>
      </div>
      <span id="crop-hint" class="crop-hint" hidden="" data-i18n="ui.cropHint">Move the area or resize it from the corners</span>
    </div>
    <div class="player-controls">
      <span class="timecode"><strong id="current-time">00:00.0</strong><span>/</span><span id="total-time">00:00.0</span></span>
      <button id="play-button" class="icon-button play-button" aria-label="Play" title="Play / pause (Space)" disabled="" data-i18n-aria-label="ui.play" data-i18n-title="ui.playShortcut">${icon('play')}</button>
      <div class="player-right"><button id="mute-button" class="icon-button" aria-label="Mute" title="Mute" disabled="" data-i18n-aria-label="ui.mute" data-i18n-title="ui.mute">${icon('volume')}</button><span id="output-ratio">—</span></div>
    </div>
  </section>
  <aside class="inspector-panel panel" aria-label="Edit settings" data-i18n-aria-label="ui.editSettings">
    <div class="inspector-tabs" role="tablist" aria-label="Editing tools" data-i18n-aria-label="ui.editTools"><button id="video-tab" class="inspector-tab active" role="tab" aria-selected="true" aria-controls="video-settings">${icon('crop')}<span data-i18n="ui.video">Video</span></button><button id="text-tab" class="inspector-tab" role="tab" aria-selected="false" aria-controls="text-settings" tabindex="-1">${icon('text')}<span data-i18n="ui.text">Text</span></button></div>
    <div id="inspector-empty" class="inspector-empty">${icon('crop')}<p data-i18n="ui.inspectorEmpty">Details make a difference.</p><span data-i18n="ui.inspectorEmptyDetail">Editing tools will appear here when you add a video.</span></div>
    <div id="video-settings" class="settings" role="tabpanel" aria-labelledby="video-tab" hidden="">
      <div class="settings-heading"><h3 data-i18n="ui.crop">Crop</h3><button id="crop-reset" class="icon-button small" aria-label="Reset crop" title="Reset crop" data-i18n-aria-label="ui.resetCrop" data-i18n-title="ui.resetCrop">${icon('reset')}</button></div>
      <p class="field-description" data-i18n="ui.cropDescription">Fit your video to where you want to share it.</p>
      <div class="ratio-options" aria-label="Aspect ratio" data-i18n-aria-label="ui.cropRatio">
        <button class="ratio-option selected" data-ratio="source"><i class="ratio-shape original"></i><span data-i18n="ui.original">Original</span></button>
        <button class="ratio-option" data-ratio="9:16"><i class="ratio-shape portrait"></i>9:16</button>
        <button class="ratio-option" data-ratio="16:9"><i class="ratio-shape landscape"></i>16:9</button>
        <button class="ratio-option" data-ratio="1:1"><i class="ratio-shape square"></i>1:1</button>
        <button class="ratio-option" data-ratio="4:5"><i class="ratio-shape fourfive"></i>4:5</button>
      </div>
      <button id="crop-mode" class="button secondary full">${icon('crop')}<span data-i18n="ui.editCrop">Edit crop</span></button>
      <div class="field-grid compact">
        <label><span data-i18n="ui.positionX">X position</span> <span class="unit-input"><input id="crop-x" type="number" min="0" max="95" step="0.1" value="0"><span>%</span></span></label>
        <label><span data-i18n="ui.positionY">Y position</span> <span class="unit-input"><input id="crop-y" type="number" min="0" max="95" step="0.1" value="0"><span>%</span></span></label>
        <label><span data-i18n="ui.width">Width</span> <span class="unit-input"><input id="crop-width" type="number" min="5" max="100" step="0.1" value="100"><span>%</span></span></label>
        <label><span data-i18n="ui.height">Height</span> <span class="unit-input"><input id="crop-height" type="number" min="5" max="100" step="0.1" value="100"><span>%</span></span></label>
      </div>
      <div class="settings-divider"></div>
      <div class="settings-heading"><h3 data-i18n="ui.selectedClip">Selected clip</h3>${icon('scissors')}</div>
      <p class="field-description" data-i18n="ui.sourceRange">Start and end times in the source video.</p>
      <div class="field-grid"><label><span data-i18n="ui.start">Start</span> <span class="unit-input"><input id="trim-start" type="number" min="0" step="0.1" value="0"><span data-i18n="ui.seconds">s</span></span></label><label><span data-i18n="ui.end">End</span> <span class="unit-input"><input id="trim-end" type="number" min="0.1" step="0.1" value="0"><span data-i18n="ui.seconds">s</span></span></label></div>
      <div class="selection-duration"><span data-i18n="ui.selectedDuration">Selected duration</span><strong id="selected-duration">00:00.0</strong></div>
      <p class="helper" data-i18n="ui.trimHint">You can also drag either handle on the timeline.</p>
      <div class="field-grid"><label><span data-i18n="ui.speed">Speed</span> <select id="clip-speed"><option value="0.25" data-i18n="ui.speed025">0.25×</option><option value="0.5" data-i18n="ui.speed050">0.5×</option><option value="0.75" data-i18n="ui.speed075">0.75×</option><option value="1" selected="">1×</option><option value="1.5" data-i18n="ui.speed150">1.5×</option><option value="2">2×</option><option value="3">3×</option><option value="4">4×</option></select></label><label><span data-i18n="ui.volume">Volume</span> <span class="unit-input"><input id="clip-volume" type="number" min="0" max="200" step="5" value="100"><span>%</span></span></label></div>
      <label class="clip-check"><input id="clip-muted" type="checkbox"><span data-i18n="ui.muteClip">Mute clip</span></label>
      <label class="clip-check"><input id="clip-reverse" type="checkbox"><span data-i18n="ui.reverse">Reverse</span></label>
      <label id="freeze-settings" class="freeze-settings" hidden=""><span data-i18n="ui.freezeDuration">Freeze frame duration</span> <span class="unit-input"><input id="freeze-duration" type="number" min="0.1" step="0.1" value="3"><span data-i18n="ui.seconds">s</span></span></label>
      <p id="clip-playback-hint" class="helper"></p>
      <div id="voiceover-controls" class="voiceover-controls"></div>
    </div>
    <div id="text-settings" class="settings" role="tabpanel" aria-labelledby="text-tab" hidden="">
      <div class="settings-heading"><h3 data-i18n="ui.textOnVideo">Text on video</h3><label class="switch"><input id="text-enabled" type="checkbox" aria-label="Enable text" data-i18n-aria-label="ui.enableText"><span></span></label></div>
      <p class="field-description" data-i18n="ui.textDescription">Add your own voice to the story.</p>
      <fieldset id="text-fields" disabled="">
        <label class="text-label" for="text-value" data-i18n="ui.text">Text</label><textarea id="text-value" maxlength="120" rows="3" placeholder="Say something…" data-i18n-placeholder="ui.textPlaceholder">Tell your story.</textarea>
        <div class="text-font-row"><span>Noto Sans</span><span id="text-char-count">16 / 120</span></div>
        <div class="field-grid"><label><span data-i18n="ui.size">Size</span> <span class="unit-input"><input id="text-size" type="number" min="2" max="20" step="0.5" value="5"><span>%</span></span></label><label><span data-i18n="ui.color">Color</span> <span class="color-input"><input id="text-color" type="color" value="#ffffff"><span id="text-color-code">#FFFFFF</span></span></label></div>
        <div class="field-grid"><label><span data-i18n="ui.positionX">X position</span> <span class="unit-input"><input id="text-x" type="number" min="0" max="100" step="1" value="50"><span>%</span></span></label><label><span data-i18n="ui.positionY">Y position</span> <span class="unit-input"><input id="text-y" type="number" min="0" max="100" step="1" value="80"><span>%</span></span></label></div>
        <p id="text-hint" class="helper" data-i18n="ui.textHint">Drag text to position it. Press Enter for a new line.</p>
        <div class="settings-divider"></div>
        <h3 data-i18n="ui.visibilityDuration">Visibility duration</h3><p class="field-description" data-i18n="ui.visibilityDescription">Relative to the start of the edited video.</p>
        <div class="field-grid"><label><span data-i18n="ui.start">Start</span> <span class="unit-input"><input id="text-start" type="number" min="0" step="0.1" value="0"><span data-i18n="ui.seconds">s</span></span></label><label><span data-i18n="ui.end">End</span> <span class="unit-input"><input id="text-end" type="number" min="0.1" step="0.1" value="0"><span data-i18n="ui.seconds">s</span></span></label></div>
      </fieldset>
    </div>
  </aside>
  <section class="timeline-panel panel" aria-label="Timeline" data-i18n-aria-label="ui.timeline">
    <div class="timeline-toolbar">
      <div class="timeline-tools" role="toolbar" aria-label="Clip tools" data-i18n-aria-label="ui.clipTools">
        <button id="select-tool" class="icon-button active" title="Selection tool (V)" aria-label="Selection tool" aria-pressed="true" data-i18n-aria-label="ui.selectTool" data-i18n-title="ui.selectToolShortcut">${icon('pointer')}</button>
        <button id="blade-tool" class="icon-button" title="Blade tool (B)" aria-label="Blade tool" aria-pressed="false" data-i18n-aria-label="ui.bladeTool" data-i18n-title="ui.bladeToolShortcut">${icon('scissors')}</button>
        <span class="toolbar-divider"></span>
        <button id="undo-button" class="icon-button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled="" data-i18n-aria-label="ui.undo" data-i18n-title="ui.undoShortcut">${icon('undo')}</button>
        <button id="redo-button" class="icon-button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled="" data-i18n-aria-label="ui.redo" data-i18n-title="ui.redoShortcut">${icon('redo')}</button>
        <button id="split-button" data-needs-clip="" class="icon-button" title="Split at playhead (Ctrl+B)" aria-label="Split at playhead" disabled="" data-i18n-aria-label="ui.split" data-i18n-title="ui.splitShortcut">${icon('scissors')}</button>
        <button id="trim-left-button" data-needs-clip="" class="icon-button" title="Trim before playhead (Q)" aria-label="Trim before playhead" disabled="" data-i18n-aria-label="ui.trimLeft" data-i18n-title="ui.trimLeftShortcut">${icon('lefttrim')}</button>
        <button id="trim-right-button" data-needs-clip="" class="icon-button" title="Trim after playhead (W)" aria-label="Trim after playhead" disabled="" data-i18n-aria-label="ui.trimRight" data-i18n-title="ui.trimRightShortcut">${icon('righttrim')}</button>
        <button id="delete-clip" data-needs-clip="" class="icon-button" title="Delete selected clip (Delete)" aria-label="Delete selected clip" disabled="" data-i18n-aria-label="ui.deleteClip" data-i18n-title="ui.deleteClipShortcut">${icon('trash')}</button>
        <button id="duplicate-clip" data-needs-clip="" class="icon-button" title="Duplicate selected clip (Ctrl+D)" aria-label="Duplicate selected clip" disabled="" data-i18n-aria-label="ui.duplicateClip" data-i18n-title="ui.duplicateClipShortcut">${icon('copy')}</button>
        <button id="marker-button" class="icon-button" title="Add / remove marker (M)" aria-label="Add or remove marker" disabled="" data-i18n-aria-label="ui.marker" data-i18n-title="ui.markerShortcut">${icon('marker')}</button>
        <button id="freeze-button" data-needs-clip="" class="icon-button" title="Add a 3-second freeze frame at the playhead" aria-label="Add freeze frame" disabled="" data-i18n-aria-label="ui.freeze" data-i18n-title="ui.freezeHint">${icon('freeze')}</button>
        <button id="reverse-button" data-needs-clip="" class="icon-button" title="Reverse selected clip" aria-label="Reverse selected clip" aria-pressed="false" disabled="" data-i18n-aria-label="ui.reverseClip" data-i18n-title="ui.reverseClip">${icon('reverse')}</button>
        <button id="reset-button" class="icon-button" title="Reset all edits" aria-label="Reset all edits" disabled="" data-i18n-aria-label="ui.resetEdits" data-i18n-title="ui.resetEdits">${icon('reset')}</button>
      </div>
      <span id="timeline-duration" class="timeline-info" data-i18n="ui.noClips">No clips yet</span>
    </div>
    <div class="timeline-options">
      <div class="timeline-tools" role="toolbar" aria-label="Timeline view" data-i18n-aria-label="ui.timelineView">
        <button id="voiceover-record" class="icon-button" title="Record from microphone" aria-label="Record from microphone" disabled="" data-i18n-aria-label="ui.recordVoice" data-i18n-title="ui.recordVoice">${icon('mic')}</button>
        <button id="voiceover-link" class="icon-button" title="Link selected recording to video" aria-label="Link selected recording to video" aria-pressed="false" disabled="" data-i18n-aria-label="ui.linkVoice" data-i18n-title="ui.linkVoice">${icon('link')}</button>
        <span id="voiceover-status" class="voiceover-status" role="status"></span>
        <button id="ripple-toggle" class="icon-button active" title="Main track magnet: close gaps" aria-label="Main track magnet" aria-pressed="true" data-i18n-aria-label="ui.ripple" data-i18n-title="ui.rippleHint">${icon('magnet')}</button>
        <button id="snap-toggle" class="icon-button active" title="Snap to clip edges and markers (N)" aria-label="Snap to edges and markers" aria-pressed="true" data-i18n-aria-label="ui.snap" data-i18n-title="ui.snapShortcut">${icon('snap')}</button>
        <button id="follow-toggle" class="icon-button active" title="Automatically follow the playhead" aria-label="Follow playhead" aria-pressed="true" data-i18n-aria-label="ui.follow" data-i18n-title="ui.followHint">${icon('follow')}</button>
        <button id="frame-previous" class="icon-button" title="Previous frame (←)" aria-label="Previous frame" disabled="" data-i18n-aria-label="ui.previousFrame" data-i18n-title="ui.previousFrameShortcut">${icon('previous')}</button>
        <button id="frame-next" class="icon-button" title="Next frame (→)" aria-label="Next frame" disabled="" data-i18n-aria-label="ui.nextFrame" data-i18n-title="ui.nextFrameShortcut">${icon('next')}</button>
        <span class="timeline-title" data-i18n="ui.timeline">Timeline</span>
      </div>
      <div class="timeline-zoom"><button id="zoom-fit" class="icon-button" title="Fit timeline" aria-label="Fit timeline" data-i18n-aria-label="ui.fitTimeline" data-i18n-title="ui.fitTimeline">${icon('fit')}</button><button id="zoom-out" class="icon-button" title="Zoom out" aria-label="Zoom out" data-i18n-aria-label="ui.zoomOut" data-i18n-title="ui.zoomOut">${icon('minus')}</button><input id="timeline-zoom" type="range" min="1" max="20" step="0.25" value="1" aria-label="Timeline zoom" data-i18n-aria-label="ui.timelineZoom"><button id="zoom-in" class="icon-button" title="Zoom in" aria-label="Zoom in" data-i18n-aria-label="ui.zoomIn" data-i18n-title="ui.zoomIn">${icon('plus')}</button><output id="zoom-label">100%</output></div>
    </div>
    <div class="timeline-body">
      <div class="track-labels"><span class="ruler-label" data-i18n="ui.seconds">s</span><span>${icon('film')}<span data-i18n="ui.video">Video</span></span><span>${icon('text')}<span data-i18n="ui.text">Text</span></span><span class="voice-track-label">${icon('mic')}<span data-i18n="ui.audio">Audio</span></span></div>
      <div class="timeline-scroll"><div id="timeline" class="timeline" aria-label="Video timeline" data-i18n-aria-label="ui.videoTimeline">
        <div id="ruler" class="ruler"></div>
        <div id="timeline-empty" class="timeline-empty"><span>${icon('plus')}<span data-i18n="ui.timelineEmpty">Your video will appear here</span></span></div>
        <div id="marker-track" class="marker-track"></div>
        <div id="clip-track" class="clip-track" hidden=""></div>
        <div class="text-track"><div id="text-clip" class="text-clip" hidden="">${icon('text')}<span id="text-clip-label"></span></div></div>
        <div id="voiceover-track" class="voiceover-track"></div>
        <div id="playhead" class="playhead" hidden=""><span></span></div>
      </div></div>
    </div>
    <footer class="timeline-footer"><span><span class="keyboard-key">Space</span> <span data-i18n="ui.shortcutPlay">play</span><span class="keyboard-key">← →</span> <span data-i18n="ui.shortcutFrame">frame</span><span class="keyboard-key">Alt + ← →</span> <span data-i18n="ui.shortcutMove">move clip</span><span class="keyboard-key">Ctrl+B</span> <span data-i18n="ui.shortcutSplit">split</span></span><button id="append-source" class="text-button" disabled="" data-i18n="ui.appendSource">Add source to timeline</button><span id="project-status"><span class="status-dot"></span><span data-i18n="ui.ready">Ready</span></span></footer>
  </section>
</main>
<dialog id="export-dialog" aria-labelledby="export-title">
  <form id="export-form">
    <div class="dialog-heading"><div><span class="section-label" data-i18n="ui.finishingTouch">THE FINAL TOUCH</span><h2 id="export-title" data-i18n="ui.export">Export</h2></div><label class="language-picker"><span class="sr-only" data-i18n="ui.language">Language</span><select id="export-language-select" data-language-select aria-label="Language" data-i18n-aria-label="ui.language"><option value="en">English</option><option value="tr">Türkçe</option></select></label><button id="close-export" type="button" class="icon-button" aria-label="Close export dialog" data-i18n-aria-label="ui.closeExport">${icon('close')}</button></div>
    <div class="export-layout"><div class="export-preview"><img id="export-poster" alt="Video to export" data-i18n-alt="ui.exportPoster"><div id="export-preview-empty">${icon('film')}</div><span id="export-duration"></span><p data-i18n="ui.readyToShare">Ready to share.</p></div>
    <div class="export-settings">
      <label for="export-name" data-i18n="ui.filename">File name</label><div class="export-name-input"><input id="export-name" value="my-video" maxlength="80" required=""><span id="export-extension">.mp4</span></div>
      <div class="export-field"><label for="export-resolution" data-i18n="ui.resolution">Resolution</label><select id="export-resolution"><option value="source" data-i18n="ui.sourceResolution">Source resolution</option><option value="720">720p</option><option value="1080" selected="">1080p</option><option value="2160">4K</option></select></div>
      <div class="export-field"><label for="export-quality" data-i18n="ui.quality">Quality</label><select id="export-quality"><option value="recommended" data-i18n="ui.recommended">Recommended</option><option value="high" data-i18n="ui.high">High</option><option value="low" data-i18n="ui.smallFile">Smaller file</option></select></div>
      <div class="export-field"><label for="export-fps" data-i18n="ui.frameRate">Frame rate</label><select id="export-fps"><option value="source" selected="" data-i18n="ui.sourceFrameRate">Same as source</option><option value="24">24 fps</option><option value="25">25 fps</option><option value="29.97" data-i18n="ui.fps2997">29.97 fps</option><option value="30">30 fps</option><option value="50">50 fps</option><option value="59.94" data-i18n="ui.fps5994">59.94 fps</option><option value="60">60 fps</option></select></div>
      <div class="export-field"><label for="export-format" data-i18n="ui.format">Format</label><select id="export-format"><option value="mp4">MP4</option><option value="mov">MOV</option></select></div>
      <div class="export-field"><label for="export-codec" data-i18n="ui.codec">Codec</label><select id="export-codec"><option value="h264">H.264</option><option value="hevc">H.265 (HEVC)</option></select></div>
      <p class="helper" data-i18n="ui.exportHint">Aspect ratio is preserved. Higher resolution does not add detail to the source.</p>
    </div></div>
    <div id="export-progress" class="export-progress" hidden="" role="status" aria-live="polite"><div><strong id="export-progress-title" data-i18n="ui.preparingVideo">Preparing video</strong><span id="export-percent">0%</span></div><progress id="export-progress-bar" max="100" value="0" aria-label="Export progress" data-i18n-aria-label="ui.exportProgress"></progress><p id="export-progress-detail" data-i18n="ui.applyingEdits">Applying your edits to the video.</p></div>
    <p id="export-error" class="export-error" role="alert" hidden=""></p>
    <div class="dialog-footer"><span id="export-summary">MP4 · H.264</span><div><button id="export-cancel" type="button" class="button secondary" data-i18n="ui.cancel">Cancel</button><button id="start-export" type="submit" class="button accent">${icon('arrow')}<span data-i18n="ui.export">Export</span></button><a id="export-download" class="button accent" download="" hidden="">${icon('download')}<span data-i18n="ui.download">Download video</span></a></div></div>
  </form>
</dialog>`;
