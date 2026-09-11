"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type FormEvent,
  type ReactNode
} from "react";
import clsx from "clsx";
import type { ApLogRecord, ApStatusSummary, SwitchStatusSummary } from "@/types";

type ApiResponse<T> = {
  data: T;
};

type DashboardData = {
  monitoring: {
    paused: boolean;
    monitoringIntervalSeconds: number;
    dashboardRefreshSeconds: number;
  };
  summary: ApStatusSummary[];
  switches: SwitchStatusSummary[];
  logs: ApLogRecord[];
};

type FormState = {
  controller: string;
  name: string;
  model: string;
  mac: string;
  host: string;
  switchId: string;
};

type ControllerGroup = {
  controller: string;
  items: ApStatusSummary[];
};

type StatusFilter = "all" | "online" | "offline";
type LogSource = "ap" | "switch";

const initialForm: FormState = { controller: "", name: "", model: "", mac: "", host: "", switchId: "" };

type SwitchFormState = {
  building: string;
  name: string;
  host: string;
};

const initialSwitchForm: SwitchFormState = { building: "", name: "", host: "" };

const LOG_PAGE_SIZE = 20;

const WLC_ACCENTS = ["#5eead4", "#a78bfa", "#fbbf24", "#f472b6", "#60a5fa", "#a3e635"];

function wlcAccent(index: number) {
  return WLC_ACCENTS[index % WLC_ACCENTS.length];
}

const jakartaTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "medium",
  hour12: false
});

const jakartaClockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

function parseSqliteTimestamp(value: string) {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? response.statusText ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return jakartaTimeFormatter.format(parseSqliteTimestamp(value));
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

function formatRelative(value: string) {
  const seconds = Math.max(0, (Date.now() - parseSqliteTimestamp(value).getTime()) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${Math.floor(seconds)}s ago`;
}

function SignalBars({ status }: { status: ApStatusSummary["status"] }) {
  return (
    <span className={clsx("signal", status)} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function StatusPill({
  status,
  paused = false,
  disabled = false
}: {
  status: ApStatusSummary["status"];
  paused?: boolean;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span className="status-pill disabled">
        <SignalBars status="unknown" />
        disabled
      </span>
    );
  }

  const displayStatus = paused ? "unknown" : status;

  return (
    <span className={clsx("status-pill", displayStatus, paused && "paused")}>
      <SignalBars status={displayStatus} />
      {paused ? "paused" : status}
    </span>
  );
}

function OverlayShell({
  title,
  description,
  onClose,
  children
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overlay-backdrop" onClick={onClose} role="presentation">
      <div className="overlay-panel panel" onClick={(event) => event.stopPropagation()}>
        <div className="overlay-head">
          <div>
            <p className="section-label">{title}</p>
            <h2>{description}</h2>
          </div>
          <button className="overlay-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function DashboardShell() {
  const [data, setData] = useState<DashboardData>({
    monitoring: {
      paused: false,
      monitoringIntervalSeconds: 60,
      dashboardRefreshSeconds: 5
    },
    summary: [],
    switches: [],
    logs: []
  });
  const [form, setForm] = useState<FormState>(initialForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isApModalOpen, setIsApModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [switchForm, setSwitchForm] = useState<SwitchFormState>(initialSwitchForm);
  const [editingSwitchId, setEditingSwitchId] = useState<number | null>(null);
  const [isSwitchModalOpen, setIsSwitchModalOpen] = useState(false);
  const [isSwitchImportModalOpen, setIsSwitchImportModalOpen] = useState(false);
  const [switchImportMessage, setSwitchImportMessage] = useState<string | null>(null);
  const [isSwitchImporting, setIsSwitchImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [logController, setLogController] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>("all");
  const [logSource, setLogSource] = useState<LogSource>("ap");
  const [isLogLoading, setIsLogLoading] = useState(false);
  const [logPage, setLogPage] = useState(1);
  const [pageInputValue, setPageInputValue] = useState("1");
  const [openControllers, setOpenControllers] = useState<Set<string>>(new Set());
  const [openSwitchGroups, setOpenSwitchGroups] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [isImporting, setIsImporting] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  // Menyimpan nilai filter History TERBARU. refresh() selalu membaca dari sini,
  // bukan langsung dari closure state — supaya interval polling (setInterval)
  // yang "dipasang" sekali tetap memakai filter terkini di setiap tick,
  // bukan versi "beku" dari saat interval pertama kali dibuat.
  const filtersRef = useRef({ logFrom, logTo, logController, searchMode, logSource });

  useEffect(() => {
    filtersRef.current = { logFrom, logTo, logController, searchMode, logSource };
  }, [logFrom, logTo, logController, searchMode, logSource]);

  const refresh = useCallback(
    async (overrides?: { searchModeOverride?: boolean; sourceOverride?: LogSource }) => {
      const current = filtersRef.current;
      const params = new URLSearchParams();
      const effectiveSearchMode = overrides?.searchModeOverride ?? current.searchMode;
      const effectiveSource = overrides?.sourceOverride ?? current.logSource;

      if (effectiveSearchMode) {
        params.set("search", "1");
        if (current.logFrom) params.set("from", current.logFrom);
        if (current.logTo) params.set("to", current.logTo);
        if (current.logController.trim()) params.set("controller", current.logController.trim());
      }

      params.set("source", effectiveSource);

      const response = await fetchJson<ApiResponse<DashboardData>>(`/api/dashboard?${params.toString()}`);
      setData(response.data);
    },
    []
  );

  const lastUpdatedAt = useMemo(() => {
    let latest: Date | null = null;

    for (const item of data.summary) {
      if (!item.checkedAt) {
        continue;
      }

      const checkedAt = parseSqliteTimestamp(item.checkedAt);
      if (!latest || checkedAt.getTime() > latest.getTime()) {
        latest = checkedAt;
      }
    }

    return latest;
  }, [data.summary]);

  // Polling berkala — refresh() sudah stabil (useCallback) dan selalu baca
  // filtersRef.current, jadi interval ini tidak perlu tahu isi filter apapun.
  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message));
    const timer = window.setInterval(() => {
      void refresh().catch((err: Error) => setError(err.message));
    }, data.monitoring.dashboardRefreshSeconds * 1000);

    return () => window.clearInterval(timer);
  }, [data.monitoring.dashboardRefreshSeconds, refresh]);

  // Refetch filter, di-debounce 400ms setelah user berhenti mengetik/ganti tanggal.
  useEffect(() => {
    if (!searchMode) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void refresh({ searchModeOverride: true }).catch((err: Error) => setError(err.message));
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [logController, logFrom, logTo, refresh]);

  useEffect(() => {
    setLogPage(1);
  }, [logController, logFrom, logTo, searchMode, selectedStatus, logSource, logQuery]);

  const toggleController = (controller: string) => {
    setOpenControllers((current) => {
      const next = new Set(current);
      if (next.has(controller)) {
        next.delete(controller);
      } else {
        next.add(controller);
      }
      return next;
    });
  };

  const toggleSwitchGroup = (building: string) => {
    setOpenSwitchGroups((current) => {
      const next = new Set(current);
      if (next.has(building)) {
        next.delete(building);
      } else {
        next.add(building);
      }
      return next;
    });
  };

  const paused = data.monitoring.paused;

  const totals = useMemo(() => {
    const disabled = data.summary.filter((item) => item.enabled !== 1).length;

    if (paused) {
      return { online: 0, offline: 0, unknown: data.summary.length, disabled, total: data.summary.length };
    }

    const activeSummary = data.summary.filter((item) => item.enabled === 1);
    const online = activeSummary.filter((item) => item.status === "online").length;
    const offline = activeSummary.filter((item) => item.status === "offline").length;
    const unknown = activeSummary.filter((item) => item.status === "unknown").length;
    return { online, offline, unknown, disabled, total: data.summary.length };
  }, [data.summary, paused]);

  const switchTotals = useMemo(() => {
    const disabled = data.switches.filter((item) => item.enabled !== 1).length;

    if (paused) {
      return { online: 0, offline: 0, unknown: data.switches.length, disabled, total: data.switches.length };
    }

    const activeSwitches = data.switches.filter((item) => item.enabled === 1);
    const online = activeSwitches.filter((item) => item.status === "online").length;
    const offline = activeSwitches.filter((item) => item.status === "offline").length;
    const unknown = activeSwitches.filter((item) => item.status === "unknown").length;
    return { online, offline, unknown, disabled, total: data.switches.length };
  }, [data.switches, paused]);

  const sourceTotals = logSource === "switch" ? switchTotals : totals;

  const groupedControllers = useMemo<ControllerGroup[]>(() => {
    const groups = new Map<string, ApStatusSummary[]>();

    for (const item of data.summary) {
      const controller = item.controller?.trim() || "Uncategorized";
      const current = groups.get(controller) ?? [];
      current.push(item);
      groups.set(controller, current);
    }

    return Array.from(groups.entries())
      .map(([controller, items]) => ({
        controller,
        items: items.sort((left, right) => left.name.localeCompare(right.name))
      }))
      .sort((left, right) => left.controller.localeCompare(right.controller));
  }, [data.summary]);

  type SwitchGroup = {
    building: string;
    items: SwitchStatusSummary[];
  };

  const groupedSwitches = useMemo<SwitchGroup[]>(() => {
    const groups = new Map<string, SwitchStatusSummary[]>();

    for (const item of data.switches) {
      const building = item.building?.trim() || "Uncategorized";
      const current = groups.get(building) ?? [];
      current.push(item);
      groups.set(building, current);
    }

    return Array.from(groups.entries())
      .map(([building, items]) => ({
        building,
        items: items.sort((left, right) => left.name.localeCompare(right.name))
      }))
      .sort((left, right) => left.building.localeCompare(right.building));
  }, [data.switches]);

  const controllerOptions = useMemo(
    () => groupedControllers.map((group) => group.controller),
    [groupedControllers]
  );

  const buildingOptions = useMemo(
    () => groupedSwitches.map((group) => group.building),
    [groupedSwitches]
  );

  const filteredLogs = useMemo(() => {
      if (!searchMode) {
        return [];
      }

      const query = logQuery.trim().toLowerCase();
      const byStatus = selectedStatus === "all" ? data.logs : data.logs.filter((item) => item.status === selectedStatus);

      const matched = !query
        ? byStatus
        : byStatus.filter(
            (item) =>
              item.name.toLowerCase().includes(query) ||
              item.host.toLowerCase().includes(query) ||
              item.controller.toLowerCase().includes(query)
          );
      return [...matched].sort((a, b) => {
        const aPriority = a.status === "offline" && a.incident_status === "ongoing" ? 0 : 1;
        const bPriority = b.status === "offline" && b.incident_status === "ongoing" ? 0 : 1;
        return aPriority - bPriority;
      });
    }, [data.logs, searchMode, selectedStatus, logQuery]);

  const logPageCount = searchMode ? Math.max(1, Math.ceil(filteredLogs.length / LOG_PAGE_SIZE)) : 1;
  const currentLogPage = Math.min(logPage, logPageCount);
  const pagedLogs = searchMode
    ? filteredLogs.slice((currentLogPage - 1) * LOG_PAGE_SIZE, currentLogPage * LOG_PAGE_SIZE)
    : filteredLogs;

  useEffect(() => {
    setPageInputValue(String(currentLogPage));
  }, [currentLogPage]);

  const commitPageJump = () => {
    const parsed = Number(pageInputValue);

    if (!Number.isFinite(parsed)) {
      setPageInputValue(String(currentLogPage));
      return;
    }

    const clamped = Math.min(Math.max(1, Math.round(parsed)), logPageCount);
    setLogPage(clamped);
    setPageInputValue(String(clamped));
  };

  const applyStatusFilter = async (status: StatusFilter) => {
    setError(null);
    setSelectedStatus(status);
    setLogPage(1);

    if (searchMode) {
      return;
    }

    setSearchMode(true);
    setIsLogLoading(true);
    try {
      await refresh({ searchModeOverride: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setIsLogLoading(false);
    }
  };

  const exportLogsCsv = () => {
    const header = ["No", "Device", "Model", "Controller", "IP", "Status", "Started", "Ended", "Duration (s)", "Latency (ms)"];
    const rows = filteredLogs.map((item, index) => [
      String(index + 1),
      item.name,
      item.model,
      item.controller,
      item.host,
      item.status,
      item.started_at ?? item.checked_at,
      item.ended_at ?? "",
      item.duration_seconds !== null ? String(item.duration_seconds) : "",
      item.latency_ms !== null ? String(item.latency_ms) : ""
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `history-${logSource}-${selectedStatus}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const showLogDetail = (item: ApLogRecord) => {
    const lines = [
      `${item.name} (${item.model})`,
      `Controller: ${item.controller}`,
      `IP: ${item.host}`,
      `Status: ${item.status}`,
      item.started_at ? `Started: ${formatTimestamp(item.started_at)}` : null,
      item.ended_at ? `Ended: ${formatTimestamp(item.ended_at)}` : null,
      item.message ? `Message: ${item.message}` : null
    ].filter(Boolean);
    window.alert(lines.join("\n"));
  };

  const clearHistoryFilters = () => {
    setLogFrom("");
    setLogTo("");
    setLogController("");
    setLogQuery("");
    setSelectedStatus("all");
    setSearchMode(false);
  };

  const switchLogSource = async (source: LogSource) => {
    setError(null);
    setLogSource(source);
    setLogController("");
    setSearchMode(true);
    setLogPage(1);
    setIsLogLoading(true);
    try {
      await refresh({ searchModeOverride: true, sourceOverride: source });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setIsLogLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const payload = {
          controller: form.controller,
          name: form.name,
          model: form.model,
          mac: form.mac,
          host: form.host,
          switchId: form.switchId ? Number(form.switchId) : null
        };

        if (editingId === null) {
          await fetchJson("/api/aps", {
            method: "POST",
            body: JSON.stringify(payload)
          });
        } else {
          await fetchJson(`/api/aps/${editingId}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
          });
        }

        setForm(initialForm);
        setEditingId(null);
        setIsApModalOpen(false);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save AP");
      }
    });
  };

  const openCreateApModal = () => {
    setError(null);
    setEditingId(null);
    setForm(initialForm);
    setIsApModalOpen(true);
  };

  const beginEdit = (item: ApStatusSummary) => {
    setError(null);
    setEditingId(item.id);
    setForm({
      controller: item.controller,
      name: item.name,
      model: item.model,
      mac: item.mac,
      host: item.host,
      switchId: item.switchId ? String(item.switchId) : ""
    });
    setIsApModalOpen(true);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(initialForm);
    setIsApModalOpen(false);
  };

  const openImportModal = () => {
    setError(null);
    setImportMessage(null);
    setIsImportModalOpen(true);
  };

  const closeImportModal = () => {
    setIsImportModalOpen(false);
  };

  const toggleAp = async (id: number, enabled: boolean) => {
    setError(null);
    await fetchJson(`/api/aps/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !enabled })
    });
    await refresh();
  };

  const removeAp = async (id: number) => {
    setError(null);
    await fetchJson(`/api/aps/${id}`, { method: "DELETE" });
    if (editingId === id) {
      cancelEdit();
    }
    await refresh();
  };

  const openCreateSwitchModal = () => {
    setError(null);
    setEditingSwitchId(null);
    setSwitchForm(initialSwitchForm);
    setIsSwitchModalOpen(true);
  };

  const beginEditSwitch = (item: SwitchStatusSummary) => {
    setError(null);
    setEditingSwitchId(item.id);
    setSwitchForm({
      building: item.building,
      name: item.name,
      host: item.host
    });
    setIsSwitchModalOpen(true);
  };

  const cancelEditSwitch = () => {
    setEditingSwitchId(null);
    setSwitchForm(initialSwitchForm);
    setIsSwitchModalOpen(false);
  };

  const handleSwitchSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        if (editingSwitchId === null) {
          await fetchJson("/api/switches", {
            method: "POST",
            body: JSON.stringify(switchForm)
          });
        } else {
          await fetchJson(`/api/switches/${editingSwitchId}`, {
            method: "PATCH",
            body: JSON.stringify(switchForm)
          });
        }

        setSwitchForm(initialSwitchForm);
        setEditingSwitchId(null);
        setIsSwitchModalOpen(false);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save switch");
      }
    });
  };

  const toggleSwitchEnabled = async (id: number, enabled: boolean) => {
    setError(null);
    await fetchJson(`/api/switches/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !enabled })
    });
    await refresh();
  };

  const removeSwitch = async (id: number) => {
    setError(null);
    await fetchJson(`/api/switches/${id}`, { method: "DELETE" });
    if (editingSwitchId === id) {
      cancelEditSwitch();
    }
    await refresh();
  };

  const importCsv = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const input = formElement.elements.namedItem("csvFile") as HTMLInputElement | null;
    const file = input?.files?.[0];

    if (!file) {
      setError("Please select a CSV file first");
      return;
    }

    setError(null);
    setImportMessage(null);
    setIsImporting(true);

    try {
      const csvText = await file.text();
      const response = await fetchJson<{ ok: boolean; inserted: number; updated: number; total: number }>(
        "/api/aps/import",
        {
          method: "POST",
          body: JSON.stringify({ csvText })
        }
      );

      setImportMessage(
        `Import completed: ${response.total} rows, ${response.inserted} added, ${response.updated} updated.`
      );
      formElement.reset();
      setIsImportModalOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import CSV");
    } finally {
      setIsImporting(false);
    }
  };

  const importSwitchesCsv = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const input = formElement.elements.namedItem("switchCsvFile") as HTMLInputElement | null;
    const file = input?.files?.[0];

    if (!file) {
      setError("Please select a CSV file first");
      return;
    }

    setError(null);
    setSwitchImportMessage(null);
    setIsSwitchImporting(true);

    try {
      const csvText = await file.text();
      const response = await fetchJson<{ ok: boolean; inserted: number; updated: number; total: number }>(
        "/api/switches/import",
        {
          method: "POST",
          body: JSON.stringify({ csvText })
        }
      );

      setSwitchImportMessage(
        `Import completed: ${response.total} rows, ${response.inserted} added, ${response.updated} updated.`
      );
      formElement.reset();
      setIsSwitchImportModalOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import switch CSV");
    } finally {
      setIsSwitchImporting(false);
    }
  };

  const openSwitchImportModal = () => {
    setError(null);
    setSwitchImportMessage(null);
    setIsSwitchImportModalOpen(true);
  };

  const closeSwitchImportModal = () => {
    setIsSwitchImportModalOpen(false);
  };

  const runNow = async () => {
    setError(null);
    setIsBusy(true);
    try {
      await fetchJson("/api/monitor/run", { method: "POST" });
      await refresh();
    } finally {
      setIsBusy(false);
    }
  };

  const toggleRun = async () => {
    setError(null);
    setIsBusy(true);

    setData((current) => ({
      ...current,
      monitoring: { ...current.monitoring, paused: !current.monitoring.paused }
    }));

    try {
      await fetchJson("/api/monitor/toggle", { method: "POST" });
      await refresh();
    } catch (err) {
      setData((current) => ({
        ...current,
        monitoring: { ...current.monitoring, paused: !current.monitoring.paused }
      }));
      setError(err instanceof Error ? err.message : "Failed to toggle monitoring");
    } finally {
      setIsBusy(false);
    }
  };

  const deleteAllDb = async () => {
    const confirmed = window.confirm(
      "Delete all APs and logs from the database? This cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    setError(null);
    setImportMessage(null);
    setIsBusy(true);
    try {
      await fetchJson("/api/database", { method: "DELETE" });
      setForm(initialForm);
      setEditingId(null);
      await refresh();
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="shell">
      <header className="hero panel">
        <div className="hero-intro">
          <div className="hero-mark">
            <SignalBars status={paused ? "unknown" : "online"} />
          </div>
          <div>
            <p className="eyebrow">Wireless Ops</p>
            <h1>Access Points &amp; Switches Monitoring</h1>
            <p className="compact-meta">
              Ping every {data.monitoring.monitoringIntervalSeconds}s
              <span className="dot">•</span>
              refresh every {data.monitoring.dashboardRefreshSeconds}s
              <span className="dot">•</span>
              <span className={clsx("run-state", paused ? "paused" : "running")}>
                {paused ? "Paused" : "Running"}
              </span>
              <span className="dot">•</span>
              Last Updated {lastUpdatedAt ? jakartaClockFormatter.format(lastUpdatedAt) : "-"}
            </p>
          </div>
        </div>

        <div className="toolbar">
          <button className="btn btn-primary" onClick={runNow} disabled={isBusy} type="button">
            Run now
          </button>
          <button className="btn" type="button" onClick={toggleRun} disabled={isBusy}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button className="btn btn-danger" type="button" onClick={deleteAllDb} disabled={isBusy}>
            Delete all
          </button>
        </div>
      </header>

      <section className="stats-grid">
        <article className="panel stat-card">
          <div>
            <span>Total APs</span>
            <strong>{totals.total}</strong>
          </div>
        </article>
        <article className="panel stat-card online">
          <div>
            <span>Online</span>
            <strong>{totals.online}</strong>
          </div>
          <span className="stat-dot" aria-hidden="true" />
        </article>
        <article className="panel stat-card offline">
          <div>
            <span>Offline</span>
            <strong>{totals.offline}</strong>
          </div>
          <span className="stat-dot" aria-hidden="true" />
        </article>
        <article className="panel stat-card unknown">
          <div>
            <span>{paused ? "Paused" : "Unknown"}</span>
            <strong>{totals.unknown}</strong>
          </div>
          <span className="stat-dot" aria-hidden="true" />
        </article>
        <article className="panel stat-card disabled">
          <div>
            <span>Disabled</span>
            <strong>{totals.disabled}</strong>
          </div>
          <span className="stat-dot" aria-hidden="true" />
        </article>
      </section>

      {importMessage ? <p className="inline-note has-message">{importMessage}</p> : null}

      <section className="panel block">
        <div className="block-head">
          <div>
            <p className="section-label">Live status</p>
            <h2>Access points</h2>
          </div>
          <div className="status-strip">
            <span className="status-chip">{groupedControllers.length} WLC</span>
            <span className="status-chip">{totals.total} AP</span>
            <button className="btn btn-ghost" type="button" onClick={openCreateApModal}>
              + Add AP
            </button>
            <button className="btn" type="button" onClick={openImportModal}>
              Import CSV
            </button>
          </div>
        </div>

        <div className="group-list">
          {groupedControllers.length === 0 ? (
            <p className="empty-state">No APs yet — add one or import a CSV to get started.</p>
          ) : (
            groupedControllers.map((group, index) => {
              const accent = wlcAccent(index);
              const isOpen = openControllers.has(group.controller);
              const activeItems = group.items.filter((item) => item.enabled === 1);
              const onlineCount = paused ? 0 : activeItems.filter((item) => item.status === "online").length;
              const offlineCount = paused ? 0 : activeItems.filter((item) => item.status === "offline").length;
              const disabledCount = group.items.filter((item) => item.enabled !== 1).length;

              return (
                <section
                  className={clsx("controller-group", isOpen && "open")}
                  key={group.controller}
                  style={{ "--wlc-accent": accent } as CSSProperties}
                >
                  <button
                    type="button"
                    className="controller-head"
                    onClick={() => toggleController(group.controller)}
                    aria-expanded={isOpen}
                  >
                    <span className="controller-title">
                      <span className="wlc-dot" aria-hidden="true" />
                      <h3 className="mono">{group.controller}</h3>
                    </span>
                    <span className="controller-summary">
                      <span className="status-chip">{group.items.length} AP</span>
                      <span className="status-chip online-chip">{onlineCount} online</span>
                      {offlineCount > 0 ? (
                        <span className="status-chip offline-chip">{offlineCount} offline</span>
                      ) : null}
                      {disabledCount > 0 ? (
                        <span className="status-chip disabled-chip">{disabledCount} disabled</span>
                      ) : null}
                      <span className="chevron" aria-hidden="true">
                        ⌄
                      </span>
                    </span>
                  </button>

                  {isOpen ? (
                    <div className="ap-list">
                      {group.items.map((item) => (
                        <div className={clsx("ap-row", item.enabled !== 1 && "disabled")} key={item.id}>
                          <div className="ap-main">
                            <div>
                              <div className="ap-name">{item.name}</div>
                              <div className="ap-meta">
                                <span>{item.model}</span>
                                <span className="mono">{item.mac}</span>
                                <span className="mono">{item.host}</span>
                                {item.checkedAt ? (
                                  <span>{formatTimestamp(item.checkedAt)}</span>
                                ) : (
                                  <span>Not checked yet</span>
                                )}
                                {item.latencyMs !== null ? (
                                  <span className="mono">{item.latencyMs} ms</span>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <div className="row-actions">
                            <StatusPill status={item.status} paused={paused} disabled={item.enabled !== 1} />
                            {item.enabled === 1 && item.switchStatus === "offline" ? (
                              <span
                                className="switch-offline-badge"
                                title={`Switch ${item.switchName ?? ""} sedang offline`}
                              >
                                ⚠ Switch offline
                              </span>
                            ) : null}
                            <button className="icon-btn" type="button" onClick={() => beginEdit(item)}>
                              Edit
                            </button>
                            <button
                              className="icon-btn"
                              type="button"
                              onClick={() => toggleAp(item.id, item.enabled === 1)}
                            >
                              {item.enabled === 1 ? "Disable" : "Enable"}
                            </button>
                            <button className="icon-btn danger" type="button" onClick={() => void removeAp(item.id)}>
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </div>
      </section>

      <section className="stats-grid">
        <article className="panel stat-card">
          <div>
            <span>Total Switches</span>
            <strong>{switchTotals.total}</strong>
          </div>
        </article>
        <article className="panel stat-card online">
          <div>
            <span>Online</span>
            <strong>{switchTotals.online}</strong>
          </div>
          <span className="stat-dot" aria-hidden="true" />
        </article>
        <article className="panel stat-card offline">
          <div>
            <span>Offline</span>
            <strong>{switchTotals.offline}</strong>
          </div>
          <span className="stat-dot" aria-hidden="true" />
        </article>
        <article className="panel stat-card unknown">
          <div>
            <span>{paused ? "Paused" : "Unknown"}</span>
            <strong>{switchTotals.unknown}</strong>
          </div>
          <span className="stat-dot" aria-hidden="true" />
        </article>
        <article className="panel stat-card disabled">
          <div>
            <span>Disabled</span>
            <strong>{switchTotals.disabled}</strong>
          </div>
          <span className="stat-dot" aria-hidden="true" />
        </article>
      </section>

      <section className="panel block">
        <div className="block-head">
          <div>
            <p className="section-label">Live Status</p>
            <h2>Switches</h2>
          </div>
          <div className="status-strip">
            <span className="status-chip">{groupedSwitches.length} Building</span>
            <span className="status-chip">{data.switches.length} Switch</span>
            <button className="btn btn-ghost" type="button" onClick={openCreateSwitchModal}>
              + Add Switch
            </button>
            <button className="btn" type="button" onClick={openSwitchImportModal}>
              Import CSV
            </button>
          </div>
        </div>

        {switchImportMessage ? <p className="inline-note has-message">{switchImportMessage}</p> : null}

        <div className="group-list">
          {groupedSwitches.length === 0 ? (
            <p className="empty-state">No switches yet — add one or import a CSV to get started.</p>
          ) : (
            groupedSwitches.map((group, index) => {
              const accent = wlcAccent(index);
              const isOpen = openSwitchGroups.has(group.building);
              const activeItems = group.items.filter((item) => item.enabled === 1);
              const onlineCount = paused ? 0 : activeItems.filter((item) => item.status === "online").length;
              const offlineCount = paused ? 0 : activeItems.filter((item) => item.status === "offline").length;
              const disabledCount = group.items.filter((item) => item.enabled !== 1).length;

              return (
                <section
                  className={clsx("controller-group", isOpen && "open")}
                  key={group.building}
                  style={{ "--wlc-accent": accent } as CSSProperties}
                >
                  <button
                    type="button"
                    className="controller-head"
                    onClick={() => toggleSwitchGroup(group.building)}
                    aria-expanded={isOpen}
                  >
                    <span className="controller-title">
                      <span className="wlc-dot" aria-hidden="true" />
                      <h3 className="mono">{group.building}</h3>
                    </span>
                    <span className="controller-summary">
                      <span className="status-chip">{group.items.length} switch</span>
                      <span className="status-chip online-chip">{onlineCount} online</span>
                      {offlineCount > 0 ? (
                        <span className="status-chip offline-chip">{offlineCount} offline</span>
                      ) : null}
                      {disabledCount > 0 ? (
                        <span className="status-chip disabled-chip">{disabledCount} disabled</span>
                      ) : null}
                      <span className="chevron" aria-hidden="true">
                        ⌄
                      </span>
                    </span>
                  </button>

                  {isOpen ? (
                    <div className="ap-list">
                      {group.items.map((sw) => (
                        <div className={clsx("ap-row", sw.enabled !== 1 && "disabled")} key={sw.id}>
                          <div className="ap-main">
                            <div>
                              <div className="ap-name">{sw.name}</div>
                              <div className="ap-meta">
                                <span className="mono">{sw.host}</span>
                                {sw.checkedAt ? (
                                  <span>{formatTimestamp(sw.checkedAt)}</span>
                                ) : (
                                  <span>Not checked yet</span>
                                )}
                                {sw.latencyMs !== null ? <span className="mono">{sw.latencyMs} ms</span> : null}
                              </div>
                            </div>
                          </div>

                          <div className="row-actions">
                            <StatusPill status={sw.status} paused={paused} disabled={sw.enabled !== 1} />
                            <button className="icon-btn" type="button" onClick={() => beginEditSwitch(sw)}>
                              Edit
                            </button>
                            <button
                              className="icon-btn"
                              type="button"
                              onClick={() => toggleSwitchEnabled(sw.id, sw.enabled === 1)}
                            >
                              {sw.enabled === 1 ? "Disable" : "Enable"}
                            </button>
                            <button
                              className="icon-btn danger"
                              type="button"
                              onClick={() => void removeSwitch(sw.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </div>
      </section>

      <section className="panel block history-panel">
        <div className="block-head">
          <div>
            <p className="section-label">History</p>
            <h2>Latest ping results</h2>
          </div>
          <div className="status-strip">
            <button
              className={clsx("btn", logSource === "ap" ? "btn-primary" : "btn-quiet")}
              type="button"
              onClick={() => void switchLogSource("ap")}
            >
              AP
            </button>
            <button
              className={clsx("btn", logSource === "switch" ? "btn-primary" : "btn-quiet")}
              type="button"
              onClick={() => void switchLogSource("switch")}
            >
              Switch
            </button>
          </div>
        </div>

        <div className="history-toolbar">
          <div className="history-search">
            <span className="history-search-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              value={logQuery}
              onChange={(event) => {
                setLogQuery(event.target.value);
                setSearchMode(true);
              }}
              placeholder={`Search ${logSource === "switch" ? "Switch" : "AP"} / Controller / IP...`}
            />
          </div>

          <label className="history-filter-field">
            <span>{logSource === "switch" ? "Building" : "Controller"}</span>
            <select
              value={logController}
              onChange={(event) => {
                setLogController(event.target.value);
                setSearchMode(true);
              }}
            >
              <option value="">{logSource === "switch" ? "All buildings" : "All controllers"}</option>
              {(logSource === "switch" ? buildingOptions : controllerOptions).map((option) => (
                <option value={option} key={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="history-filter-field">
            <span>Date Range</span>
            <div className="history-date-range">
              <input
                type="datetime-local"
                value={logFrom}
                onChange={(event) => {
                  setLogFrom(event.target.value);
                  setSearchMode(true);
                }}
              />
              <span>–</span>
              <input
                type="datetime-local"
                value={logTo}
                onChange={(event) => {
                  setLogTo(event.target.value);
                  setSearchMode(true);
                }}
              />
            </div>
          </label>

          <button className="btn btn-quiet" type="button" onClick={clearHistoryFilters}>
            Clear
          </button>

          <div className="history-toolbar-actions">
            <button className="btn btn-quiet" type="button" onClick={exportLogsCsv} disabled={filteredLogs.length === 0}>
              Export
            </button>
            <button
              className="icon-btn history-refresh"
              type="button"
              onClick={() => void refresh()}
              title="Refresh"
              aria-label="Refresh"
            >
              ⟳
            </button>
          </div>
        </div>

        <div className="history-status-pills">
          <button
            className={clsx("status-pill-btn", selectedStatus === "all" && "active")}
            type="button"
            onClick={() => void applyStatusFilter("all")}
          >
            All Status <span className="count">({sourceTotals.total})</span>
          </button>
          <button
            className={clsx("status-pill-btn", "online", selectedStatus === "online" && "active")}
            type="button"
            onClick={() => void applyStatusFilter("online")}
          >
            <span className="pill-dot online" /> Online <span className="count">({sourceTotals.online})</span>
          </button>
          <button
            className={clsx("status-pill-btn", "offline", selectedStatus === "offline" && "active")}
            type="button"
            onClick={() => void applyStatusFilter("offline")}
          >
            <span className="pill-dot offline" /> Offline <span className="count">({sourceTotals.offline})</span>
          </button>
        </div>

        {isLogLoading ? <p className="helper-text">Loading data…</p> : null}

        {searchMode ? (
          <>
            <div className="history-table">
              <div className="history-row history-head">
                <span>No</span>
                <span>Device / {logSource === "switch" ? "Switch" : "AP"}</span>
                <span>{logSource === "switch" ? "Building" : "Controller"}</span>
                <span>IP Address</span>
                <span>Status</span>
                <span>Since{selectedStatus !== "all" ? ` (${selectedStatus === "online" ? "Online" : "Offline"})` : ""}</span>
                <span>Duration</span>
                <span>Latency</span>
                <span>Action</span>
              </div>

              {pagedLogs.length === 0 ? (
                <div className="history-row empty-table">
                  <span>No Data Found.</span>
                </div>
              ) : (
                pagedLogs.map((item, index) => {
                  const isIncident = Boolean(item.incident_status);
                  const isOngoing = item.incident_status === "ongoing";
                  const durationSeconds = !isIncident
                    ? null
                    : isOngoing && item.started_at
                      ? (Date.now() - parseSqliteTimestamp(item.started_at).getTime()) / 1000
                      : (item.duration_seconds ?? 0);
                  const rowNumber = (currentLogPage - 1) * LOG_PAGE_SIZE + index + 1;

                  return (
                    <div className={clsx("history-row", `status-${item.status}`, isOngoing && "ongoing")} key={item.id}>
                      <span className="history-no">{rowNumber}</span>
                      <span className="history-device">
                        <SignalBars status={item.status} />
                        <span className="history-device-text">
                          <span className="history-device-name">{item.name}</span>
                          {item.model && item.model !== "-" ? (
                            <span className="history-device-model">{item.model}</span>
                          ) : null}
                        </span>
                      </span>
                      <span>{item.controller}</span>
                      <span className="mono">{item.host}</span>
                      <span>
                        <span className={clsx("table-status", item.status, isOngoing && "ongoing")}>
                          {item.status}
                          {isOngoing ? " · ongoing" : ""}
                        </span>
                      </span>
                      <span className="history-since">
                        {isIncident ? (
                          <>
                            <span className="mono">{formatTimestamp(item.started_at ?? item.checked_at)}</span>
                            <span className="history-since-ago">
                              ({formatRelative(item.started_at ?? item.checked_at)})
                            </span>
                          </>
                        ) : (
                          <span className="mono">{formatTimestamp(item.checked_at)}</span>
                        )}
                      </span>
                      <span className="mono">{isIncident ? formatDuration(durationSeconds ?? 0) : "-"}</span>
                      <span className="mono">{item.latency_ms === null ? "-" : `${item.latency_ms} ms`}</span>
                      <span>
                        <button
                          className="btn btn-quiet history-view-btn"
                          type="button"
                          onClick={() => showLogDetail(item)}
                        >
                          View
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {filteredLogs.length > 0 ? (
              <div className="pagination">
                <span className="helper-text">
                  {filteredLogs.length} result{filteredLogs.length === 1 ? "" : "s"} • page {currentLogPage} of{" "}
                  {logPageCount}
                </span>
                <div className="pagination-controls">
                  <button
                    className="btn btn-quiet"
                    type="button"
                    disabled={currentLogPage <= 1}
                    onClick={() => setLogPage((page) => Math.max(1, page - 1))}
                  >
                    Prev
                  </button>
                  <div className="page-jump">
                    <span>Page</span>
                    <input
                      type="number"
                      min={1}
                      max={logPageCount}
                      value={pageInputValue}
                      onChange={(event) => setPageInputValue(event.target.value)}
                      onBlur={commitPageJump}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitPageJump();
                        }
                      }}
                    />
                    <span>of {logPageCount}</span>
                  </div>
                  <button
                    className="btn btn-quiet"
                    type="button"
                    disabled={currentLogPage >= logPageCount}
                    onClick={() => setLogPage((page) => Math.min(logPageCount, page + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p className="empty-state">Please do a search or select a status.</p>
        )}

        {error ? <p className="error-banner">{error}</p> : null}
      </section>

      {isImportModalOpen ? (
        <OverlayShell title="Import" description="Import AP list from CSV" onClose={closeImportModal}>
          <form className="form" onSubmit={importCsv}>
            <label>
              CSV file
              <input name="csvFile" accept=".csv,text/csv" type="file" />
            </label>
            <p className="helper-text">
              Expected headers: <span className="mono">controller, nama ap, model ap, mac, ipaddress</span>. Kolom{" "}
              <span className="mono">switch</span> opsional — isi dengan nama switch yang sudah terdaftar untuk
              menghubungkan AP ke switch tersebut.
            </p>
            <div className="form-actions">
              <button className="btn btn-primary" disabled={isImporting} type="submit">
                {isImporting ? "Importing…" : "Import CSV"}
              </button>
              <button className="btn btn-quiet" type="button" onClick={closeImportModal}>
                Cancel
              </button>
            </div>
          </form>
        </OverlayShell>
      ) : null}

      {isSwitchImportModalOpen ? (
        <OverlayShell title="Import" description="Import daftar switch dari CSV" onClose={closeSwitchImportModal}>
          <form className="form" onSubmit={importSwitchesCsv}>
            <label>
              CSV file
              <input name="switchCsvFile" accept=".csv,text/csv" type="file" />
            </label>
            <p className="helper-text">
              Expected headers: <span className="mono">gedung, nama switch, ipaddress</span>.
            </p>
            <div className="form-actions">
              <button className="btn btn-primary" disabled={isSwitchImporting} type="submit">
                {isSwitchImporting ? "Importing…" : "Import CSV"}
              </button>
              <button className="btn btn-quiet" type="button" onClick={closeSwitchImportModal}>
                Cancel
              </button>
            </div>
          </form>
        </OverlayShell>
      ) : null}

      {isApModalOpen ? (
        <OverlayShell
          title={editingId === null ? "New AP" : "Edit AP"}
          description={editingId === null ? "Add an access point" : "Update access point"}
          onClose={cancelEdit}
        >
          <form className="form manual-form" onSubmit={handleSubmit}>
            <div className="manual-grid">
              <label>
                Controller
                <input
                  value={form.controller}
                  onChange={(event) => setForm((current) => ({ ...current, controller: event.target.value }))}
                  placeholder="Controller-1"
                  required
                />
              </label>
              <label>
                Switch
                <select
                  value={form.switchId}
                  onChange={(event) => setForm((current) => ({ ...current, switchId: event.target.value }))}
                >
                  <option value="">No switch</option>
                  {groupedSwitches.map((group) => (
                    <optgroup label={group.building} key={group.building}>
                      {group.items.map((sw) => (
                        <option value={sw.id} key={sw.id}>
                          {sw.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label>
                AP name
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="AP Lobby"
                  required
                />
              </label>
              <label>
                AP model
                <input
                  value={form.model}
                  onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                  placeholder="U6-Lite"
                  required
                />
              </label>
              <label>
                MAC address
                <input
                  value={form.mac}
                  onChange={(event) => setForm((current) => ({ ...current, mac: event.target.value }))}
                  placeholder="AA:BB:CC:DD:EE:FF"
                  required
                />
              </label>
              <label>
                IP address
                <input
                  value={form.host}
                  onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))}
                  placeholder="10.109.x.x"
                  required
                />
              </label>
            </div>

            <div className="form-actions">
              <button className="btn btn-primary" disabled={isPending} type="submit">
                {editingId === null ? "Save AP" : "Update AP"}
              </button>
              <button className="btn btn-quiet" type="button" onClick={cancelEdit}>
                Cancel
              </button>
            </div>
          </form>
        </OverlayShell>
      ) : null}

      {isSwitchModalOpen ? (
        <OverlayShell
          title={editingSwitchId === null ? "New Switch" : "Edit Switch"}
          description={editingSwitchId === null ? "Add a switch" : "Update switch"}
          onClose={cancelEditSwitch}
        >
          <form className="form manual-form" onSubmit={handleSwitchSubmit}>
            <div className="manual-grid">
              <label>
                Building
                <input
                  value={switchForm.building}
                  onChange={(event) => setSwitchForm((current) => ({ ...current, building: event.target.value }))}
                  placeholder="PK"
                  required
                />
              </label>
              <label>
                Switch name
                <input
                  value={switchForm.name}
                  onChange={(event) => setSwitchForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="PK-LAN-IT"
                  required
                />
              </label>
              <label>
                IP address
                <input
                  value={switchForm.host}
                  onChange={(event) => setSwitchForm((current) => ({ ...current, host: event.target.value }))}
                  placeholder="10.109.5.20"
                  required
                />
              </label>
            </div>

            <div className="form-actions">
              <button className="btn btn-primary" disabled={isPending} type="submit">
                {editingSwitchId === null ? "Save Switch" : "Update Switch"}
              </button>
              <button className="btn btn-quiet" type="button" onClick={cancelEditSwitch}>
                Cancel
              </button>
            </div>
          </form>
        </OverlayShell>
      ) : null}
    </main>
  );
}