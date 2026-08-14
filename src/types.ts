export type ApRecord = {
  id: number;
  controller: string;
  name: string;
  model: string;
  mac: string;
  host: string;
  enabled: number;
  switch_id: number | null;
  current_status: "online" | "offline" | null;
  created_at: string;
  updated_at: string;
};

export type ApStatusSummary = {
  id: number;
  controller: string;
  name: string;
  model: string;
  mac: string;
  host: string;
  enabled: number;
  status: "online" | "offline" | "unknown";
  latencyMs: number | null;
  checkedAt: string | null;
  message: string | null;
  switchId: number | null;
  switchName: string | null;
  switchStatus: "online" | "offline" | "unknown" | null;
};

export type ApLogRecord = {
  id: number;
  ap_id: number;
  controller: string;
  name: string;
  model: string;
  mac: string;
  host: string;
  status: "online" | "offline";
  latency_ms: number | null;
  message: string | null;
  checked_at: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  incident_status: "ongoing" | "resolved" | null;
};

export type SwitchRecord = {
  id: number;
  building: string;
  name: string;
  host: string;
  enabled: number;
  current_status: "online" | "offline" | null;
  created_at: string;
  updated_at: string;
};

export type SwitchStatusSummary = {
  id: number;
  building: string;
  name: string;
  host: string;
  enabled: number;
  status: "online" | "offline" | "unknown";
  latencyMs: number | null;
  checkedAt: string | null;
  message: string | null;
};