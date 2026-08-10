export type ApRecord = {
  id: number;
  controller: string;
  name: string;
  model: string;
  mac: string;
  host: string;
  enabled: number;
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
};