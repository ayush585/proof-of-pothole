const HEADERS = ["id", "severity", "lat", "lng", "score", "area_px", "depth_cm", "createdAt"];

export function exportCSV(records) {
  if (!records.length) {
    return;
  }

  const lines = [HEADERS.join(",")];
  for (const record of records) {
    const row = HEADERS.map((key) => resolveValue(record, key));
    lines.push(row.join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "potholes.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function resolveValue(record, key) {
  const hasPayload = record && record.payload;
  if (!hasPayload) {
    return formatValue(record[key]);
  }

  const payload = record.payload;
  switch (key) {
    case "severity":
      return formatValue(payload.severity);
    case "lat":
      return formatValue(payload.lat);
    case "lng":
      return formatValue(payload.lng);
    case "score":
      return formatValue(payload.score);
    case "area_px":
      return formatValue(payload.area_px);
    case "depth_cm":
      return formatValue(payload.depth_cm);
    case "createdAt": {
      const ts = payload.ts || record.createdAt || record.createdAtISO;
      if (!ts) return "";
      if (typeof ts === "number") {
        return formatValue(new Date(ts).toISOString());
      }
      return formatValue(ts);
    }
    default:
      return formatValue(record[key]);
  }
}

function formatValue(value) {
  if (value == null) return "";
  if (typeof value === "number") return value.toString();
  const escaped = String(value).replace(/"/g, '""');
  return `"${escaped}"`;
}
