import "dotenv/config";
import { app } from "./app.js";
import { autoCloseExpired, notifyAutomaticallyPublishedMatches, remindMissingPredictions, remindNextNightMissingPredictions } from "./services/matches.js";
import { startWorldCupReferenceSync } from "./services/worldcupReference.js";
import { saveRankingSnapshot, scheduleDailyRankingSnapshot } from "./services/notifications.js";

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3001);
app.listen(port, host, () => console.log(`Aplicación disponible en http://${host}:${port}`));
const processMatchDeadlines = () => {
  notifyAutomaticallyPublishedMatches();
  remindNextNightMissingPredictions();
  remindMissingPredictions();
  autoCloseExpired();
};
setInterval(processMatchDeadlines, 30000).unref();
processMatchDeadlines();
saveRankingSnapshot();
scheduleDailyRankingSnapshot();
startWorldCupReferenceSync();
