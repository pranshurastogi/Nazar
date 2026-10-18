import { defineRailway, project, service, volume } from "railway/iac";

// Nazar backend on Railway, as code. `railway config plan` diffs it against the live project;
// `railway config apply` enforces it.
//
// REGION MUST STAY SINGAPORE (asia-southeast1-eqsg3a). From Railway's US regions CDSCO
// (cdsco.gov.in, cdscoonline.gov.in) refuses every connection, so the pipeline would quietly
// lose all national alerts. The volume is pinned to the same region because volumes cannot move
// with a replica. The server also checks this at startup and reports it on /health
// (see src/pipeline/egress.ts).
//
// Variables are deliberately unmanaged: secrets such as NAZAR_PUBLISHER_PRIVATE_KEY live only
// in Railway, never in this file.

export default defineRailway(() => {
  const nazarApiVolume = volume("nazar-api-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "asia-southeast1-eqsg3a", sizeMB: 5000 });
  const nazarApi = service("nazar-api", {
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    healthcheck: "/health",
    healthcheckTimeout: 120,
    // One replica only: one publisher wallet means one writer (entity keys are nonce-predicted).
    replicas: { "asia-southeast1-eqsg3a": 1 },
    volumeMounts: { "/app/data": nazarApiVolume },
  });

  return project("nazar-api", {
    variables: { managed: false },
    resources: [nazarApi, nazarApiVolume],
  });
});
