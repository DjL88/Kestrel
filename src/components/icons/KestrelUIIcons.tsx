/** Central Kite44 icon language.
 * Every standard action uses the same Lucide-compatible geometry, round joins,
 * restrained 1.85px optical stroke and inherited colour. Explicit caller
 * strokeWidth overrides remain available for accessibility and density.
 * Flight guidance uses separately approved PNG assets; no provisional bird SVG is shipped.
 * Keep icon labels visible; never encode a decision with colour alone.
 */
import { forwardRef } from 'react';
import type { LucideProps } from 'lucide-react';
import {
  Lock as LucideLock,
  Cloud as LucideCloud,
  Folder as LucideFolder,
  HardDrive as LucideHardDrive,
  Server as LucideServer,
  Settings2 as LucideSettings2,
  Info as LucideInfo,
  SlidersHorizontal as LucideSlidersHorizontal,
  X as LucideX,
  FolderKey as LucideFolderKey,
  Languages as LucideLanguages,
  Download as LucideDownload,
  ArrowDownToLine as LucideArrowDownToLine,
  ArrowUpToLine as LucideArrowUpToLine,
  Star as LucideStar,
  Check as LucideCheck,
  CircleHelp as LucideCircleHelp,
  RotateCcw as LucideRotateCcw,
  Trash2 as LucideTrash2,
  AlertTriangle as LucideAlertTriangle,
  CheckCircle2 as LucideCheckCircle2,
  Clock as LucideClock,
  Loader2 as LucideLoader2,
  MoveHorizontal as LucideMoveHorizontal,
  FolderOpen as LucideFolderOpen,
  ImagePlus as LucideImagePlus,
  ImageOff as LucideImageOff,
  LoaderCircle as LucideLoaderCircle,
  ArrowLeftRight as LucideArrowLeftRight,
  ChevronLeft as LucideChevronLeft,
  ChevronRight as LucideChevronRight,
  Maximize2 as LucideMaximize2,
  Expand as LucideExpand,
  Shrink as LucideShrink,
  Scan as LucideScan,
  ZoomIn as LucideZoomIn,
  ArrowDownUp as LucideArrowDownUp,
  ListFilter as LucideListFilter,
  Search as LucideSearch,
  Eye as LucideEye,
  MoreHorizontal as LucideMoreHorizontal,
  Undo2 as LucideUndo2,
  Archive as LucideArchive,
  ArchiveRestore as LucideArchiveRestore,
  FolderUp as LucideFolderUp,
  Plus as LucidePlus,
  SquareChevronsRight as LucideSquareChevronsRight,
  CloudOff as LucideCloudOff,
  HelpCircle as LucideHelpCircle,
  Plug as LucidePlug,
  RefreshCw as LucideRefreshCw,
  ClipboardCopy as LucideClipboardCopy,
  PanelTopOpen as LucidePanelTopOpen,
  Minus as LucideMinus,
  RectangleHorizontal as LucideRectangleHorizontal,
  ArrowLeft as LucideArrowLeft,
  Copy as LucideCopy,
  ClipboardPaste as LucideClipboardPaste,
  PanelLeftClose as LucidePanelLeftClose,
  PanelLeftOpen as LucidePanelLeftOpen,
  Eraser as LucideEraser,
  Paintbrush as LucidePaintbrush,
  ScanSearch as LucideScanSearch,
  SquareDashedMousePointer as LucideSquareDashedMousePointer,
  Keyboard as LucideKeyboard,
  Columns2 as LucideColumns2,
  Redo2 as LucideRedo2,
  Bird as LucideBird,
  Mountain as LucideMountain,
  Tag as LucideTag,
  UserRound as LucideUserRound,
  ChevronDown as LucideChevronDown,
  ChevronUp as LucideChevronUp,
  Focus as LucideFocus,
  Minimize2 as LucideMinimize2,
  GripHorizontal as LucideGripHorizontal,
  PanelRightClose as LucidePanelRightClose,
  Pin as LucidePin,
  Lightbulb as LucideLightbulb,
  Palette as LucidePalette,
  MessageSquareText as LucideMessageSquareText,
  ArrowRight as LucideArrowRight,
  Maximize as LucideMaximize,
  Minimize as LucideMinimize,
  Crop as LucideCrop,
  History as LucideHistory,
  RectangleVertical as LucideRectangleVertical,
  RotateCw as LucideRotateCw,
  Square as LucideSquare,
  SquircleDashed as LucideSquircleDashed,
  Wand2 as LucideWand2,
  Ellipsis as LucideEllipsis,
  Grid3X3 as LucideGrid3X3,
  Image as LucideImage,
  FileDown as LucideFileDown,
  FolderInput as LucideFolderInput,
  ListChecks as LucideListChecks,
  Pencil as LucidePencil,
  Save as LucideSave,
  EyeOff as LucideEyeOff,
  PanelRight as LucidePanelRight,
  PictureInPicture2 as LucidePictureInPicture2,
  SquareCheck as LucideSquareCheck
} from 'lucide-react';

type SourceIcon = typeof LucideCheck;
function branded(Icon: SourceIcon, displayName: string) {
  const Component = forwardRef<SVGSVGElement, LucideProps>(({ strokeWidth = 1.85, ...props }, ref) =>
    <Icon ref={ref} strokeWidth={strokeWidth} {...props} />
  );
  Component.displayName = `Kite44${displayName}`;
  return Component;
}
export const Lock = branded(LucideLock, 'Lock');
export const Cloud = branded(LucideCloud, 'Cloud');
export const Folder = branded(LucideFolder, 'Folder');
export const HardDrive = branded(LucideHardDrive, 'HardDrive');
export const Server = branded(LucideServer, 'Server');
export const Settings2 = branded(LucideSettings2, 'Settings2');
export const Info = branded(LucideInfo, 'Info');
export const SlidersHorizontal = branded(LucideSlidersHorizontal, 'SlidersHorizontal');
export const X = branded(LucideX, 'X');
export const FolderKey = branded(LucideFolderKey, 'FolderKey');
export const Languages = branded(LucideLanguages, 'Languages');
export const Download = branded(LucideDownload, 'Download');
export const ArrowDownToLine = branded(LucideArrowDownToLine, 'ArrowDownToLine');
export const ArrowUpToLine = branded(LucideArrowUpToLine, 'ArrowUpToLine');
export const Star = branded(LucideStar, 'Star');
export const Check = branded(LucideCheck, 'Check');
export const CircleHelp = branded(LucideCircleHelp, 'CircleHelp');
export const RotateCcw = branded(LucideRotateCcw, 'RotateCcw');
export const Trash2 = branded(LucideTrash2, 'Trash2');
export const AlertTriangle = branded(LucideAlertTriangle, 'AlertTriangle');
export const CheckCircle2 = branded(LucideCheckCircle2, 'CheckCircle2');
export const Clock = branded(LucideClock, 'Clock');
export const Loader2 = branded(LucideLoader2, 'Loader2');
export const MoveHorizontal = branded(LucideMoveHorizontal, 'MoveHorizontal');
export const FolderOpen = branded(LucideFolderOpen, 'FolderOpen');
export const ImagePlus = branded(LucideImagePlus, 'ImagePlus');
export const ImageOff = branded(LucideImageOff, 'ImageOff');
export const LoaderCircle = branded(LucideLoaderCircle, 'LoaderCircle');
export const ArrowLeftRight = branded(LucideArrowLeftRight, 'ArrowLeftRight');
export const ChevronLeft = branded(LucideChevronLeft, 'ChevronLeft');
export const ChevronRight = branded(LucideChevronRight, 'ChevronRight');
export const Maximize2 = branded(LucideMaximize2, 'Maximize2');
export const Expand = branded(LucideExpand, 'Expand');
export const Shrink = branded(LucideShrink, 'Shrink');
export const Scan = branded(LucideScan, 'Scan');
export const ZoomIn = branded(LucideZoomIn, 'ZoomIn');
export const ArrowDownUp = branded(LucideArrowDownUp, 'ArrowDownUp');
export const ListFilter = branded(LucideListFilter, 'ListFilter');
export const Search = branded(LucideSearch, 'Search');
export const Eye = branded(LucideEye, 'Eye');
export const MoreHorizontal = branded(LucideMoreHorizontal, 'MoreHorizontal');
export const Undo2 = branded(LucideUndo2, 'Undo2');
export const Archive = branded(LucideArchive, 'Archive');
export const ArchiveRestore = branded(LucideArchiveRestore, 'ArchiveRestore');
export const FolderUp = branded(LucideFolderUp, 'FolderUp');
export const Plus = branded(LucidePlus, 'Plus');
export const SquareChevronsRight = branded(LucideSquareChevronsRight, 'SquareChevronsRight');
export const CloudOff = branded(LucideCloudOff, 'CloudOff');
export const HelpCircle = branded(LucideHelpCircle, 'HelpCircle');
export const Plug = branded(LucidePlug, 'Plug');
export const RefreshCw = branded(LucideRefreshCw, 'RefreshCw');
export const ClipboardCopy = branded(LucideClipboardCopy, 'ClipboardCopy');
export const PanelTopOpen = branded(LucidePanelTopOpen, 'PanelTopOpen');
export const Minus = branded(LucideMinus, 'Minus');
export const RectangleHorizontal = branded(LucideRectangleHorizontal, 'RectangleHorizontal');
export const ArrowLeft = branded(LucideArrowLeft, 'ArrowLeft');
export const Copy = branded(LucideCopy, 'Copy');
export const ClipboardPaste = branded(LucideClipboardPaste, 'ClipboardPaste');
export const PanelLeftClose = branded(LucidePanelLeftClose, 'PanelLeftClose');
export const PanelLeftOpen = branded(LucidePanelLeftOpen, 'PanelLeftOpen');
export const Eraser = branded(LucideEraser, 'Eraser');
export const Paintbrush = branded(LucidePaintbrush, 'Paintbrush');
export const ScanSearch = branded(LucideScanSearch, 'ScanSearch');
export const SquareDashedMousePointer = branded(LucideSquareDashedMousePointer, 'SquareDashedMousePointer');
export const Keyboard = branded(LucideKeyboard, 'Keyboard');
export const Columns2 = branded(LucideColumns2, 'Columns2');
export const Redo2 = branded(LucideRedo2, 'Redo2');
export const Bird = branded(LucideBird, 'Bird');
export const Mountain = branded(LucideMountain, 'Mountain');
export const Tag = branded(LucideTag, 'Tag');
export const UserRound = branded(LucideUserRound, 'UserRound');
export const ChevronDown = branded(LucideChevronDown, 'ChevronDown');
export const ChevronUp = branded(LucideChevronUp, 'ChevronUp');
export const Focus = branded(LucideFocus, 'Focus');
export const Minimize2 = branded(LucideMinimize2, 'Minimize2');
export const GripHorizontal = branded(LucideGripHorizontal, 'GripHorizontal');
export const PanelRightClose = branded(LucidePanelRightClose, 'PanelRightClose');
export const Pin = branded(LucidePin, 'Pin');
export const Lightbulb = branded(LucideLightbulb, 'Lightbulb');
export const Palette = branded(LucidePalette, 'Palette');
export const MessageSquareText = branded(LucideMessageSquareText, 'MessageSquareText');
export const ArrowRight = branded(LucideArrowRight, 'ArrowRight');
export const Maximize = branded(LucideMaximize, 'Maximize');
export const Minimize = branded(LucideMinimize, 'Minimize');
export const Crop = branded(LucideCrop, 'Crop');
export const History = branded(LucideHistory, 'History');
export const RectangleVertical = branded(LucideRectangleVertical, 'RectangleVertical');
export const RotateCw = branded(LucideRotateCw, 'RotateCw');
export const Square = branded(LucideSquare, 'Square');
export const SquircleDashed = branded(LucideSquircleDashed, 'SquircleDashed');
export const Wand2 = branded(LucideWand2, 'Wand2');
export const Ellipsis = branded(LucideEllipsis, 'Ellipsis');
export const Grid3X3 = branded(LucideGrid3X3, 'Grid3X3');
export const Image = branded(LucideImage, 'Image');
export const FileDown = branded(LucideFileDown, 'FileDown');
export const FolderInput = branded(LucideFolderInput, 'FolderInput');
export const ListChecks = branded(LucideListChecks, 'ListChecks');
export const Pencil = branded(LucidePencil, 'Pencil');
export const Save = branded(LucideSave, 'Save');

export const EyeOff = branded(LucideEyeOff, 'EyeOff');
export const PanelRight = branded(LucidePanelRight, 'PanelRight');
export const PictureInPicture2 = branded(LucidePictureInPicture2, 'PictureInPicture2');
export const SquareCheck = branded(LucideSquareCheck, 'SquareCheck');