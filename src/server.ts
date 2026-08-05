import "dotenv/config";
import app from "./app";
import { startTeamsNotificationWorker } from "./modules/teams-notifications";

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

const stopTeamsWorker = startTeamsNotificationWorker();
const shutdown = () => {
  stopTeamsWorker();
  server.close(() => process.exit(0));
};

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
