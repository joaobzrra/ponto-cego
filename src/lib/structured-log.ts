type LogLevel = "info" | "warn" | "error";

export function structuredLog(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
