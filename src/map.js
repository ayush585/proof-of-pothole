let map;
let layerGroup;

const SEVERITY_COLORS = {
  MINOR: "#22c55e",
  MODERATE: "#f59e0b",
  CRITICAL: "#ef4444",
};

export function initMap({ lat = 22.5726, lng = 88.3639, zoom = 13 } = {}) {
  if (map) {
    return map;
  }

  map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
  }).setView([lat, lng], zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  layerGroup = L.layerGroup().addTo(map);
  return map;
}

export function addPin({ lat, lng, severity, when }) {
  if (!map || !layerGroup) return;
  const color = SEVERITY_COLORS[severity] || SEVERITY_COLORS.MINOR;
  L.circleMarker([lat, lng], {
    radius: 9,
    color,
    weight: 3,
    opacity: 0.9,
    fillOpacity: 0.45,
  }).addTo(layerGroup)
    .bindPopup(`${severity} - ${new Date(when).toLocaleString()}`);
}

export function flyTo(lat, lng, zoom = 16) {
  if (!map) return;
  map.flyTo([lat, lng], zoom, { duration: 0.8 });
}
