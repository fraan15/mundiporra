import "dotenv/config";
import { app } from "./app.js";
import { autoCloseExpired } from "./services/matches.js";

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3001);
app.listen(port, host, () => console.log(`Aplicación disponible en http://${host}:${port}`));
setInterval(autoCloseExpired, 30000).unref();
