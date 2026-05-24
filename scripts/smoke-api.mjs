const baseUrl = new URL(process.argv[2] ?? process.env.API_PUBLIC_URL ?? "http://localhost:4000");

const checks = [
  { path: "/health", expectedStatus: 200 },
  { path: "/ready", expectedStatus: 200 }
];

for (const check of checks) {
  const url = new URL(check.path, baseUrl);
  const startedAt = Date.now();
  const response = await fetch(url, {
    headers: {
      "user-agent": "altrion-smoke-check/1.0"
    }
  });
  const elapsedMs = Date.now() - startedAt;
  const body = await response.text();

  if (response.status !== check.expectedStatus) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          url: url.toString(),
          status: response.status,
          expectedStatus: check.expectedStatus,
          elapsedMs,
          body: body.slice(0, 500)
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      ok: true,
      url: url.toString(),
      status: response.status,
      elapsedMs
    })
  );
}
