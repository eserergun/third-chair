// Deployment JSON source for the browser build.
// Choice: import.meta.glob (eager) instead of a static import, so the build and tsc still pass
// before deployments/testnet.json exists. VITE_DEPLOYMENT (build time) may name another file in
// deployments/ (for example "testnet-test.json"); VITE_DEPLOYMENT_JSON may hold the JSON itself.
// Outside Vite (Node, tsx) import.meta.glob does not exist and this module yields null:
// Node scripts read the file from disk and call parseDeployment.

let files: Record<string, unknown> = {};
try {
  files = import.meta.glob("../../deployments/testnet*.json", { eager: true, import: "default" });
} catch {
  files = {};
}

function env(name: string): string | undefined {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name];
    return v && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

export function rawDeployment(): unknown | null {
  const inline = env("VITE_DEPLOYMENT_JSON");
  if (inline) {
    try {
      return JSON.parse(inline);
    } catch {
      return null;
    }
  }
  const wanted = env("VITE_DEPLOYMENT");
  const pick = wanted ? wanted.split("/").pop() : "testnet.json";
  for (const [path, json] of Object.entries(files)) {
    if (path.endsWith(`/${pick}`)) return json;
  }
  return null;
}
