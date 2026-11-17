import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "./components/AppHeader";
import ChatView from "./components/ChatView";
import DeviceList from "./components/DeviceList";
import Onboarding, { type OnboardingResult } from "./components/Onboarding";
import ProfilesModal from "./components/ProfilesModal";
import SettingsModal from "./components/SettingsModal";
import { useDeviceChat } from "./hooks/useDeviceChat";
import { useDevices } from "./hooks/useDevices";
import { usePresence } from "./hooks/usePresence";
import { usePwaInstall } from "./hooks/usePwaInstall";
import { SERVER_URL } from "./lib/env";
import {
  isOnboarded,
  loadServerUrl,
  markOnboarded,
  saveServerUrl,
} from "./lib/settings";
import {
  createProfile,
  deleteProfile,
  getActiveProfileId,
  loadProfiles,
  profileById,
  renameProfile,
  setActiveProfileId,
  scopedKey,
  type Profile,
} from "./lib/profiles";
import type { ConnectionMode, PresenceState } from "./lib/types";
import { isValidToken } from "./lib/deviceStore";
import { normalizeServerUrl } from "./lib/serverApi";

const MODE_KEY = "iotbot.mode";

interface DeepLink {
  token: string;
  relay?: string;
}

function deepLinkFromHash(): DeepLink | null {
  if (!window.location.hash) return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = params.get("token");
  if (!token || !isValidToken(token)) return null;

  const relayRaw = params.get("relay");
  const relay = relayRaw ? normalizeServerUrl(relayRaw) : null;
  return { token, relay: relay ?? undefined };
}

/**
 * Owns the local profile selection. Every profile gets its own storage scope,
 * so the workspace below is remounted (via `key`) when the user switches.
 */
export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [profileId, setProfileId] = useState<string>(() => getActiveProfileId());
  const [profilesOpen, setProfilesOpen] = useState(false);

  const activeProfile = useMemo(() => {
    const stored = profileById(profileId);
    return profiles.find((profile) => profile.id === stored.id) ?? stored;
  }, [profileId, profiles]);

  function handleCreateProfile(name: string): void {
    const profile = createProfile(name);
    setActiveProfileId(profile.id);
    setProfiles(loadProfiles());
    setProfileId(profile.id);
    setProfilesOpen(false);
  }

  function handleSwitchProfile(id: string): void {
    if (id === profileId) return;
    setActiveProfileId(id);
    setProfileId(id);
    setProfilesOpen(false);
  }

  function handleRenameProfile(id: string, name: string): boolean {
    const renamed = renameProfile(id, name);
    if (renamed) setProfiles(loadProfiles());
    return renamed;
  }

  function handleDeleteProfile(id: string): void {
    if (!deleteProfile(id)) return;
    setProfiles(loadProfiles());
    setProfileId(getActiveProfileId());
  }

  return (
    <>
      <Workspace
        key={profileId}
        profile={activeProfile}
        onOpenProfiles={() => setProfilesOpen(true)}
      />

      <ProfilesModal
        open={profilesOpen}
        profiles={profiles}
        activeId={profileId}
        onClose={() => setProfilesOpen(false)}
        onCreate={handleCreateProfile}
        onSwitch={handleSwitchProfile}
        onRename={handleRenameProfile}
        onDelete={handleDeleteProfile}
      />
    </>
  );
}

interface WorkspaceProps {
  profile: Profile;
  onOpenProfiles(): void;
}

function Workspace({ profile, onOpenProfiles }: WorkspaceProps) {
  const deepLink = useMemo(() => deepLinkFromHash(), []);
  const { devices, add, remove, rename, setLocalHost, touch } = useDevices(
    deepLink ? { token: deepLink.token } : undefined,
  );
  const [mode, setMode] = useState<ConnectionMode>(() =>
    localStorage.getItem(scopedKey(MODE_KEY)) === "local" ? "local" : "cloud",
  );
  const [activeToken, setActiveToken] = useState<string | null>(
    deepLink?.token ?? null,
  );
  const [serverUrl, setServerUrl] = useState(loadServerUrl);
  const [boarding, setBoarding] = useState(
    () => !deepLink && !isOnboarded() && devices.length === 0,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const install = usePwaInstall();
  const pendingOpen = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem(scopedKey(MODE_KEY), mode);
  }, [mode]);

  const activeDevice = useMemo(
    () => devices.find((device) => device.token === activeToken) ?? null,
    [devices, activeToken],
  );

  const chat = useDeviceChat({
    token: activeDevice?.token ?? null,
    mode,
    serverUrl,
    localHost: activeDevice?.localHost,
  });

  const presence = usePresence({
    devices,
    mode,
    serverUrl,
    skipToken: activeDevice?.token ?? null,
  });

  const statuses = useMemo(() => {
    const next: Record<string, PresenceState> = {};
    for (const device of devices) {
      if (device.token === activeDevice?.token) {
        next[device.token] =
          chat.status === "online"
            ? chat.deviceOnline
              ? "online"
              : "offline"
            : chat.status;
      } else {
        next[device.token] = presence[device.token] ?? "unknown";
      }
    }
    return next;
  }, [devices, activeDevice?.token, chat.status, chat.deviceOnline, presence]);

  // Remember the last activity so the device list can show it.
  const lastMessageId =
    chat.messages.length > 0 ? chat.messages[chat.messages.length - 1]?.id : undefined;
  const activeDeviceToken = activeDevice?.token;
  useEffect(() => {
    if (activeDeviceToken && lastMessageId) {
      touch(activeDeviceToken);
    }
  }, [activeDeviceToken, lastMessageId, touch]);

  // Open a chat only after the device is actually present in the list.
  useEffect(() => {
    const pending = pendingOpen.current;
    if (!pending) return;
    if (!devices.some((device) => device.token === pending)) return;

    pendingOpen.current = null;
    setActiveToken(pending);
  }, [devices]);

  // QR from the flasher: /app/#token=...&relay=... — the device is seeded by
  // useDevices above; here we save the relay and clean the URL.
  useEffect(() => {
    const link = deepLinkFromHash();
    if (!link) return;

    if (link.relay) {
      setServerUrl(saveServerUrl(link.relay));
    }

    markOnboarded(true);
    setBoarding(false);

    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }, []);

  function handleOnboardingComplete(result: OnboardingResult): void {
    const saved = saveServerUrl(result.serverUrl);
    setServerUrl(saved);

    if (result.device) {
      try {
        add({ token: result.device.token, name: result.device.name });
      } catch {
        // Already added from another tab — just open it.
      }
      pendingOpen.current = result.device.token;
    }

    markOnboarded(true);
    setBoarding(false);
  }

  function handleSkipOnboarding(): void {
    markOnboarded(true);
    setBoarding(false);
  }

  function handleSaveServer(value: string): void {
    setServerUrl(saveServerUrl(value));
  }

  function handleRemoveDevice(token: string): void {
    remove(token);
    if (activeToken === token) setActiveToken(null);
  }

  function runOnboarding(): void {
    setSettingsOpen(false);
    setActiveToken(null);
    setBoarding(true);
  }

  if (boarding) {
    return (
      <div className="tech-grid relative mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-ink-950 text-zinc-200 md:my-4 md:h-[calc(100dvh-2rem)] md:border md:border-white/10">
        <Onboarding
          defaultServerUrl={serverUrl || SERVER_URL}
          onComplete={handleOnboardingComplete}
          onSkip={handleSkipOnboarding}
        />
      </div>
    );
  }

  return (
    <div className="tech-grid relative mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-ink-950 text-zinc-200 md:my-4 md:h-[calc(100dvh-2rem)] md:border md:border-white/10">
      {activeDevice ? (
        <ChatView
          key={activeDevice.token}
          device={activeDevice}
          chat={chat}
          mode={mode}
          onBack={() => setActiveToken(null)}
          onSetLocalHost={(host) => setLocalHost(activeDevice.token, host)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <>
          <AppHeader
            mode={mode}
            profile={profile}
            onModeChange={setMode}
            onOpenProfiles={onOpenProfiles}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <DeviceList
            devices={devices}
            activeToken={activeToken}
            mode={mode}
            statuses={statuses}
            serverUrl={serverUrl}
            onOpenDevice={setActiveToken}
            onAddDevice={add}
            onRemoveDevice={handleRemoveDevice}
            onRenameDevice={rename}
          />
        </>
      )}

      <SettingsModal
        open={settingsOpen}
        serverUrl={serverUrl}
        mode={mode}
        install={install}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveServer}
        onRunOnboarding={runOnboarding}
      />
    </div>
  );
}
