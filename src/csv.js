const HEADERS = ["id", "severity", "lat", "lng", "score", "area_px", "depth_cm", "createdAt"];

export function exportCSV(records) {
  if (!records.length) {
    return;
  }

  const lines = [HEADERS.join(",")];
  for (const record of records) {
    const row = HEADERS.map((key) => {
      const value = record[key];
      if (value == null) return "";
      if (typeof value === "number") return value.toString();
      return `"${String(value).replace(/"/g, '""')}"`;
    });
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
