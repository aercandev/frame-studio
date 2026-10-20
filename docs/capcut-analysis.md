# CapCut inspection and editor design

Inspection date: 20 October 2026. The target was the shipped files of **CapCut 7.9.0.3294**, installed on the inspection machine. REA was used to inspect PE resources; local tools also read the application's language file and selected strings in two DLLs. **No native function decompilation or live CapCut UI testing was performed.**

## Target and method

- Installation: `%LOCALAPPDATA%/CapCut/Apps/7.9.0.3294`.
- `Apps/ProductInfo.xml` reports `7.9.0.3294` in `full_appver`. XML SHA-256: `3d2f712b76d79b788c7cd5dea1af70ba3000fb23dc6d2d666cdd7d4260ed0683`.
- Inspected `CapCut.exe`: 86,320 bytes, SHA-256 `6c0a4ebeb9d087ca3d330a11af5d58465217da545e15382cceaa7bbe8022ef8d`.
- `VECreator.dll`: 253,717,808 bytes, SHA-256 `25f5b0a8b72675761d9625f8cea188c2fe340fab927daea7bc323698350e9c4c`.
- `Resources/po/en.po`: SHA-256 `f9345ab9fc68b5fd51b15cc67a19660e856a26bd39727a4163b23b72c6a2a70f`.
- The scope was limited to shipped installation files. `User Data`, `Videos`, personal projects, drafts, and crash dumps were not read.

REA MCP was not connected. The pinned CLI supported by the inspection skill, `npx -y rea-agents@6.4.0`, was used. The local doctor record, `.tools/rea/doctor.json`, reports that the Ghidra, Hopper, and IDA analysis engines were unavailable. The engine-free `inspect-pe-resources` command was therefore used; no additional analysis engine was installed and no MCP settings were changed.

The recorded REA command can be reproduced on a Windows installation containing the same version:

```powershell
npx -y rea-agents@6.4.0 inspect-pe-resources `
  "$env:LOCALAPPDATA\CapCut\Apps\7.9.0.3294\CapCut.exe" `
  --format json --full-output
```

## Evidence records

The `.tools/rea` paths below identify local, unpublished inspection artifacts. They are excluded from version control and are not distributed with this repository.

| Record | Type and finding | Limitation |
| --- | --- | --- |
| `.tools/rea/capcut-pe-resources.json` | Genuine REA Evidence: `ev_b66fd79a645769e937bb1217454dda8508066ff5626be70305240a3600628323`. `pe32-plus`, machine `34404` / x64, 7 resources; ranges and hashes for icon, version, and manifest resources. | The resource inventory is complete; this record does not explain editor behavior or functions. |
| `.tools/rea/capcut-feature-observations.json` | PO key/value extraction using Node, line numbers, and file SHA-256 hashes; 47 relevant labels. | **Not REA Evidence.** Packaged strings do not prove availability in the live application. |
| `.tools/rea/VECreator.dll-export-string-observations.json` | UTF-8/UTF-16LE byte positions of selected export terms; at most 8 short contexts per search. | **Not REA Evidence.** A string's presence does not prove code flow or default settings. |
| `.tools/rea/export-option-pool.json` | `VECreator.dll`, file offsets `104738056–104739255`: a 1,200-byte region containing adjacent resolution and codec names. | The conditions under which these labels appear in the same dialog were not determined. |
| `.tools/rea/capcut-export-string-observations.json` | An additional limited static scan of cccreator strings, including fixed strings related to H.264/HEVC. | Insufficient evidence on its own for codec behavior or the user interface. |

The local observations were generated with the PO extraction script, `.tools/rea/extract-feature-evidence.mjs`, and the string-scanning script, `.tools/rea/scan-export-strings.mjs`. These scripts are also local, unpublished artifacts. This report does not claim that all files or the application's source code were extracted.

## Findings for the requested features

Numbers in parentheses refer to lines in the inspected `en.po` file unless otherwise indicated.

| Question | Observation and source | Status and implementation decision |
| --- | --- | --- |
| What are the main editor sections? | `en.po`: `media` (7987), `player` (42686), `pc_timeline` (38456), `pc_text` (37077). | Section names were observed. Placing media on the left, preview in the center, properties on the right, and the timeline below is this project's design decision; no pixel measurements of the native CapCut screen were taken. |
| Can the image area be cropped? | `pc_crop` (17274), `pc_crop_ratio` (17277); `support_dragging_the_material_picture` (45105) explains that the video can be moved within a rectangle to select the retained area. | The crop concept and interaction help text were observed. This project independently implements cropping through aspect ratio and position controls. |
| Is duration trimming available? | `prune_pc` (43069), `trim_clip` (45772), `trim_video` (45775). | Trim labels were observed. This project uses a start/end range; CapCut's internal timeline model was not reconstructed. |
| What text features are described? | `pc_font` (21167), `pc_font_color` (21170), `pc_font_size` (21176), `pc_font_stroke` (21182). | Font, color, size, and stroke labels were observed. Text layers, positioning, and visibility timing are implemented independently in this project. |
| Which settings are associated with export? | `resolution` (43520), `bit_rate_pc` (1632), `codec_pc` (4165), `format` (6281), `frame_rate` (6326). | Setting categories were observed. Packaged labels also support the presence of a save dialog, progress, cancellation, and completion states. |
| Which frame rates are named? | `pc_export_24`, `25`, `29_97`, `30`, `50`, `59_94`, `60` (19590–19609). | Labels for **24 / 25 / 29.97 / 30 / 50 / 59.94 / 60 fps** were directly observed in the export namespace. The default was not determined. |
| Which resolution and codec names occur? | `VECreator.dll` string pool: 480P, 720P, 1080P, 2K, 4K, 8K, and other lower resolutions; `H.264` at offset `104738144`, `HEVC` at offset `104738152`; other codec names also occur. | Names were observed; availability on every device or account was not proven. This project's selected scope is source / 720 / 1080 / 4K resolution and H.264 / HEVC. |
| Is there evidence for MP4/MOV export? | `VECreator.dll` UTF-16LE offset `194256062`: `.MP4`, near `batchExportFileType` and an export icon resource path. MP4/MOV names also appear in media-support strings. | MP4 has an export context. MOV availability in the same export menu was not verified by this inspection. This project's MP4/MOV choice is an explicit implementation decision. |
| How is bitrate selected? | `pc_cbr` (14070), `pc_vbr` (40029); `pc_bit_rate_details` (13030) explains that higher bitrate affects detail/quality and file size. | CBR/VBR names were observed. No numeric bitrate table, defaults, or per-codec behavior was extracted. This project's three quality levels use its own encoder configuration. |

## Implementation boundary

This project is an independent browser editor informed by the observed CapCut editing concepts. CapCut code, icons, fonts, and media engine were not incorporated. The presence of Qt6 and FFmpeg-family DLLs in the CapCut installation is a file-inventory observation; how any specific CapCut operation connects to these DLLs was not determined.

The editor supports cropping downloaded videos, trimming start/end times, and editing timed text layers. Its export dialog selects the filename, format, codec, resolution, frame rate, and quality. Rendering uses the project's own FFmpeg installation. This report does not claim bit-identical output, identical encoder settings, matching hardware-acceleration behavior, or complete feature parity with CapCut.

Packaged concept and setting evidence was obtained for the four requested features. Native processing chains, exact screen geometry, default export values, and live UI behavior remain **unresolved**. This distinction identifies where independently implemented behavior moves from observation to a design decision.
