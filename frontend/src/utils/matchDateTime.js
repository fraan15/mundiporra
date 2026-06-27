const SOURCE_TIME_ZONE = "Europe/Madrid";

export const countryTimeZone = (countryCode) =>
  countryCode === "GB" ? "Europe/London" : SOURCE_TIME_ZONE;

const sourceFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SOURCE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const madridDateTimeToDate = (date, time = "00:00") => {
  const [year, month, day] = String(date).split("-").map(Number);
  const [hour, minute, second = 0] = String(time).split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = target;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(
      sourceFormatter
        .formatToParts(new Date(instant))
        .map(({ type, value }) => [type, value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    instant += target - represented;
  }

  return new Date(instant);
};

export const localMatchParts = (match, countryCode = "ES") => {
  if (!match?.match_date || !match?.match_time) {
    return { date: match?.match_date || "", time: match?.match_time || "" };
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: countryTimeZone(countryCode),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(madridDateTimeToDate(match.match_date, match.match_time))
      .map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
};

export const localMatchDate = (match, countryCode = "ES") =>
  localMatchParts(match, countryCode).date;

export const localMatchTime = (match, countryCode = "ES") =>
  localMatchParts(match, countryCode).time;

