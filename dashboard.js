// Global variables
let map, allFeatures, markerClusterGroup;
let selectedCategories = [];
let allMarkers = [];
let allCategoryCounts = {};
let categoryLayers = {}; // Store individual markers by category
let boundaryLayers = {}; // Store boundary layers by administrative level
let loadedBoundaries = {}; // Cache loaded boundary data
let originalFeatures = []; // Store original features for reset
let viewportMarkers = new Set(); // Track markers currently in viewport
let currentViewportBounds = null; // Current map viewport bounds
let spatialIndex = null; // Spatial index for efficient boundary filtering
let isLoadingComplete = false; // Track if all data has been loaded
let loadingInProgress = false; // Prevent concurrent loading requests
let currentZoomLevel = 12; // Track current zoom level for LOD
let selectedBoundary = null; // Store currently selected boundary feature for filtering
let selectedBoundaryLayer = null; // Store the Leaflet layer of selected boundary
let radiusCircle = null; // Circle overlay for radius analysis
let radiusCenterMarker = null; // Draggable marker for radius center
const radiusAnalysisConfig = {
  center: {
    lat: 35.5613,
    lng: 45.4373,
  },
  radiusMeters: 1500,
  minRadiusMeters: 500,
  maxRadiusMeters: 5000,
  stepMeters: 100,
  label: "Slemani Bazar (35.5613, 45.4373)",
};
let radiusAnalysisResults = {
  total: 0,
  categories: [],
};

// Simple spatial index using a grid-based approach
class SpatialIndex {
  constructor(cellSize = 0.01) {
    // ~1km at equator
    this.cellSize = cellSize;
    this.grid = new Map();
    this.bounds = null;
  }

  // Convert coordinates to grid cell key
  getCellKey(lng, lat) {
    const x = Math.floor(lng / this.cellSize);
    const y = Math.floor(lat / this.cellSize);
    return `${x},${y}`;
  }

  // Insert feature into spatial index
  insert(feature) {
    const coords = feature.geometry.coordinates;
    const lng = coords[0];
    const lat = coords[1];
    const key = this.getCellKey(lng, lat);

    if (!this.grid.has(key)) {
      this.grid.set(key, []);
    }
    this.grid.get(key).push(feature);

    // Update bounds
    if (!this.bounds) {
      this.bounds = { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat };
    } else {
      this.bounds.minLng = Math.min(this.bounds.minLng, lng);
      this.bounds.maxLng = Math.max(this.bounds.maxLng, lng);
      this.bounds.minLat = Math.min(this.bounds.minLat, lat);
      this.bounds.maxLat = Math.max(this.bounds.maxLat, lat);
    }
  }

  // Get features within a bounding box
  queryBounds(minLng, maxLng, minLat, maxLat) {
    const features = [];
    const minX = Math.floor(minLng / this.cellSize);
    const maxX = Math.floor(maxLng / this.cellSize);
    const minY = Math.floor(minLat / this.cellSize);
    const maxY = Math.floor(maxLat / this.cellSize);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = `${x},${y}`;
        if (this.grid.has(key)) {
          features.push(...this.grid.get(key));
        }
      }
    }

    return features;
  }

  // Build spatial index from features array
  build(features) {
    this.grid.clear();
    this.bounds = null;

    features.forEach((feature) => this.insert(feature));

    console.log(
      `Built spatial index with ${this.grid.size} cells containing ${features.length} features`
    );
    return this;
  }
}

// Initialize the map centered on Iraq to show all three cities
function initializeMap() {
  injectCustomClusterStyles();
  map = L.map("map", {
    attributionControl: false,
  }).setView([34.0, 44.0], 6); // Centered on Iraq to show all three cities

  // Add OpenStreetMap tiles
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "",
  }).addTo(map);

  // Initialize marker cluster group for better performance
  try {
    markerClusterGroup = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 80,
      spiderfyOnMaxZoom: false,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 18,
      animate: true,
      animateAddingMarkers: false, // Disable for better performance
      iconCreateFunction: function (cluster) {
        const count = cluster.getChildCount();
        const size = count < 100 ? "small" : count < 500 ? "medium" : "large";
        const iconHtml = `
          <div class="cluster-icon ${size}">
            <span>${count}</span>
          </div>
        `;
        return L.divIcon({
          html: iconHtml,
          className: "custom-marker-cluster",
          iconSize: null,
        });
      },
    });
    console.log("✅ Marker cluster initialized successfully");
  } catch (error) {
    console.error("❌ Error initializing marker cluster:", error);
    markerClusterGroup = null;
  }

  // Add cluster group to map (if available)
  if (markerClusterGroup) {
    map.addLayer(markerClusterGroup);
  }

  // Add viewport optimization and LOD event listeners
  map.on("moveend zoomend", function () {
    const newZoom = map.getZoom();
    if (Math.abs(newZoom - currentZoomLevel) > 0.5) {
      currentZoomLevel = newZoom;
      console.log(
        `Zoom level changed to ${currentZoomLevel}, updating LOD settings`
      );

      // Update clustering settings based on new zoom level
      const clusteringSettings = getClusteringSettings(currentZoomLevel);
      if (markerClusterGroup) {
        markerClusterGroup.options.maxClusterRadius =
          clusteringSettings.maxClusterRadius;
        markerClusterGroup.options.disableClusteringAtZoom =
          clusteringSettings.disableClusteringAtZoom;
      }
    }

    // Use setTimeout to avoid excessive updates during rapid movements
    clearTimeout(map._viewportUpdateTimer);
    map._viewportUpdateTimer = setTimeout(function () {
      updateViewportMarkers();
    }, 150);
  });
}

// Function to inject custom CSS for cluster markers
function injectCustomClusterStyles() {
  const style = document.createElement("style");
  style.innerHTML = `
    .custom-marker-cluster {
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .cluster-icon {
      border-radius: 50%;
      color: white;
      font-weight: bold;
      display: flex;
      justify-content: center;
      align-items: center;
      transition: all 0.3s ease;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      border: 2px solid rgba(255, 255, 255, 0.8);
    }
    .cluster-icon.small {
      width: 30px;
      height: 30px;
      font-size: 12px;
      background: #27ae60;
    }
    .cluster-icon.medium {
      width: 40px;
      height: 40px;
      font-size: 14px;
      background: #f39c12;
    }
    .cluster-icon.large {
      width: 55px;
      height: 55px;
      font-size: 16px;
      background: #e74c3c;
    }
    .cluster-icon:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
    }
  `;
  document.head.appendChild(style);
}

// Point-in-polygon algorithm using ray casting
function pointInPolygon(point, polygon) {
  const x = point[0],
    y = point[1];
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0],
      yi = polygon[i][1];
    const xj = polygon[j][0],
      yj = polygon[j][1];

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

// Check if a marker is within the current map viewport
function isMarkerInViewport(marker, padding = 0.1) {
  if (!currentViewportBounds) return true;

  const markerBounds = marker.getBounds
    ? marker.getBounds()
    : L.latLngBounds([marker.getLatLng()], [marker.getLatLng()]);
  return currentViewportBounds.pad(padding).intersects(markerBounds);
}

// Update markers based on current viewport
function updateViewportMarkers() {
  if (!markerClusterGroup) return;

  const mapBounds = map.getBounds();
  const paddedBounds = mapBounds.pad(0.1); // Add some padding
  currentViewportBounds = mapBounds;

  // For performance, only update viewport markers on zoom changes or when bounds change significantly
  const shouldUpdate =
    !currentViewportBounds || !currentViewportBounds.equals(mapBounds, 0.001);

  if (!shouldUpdate) return;

  console.log(
    "Updating viewport markers for bounds:",
    mapBounds.toBBoxString()
  );
}
function isPointInGeometry(point, geometry) {
  if (geometry.type === "Polygon") {
    return pointInPolygon(point, geometry.coordinates[0]);
  } else if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) =>
      pointInPolygon(point, polygon[0])
    );
  }
  return false;
}


// Get bounds of a GeoJSON geometry
function getGeometryBounds(geometry) {
  if (geometry.type === "Polygon") {
    const coords = geometry.coordinates[0];
    let minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;

    coords.forEach(([lng, lat]) => {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    });

    return { minLng, maxLng, minLat, maxLat };
  } else if (geometry.type === "MultiPolygon") {
    let minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;

    geometry.coordinates.forEach((polygon) => {
      polygon[0].forEach(([lng, lat]) => {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      });
    });

    return { minLng, maxLng, minLat, maxLat };
  }

  return null;
}


// Function to create custom popup content
function createPopupContent(feature) {
  const props = feature.properties;
  const name = props.names?.primary || "Unknown Location";
  const category = props.categories?.primary || "Unknown Category";
  const phone = props.phones?.[0] || "No phone";
  const address =
    props.addresses?.[0]?.freeform ||
    props.addresses?.[0]?.locality ||
    "No address";
  const confidence = (props.confidence * 100).toFixed(1);
  const city = props.city || "Unknown City";

  return `
          <div class="custom-popup">
              <div class="popup-title">${name}</div>
              <div class="popup-category">${category.replace(/_/g, " ")}</div>
              <div class="popup-details">
                  <p><strong>City:</strong> ${city}</p>
                  <p><strong>Phone:</strong> ${phone}</p>
                  <p><strong>Address:</strong> ${address}</p>
                  <p><strong>Confidence:</strong> ${confidence}%</p>
              </div>
          </div>
      `;
}

// Function to get marker color based on category
function getMarkerColor(category) {
  const colors = {
    industrial_company: "#e74c3c",
    retail: "#3498db",
    professional_services: "#2ecc71",
    construction_services: "#f39c12",
    automotive_repair: "#9b59b6",
    real_estate: "#1abc9c",
    health_and_medical: "#e67e22",
    college_university: "#34495e",
    airport: "#e91e63",
    default: "#2c3e50", // Professional dark blue-gray
  };
  return colors[category] || colors.default;
}

// Get marker properties based on zoom level (Level of Detail)
function getMarkerLODProperties(category, zoomLevel) {
  const baseColor = getMarkerColor(category);

  // Very low zoom - show simple dots
  return {
    radius: 6,
    fillColor: baseColor,
    color: "#fff",
    opacity: 1,
    fillOpacity: 0.8,
  };
}

// Get clustering settings based on zoom level
function getClusteringSettings(zoomLevel) {
  if (zoomLevel < 10) {
    return {
      maxClusterRadius: 120,
      disableClusteringAtZoom: 18,
    };
  } else if (zoomLevel < 13) {
    return {
      maxClusterRadius: 80,
      disableClusteringAtZoom: 19,
    };
  } else {
    return {
      maxClusterRadius: 60,
      disableClusteringAtZoom: 20,
    };
  }
}


// Helper to convert category keys to a readable label
function formatCategoryLabel(categoryKey) {
  if (!categoryKey || categoryKey === "unknown") {
    return "Unknown";
  }

  return categoryKey
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDistanceLabel(meters) {
  if (!Number.isFinite(meters)) {
    return "0 m";
  }

  if (meters >= 1000) {
    const kilometers = meters / 1000;
    const decimals = kilometers >= 10 ? 0 : 1;
    return `${kilometers.toFixed(decimals)} km`;
  }

  return `${Math.round(meters)} m`;
}

function formatLatLng(latLng) {
  if (!latLng) {
    return "";
  }
  const lat = Number(latLng.lat || latLng[0] || 0).toFixed(4);
  const lng = Number(latLng.lng || latLng[1] || 0).toFixed(4);
  return `Lat ${lat}, Lng ${lng}`;
}

function updateRadiusPanelDetails() {
  const radiusLabel = document.getElementById("radius-distance-label");
  if (radiusLabel) {
    radiusLabel.textContent = formatDistanceLabel(
      radiusAnalysisConfig.radiusMeters
    );
  }

  const centerLabel = document.getElementById("radius-panel-center");
  if (centerLabel) {
    centerLabel.textContent =
      radiusAnalysisConfig.label ||
      formatLatLng(radiusAnalysisConfig.center);
  }

  const slider = document.getElementById("radius-range");
  if (slider) {
    const value = Number(slider.value);
    if (value !== radiusAnalysisConfig.radiusMeters) {
      slider.value = radiusAnalysisConfig.radiusMeters;
    }
  }
}

function setRadiusMeters(newRadius, { runAnalysis = true } = {}) {
  let radiusValue = Number(newRadius);
  if (!Number.isFinite(radiusValue)) {
    radiusValue = radiusAnalysisConfig.radiusMeters;
  }

  radiusValue = Math.max(
    radiusAnalysisConfig.minRadiusMeters,
    Math.min(radiusValue, radiusAnalysisConfig.maxRadiusMeters)
  );

  radiusAnalysisConfig.radiusMeters = radiusValue;

  if (radiusCircle) {
    radiusCircle.setRadius(radiusValue);
  }

  updateRadiusPanelDetails();

  if (runAnalysis) {
    updateRadiusAnalysis();
  }
}

function updateRadiusCenter(latLng, { updateLabel = true, runAnalysis = true } = {}) {
  if (!latLng) {
    return;
  }

  radiusAnalysisConfig.center = {
    lat: latLng.lat,
    lng: latLng.lng,
  };

  if (updateLabel) {
    radiusAnalysisConfig.label = formatLatLng(latLng);
  }

  if (radiusCircle) {
    radiusCircle.setLatLng(latLng);
  }

  if (radiusCenterMarker) {
    radiusCenterMarker.setLatLng(latLng);
  }

  updateRadiusPanelDetails();

  if (runAnalysis) {
    updateRadiusAnalysis();
  }
}

function focusRadiusArea(paddingFactor = 0.35) {
  if (!map || !radiusCircle) {
    return;
  }

  try {
    const bounds = radiusCircle.getBounds();
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds.pad(paddingFactor));
    } else {
      const center = radiusCircle.getLatLng();
      if (center) {
        map.setView(center, Math.max(map.getZoom(), 14));
      }
    }
  } catch (error) {
    console.warn("Could not focus radius area:", error);
  }
}

function setupRadiusSlider() {
  const slider = document.getElementById("radius-range");
  if (!slider) {
    return;
  }

  slider.min = radiusAnalysisConfig.minRadiusMeters;
  slider.max = radiusAnalysisConfig.maxRadiusMeters;
  slider.step = radiusAnalysisConfig.stepMeters || 100;
  slider.value = radiusAnalysisConfig.radiusMeters;

  slider.addEventListener("input", (event) => {
    setRadiusMeters(Number(event.target.value));
  });
}

// Get all features that fall within a specific radius of a center point
function getFeaturesWithinRadius(features, centerLatLng, radiusMeters) {
  if (!Array.isArray(features) || !centerLatLng) {
    return [];
  }

  return features.filter((feature) => {
    if (!feature?.geometry || feature.geometry.type !== "Point") {
      return false;
    }

    const [lng, lat] = feature.geometry.coordinates;
    const pointLatLng = L.latLng(lat, lng);

    return centerLatLng.distanceTo(pointLatLng) <= radiusMeters;
  });
}

// Calculate top categories for a set of features
function calculateRadiusTopCategories(features, limit = 5) {
  const categoryCounts = {};

  features.forEach((feature) => {
    const categoryKey = feature.properties?.categories?.primary || "unknown";
    categoryCounts[categoryKey] = (categoryCounts[categoryKey] || 0) + 1;
  });

  return Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([categoryKey, count]) => ({
      key: categoryKey,
      label: formatCategoryLabel(categoryKey),
      count,
    }));
}

// Update the panel UI with the latest radius analysis data
function renderRadiusPanelContent(results) {
  const countElement = document.getElementById("radius-location-count");
  const listElement = document.getElementById("radius-top-categories");

  if (!countElement || !listElement) {
    return;
  }

  const total = results?.total ?? 0;
  const categories = results?.categories ?? [];

  countElement.textContent = total.toLocaleString();
  listElement.innerHTML = "";

  if (!categories.length) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = total === 0 ? "No locations within radius" : "No category data";
    listElement.appendChild(emptyItem);
    return;
  }

  categories.forEach((category) => {
    const item = document.createElement("li");
    const labelSpan = document.createElement("span");
    const countSpan = document.createElement("span");

    labelSpan.textContent = category.label;
    countSpan.textContent = category.count.toLocaleString();

    item.appendChild(labelSpan);
    item.appendChild(countSpan);
    listElement.appendChild(item);
  });
}

// Recalculate radius analysis results using the full dataset
function updateRadiusAnalysis() {
  if (!map || !allFeatures || !allFeatures.length) {
    radiusAnalysisResults = {
      total: 0,
      categories: [],
    };
    renderRadiusPanelContent(radiusAnalysisResults);
    return;
  }

  const centerLatLng = L.latLng(
    radiusAnalysisConfig.center.lat,
    radiusAnalysisConfig.center.lng
  );

  const featuresInRadius = getFeaturesWithinRadius(
    allFeatures,
    centerLatLng,
    radiusAnalysisConfig.radiusMeters
  );

  radiusAnalysisResults = {
    total: featuresInRadius.length,
    categories: calculateRadiusTopCategories(featuresInRadius),
  };

  renderRadiusPanelContent(radiusAnalysisResults);
}

// Toggle the visibility of the radius analysis panel
function toggleRadiusPanel(forceOpen = null) {
  const panel = document.getElementById("radius-panel");
  if (!panel) {
    return;
  }

  const isHidden = panel.classList.contains("hidden");
  const shouldOpen = forceOpen === null ? isHidden : forceOpen;

  if (shouldOpen) {
    panel.classList.remove("hidden");
    updateRadiusPanelDetails();
    updateRadiusAnalysis();
    if (radiusCircle && typeof radiusCircle.bringToFront === 'function') {
      radiusCircle.bringToFront();
    }
    if (radiusCenterMarker && typeof radiusCenterMarker.bringToFront === 'function') {
      radiusCenterMarker.bringToFront();
    }
  } else {
    panel.classList.add("hidden");
  }
}

window.toggleRadiusPanel = toggleRadiusPanel;

// Create the map circle used to visualise the radius analysis
function initializeRadiusAnalysis() {
  if (!map) {
    return;
  }

  const centerLatLng = L.latLng(
    radiusAnalysisConfig.center.lat,
    radiusAnalysisConfig.center.lng
  );

  if (radiusCircle) {
    map.removeLayer(radiusCircle);
  }

  if (radiusCenterMarker) {
    map.removeLayer(radiusCenterMarker);
  }

  radiusCircle = L.circle(centerLatLng, {
    radius: radiusAnalysisConfig.radiusMeters,
    color: "#0f9d84",
    weight: 3,
    opacity: 0.9,
    dashArray: "6 12",
    fillColor: "#1abc9c",
    fillOpacity: 0.05,
    bubblingMouseEvents: false,
    className: "radius-circle-outline",
  });

  radiusCircle.addTo(map);
  radiusCircle.on("click", () => {
    toggleRadiusPanel(true);
    focusRadiusArea();
  });
  radiusCircle.bringToBack();

  const radiusMarkerIcon = L.divIcon({
    className: "radius-marker-icon",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: '<div class="radius-marker-core"></div>',
  });

  radiusCenterMarker = L.marker(centerLatLng, {
    draggable: true,
    icon: radiusMarkerIcon,
  });

  radiusCenterMarker.addTo(map);
  
  // Use setTimeout to ensure marker is fully initialized before calling bringToFront
  setTimeout(() => {
    if (radiusCenterMarker && typeof radiusCenterMarker.bringToFront === 'function') {
      try {
        radiusCenterMarker.bringToFront();
      } catch (e) {
        console.warn("Could not bring radius marker to front:", e);
      }
    }
  }, 100);

  radiusCenterMarker.on("drag", (event) => {
    const newLatLng = event.target.getLatLng();
    if (radiusCircle) {
      radiusCircle.setLatLng(newLatLng);
    }
  });

  radiusCenterMarker.on("dragend", (event) => {
    updateRadiusCenter(event.target.getLatLng());
  });

  radiusCenterMarker.on("click", () => {
    toggleRadiusPanel(true);
    focusRadiusArea();
  });

  updateRadiusCenter(centerLatLng, { updateLabel: false, runAnalysis: false });
  setRadiusMeters(radiusAnalysisConfig.radiusMeters);
}


// Function to get boundary styling
function getBoundaryStyle(level) {
  const styles = {
    adm0: {
      color: "#2c3e50",
      weight: 3,
      opacity: 0.8,
      fillColor: "#3498db",
      fillOpacity: 0.1,
    },
    adm1: {
      color: "#e74c3c",
      weight: 2,
      opacity: 0.7,
      fillColor: "#e74c3c",
      fillOpacity: 0.1,
    },
    adm2: {
      color: "#f39c12",
      weight: 1.5,
      opacity: 0.6,
      fillColor: "#f39c12",
      fillOpacity: 0.08,
    },
    adm3: {
      color: "#9b59b6",
      weight: 1,
      opacity: 0.5,
      fillColor: "#9b59b6",
      fillOpacity: 0.06,
    },
  };
  return styles[level] || styles.adm1;
}

// Function to get boundary hover styling
function getBoundaryHoverStyle(level) {
  const hoverStyles = {
    adm0: {
      color: "#2c3e50",
      weight: 4,
      opacity: 1,
      fillColor: "#3498db",
      fillOpacity: 0.3,
    },
    adm1: {
      color: "#e74c3c",
      weight: 3,
      opacity: 1,
      fillColor: "#e74c3c",
      fillOpacity: 0.3,
    },
    adm2: {
      color: "#f39c12",
      weight: 2.5,
      opacity: 1,
      fillColor: "#f39c12",
      fillOpacity: 0.25,
    },
    adm3: {
      color: "#9b59b6",
      weight: 2,
      opacity: 1,
      fillColor: "#9b59b6",
      fillOpacity: 0.2,
    },
  };
  return hoverStyles[level] || hoverStyles.adm1;
}


// Function to create boundary popup content
function createBoundaryPopupContent(feature, level) {
  const props = feature.properties;
  let title, nameEn, nameAr, code;

  switch (level) {
    case "adm0":
      title = "Country";
      nameEn = props.ADM0_EN || "Unknown";
      nameAr = props.ADM0_AR || "";
      code = props.ADM0_PCODE || "";
      break;
    case "adm1":
      title = "Governorate";
      nameEn = props.ADM1_EN || "Unknown";
      nameAr = props.ADM1_AR || "";
      code = props.ADM1_PCODE || "";
      break;
    case "adm2":
      title = "District";
      nameEn = props.ADM2_EN || "Unknown";
      nameAr = props.ADM2_AR || "";
      code = props.ADM2_PCODE || "";
      break;
    case "adm3":
      title = "Sub-district";
      nameEn = props.ADM3_EN || "Unknown";
      nameAr = props.ADM3_AR || "";
      code = props.ADM3_PCODE || "";
      break;
  }

  return `
    <div class="custom-popup">
      <div class="popup-title">${title}</div>
      <div class="popup-details">
        <p><strong>Name (EN):</strong> ${nameEn}</p>
        ${nameAr ? `<p><strong>Name (AR):</strong> ${nameAr}</p>` : ""}
        ${code ? `<p><strong>Code:</strong> ${code}</p>` : ""}
        <p><strong>Area:</strong> ${(props.Shape_Area || 0).toFixed(2)} km²</p>
        <p><strong>Level:</strong> ${title}</p>
      </div>
    </div>
  `;
}

// Function to create markers with clustering and viewport optimization for better performance
function createMarkers(features) {
  console.log("Creating markers for", features.length, "features");
  allMarkers = [];

  // Clear existing markers and category layers
  if (markerClusterGroup) {
    markerClusterGroup.clearLayers();
  }
  Object.values(categoryLayers).forEach((markers) => {
    markers.forEach((marker) => {
      map.removeLayer(marker);
    });
  });
  categoryLayers = {};

  // For performance, limit initial marker creation to viewport area
  const mapBounds = map.getBounds();
  const center = map.getCenter();
  const maxDistance =
    Math.max(
      mapBounds.getNorth() - mapBounds.getSouth(),
      mapBounds.getEast() - mapBounds.getWest()
    ) * 111000; // Convert degrees to meters (approximate)

  const viewportFeatures = features.filter((feature) => {
    const coords = feature.geometry.coordinates;
    const point = L.latLng(coords[1], coords[0]);
    const distance = center.distanceTo(point);
    return distance <= maxDistance * 1.5; // Show markers within 1.5x viewport distance
  });

  console.log(
    `Showing ${viewportFeatures.length} of ${features.length} features in current viewport`
  );

  // Group viewport features by category
  const featuresByCategory = {};
  viewportFeatures.forEach((feature) => {
    const category = feature.properties.categories?.primary || "unknown";
    if (!featuresByCategory[category]) {
      featuresByCategory[category] = [];
    }
    featuresByCategory[category].push(feature);
  });

  // Create markers for each category using clustering
  Object.entries(featuresByCategory).forEach(([category, categoryFeatures]) => {
    console.log(
      `Creating clustered markers for ${category}:`,
      categoryFeatures.length,
      "features"
    );

    // Create markers for this category
    const categoryMarkers = [];
    categoryFeatures.forEach((feature) => {
      const coords = feature.geometry.coordinates;

      // Get LOD properties based on current zoom level
      const lodProperties = getMarkerLODProperties(category, currentZoomLevel);

      // Create custom marker with LOD properties
      const marker = L.circleMarker([coords[1], coords[0]], lodProperties);

      // Add popup
      marker.bindPopup(createPopupContent(feature));

      // Store reference to feature and category
      marker.featureCategory = category;
      marker.featureData = feature;

      // Add to category markers and all markers
      categoryMarkers.push(marker);
      allMarkers.push(marker);
    });

    // Store category markers
    categoryLayers[category] = categoryMarkers;

    // Add markers to cluster group or directly to map
    if (markerClusterGroup) {
      markerClusterGroup.addLayers(categoryMarkers);
      console.log(
        `Added ${categoryMarkers.length} markers for ${category} to cluster group`
      );
    } else {
      // Add markers directly to map if clustering is not available
      categoryMarkers.forEach((marker) => {
        marker.addTo(map);
      });
      console.log(
        `Added ${categoryMarkers.length} individual markers for ${category} to map`
      );
    }
  });
}

// Function to toggle category selection
function toggleCategoryFilter(category) {
  const index = selectedCategories.indexOf(category);
  if (index > -1) {
    // Remove category from selection
    selectedCategories.splice(index, 1);
  } else {
    // Add category to selection
    selectedCategories.push(category);
  }

  // Update map
  updateMapAndChart();
}

// Function to filter features by boundary geometry
function filterFeaturesByBoundary(features, boundaryFeature) {
  if (!boundaryFeature || !boundaryFeature.geometry) {
    return features;
  }

  const geometry = boundaryFeature.geometry;
  const filtered = features.filter((feature) => {
    // Check if feature is a point
    if (feature.geometry.type === "Point") {
      const point = feature.geometry.coordinates;
      return isPointInGeometry(point, geometry);
    }
    return false;
  });

  console.log(`Boundary filter: ${filtered.length} of ${features.length} features within boundary`);
  return filtered;
}

// Function to update map markers based on selected categories
function updateMapAndChart() {
  let filteredCount = 0;
  let currentFeatures = [];

  // Start with original features
  let filteredFeatures = [...originalFeatures];

  // Apply boundary filtering if a boundary is selected
  if (selectedBoundary) {
    filteredFeatures = filterFeaturesByBoundary(filteredFeatures, selectedBoundary);
  }

  // Apply category filtering to the filtered features
  const categoryFilteredFeatures = filteredFeatures.filter((feature) => {
    const category = feature.properties.categories?.primary || "unknown";
    return (
      selectedCategories.length === 0 || selectedCategories.includes(category)
    );
  });

  // Clear cluster group and rebuild with filtered features
  if (markerClusterGroup) {
    markerClusterGroup.clearLayers();
  }

  // Use all filtered features for display (viewport filtering disabled)
  const featuresForDisplay = categoryFilteredFeatures;

  // Group filtered features by category
  const filteredFeaturesByCategory = {};
  featuresForDisplay.forEach((feature) => {
    const category = feature.properties.categories?.primary || "unknown";
    if (!filteredFeaturesByCategory[category]) {
      filteredFeaturesByCategory[category] = [];
    }
    filteredFeaturesByCategory[category].push(feature);
  });

  filteredCount = featuresForDisplay.length;

  console.log(`Displaying ${filteredCount} filtered features`);

  // Create markers for filtered features only
  Object.entries(filteredFeaturesByCategory).forEach(
    ([category, categoryFeatures]) => {
      const categoryMarkers = [];
      categoryFeatures.forEach((feature) => {
        const coords = feature.geometry.coordinates;

        // Get LOD properties based on current zoom level
        const lodProperties = getMarkerLODProperties(
          category,
          currentZoomLevel
        );

        // Create custom marker with LOD properties
        const marker = L.circleMarker([coords[1], coords[0]], lodProperties);

        // Add popup
        marker.bindPopup(createPopupContent(feature));

        // Store reference to feature and category
        marker.featureCategory = category;
        marker.featureData = feature;

        categoryMarkers.push(marker);
      });

      // Add markers to cluster group or directly to map
      if (markerClusterGroup) {
        markerClusterGroup.addLayers(categoryMarkers);
      } else {
        // Add markers directly to map if clustering is not available
        categoryMarkers.forEach((marker) => {
          if (!map.hasLayer(marker)) {
            marker.addTo(map);
          }
        });
      }
    }
  );

  // Update category layers with new filtered markers
  categoryLayers = {};
  Object.entries(filteredFeaturesByCategory).forEach(([category, features]) => {
    const markers = [];
    features.forEach((feature) => {
      const coords = feature.geometry.coordinates;
      const marker = L.circleMarker([coords[1], coords[0]], {
        radius: 6,
        fillColor: getMarkerColor(category),
        opacity: 1,
        fillOpacity: 0.8,
      });
      marker.bindPopup(createPopupContent(feature));
      marker.featureCategory = category;
      marker.featureData = feature;
      markers.push(marker);
    });
    categoryLayers[category] = markers;
  });

  // Update info panel
  document.getElementById("location-count").textContent = filteredCount;

  // Update active filter display
  let filterDisplay =
    selectedCategories.length === 0
      ? "All Categories"
      : selectedCategories
          .map((cat) => cat.replace(/_/g, " ").toUpperCase())
          .join(", ");

  document.getElementById("active-filter").textContent = filterDisplay;

  // Fit map to filtered markers if any
  if (filteredCount > 0) {
    // Refresh cluster group to get current markers
    const clusterBounds = markerClusterGroup.getBounds();
    if (clusterBounds.isValid()) {
      map.fitBounds(clusterBounds.pad(0.1));
    }
  }
}

// Function to clear all filters
function clearFilter() {
  selectedCategories = [];
  clearBoundaryFilter();
  updateMapAndChart();
}

// Function to load boundary data from local files
async function loadBoundaryData(level) {
  if (loadedBoundaries[level]) {
    return loadedBoundaries[level];
  }

  try {
    // Map level names to file paths
    const fileMap = {
      'adm0': './map shapefiles/irq_admbnda_adm0_cso_itos_20190603.geojson',
      'adm1': './map shapefiles/irq_admbnda_adm1_cso_20190603.geojson',
      'adm2': './map shapefiles/irq_admbnda_adm2_cso_20190603.geojson',
      'adm3': './map shapefiles/irq_admbnda_adm3_cso_20190603.geojson'
    };

    const filePath = fileMap[level];
    if (!filePath) {
      throw new Error(`No file mapping found for boundary level: ${level}`);
    }

    console.log(`Loading boundary data for ${level} from ${filePath}...`);
    const response = await fetch(filePath);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    loadedBoundaries[level] = data;
    console.log(`✅ Successfully loaded boundary data for ${level}: ${data.features?.length || 0} features`);
    return data;
  } catch (error) {
    console.error(`❌ Error loading boundary data for ${level}:`, error);
    return null;
  }
}

// Function to get selected boundary style (highlighted)
function getSelectedBoundaryStyle(level) {
  const selectedStyles = {
    adm0: {
      color: "#2c3e50",
      weight: 5,
      opacity: 1,
      fillColor: "#3498db",
      fillOpacity: 0.4,
    },
    adm1: {
      color: "#e74c3c",
      weight: 4,
      opacity: 1,
      fillColor: "#e74c3c",
      fillOpacity: 0.4,
    },
    adm2: {
      color: "#f39c12",
      weight: 3.5,
      opacity: 1,
      fillColor: "#f39c12",
      fillOpacity: 0.35,
    },
    adm3: {
      color: "#9b59b6",
      weight: 3,
      opacity: 1,
      fillColor: "#9b59b6",
      fillOpacity: 0.3,
    },
  };
  return selectedStyles[level] || selectedStyles.adm1;
}

// Function to create boundary layer
function createBoundaryLayer(boundaryData, level) {
  const layer = L.geoJSON(boundaryData, {
    style: getBoundaryStyle(level),
    pane: "overlayPane", // Ensure boundaries are in the correct pane
    onEachFeature: function (feature, layer) {
      const originalStyle = getBoundaryStyle(level);
      const hoverStyle = getBoundaryHoverStyle(level);
      const selectedStyle = getSelectedBoundaryStyle(level);

      // Mouse events for hover effect
      layer.on("mouseover", function (e) {
        // Only show hover if this boundary is not selected
        if (selectedBoundaryLayer !== layer) {
          layer.setStyle(hoverStyle);
        }
        // Change cursor to pointer to indicate clickability
        layer._container && (layer._container.style.cursor = "pointer");
      });

      layer.on("mouseout", function (e) {
        // Restore to original or selected style
        if (selectedBoundaryLayer === layer) {
          layer.setStyle(selectedStyle);
        } else {
          layer.setStyle(originalStyle);
        }
        layer._container && (layer._container.style.cursor = "");
      });

      // Click event to filter markers by boundary
      layer.on("click", function (e) {
        e.originalEvent.stopPropagation(); // Prevent map click events
        
        // If clicking the same boundary, deselect it
        if (selectedBoundaryLayer === layer) {
          clearBoundaryFilter();
          return;
        }

        // Clear previous selection
        if (selectedBoundaryLayer) {
          const prevLevel = selectedBoundaryLayer.boundaryLevel;
          selectedBoundaryLayer.setStyle(getBoundaryStyle(prevLevel));
        }

        // Set new selection
        selectedBoundary = feature;
        selectedBoundaryLayer = layer;
        layer.setStyle(selectedStyle);
        layer.bringToFront();

        // Zoom to boundary bounds
        try {
          const bounds = layer.getBounds();
          if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50] });
          }
        } catch (error) {
          console.warn("Could not zoom to boundary bounds:", error);
        }

        // Update UI
        updateBoundaryFilterDisplay(feature, level);

        // Filter and update map
        console.log(`Filtering by boundary: ${getBoundaryName(feature, level)}`);
        updateMapAndChart();
      });

      // Store level reference and feature
      layer.boundaryLevel = level;
      layer.boundaryFeature = feature;
    },
  });

  // Set z-index to ensure boundaries stay below markers
  layer.setZIndex = function (zIndex) {
    this.eachLayer(function (layer) {
      if (layer.setZIndex) {
        layer.setZIndex(zIndex);
      }
    });
  };

  return layer;
}

// Function to get boundary name for display
function getBoundaryName(feature, level) {
  const props = feature.properties;
  switch (level) {
    case "adm0":
      return props.ADM0_EN || "Unknown Country";
    case "adm1":
      return props.ADM1_EN || "Unknown Governorate";
    case "adm2":
      return props.ADM2_EN || "Unknown District";
    case "adm3":
      return props.ADM3_EN || "Unknown Sub-district";
    default:
      return "Unknown";
  }
}

// Function to update boundary filter display in UI
function updateBoundaryFilterDisplay(feature, level) {
  const boundaryName = getBoundaryName(feature, level);
  const levelNames = {
    adm0: "Country",
    adm1: "Governorate",
    adm2: "District",
    adm3: "Sub-district"
  };
  
  const filterInfo = document.getElementById("boundary-filter-info");
  if (filterInfo) {
    filterInfo.innerHTML = `
      <div style="margin-top: 10px; padding: 8px; background: #f0f0f0; border-radius: 4px;">
        <strong>Boundary Filter:</strong> ${levelNames[level]} - ${boundaryName}
      </div>
    `;
  }
  
  // Show the clear boundary filter button
  const clearBoundaryBtn = document.getElementById("clear-boundary-btn");
  if (clearBoundaryBtn) {
    clearBoundaryBtn.style.display = "block";
  }
}

// Function to clear boundary filter
function clearBoundaryFilter() {
  if (selectedBoundaryLayer) {
    const level = selectedBoundaryLayer.boundaryLevel;
    selectedBoundaryLayer.setStyle(getBoundaryStyle(level));
    selectedBoundaryLayer = null;
  }
  selectedBoundary = null;
  
  // Clear UI
  const filterInfo = document.getElementById("boundary-filter-info");
  if (filterInfo) {
    filterInfo.innerHTML = "";
  }
  
  // Hide the clear boundary filter button
  const clearBoundaryBtn = document.getElementById("clear-boundary-btn");
  if (clearBoundaryBtn) {
    clearBoundaryBtn.style.display = "none";
  }
  
  // Update map
  updateMapAndChart();
}

// Expose clearBoundaryFilter to global scope
window.clearBoundaryFilter = clearBoundaryFilter;

// Function to toggle boundary layer (now handles radio button behavior)
async function toggleBoundary(level) {
  const radioButton = document.getElementById(`boundary-${level}`);

  if (radioButton.checked) {
    // Clear boundary filter if switching to a different level
    if (selectedBoundaryLayer && selectedBoundaryLayer.boundaryLevel !== level) {
      clearBoundaryFilter();
    }

    // Hide all other boundary layers first
    Object.keys(boundaryLayers).forEach(async (otherLevel) => {
      if (otherLevel !== level && boundaryLayers[otherLevel] && map.hasLayer(boundaryLayers[otherLevel])) {
        map.removeLayer(boundaryLayers[otherLevel]);
      }
    });

    // Show selected boundary layer
    if (!boundaryLayers[level]) {
      // Load and create layer if not exists
      const boundaryData = await loadBoundaryData(level);
      if (boundaryData) {
        boundaryLayers[level] = createBoundaryLayer(boundaryData, level);
      } else {
        radioButton.checked = false;
        alert(`Failed to load ${level} boundary data`);
        return;
      }
    }

    // Add layer to map
    if (boundaryLayers[level] && !map.hasLayer(boundaryLayers[level])) {
      map.addLayer(boundaryLayers[level]);

      // Ensure boundaries stay below markers by setting lower z-index
      const zIndexMap = { adm0: 100, adm1: 200, adm2: 300, adm3: 400 };
      if (boundaryLayers[level].setZIndex) {
        boundaryLayers[level].setZIndex(zIndexMap[level] || 200);
      }

      // Ensure cluster group stays above boundaries (if available)
      if (markerClusterGroup) {
        markerClusterGroup.bringToFront();
      }
    }
  } else {
    // If unchecking, clear boundary filter if it was from this level
    if (selectedBoundaryLayer && selectedBoundaryLayer.boundaryLevel === level) {
      clearBoundaryFilter();
    }
  }
}



// Function to load combined places GeoJSON data
async function loadCombinedPlacesData() {
  try {
    console.log("📂 Loading combined places data...");
    const response = await fetch("./geo locations/combined_places.geojson");

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log(`✅ Successfully loaded ${data.features?.length || 0} features from combined_places.geojson`);

    // Store the data
    allFeatures = data.features || [];
    originalFeatures = [...allFeatures]; // Store original for filtering

    // Build spatial index for efficient queries
    if (allFeatures.length > 0) {
      spatialIndex = new SpatialIndex();
      spatialIndex.build(allFeatures);
    }

    // Count all categories and store globally
    allCategoryCounts = {};
    allFeatures.forEach((feature) => {
      const category = feature.properties.categories?.primary || "unknown";
      allCategoryCounts[category] = (allCategoryCounts[category] || 0) + 1;
    });

    // Create markers
    if (allFeatures.length > 0) {
      createMarkers(allFeatures);
      
      // Update info panel
      document.getElementById("location-count").textContent = allFeatures.length;
      document.getElementById("category-count").textContent = Object.keys(allCategoryCounts).length;
    }

    // Initialize radius analysis visualisation and data
    try {
      initializeRadiusAnalysis();
    } catch (error) {
      console.error("❌ Error initializing radius analysis:", error);
      // Continue loading even if radius analysis fails
    }

    // Hide loading indicator
    const loadingElement = document.getElementById("loading");
    if (loadingElement) {
      loadingElement.style.display = "none";
    }

    return data;
  } catch (error) {
    console.error("❌ Error loading combined places data:", error);
    
    // Show error message
    const loadingElement = document.getElementById("loading");
    if (loadingElement) {
      loadingElement.innerHTML = `<p style="color: red;">Error loading data: ${error.message}</p>`;
    }
    
    return null;
  }
}

// Initialize everything when page loads
document.addEventListener("DOMContentLoaded", function () {
  console.log("🚀 DOMContentLoaded - initializing map application");
  initializeMap();
  console.log("🗺️ Map initialized");

  const radiusToggleButton = document.getElementById("radius-panel-toggle");
  if (radiusToggleButton) {
    radiusToggleButton.addEventListener("click", () => toggleRadiusPanel());
  }

  setupRadiusSlider();
  updateRadiusPanelDetails();

  // Load combined places data
  loadCombinedPlacesData();

  // Load default boundary layer (ADM3 - Sub-districts) after a short delay
  setTimeout(() => {
    toggleBoundary("adm3");
  }, 1000);
});
