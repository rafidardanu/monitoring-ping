"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type CSSProperties,
  type FormEvent,
  type ReactNode
} from "react";
import clsx from "clsx";
import type { ApLogRecord, ApStatusSummary } from "@/types";

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
  logs: ApLogRecord[];
};

type FormState = {
  controller: string;
  name: string;
  model: string;
  mac: string;
  host: string;
};

type ControllerGroup = {
  controller: string;
  items: ApStatusSummary[];
};

// Riwayat status filter — "all" shows every status, same as no filter applied.
type StatusFilter = "all" | "online" | "offline";

const initialForm = { controller: "", name: "", model: "", mac: "", host: "" };

const LOG_PAGE_SIZE = 20;

// One accent per WLC/controller, cycled by sort order — keeps groups visually distinct
// without depending on the controller's name or id.
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

/** Signature element: a signal-strength readout standing in for the usual dot/badge —
 *  it echoes the subject (wireless access points) instead of a generic status chip. */
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
    logs: []
  });
  const [form, setForm] = useState<FormState>(initialForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isApModalOpen, setIsApModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [logController, setLogController] = useState("");
  const [logName, setLogName] = useState("");
  const [logIp, setLogIp] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>("all");
  const [isLogLoading, setIsLogLoading] = useState(false);
  const [logPage, setLogPage] = useState(1);
  const [pageInputValue, setPageInputValue] = useState("1");
  const [openControllers, setOpenControllers] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [isImporting, setIsImporting] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const refresh = async (overrides?: { searchModeOverride?: boolean }) => {
    const params = new URLSearchParams();
    const effectiveSearchMode = overrides?.searchModeOverride ?? searchMode;

    if (effectiveSearchMode) {
      params.set("search", "1");

      if (logFrom) {
        params.set("from", logFrom);
      }

      if (logTo) {
        params.set("to", logTo);
      }

      if (logController.trim()) {
        params.set("controller", logController.trim());
      }

      if (logName.trim()) {
        params.set("name", logName.trim());
      }

      if (logIp.trim()) {
        params.set("host", logIp.trim());
      }
    }

    const response = await fetchJson<ApiResponse<DashboardData>>(
      params.toString() ? `/api/dashboard?${params.toString()}` : "/api/dashboard"
    );
    setData(response.data);
  };

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

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message));
    const timer = window.setInterval(() => {
      void refresh().catch((err: Error) => setError(err.message));
    }, data.monitoring.dashboardRefreshSeconds * 1000);

    return () => window.clearInterval(timer);
  }, [data.monitoring.dashboardRefreshSeconds, logController, logFrom, logIp, logName, logTo, searchMode]);

  useEffect(() => {
    setLogPage(1);
  }, [logController, logFrom, logIp, logName, logTo, searchMode, selectedStatus]);

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

  const controllerOptions = useMemo(
    () => groupedControllers.map((group) => group.controller),
    [groupedControllers]
  );

  const filteredLogs = useMemo(() => {
    if (!searchMode) {
      return [];
    }

    const fromTime = logFrom ? new Date(logFrom).getTime() : null;
    const toTime = logTo ? new Date(logTo).getTime() : null;
    const controllerQuery = logController.trim().toLowerCase();
    const nameQuery = logName.trim().toLowerCase();
    const ipQuery = logIp.trim().toLowerCase();

    const matched = data.logs.filter((item) => {
      const itemTime = parseSqliteTimestamp(item.checked_at).getTime();
      const matchesController = controllerQuery
        ? item.controller.toLowerCase() === controllerQuery
        : true;
      const matchesName = nameQuery ? item.name.toLowerCase().includes(nameQuery) : true;
      const matchesIp = ipQuery ? item.host.toLowerCase().includes(ipQuery) : true;
      const matchesStatus = selectedStatus === "all" ? true : item.status === selectedStatus;

      return (
        matchesController &&
        matchesName &&
        matchesIp &&
        matchesStatus &&
        (fromTime === null || itemTime >= fromTime) &&
        (toTime === null || itemTime <= toTime)
      );
    });

    return [...matched].sort(
      (a, b) => parseSqliteTimestamp(b.checked_at).getTime() - parseSqliteTimestamp(a.checked_at).getTime()
    );
  }, [data.logs, logController, logFrom, logIp, logName, logTo, searchMode, selectedStatus]);

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
    setSearchMode(true);
    setLogPage(1);
    setIsLogLoading(true);
    try {
      await refresh({ searchModeOverride: true });
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
        if (editingId === null) {
          await fetchJson("/api/aps", {
            method: "POST",
            body: JSON.stringify(form)
          });
        } else {
          await fetchJson(`/api/aps/${editingId}`, {
            method: "PATCH",
            body: JSON.stringify(form)
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
      host: item.host
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
            <h1>Cisco &amp; Unify Monitoring</h1>
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
          <div className="toolbar-divider" />
          <button className="btn btn-ghost" type="button" onClick={openCreateApModal}>
            + Add AP
          </button>
          <button className="btn" type="button" onClick={openImportModal}>
            Import CSV
          </button>
          <div className="toolbar-divider" />
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
            <h2>Access points by controller</h2>
          </div>
          <div className="status-strip">
            <span className="status-chip">{groupedControllers.length} WLC</span>
            <span className="status-chip">{totals.total} AP</span>
          </div>
        </div>

        <div className="group-list">
          {groupedControllers.length === 0 ? (
            <p className="empty-state">No APs yet — add one or import a CSV to get started.</p>
          ) : (
            groupedControllers.map((group, index) => {
              const accent = wlcAccent(index);
              const isOpen = openControllers.has(group.controller);
              const onlineCount = paused
                ? 0
                : group.items.filter((item) => item.status === "online").length;
              const offlineCount = paused
                ? 0
                : group.items.filter((item) => item.status === "offline").length;
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
                        <div
                          className={clsx("ap-row", item.enabled !== 1 && "disabled")}
                          key={item.id}
                        >
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
                            <button
                              className="icon-btn danger"
                              type="button"
                              onClick={() => void removeAp(item.id)}
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

      <section className="panel block">
        <div className="block-head">
          <div>
            <p className="section-label">History</p>
            <h2>Latest ping results</h2>
          </div>
          <div className="log-filters">
            <button className="btn btn-quiet" type="button" onClick={() => setSearchMode((current) => !current)}>
              {searchMode ? "Search: on" : "Search"}
            </button>
            {searchMode ? (
              <>
                <label>
                  From
                  <input
                    type="datetime-local"
                    value={logFrom}
                    onChange={(event) => setLogFrom(event.target.value)}
                  />
                </label>
                <label>
                  To
                  <input type="datetime-local" value={logTo} onChange={(event) => setLogTo(event.target.value)} />
                </label>
                <label>
                  Controller
                  <select value={logController} onChange={(event) => setLogController(event.target.value)}>
                    <option value="">All controllers</option>
                    {controllerOptions.map((controller) => (
                      <option value={controller} key={controller}>
                        {controller}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  AP name
                  <input value={logName} onChange={(event) => setLogName(event.target.value)} placeholder="AP Lobby" />
                </label>
                <label>
                  IP address
                  <input value={logIp} onChange={(event) => setLogIp(event.target.value)} placeholder="10.109.x.x" />
                </label>
                <button
                  className="btn btn-quiet"
                  type="button"
                  onClick={() => {
                    setLogFrom("");
                    setLogTo("");
                    setLogController("");
                    setLogName("");
                    setLogIp("");
                    setSelectedStatus("all");
                    setSearchMode(false);
                  }}
                >
                  Clear
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="log-filters status-filter-row">
          <button
            className={clsx("btn", selectedStatus === "all" ? "btn-primary" : "btn-quiet")}
            type="button"
            onClick={() => void applyStatusFilter("all")}
            aria-pressed={selectedStatus === "all"}
          >
            All Status
          </button>
          <button
            className={clsx("btn", selectedStatus === "online" ? "btn-primary" : "btn-quiet")}
            type="button"
            onClick={() => void applyStatusFilter("online")}
            aria-pressed={selectedStatus === "online"}
          >
            Online
          </button>
          <button
            className={clsx("btn", selectedStatus === "offline" ? "btn-primary" : "btn-quiet")}
            type="button"
            onClick={() => void applyStatusFilter("offline")}
            aria-pressed={selectedStatus === "offline"}
          >
            Offline
          </button>
        </div>

        {isLogLoading ? <p className="helper-text">Loading data…</p> : null}

        {searchMode ? (
          <>
            <div className="table">
              <div className="table-row table-head">
                <span>Date / time</span>
                <span>Controller</span>
                <span>AP</span>
                <span>IP</span>
                <span>Status</span>
                <span>Latency</span>
              </div>
              {pagedLogs.length === 0 ? (
                <div className="table-row empty-table">
                  <span>No Data Found. </span>
                </div>
              ) : (
                pagedLogs.map((item) => (
                  <div className="table-row" key={item.id}>
                    <span className="mono">{formatTimestamp(item.checked_at)}</span>
                    <span>{item.controller}</span>
                    <span>{item.name}</span>
                    <span className="mono">{item.host}</span>
                    <span className={clsx("table-status", item.status)}>{item.status}</span>
                    <span className="mono">{item.latency_ms === null ? "-" : `${item.latency_ms} ms`}</span>
                  </div>
                ))
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
              Expected headers: <span className="mono">controller, nama ap, model ap, mac, ipaddress</span>.
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
    </main>
  );
}