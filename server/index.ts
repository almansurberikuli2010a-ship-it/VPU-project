import { createApp } from "./app.js";
import { config } from "./config.js";
const server = createApp().listen(config.PORT, "0.0.0.0", () => {
  console.log(`Visual Campus server listening on port ${config.PORT}`);
  if (!config.GEMINI_API_KEY || !config.SERPER_API_KEY)
    console.log("Search disabled until both server API keys are configured.");
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
