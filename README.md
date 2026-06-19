# La Porra Mundial

Aplicación web local para organizar una porra privada del Mundial. Incluye autenticación, pronósticos, cierre automático, clasificación, histórico diario y administración auditada.

## Requisitos

- Node.js 20 o superior
- npm

No requiere servicios externos. La API crea automáticamente `backend/data/worldcup-porra.sqlite`.

## Instalación y ejecución

```bash
npm install
npm run install:all
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3001
- Administrador inicial: `administrador`
- Contraseña: `yami`

Los usuarios de prueba `lucia`, `marcos` y `sara` solo se crean al ejecutar los tests o si se configura expresamente `SEED_DEMO_DATA=true`.

Para ejecutar cada parte por separado:

```bash
npm run dev --prefix backend
npm run dev --prefix frontend
```

Pruebas y compilación:

```bash
npm test
npm run build
```

## Variables de entorno

Copia `.env.example` como `.env` y ajusta:

- `HOST`: interfaz de escucha. Por defecto `0.0.0.0`.
- `PORT`: puerto del servidor único. Por defecto `3001`.
- `NODE_ENV=production`: hace que Express sirva `frontend/dist`.
- `SESSION_SECRET`: secreto privado para firmar sesiones.
- `ALLOWED_ORIGINS`: lista de orígenes permitidos separada por comas.
- `COOKIE_SECURE=true`: obliga a enviar la cookie solo mediante HTTPS.
- `DB_PATH`: ruta opcional de SQLite.
- `SEED_DEMO_DATA`: crea usuarios de demostración únicamente cuando vale `true`.
- `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`: identidad y claves para Web Push. Se generan una sola vez con `npx web-push generate-vapid-keys` dentro de `backend`.

En producción, `npm start` compila React y arranca Express. Tanto la web como `/api` quedan disponibles en el mismo puerto.

## Cloudflare Tunnel

La aplicación confía en un único proxy inverso, interpreta `X-Forwarded-For` y prioriza `CF-Connecting-IP`. Las cookies son HTTP-only, `SameSite=Lax` y pueden marcarse `Secure`, por lo que funcionan con el HTTPS terminado por Cloudflare.

### Prueba rápida

1. Configura `.env` con `NODE_ENV=production`, `COOKIE_SECURE=true` y un `SESSION_SECRET` nuevo.
2. Añade la URL pública a `ALLOWED_ORIGINS`. Para un Quick Tunnel aleatorio puedes arrancar primero con la URL local y reiniciar cuando conozcas el subdominio.
3. Arranca la aplicación:

```bash
npm start
```

4. En otra terminal, expón el puerto:

```bash
cloudflared tunnel --url http://localhost:3001
```

Cloudflare imprimirá una URL HTTPS aleatoria bajo `trycloudflare.com`. Los Quick Tunnels están pensados para pruebas y desarrollo, no ofrecen SLA y tienen límites de concurrencia.

### Túnel estable

Para uso continuado, crea un túnel administrado desde Cloudflare Zero Trust, asigna un hostname público y configura su servicio de origen como:

```text
http://localhost:3001
```

Después establece, por ejemplo:

```dotenv
ALLOWED_ORIGINS=https://porra.tudominio.com
COOKIE_SECURE=true
NODE_ENV=production
```

No es necesario instalar certificados en Express: Cloudflare proporciona HTTPS públicamente y conecta con el origen local a través del túnel.

## Uso

Tras entrar como administrador, abre **Gestión**:

- **Partidos**: crea y edita encuentros, cierra apuestas, reabre partidos, introduce resultados o elimina encuentros.
- **Usuarios**: crea participantes, cambia contraseñas y roles, activa o desactiva cuentas.
- **Ajustes**: suma o resta puntos indicando siempre un motivo.
- **Recálculo**: recalcula todos los resultados o un partido concreto.
- **Configuración**: cambia el nombre, los puntos de ganador, exacto y goleador, y el margen de cierre automático.
- **Actividad**: consulta y filtra la auditoría administrativa.

El administrador inicial no se puede desactivar ni eliminar accidentalmente.

## Pronósticos y puntuación

Mientras un partido esté abierto, cada usuario puede elegir ganador o empate, escribir un marcador exacto y, cuando esté habilitado, seleccionar un posible goleador entre las plantillas de ambos equipos. El ganador elegido debe coincidir con el marcador pronosticado.

- Ganador o empate acertado: 3 puntos.
- Marcador exacto: 5 puntos.
- Goleador acertado: 2 puntos.
- Las tres puntuaciones se acumulan: máximo automático predeterminado de 10 puntos.
- En un pronóstico 0-0 se selecciona **Sin goleador**, automáticamente o de forma manual.
- En partidos con goles y regla de goleador activa, elegir goleador es obligatorio.
- Un **Partido Estrella** multiplica por dos todos los puntos automáticos, incluidos los de goleador.
- Los ajustes manuales se suman aparte.

Al finalizar un partido se calculan los puntos. Editar su resultado o sus goleadores vuelve a calcularlos. Las tres reglas de puntuación se pueden modificar desde Configuración; después conviene ejecutar un recálculo global.

## Catálogo del Mundial

El backend importa los equipos, plantillas y estadios desde `backend/data/catalog`. Los partidos vinculados al catálogo permiten:

- buscar equipos y estadios al crearlos;
- limitar el goleador pronosticado a jugadores de los dos equipos;
- consultar la ficha, estadísticas y plantilla de una selección;
- registrar uno o varios goleadores reales, sin duplicados; en 0-0 el goleador real es **Sin goleador**.

Los autogoles no se incluyen como goleadores puntuables.

## Bloqueo automático

Cada partido guarda `auto_close_at`. El backend comprueba los vencimientos:

- en cada petición autenticada;
- cada 30 segundos mientras el servidor está activo;
- mediante `POST /api/admin/auto-close-expired-matches`.

En Configuración se puede desactivar el cierre automático o indicar cuántos minutos antes del inicio deben bloquearse las apuestas. La validación siempre ocurre en el backend. Un cierre automático queda registrado con `auto_close_match`.

`close_reason` es una ampliación deliberada del modelo solicitado: permite distinguir visualmente cierres manuales y automáticos sin inferirlo del historial.

## Visibilidad e histórico

Antes del cierre solo se muestra el número de participantes. Después del cierre se revelan usuario, ganador y marcador; al finalizar también aparecen sus puntos.

**Histórico** agrupa encuentros por día. Cada jornada incluye el pronóstico propio, puntos obtenidos, apuestas reveladas y una clasificación diaria con aciertos de ganador y exactos.

## Notificaciones internas

La campana de la cabecera muestra avisos privados del usuario. Se generan automáticamente por:

- cierre manual o automático de partido;
- publicación o edición de un resultado;
- puntos obtenidos en un partido;
- entrada en el top 3 tras un resultado o ajuste;
- ajuste manual de puntos.

Las notificaciones se pueden abrir individualmente o marcar todas como leídas.

## Tablas

- `users`: credenciales locales, rol y estado.
- `matches`: calendario, equipos, estado, resultado y cierre.
- `predictions`: un pronóstico único por usuario y partido.
- `points_adjustments`: ajustes manuales con autor y motivo.
- `admin_actions_log`: auditoría con datos anteriores y posteriores.
- `app_settings`: nombre, puntuación y reglas de cierre.
- `sessions`: sesiones persistentes locales. Esta tabla adicional evita perder la sesión al reiniciar procesos breves.
- `notifications`: avisos internos por usuario, tipo, entidad, enlace y estado de lectura.
- `teams`, `players` y `stadiums`: catálogo del torneo.
- `match_scorers`: goleadores puntuables registrados para cada partido.

Las fechas se guardan en ISO. `match_date` usa `YYYY-MM-DD`, `match_time` usa `HH:mm` y `auto_close_at` representa un instante completo.

## Endpoints principales

### Autenticación

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Partidos y predicciones

- `GET|POST /api/matches`
- `PUT|DELETE /api/matches/:id`
- `PATCH /api/matches/:id/status`
- `POST /api/matches/:id/finish`
- `GET|PUT /api/matches/:id/scorers`
- `GET /api/predictions/me`
- `GET /api/predictions/match/:matchId`
- `POST /api/predictions`
- `PUT /api/predictions/:id`
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `POST /api/notifications/read-all`
- `GET /api/teams`
- `GET /api/teams/:id/detail`
- `GET /api/players`
- `GET /api/stadiums`

### Consultas

- `GET /api/leaderboard`
- `GET /api/history/days`
- `GET /api/history/day/:date`
- `GET /api/history/day/:date/summary`

### Administración

- `GET|POST /api/users`
- `PUT /api/users/:id`
- `PATCH /api/users/:id/active`
- `DELETE /api/users/:id`
- `POST /api/admin/recalculate`
- `POST /api/admin/recalculate/:matchId`
- `GET|POST /api/admin/points-adjustments`
- `GET /api/admin/actions-log`
- `POST /api/admin/auto-close-expired-matches`
- `GET|PUT /api/admin/settings`

## Seguridad local

Las contraseñas se guardan sin cifrar por requisito del prototipo. La aplicación no debe publicarse en Internet con este esquema. Las sesiones usan cookies HTTP-only y se almacenan en SQLite.
