const baseUrl = `http://${process.env.HOSTING_EMULATOR_HOST ?? "127.0.0.1:5500"}`;
const nestedRoutes = [
  "/host/new",
  "/room/AB12CD34/lobby",
  "/room/AB12CD34/host",
  "/room/AB12CD34/play",
  "/room/AB12CD34/display",
];

for (const route of nestedRoutes) {
  const response = await fetch(`${baseUrl}${route}`, { redirect: "error" });
  if (!response.ok)
    throw new Error(`Hosting deep link ${route} returned ${response.status}.`);
  const document = await response.text();
  if (!document.includes('id="root"'))
    throw new Error(`Hosting deep link ${route} did not serve the app shell.`);
}

console.log(`Verified ${nestedRoutes.length} Firebase Hosting SPA deep links.`);
