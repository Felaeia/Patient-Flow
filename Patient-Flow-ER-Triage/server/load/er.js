import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";
import exec from "k6/execution";

const base = (__ENV.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "") + "/api/v1";
const tokens = { admin: __ENV.ADMIN_TOKEN, registration: __ENV.REGISTRATION_TOKEN, clinical: __ENV.CLINICAL_TOKEN };
const profile = __ENV.PROFILE || "smoke";
const workload = __ENV.WORKLOAD || "mixed";
const profiles = {
  smoke: { executor: "constant-vus", vus: 1, duration: "10s" },
  baseline: { executor: "constant-vus", vus: 10, duration: "2m" },
  peak: { executor: "constant-vus", vus: 30, duration: "3m" },
  stress: { executor: "ramping-vus", startVUs: 1, stages: [{ duration: "1m", target: 25 }, { duration: "2m", target: 75 }, { duration: "1m", target: 0 }] },
  soak: { executor: "constant-vus", vus: 10, duration: "30m" },
};
if (!profiles[profile]) throw new Error("Unknown PROFILE");
if (!["mixed", "dashboard", "search", "registration", "triage", "bay", "inventory"].includes(workload)) throw new Error("Unknown WORKLOAD");
const scenario = { ...profiles[profile] };
if (scenario.executor === "constant-vus") {
  scenario.vus = Number(__ENV.VUS || scenario.vus);
  scenario.duration = __ENV.DURATION || scenario.duration;
} else if (__ENV.VUS || __ENV.DURATION) {
  const target = Number(__ENV.VUS || 75);
  scenario.stages = [
    { duration: __ENV.DURATION || "1m", target: Math.max(1, Math.floor(target / 3)) },
    { duration: __ENV.DURATION || "2m", target },
    { duration: __ENV.DURATION || "1m", target: 0 },
  ];
}
const writes = new Counter("completed_workflows");
const integrityFailures = new Counter("integrity_failures");
export const options = {
  scenarios: { er: scenario },
  setupTimeout: "2m",
  summaryTrendStats: ["avg", "med", "p(50)", "p(95)", "p(99)", "max"],
  thresholds: {
    http_req_failed: [`rate<${__ENV.FAILURE_RATE || 0.01}`],
    checks: ["rate==1"],
    integrity_failures: ["count==0"],
    ...(["mixed", "dashboard", "search"].includes(workload) && { "http_req_duration{operation:read}": [`p(95)<${__ENV.READ_P95_MS || 500}`] }),
    ...(!["dashboard", "search"].includes(workload) && { "http_req_duration{operation:write}": [`p(95)<${__ENV.WRITE_P95_MS || 1000}`] }),
  },
};

function params(role, operation, name, status) {
  return {
    headers: { Authorization: "Bearer " + tokens[role], "Content-Type": "application/json" },
    tags: { operation, name }, responseCallback: http.expectedStatuses(...status),
  };
}
function request(method, path, role, body, name, status = method === "POST" ? [201] : [200]) {
  const response = http.request(method, base + path, body ? JSON.stringify(body) : null,
    params(role, method === "GET" ? "read" : "write", name, status));
  if (!check(response, { [name + " returned expected status"]: (r) => status.includes(r.status) })) fail(name + " failed with HTTP " + response.status);
  return response.json("data");
}
function requireOutcome(condition, label) {
  if (!check(condition, { [label]: (value) => value === true })) {
    integrityFailures.add(1);
    fail(label);
  }
}
function register(code) {
  const result = request("POST", "/patients", "registration",
    { patient_code: code, first_name: "Synthetic", last_name: "Test", sex: "U", chief_complaint: "Synthetic intake" }, "registration");
  requireOutcome(!!result?.patient?.id && result.encounter?.status === "triage", "registration returned patient and intake encounter");
  return result.encounter.id;
}
function triage(id) {
  const result = request("POST", "/encounters/" + id + "/triage", "clinical", { esi: 3 }, "triage");
  requireOutcome(result?.esi === 3, "triage persisted ESI");
}
function bay(code) {
  return request("POST", "/treatment-bays", "admin", {
    code, name: "Synthetic bay", type: "General", location: "Load test", operational_status: "Active", readiness: "Available",
  }, "create bay").id;
}
function stock(code, capacity) {
  return request("POST", "/resources", "admin", {
    code, name: "Synthetic stock", category: "Load test", kind: "Consumable",
    quantity_total: capacity, quantity_available: capacity, unit: "each", location: "Load test", status: "Available",
  }, "create resource").id;
}
function assignmentPath(id) { return "/encounters/" + id + "/bay-assignment"; }
function inventoryPath(id) { return "/resources/" + id + "/adjustments"; }
function discharge(id) {
  const result = request("POST", "/encounters/" + id + "/discharge", "clinical", {}, "discharge", [200]);
  requireOutcome(result?.status === "discharged", "discharge persisted");
}
export function setup() {
  if (__ENV.ALLOW_SYNTHETIC_WRITES !== "yes") fail("Set ALLOW_SYNTHETIC_WRITES=yes for an isolated load-test database");
  if (Object.values(tokens).some((token) => !token)) fail("Set ADMIN_TOKEN, REGISTRATION_TOKEN and CLINICAL_TOKEN");
  integrityFailures.add(0);
  const run = "K6-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
  const code = run + "-fixture";
  const fixture = register(code);
  const details = request("GET", "/encounters/" + fixture, "clinical", null, "verify registration");
  const queues = request("GET", "/queues?search=" + fixture, "clinical", null, "verify queue");
  requireOutcome(details?.status === "triage" && queues.rows.some((row) => row.encounter_id === fixture && row.status === "triage"), "registration persisted queue");
  const bayId = bay(run + "-race");
  const competing = [run + "-A", run + "-B"].map(register);
  competing.forEach(triage);
  const allocations = http.batch(competing.map((id) => ({
    method: "POST", url: base + assignmentPath(id), body: JSON.stringify({ bay_id: bayId }),
    params: params("clinical", "write", "bay race", [201, 409]),
  })));
  requireOutcome(allocations.filter((r) => r.status === 201).length === 1 && allocations.filter((r) => r.status === 409).length === 1, "exactly one bay assignment committed");
  const visits = competing.map((id) => request("GET", "/encounters/" + id, "clinical", null, "verify allocation"));
  requireOutcome(visits.filter((visit) => visit.status === "treatment").length === 1 &&
    visits.filter((visit) => visit.status === "waiting").length === 1, "losing encounter remains waiting");
  discharge(visits.find((visit) => visit.status === "treatment").id);
  const released = request("GET", "/treatment-bays?search=" + run + "-race", "clinical", null, "verify bay release");
  requireOutcome(released.rows[0]?.status === "available", "winning assignment released its bay");

  const raceStock = stock(run + "-race", 1);
  const adjustments = http.batch(Array.from({ length: 6 }, () => ({
    method: "POST", url: base + inventoryPath(raceStock), body: JSON.stringify({ delta: -1, reason: "Synthetic contention" }),
    params: params("admin", "write", "inventory race", [200, 409]),
  })));
  requireOutcome(adjustments.filter((r) => r.status === 200).length === 1 && adjustments.filter((r) => r.status === 409).length === 5,
    "exactly one inventory adjustment committed");
  const inventory = request("GET", "/resources/" + raceStock, "admin", null, "verify inventory");
  requireOutcome(inventory.quantity_available === 0, "stock exhausted without underflow");

  const count = scenario.vus || Math.max(...scenario.stages.map((stage) => stage.target));
  const bays = ["mixed", "bay"].includes(workload) ? Array.from({ length: count }, (_, i) => bay(run + "-bay-" + i)) : [];
  const resource = ["mixed", "inventory"].includes(workload) ? stock(run + "-stock", count) : null;
  return { run, code, bays, resource, capacity: count };
}

export default function (data) {
  const code = data.run + "-vu-" + exec.vu.idInTest + "-" + exec.vu.iterationInScenario;
  const dashboard = () => request("GET", "/dashboard", "clinical", null, "dashboard");
  const search = () => {
    const result = request("GET", "/patients?search=" + data.code, "registration", null, "patient search");
    requireOutcome(result.rows.some((row) => row.patient_code === data.code), "patient search found fixture");
  };
  const allocate = (id) => {
    const bayId = data.bays[exec.vu.idInTest - 1];
    const assignment = request("POST", assignmentPath(id), "clinical", { bay_id: bayId }, "bay assignment");
    requireOutcome(assignment?.encounter_id === id && assignment?.bay_id === bayId, "bay assignment linked to encounter");
    discharge(id);
  };
  const adjust = () => {
    const path = inventoryPath(data.resource);
    const reserved = request("POST", path, "admin", { delta: -1, reason: "Synthetic use" }, "inventory", [200]);
    requireOutcome(reserved.quantity_available >= 0 && reserved.quantity_available < data.capacity, "inventory reservation in bounds");
    request("POST", path, "admin", { delta: 1, reason: "Synthetic return" }, "inventory", [200]);
  };

  if (workload === "dashboard") dashboard();
  else if (workload === "search") search();
  else if (workload === "inventory") adjust();
  else if (workload === "mixed") {
    dashboard(); search();
    if (exec.vu.iterationInScenario === 0 || Math.random() < 0.3) {
      const id = register(code); triage(id); allocate(id); adjust(); writes.add(1);
    }
  } else {
    const id = register(code);
    if (workload !== "registration") triage(id);
    if (workload === "bay") allocate(id);
    writes.add(1);
  }
  sleep(Number(__ENV.THINK_TIME || 1));
}

export function teardown(data) {
  if (data.resource) {
    const resource = request("GET", "/resources/" + data.resource, "admin", null, "verify final inventory");
    requireOutcome(resource.quantity_available === data.capacity, "all stock reservations returned");
  }
  for (const id of data.bays) {
    const result = request("GET", "/treatment-bays?search=" + data.run + "-bay-&pageSize=50&page=" +
      (Math.floor(data.bays.indexOf(id) / 50) + 1) + "&sort=asc", "clinical", null, "verify final bay");
    requireOutcome(result.rows.find((row) => row.id === id)?.status === "available", "all treatment bays released");
  }
}
