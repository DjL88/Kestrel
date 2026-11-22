# InFlight icon list for the V2 redesign

Every icon the app uses today, plus the icons Version 2 needs. Today all icons come from one wrapper, `src/components/icons/KestrelUIIcons.tsx`, so replacing an icon with your own design is a one-file change per icon. External logos (social, cloud, AI) stay official and are not redrawn.

**Suggested drawing spec:** 24 px grid, 1.75 px stroke, round caps and joins, 2 px padding, one filled accent allowed. Draw each as a single-colour SVG using `currentColor` so it works in dark and light mode. Name files exactly as the `icon` column, for example `flag-off.svg`.


## Chrome and navigation

| icon | meaning or use | status |
| --- | --- | --- |
| `ArrowDownUp` | Sort | in app today |
| `ArrowLeft` | Back | in app today |
| `ArrowRight` | Next | in app today |
| `Check` | Done, selected | in app today |
| `ChevronDown` | Disclosure, dropdown | in app today |
| `ChevronLeft` | Previous, collapse left | in app today |
| `ChevronRight` | Next, expand | in app today |
| `ChevronUp` | Disclosure open | in app today |
| `CircleHelp` | Help | in app today |
| `Ellipsis` | More actions | in app today |
| `Info` | Photo info | in app today |
| `Keyboard` | Keyboard shortcuts | in app today |
| `Languages` | Language | in app today |
| `ListFilter` | Filter | in app today |
| `Lock` | Pro locked | in app today |
| `Minus` | Remove, zoom out | in app today |
| `Plus` | Add | in app today |
| `Search` | Search | in app today |
| `Settings2` | Settings | in app today |
| `Square` | Checkbox empty | in app today |
| `SquareCheck` | Checkbox ticked | in app today |
| `UserRound` | Account | in app today |
| `X` | Close | in app today |

## Panels and docking

| icon | meaning or use | status |
| --- | --- | --- |
| `Columns2` | Compare / before and after | in app today |
| `Expand` | Expand | in app today |
| `Focus` | Photo only | in app today |
| `Grip` | Drag handle | in app today |
| `GripHorizontal` | Resize handle | in app today |
| `Maximize` | Full screen | in app today |
| `Maximize2` | Maximise panel | in app today |
| `Minimize` | Exit full screen | in app today |
| `Minimize2` | Restore panel | in app today |
| `MoveHorizontal` | Resize width | in app today |
| `PanelLeftClose` | Hide left panel | in app today |
| `PanelLeftOpen` | Show left panel | in app today |
| `PanelRight` | Dock panel | in app today |
| `PanelRightClose` | Dock panel to right | in app today |
| `PanelTopOpen` | Top bar panel | in app today |
| `PictureInPicture2` | Float panel | in app today |
| `Pin` | Keep visible | in app today |
| `Scan` | Fit to screen | in app today |
| `Shrink` | Shrink | in app today |
| `SquareChevronsRight` | Fold tools | in app today |

## Rail tools

| icon | meaning or use | status |
| --- | --- | --- |
| `Bird` | Wildlife look | in app today |
| `Crop` | Crop and sizes | in app today |
| `Eraser` | Erase mask | in app today |
| `History` | History | in app today |
| `Lightbulb` | Auto and advice | in app today |
| `MessageSquareText` | Text | in app today |
| `Mountain` | Landscape look | in app today |
| `Paintbrush` | Brush mask | in app today |
| `Palette` | Colour | in app today |
| `ScanSearch` | Find subject | in app today |
| `SlidersHorizontal` | Edit sliders | in app today |
| `Sparkles` | Assist | in app today |
| `SquareDashedMousePointer` | Select area | in app today |
| `SquircleDashed` | Masks | in app today |
| `Wand2` | Auto adjust | in app today |

## Photos, culling and filmstrip

| icon | meaning or use | status |
| --- | --- | --- |
| `CircleAlert` | Needs attention | in app today |
| `CircleCheck` | Ready | in app today |
| `Clock` | Waiting | in app today |
| `Eye` | Show | in app today |
| `EyeOff` | Hide | in app today |
| `Grid3X3` | Grid view | in app today |
| `Image` | Photo | in app today |
| `ImageOff` | Photo missing | in app today |
| `ImagePlus` | Add photos | in app today |
| `ListChecks` | Select photos | in app today |
| `LoaderCircle` | Working | in app today |
| `Star` | Rating star | in app today |
| `Tag` | Tags | in app today |

## Edit actions

| icon | meaning or use | status |
| --- | --- | --- |
| `ClipboardCopy` | Copy | in app today |
| `ClipboardPaste` | Paste edits | in app today |
| `Copy` | Copy edits | in app today |
| `Pencil` | Rename, edit | in app today |
| `RectangleHorizontal` | Landscape orientation | in app today |
| `RectangleVertical` | Portrait orientation | in app today |
| `Redo2` | Redo | in app today |
| `RotateCcw` | Reset, rotate left | in app today |
| `RotateCw` | Rotate right | in app today |
| `Save` | Save | in app today |
| `Trash2` | Delete | in app today |
| `Undo2` | Undo | in app today |
| `ZoomIn` | Zoom | in app today |

## Files, export and storage

| icon | meaning or use | status |
| --- | --- | --- |
| `Archive` | Archive | in app today |
| `ArchiveRestore` | Restore | in app today |
| `ArrowDownToLine` | Import | in app today |
| `ArrowLeftRight` | Swap | in app today |
| `ArrowUpToLine` | Upload | in app today |
| `Download` | Export | in app today |
| `FileDown` | Save file | in app today |
| `Folder` | Folder | in app today |
| `FolderInput` | Move to project | in app today |
| `FolderKey` | Protected folder | in app today |
| `FolderOpen` | Open folder | in app today |
| `FolderUp` | Up a folder | in app today |
| `HardDrive` | Drive | in app today |
| `RefreshCw` | Sync, refresh | in app today |

## Cloud, connections and AI

| icon | meaning or use | status |
| --- | --- | --- |
| `Cloud` | Cloud storage | in app today |
| `CloudOff` | Offline | in app today |
| `Plug` | Connection | in app today |
| `Server` | NAS or server | in app today |

## V2 · Flags and filmstrip

| icon | meaning or use | status |
| --- | --- | --- |
| `flag` | Flag a photo (replaces Keep) | **new** |
| `flag-off` | Unflag | **new** |
| `flag-from-camera` | Flag came from the camera | **new** |
| `star-empty / star-filled` | Rating, two states | **new** |
| `state-importing` | Importing | **new** |
| `state-analysing` | Analysing | **new** |
| `state-ready` | Ready to edit | **new** |
| `state-original-offline` | Original not connected, preview only | **new** |
| `relink` | Relink original | **new** |

## V2 · Overlay

| icon | meaning or use | status |
| --- | --- | --- |
| `overlay` | Overlay tool (replaces Mark) | **new** |
| `watermark` | Watermark | **new** |
| `watermark-library` | Watermark library | **new** |
| `watermark-white-on-black` | Swatch | **new** |
| `watermark-black-on-white` | Swatch | **new** |
| `text-overlay` | Text overlay | **new** |
| `camera-settings-text` | Camera settings tokens (aperture, shutter, ISO) | **new** |
| `position-grid-9` | Nine-position picker | **new** |

## V2 · Sizes, split and video

| icon | meaning or use | status |
| --- | --- | --- |
| `size-copy` | Size copy | **new** |
| `linked` | Linked edit across sizes | **new** |
| `unlinked` | Unlinked | **new** |
| `size-4x5` | Post 4:5 | **new** |
| `size-9x16` | Story 9:16 | **new** |
| `size-1x1` | Square | **new** |
| `size-16x9` | Landscape | **new** |
| `add-frame` | Plus next to the canvas: repeat this size | **new** |
| `split-panorama` | Spread one image across frames | **new** |
| `all-sizes-view` | Group view of every size | **new** |
| `video-zoom` | Export as zoom video | **new** |
| `focal-point` | Choose the zoom target | **new** |
| `zoom-in-out` | Zoom direction | **new** |

## V2 · Chrome and assistance

| icon | meaning or use | status |
| --- | --- | --- |
| `mode-solo` | Assistance mode: Solo | **new** |
| `mode-copilot` | Assistance mode: Co-pilot | **new** |
| `mode-autopilot` | Assistance mode: Auto-pilot | **new** |
| `theme-light / theme-dark` | Light and dark mode | **new** |
| `advice-bulb` | Quiet advice beside a slider | **new** |
| `cloud-assist` | Optional cloud processing | **new** |
| `cloud-temporary` | Held briefly, then deleted | **new** |

## External logos (keep official, do not redraw)

Instagram, Facebook, TikTok, Threads, X, Bluesky, Pinterest (social). Dropbox, Google Drive, OneDrive, Amazon S3 (cloud storage). Google Gemini and OpenAI (AI). OneDrive, OpenAI and Amazon S3 are not in the open icon set the app uses today and currently show a neutral icon; they need the owners' official brand assets under each brand's guidelines.
