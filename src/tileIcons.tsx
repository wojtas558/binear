import type { ReactNode } from 'react';

import {
  BarsIcon,
  BoardIcon,
  BugIcon,
  BulbIcon,
  CalendarIcon,
  ChartIcon,
  CheckIcon,
  ClipIcon,
  ColumnsIcon,
  CommentIcon,
  EyeIcon,
  FlameIcon,
  HashIcon,
  HistoryIcon,
  LayersIcon,
  LinkIcon,
  ListIcon,
  ParentIcon,
  PenIcon,
  PersonIcon,
  PinIcon,
  PlanIcon,
  RefreshIcon,
  SearchIcon,
  SmileIcon,
  SubtaskIcon,
  TagIcon,
} from './icons';

/** Prosty rysunek 16×16 kreska-bez-wypelnienia, spojny z reszta ikon aplikacji. */
const Svg = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

export const PlusIcon = () => (
  <Svg>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);

const StarIcon = () => (
  <Svg>
    <path d="M8 1.8l1.9 4.2 4.5.4-3.4 3 1 4.5L8 11.5 4 13.9l1-4.5-3.4-3 4.5-.4L8 1.8z" />
  </Svg>
);
const HeartIcon = () => (
  <Svg>
    <path d="M8 13.5S2.5 10 2.5 6.2A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.2C13.5 10 8 13.5 8 13.5z" />
  </Svg>
);
const BellIcon = () => (
  <Svg>
    <path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3L4 11zM6.6 14a1.5 1.5 0 0 0 2.8 0" />
  </Svg>
);
const TruckIcon = () => (
  <Svg>
    <path d="M1.5 4.5h8v6h-8zM9.5 6.5h3l2 2.2v2.3h-5" />
    <circle cx="4.5" cy="12" r="1.4" />
    <circle cx="11.5" cy="12" r="1.4" />
  </Svg>
);
const BoxIcon = () => (
  <Svg>
    <path d="M2 5l6-3 6 3v6l-6 3-6-3V5zM2 5l6 3 6-3M8 8v6" />
  </Svg>
);
const WrenchIcon = () => (
  <Svg>
    <path d="M10.5 2.5a3.2 3.2 0 0 0-3 4.3L2.5 11.8a1.4 1.4 0 0 0 2 2l5-5a3.2 3.2 0 0 0 4.3-3l-2 2-1.8-.4-.4-1.8 2-2z" />
  </Svg>
);
const DollarIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5v7M10 6.2c0-.9-.9-1.5-2-1.5s-2 .6-2 1.5 1 1.3 2 1.5 2 .6 2 1.5-.9 1.5-2 1.5-2-.6-2-1.5" />
  </Svg>
);
const MailIcon = () => (
  <Svg>
    <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
    <path d="M2 4.5l6 4.5 6-4.5" />
  </Svg>
);
const PhoneIcon = () => (
  <Svg>
    <path d="M3 2.5h3l1 3-1.7 1a8 8 0 0 0 3.7 3.7l1-1.7 3 1v3A1.5 1.5 0 0 1 12 14 10 10 0 0 1 2 4a1.5 1.5 0 0 1 1-1.5z" />
  </Svg>
);
const ClockIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </Svg>
);
const WarehouseIcon = () => (
  <Svg>
    <path d="M1.5 6.5L8 2.5l6.5 4v7h-13v-7zM5 13.5v-4h6v4" />
  </Svg>
);
const ShieldIcon = () => (
  <Svg>
    <path d="M8 1.8l5 1.8v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4l5-1.8z" />
  </Svg>
);
const TargetIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <circle cx="8" cy="8" r="3.2" />
    <circle cx="8" cy="8" r=".8" />
  </Svg>
);
const ZapIcon = () => (
  <Svg>
    <path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8l1-5.5z" />
  </Svg>
);
const FlagIcon = () => (
  <Svg>
    <path d="M3.5 14V2.5M3.5 3h8l-1.5 3 1.5 3h-8" />
  </Svg>
);
const UsersIcon = () => (
  <Svg>
    <circle cx="6" cy="5.5" r="2.2" />
    <path d="M2 13c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8" />
    <circle cx="11.5" cy="6" r="1.8" />
    <path d="M10.5 9.4c2 .1 3.5 1.4 3.5 3.4" />
  </Svg>
);
const LockIcon = () => (
  <Svg>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Svg>
);
const CartIcon = () => (
  <Svg>
    <path d="M1.5 2.5h2l1.6 7.5h7l1.4-5.5H4.3" />
    <circle cx="6" cy="13" r="1.1" />
    <circle cx="11.5" cy="13" r="1.1" />
  </Svg>
);
const GiftIcon = () => (
  <Svg>
    <rect x="2" y="6" width="12" height="3" rx=".8" />
    <path d="M3 9v5h10V9M8 6v8M8 6S6.2 2.5 4.8 3.7 6 6 8 6zm0 0s1.8-3.5 3.2-2.3S10 6 8 6z" />
  </Svg>
);
const GlobeIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12M8 2c2 1.8 2 10.2 0 12M8 2c-2 1.8-2 10.2 0 12" />
  </Svg>
);
const CameraIcon = () => (
  <Svg>
    <path d="M2 5h2.5L6 3h4l1.5 2H14v8H2V5z" />
    <circle cx="8" cy="9" r="2.2" />
  </Svg>
);
const CpuIcon = () => (
  <Svg>
    <rect x="4" y="4" width="8" height="8" rx="1" />
    <path d="M6.5 1.5v2.5M9.5 1.5v2.5M6.5 12v2.5M9.5 12v2.5M1.5 6.5H4M1.5 9.5H4M12 6.5h2.5M12 9.5h2.5" />
  </Svg>
);
const PlusCircleIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v6M5 8h6" />
  </Svg>
);
const AlertIcon = () => (
  <Svg>
    <path d="M8 2l6.5 11.5h-13L8 2zM8 6.5v3M8 11.6v.1" />
  </Svg>
);

const TrashTileIcon = () => (
  <Svg>
    <path d="M2.5 4.5h11M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.3a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.3M6.7 7v4M9.3 7v4" />
  </Svg>
);
const XCircleIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" />
  </Svg>
);
const BanIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <path d="M3.8 3.8l8.4 8.4" />
  </Svg>
);
const ArchiveIcon = () => (
  <Svg>
    <rect x="1.8" y="2.5" width="12.4" height="3.2" rx=".8" />
    <path d="M3 5.7v6.8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.7M6.4 8.6h3.2" />
  </Svg>
);
const ArrowDownIcon = () => (
  <Svg>
    <path d="M8 2.5v10M3.8 8.5L8 12.7l4.2-4.2" />
  </Svg>
);
const MoonIcon = () => (
  <Svg>
    <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z" />
  </Svg>
);
const EyeOffIcon = () => (
  <Svg>
    <path d="M1.8 8S4 3.8 8 3.8c1 0 1.9.3 2.7.7M14.2 8S12 12.2 8 12.2c-1 0-1.9-.3-2.7-.7M2.5 2.5l11 11M6.6 6.6a2 2 0 0 0 2.8 2.8" />
  </Svg>
);
const PauseCircleIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.4 5.8v4.4M9.6 5.8v4.4" />
  </Svg>
);

/**
 * Ikony do wyboru przy kafelku. Klucze sa zapisywane w konfiguracji, wiec ich NIE zmieniamy; nowe tylko dopisujemy.
 * `TILE_ICON_KEYS` w customTiles.ts musi miec dokladnie te same klucze (pilnuje tego test).
 */
export const TILE_ICON_NODES: Record<string, ReactNode> = {
  list: <ListIcon />,
  check: <CheckIcon />,
  pen: <PenIcon />,
  history: <HistoryIcon />,
  comment: <CommentIcon />,
  hash: <HashIcon />,
  calendar: <CalendarIcon />,
  flame: <FlameIcon />,
  bug: <BugIcon />,
  bulb: <BulbIcon />,
  parent: <ParentIcon />,
  layers: <LayersIcon />,
  tag: <TagIcon />,
  person: <PersonIcon />,
  eye: <EyeIcon />,
  star: <StarIcon />,
  heart: <HeartIcon />,
  bell: <BellIcon />,
  flag: <FlagIcon />,
  zap: <ZapIcon />,
  target: <TargetIcon />,
  alert: <AlertIcon />,
  clock: <ClockIcon />,
  users: <UsersIcon />,
  lock: <LockIcon />,
  shield: <ShieldIcon />,
  box: <BoxIcon />,
  truck: <TruckIcon />,
  warehouse: <WarehouseIcon />,
  cart: <CartIcon />,
  gift: <GiftIcon />,
  dollar: <DollarIcon />,
  mail: <MailIcon />,
  phone: <PhoneIcon />,
  wrench: <WrenchIcon />,
  cpu: <CpuIcon />,
  globe: <GlobeIcon />,
  camera: <CameraIcon />,
  board: <BoardIcon />,
  plan: <PlanIcon />,
  chart: <ChartIcon />,
  columns: <ColumnsIcon />,
  bars: <BarsIcon />,
  subtask: <SubtaskIcon />,
  link: <LinkIcon />,
  pin: <PinIcon filled={false} />,
  clip: <ClipIcon />,
  search: <SearchIcon />,
  refresh: <RefreshIcon />,
  smile: <SmileIcon />,
  plusCircle: <PlusCircleIcon />,
  trash: <TrashTileIcon />,
  xCircle: <XCircleIcon />,
  ban: <BanIcon />,
  archive: <ArchiveIcon />,
  arrowDown: <ArrowDownIcon />,
  moon: <MoonIcon />,
  eyeOff: <EyeOffIcon />,
  pause: <PauseCircleIcon />,
};
