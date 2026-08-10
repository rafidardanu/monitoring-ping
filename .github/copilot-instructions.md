# Monitoring AP Dashboard

- Use Next.js App Router with TypeScript.
- Store monitoring history in SQLite under `data/monitoring.db`.
- Keep ping logic on the server side only.
- Run the worker every 1 minute and log every check result.
- Prefer small, focused components and keep the dashboard simple.
- AP data is imported from CSV and grouped by controller.