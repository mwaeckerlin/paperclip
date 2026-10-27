// HEALTHCHECK of the image: healthy once Paperclip reports "ok" on /api/health,
// which it does when its start, migrations and recovery are done. The request
// goes to the root, which the image serves with and without a base path.
const port = process.env.PORT || "3100";
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(10000) });
  const health = await response.json();
  if (response.ok && health.status === "ok") process.exit(0);
  console.error(`paperclip health: status ${response.status}, ${JSON.stringify(health.status)}`);
} catch (error) {
  console.error(`paperclip health: ${error.message}`);
}
process.exit(1);
