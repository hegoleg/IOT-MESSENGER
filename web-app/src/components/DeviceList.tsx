import { useMemo, useState, type JSX } from "react";
import { CircuitBoard, Plus, Search } from "lucide-react";
import type {
  AddDeviceInput,
  ConnectionMode,
  PresenceState,
  StoredDevice,
} from "../lib/types";
import AddDeviceModal from "./AddDeviceModal";
import DeviceCard from "./DeviceCard";

export interface DeviceListProps {
  devices: StoredDevice[];
  activeToken: string | null;
  mode: ConnectionMode;
  statuses: Record<string, PresenceState>;
  serverUrl: string;
  onOpenDevice(token: string): void;
  onAddDevice(input: AddDeviceInput): void;
  onRemoveDevice(token: string): void;
  onRenameDevice(token: string, name: string): void;
}

/** Search appears once the list no longer fits on one screen. */
const SEARCH_THRESHOLD = 6;

export default function DeviceList({
  devices,
  activeToken,
  mode,
  statuses,
  serverUrl,
  onOpenDevice,
  onAddDevice,
  onRemoveDevice,
  onRenameDevice,
}: DeviceListProps): JSX.Element {
  const [modalOpen, setModalOpen] = useState(false);
  const [query, setQuery] = useState("");

  const showSearch = devices.length > SEARCH_THRESHOLD;
  const normalizedQuery = query.trim().toLowerCase();

  const visibleDevices = useMemo(() => {
    if (!normalizedQuery) return devices;
    return devices.filter(
      (device) =>
        device.name.toLowerCase().includes(normalizedQuery) ||
        device.token.toLowerCase().includes(normalizedQuery),
    );
  }, [devices, normalizedQuery]);

  const subtitle =
    mode === "cloud"
      ? "Подключение через релей"
      : "Прямое подключение по IP (порт 81)";

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-baseline gap-2">
          <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-300">
            Устройства
          </h2>
          <span className="font-mono text-[10px] tabular-nums text-accent-400">
            [{String(devices.length).padStart(2, "0")}]
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">
          {subtitle}
        </p>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="btn-primary mt-4 min-h-11 w-full"
        >
          <Plus className="size-4" strokeWidth={2.5} aria-hidden="true" />
          Добавить устройство
        </button>

        {showSearch && (
          <div className="relative mt-2.5">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по имени или токену"
              aria-label="Поиск устройств"
              className="field min-h-10 pl-9 font-mono text-[11px]"
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {devices.length === 0 ? (
          <div className="panel animate-fade-in flex flex-col items-center gap-3 px-5 py-10 text-center">
            <div className="flex size-12 items-center justify-center border border-white/10 bg-ink-950 text-accent-400">
              <CircuitBoard className="size-6" strokeWidth={1.6} aria-hidden="true" />
            </div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-300">
              Нет устройств
            </p>
            <p className="max-w-[18rem] text-xs leading-relaxed text-zinc-500">
              Вставьте токен, выданный релеем, или отсканируйте QR-код — затем нажмите
              «Добавить устройство».
            </p>
          </div>
        ) : visibleDevices.length === 0 ? (
          <div className="panel animate-fade-in flex flex-col items-center gap-2 px-5 py-10 text-center">
            <div className="flex size-11 items-center justify-center border border-white/10 bg-ink-950 text-zinc-500">
              <Search className="size-5" strokeWidth={1.6} aria-hidden="true" />
            </div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-300">
              Ничего не найдено
            </p>
            <p className="max-w-[16rem] text-xs leading-relaxed text-zinc-500">
              Попробуйте другое имя или часть токена.
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="btn-ghost mt-1 min-h-9"
            >
              Сбросить поиск
            </button>
          </div>
        ) : (
          <ul className="panel divide-y divide-white/10">
            {visibleDevices.map((device) => (
              <li key={device.token}>
                <DeviceCard
                  device={device}
                  active={device.token === activeToken}
                  status={statuses[device.token] ?? "unknown"}
                  onOpen={() => onOpenDevice(device.token)}
                  onRemove={() => onRemoveDevice(device.token)}
                  onRename={(name) => onRenameDevice(device.token, name)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <AddDeviceModal
        open={modalOpen}
        serverUrl={serverUrl}
        existingTokens={devices.map((device) => device.token)}
        onClose={() => setModalOpen(false)}
        onAdd={onAddDevice}
      />
    </section>
  );
}
