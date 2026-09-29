import {
  AppWindow,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  ArrowUUpLeft,
  ArrowsOutSimple,
  ArrowsInSimple,
  CaretDown,
  ChatCircle,
  ChatCircleDots,
  Books,
  CalendarBlank,
  Check,
  Clock,
  CloudArrowUp,
  Columns,
  Copy,
  Cpu,
  ChartBar,
  Database,
  Desktop,
  DotsThree,
  File,
  FilePlus,
  FileText,
  Files,
  Folder,
  FolderOpen,
  Folders,
  Gear,
  GitBranch,
  GitCommit,
  ListChecks,
  Globe,
  HandPalm,
  Image,
  Images,
  Info,
  Keyboard,
  Microphone,
  MagnifyingGlass,
  Pause,
  PencilSimple,
  Plus,
  PlusMinus,
  Play,
  PuzzlePiece,
  Sidebar,
  SidebarSimple,
  SlidersHorizontal,
  SortAscending,
  Shapes,
  SquaresFour,
  Stop,
  Sun,
  Terminal,
  TerminalWindow,
  Trash,
  Tray,
  WarningOctagon,
  X,
  type Icon,
  type IconProps,
  type IconWeight,
} from '@phosphor-icons/react';

export type AppIconName =
  | 'compose' | 'conversation' | 'thinking' | 'now' | 'scheduled' | 'browse' | 'fields' | 'inbox'
  | 'folder' | 'folderOpen' | 'files' | 'library' | 'file' | 'image' | 'images' | 'contextCompress' | 'filePlus' | 'objects'
  | 'diff' | 'fileDiff' | 'reviewChanges' | 'fileUndo' | 'terminal' | 'terminalPanel' | 'computer' | 'settings' | 'refresh' | 'undo' | 'close'
  | 'more' | 'models' | 'usage' | 'appearance' | 'extensions' | 'storage' | 'keyboard'
  | 'info' | 'environment' | 'branch' | 'commit' | 'changes' | 'openAction' | 'cloud' | 'source' | 'copy' | 'check'
  | 'sort' | 'plus' | 'edit' | 'search' | 'run' | 'pause' | 'delete' | 'chevronDown' | 'panelRight' | 'sidebar'
  | 'back' | 'forward' | 'arrowDown' | 'focus' | 'unfocus' | 'fileTree' | 'tools' | 'microphone' | 'send' | 'stop'
  | 'permissionAsk' | 'permissionReview' | 'permissionFull' | 'application';

const ICONS: Record<AppIconName, Icon> = {
  usage: ChartBar,
  compose: PencilSimple,
  conversation: ChatCircle,
  thinking: ChatCircleDots,
  now: Clock,
  scheduled: CalendarBlank,
  browse: Globe,
  fields: SquaresFour,
  inbox: Tray,
  folder: Folder,
  folderOpen: FolderOpen,
  files: Files,
  library: Books,
  file: File,
  image: Image,
  images: Images,
  contextCompress: FileText,
  filePlus: FilePlus,
  objects: Shapes,
  diff: PlusMinus,
  fileDiff: File,
  reviewChanges: PlusMinus,
  fileUndo: ArrowUUpLeft,
  terminal: Terminal,
  terminalPanel: TerminalWindow,
  computer: Desktop,
  settings: Gear,
  refresh: ArrowClockwise,
  undo: ArrowCounterClockwise,
  arrowDown: ArrowDown,
  close: X,
  more: DotsThree,
  models: Cpu,
  appearance: Sun,
  extensions: PuzzlePiece,
  storage: Database,
  keyboard: Keyboard,
  info: Info,
  environment: SlidersHorizontal,
  branch: GitBranch,
  commit: GitCommit,
  changes: ListChecks,
  openAction: ArrowUpRight,
  cloud: CloudArrowUp,
  source: FileText,
  copy: Copy,
  check: Check,
  sort: SortAscending,
  plus: Plus,
  edit: PencilSimple,
  search: MagnifyingGlass,
  run: Play,
  pause: Pause,
  delete: Trash,
  chevronDown: CaretDown,
  panelRight: SidebarSimple,
  sidebar: Sidebar,
  back: ArrowLeft,
  forward: ArrowRight,
  focus: ArrowsOutSimple,
  unfocus: ArrowsInSimple,
  fileTree: Folders,
  tools: Columns,
  microphone: Microphone,
  send: ArrowUp,
  stop: Stop,
  permissionAsk: HandPalm,
  permissionReview: ChatCircleDots,
  permissionFull: WarningOctagon,
  application: AppWindow,
};

export interface FieloraIconProps extends Omit<IconProps, 'size' | 'weight'> {
  name: AppIconName;
  size?: 'sm' | 'md' | 'lg';
  weight?: IconWeight;
}

export function FieloraIcon({ name, size = 'md', weight = 'regular', className = '', ...props }: FieloraIconProps) {
  if (name === 'terminal' || name === 'contextCompress') return <svg {...props} className={`app-icon shell-icon size-${size}${className ? ` ${className}` : ''}`} width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon={name} data-icon-size={size}>
    {name === 'terminal' ? <><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m7 8 3 3-3 3m6 1h4"/></> : <><path d="M8 3H5v7l-2 2 2 2v7h3m8-18h3v7l2 2-2 2v7h-3M9 8h6m-6 4h4m-4 4h6"/></>}
  </svg>;
  if (name === 'fileDiff' || name === 'reviewChanges') return <svg {...props} className={`app-icon shell-icon size-${size}${className ? ` ${className}` : ''}`} width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon={name} data-icon-size={size}>
    {name === 'fileDiff' ? <><rect x="3.5" y="2" width="17" height="20" rx="3"/><path d="M9 8h6M12 5v6M9 16h6"/></> : <><rect x="2.5" y="2.5" width="19" height="19" rx="4"/><path d="M6 8h5M8.5 5.5v5M13 16h5M8 16l8-8"/></>}
  </svg>;
  const IconComponent = ICONS[name];
  return <IconComponent
    {...props}
    className={`app-icon shell-icon size-${size}${className ? ` ${className}` : ''}`}
    size={24}
    weight={weight}
    aria-hidden="true"
    focusable="false"
    data-icon={name}
    data-icon-size={size}
  />;
}

export const AppIcon = FieloraIcon;
