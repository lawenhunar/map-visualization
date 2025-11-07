// Global variables
let map, allFeatures, categoryChart, markerClusterGroup;
let selectedCategories = [];
let allMarkers = [];
let allCategoryCounts = {};
let categoryLayers = {}; // Store individual markers by category
let boundaryLayers = {}; // Store boundary layers by administrative level
let loadedBoundaries = {}; // Cache loaded boundary data
let selectedBoundary = null; // Currently selected boundary for filtering
let filteredFeatures = []; // Features within selected boundary
let originalFeatures = []; // Store original features for reset
let viewportMarkers = new Set(); // Track markers currently in viewport
let currentViewportBounds = null; // Current map viewport bounds
let spatialIndex = null; // Spatial index for efficient boundary filtering
let isLoadingComplete = false; // Track if all data has been loaded
let loadingInProgress = false; // Prevent concurrent loading requests
let currentZoomLevel = 12; // Track current zoom level for LOD

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

// Filter features within a boundary using spatial indexing for optimization
function filterFeaturesInBoundary(features, boundaryGeometry) {
  if (!spatialIndex) {
    // Fallback to original method if spatial index not available
    return features.filter((feature) => {
      const coords = feature.geometry.coordinates;
      return isPointInGeometry(coords, boundaryGeometry);
    });
  }

  // Get boundary bounds for spatial filtering
  const bounds = getGeometryBounds(boundaryGeometry);
  if (!bounds) {
    return [];
  }

  // Use spatial index to get candidate features within bounds
  const candidateFeatures = spatialIndex.queryBounds(
    bounds.minLng,
    bounds.maxLng,
    bounds.minLat,
    bounds.maxLat
  );

  console.log(
    `Spatial index filtered ${candidateFeatures.length} candidates from ${features.length} total features`
  );

  // Apply precise point-in-polygon test only to candidates
  const filteredFeatures = candidateFeatures.filter((feature) => {
    const coords = feature.geometry.coordinates;
    return isPointInGeometry(coords, boundaryGeometry);
  });

  console.log(
    `Final filtered result: ${filteredFeatures.length} features within boundary`
  );
  return filteredFeatures;
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

// Reset boundary filter
function resetBoundaryFilter() {
  selectedBoundary = null;
  filteredFeatures = [];

  // Reset boundary styles
  Object.values(boundaryLayers).forEach((layer) => {
    if (layer && map.hasLayer(layer)) {
      layer.eachLayer((sublayer) => {
        const level = sublayer.boundaryLevel;
        sublayer.setStyle(getBoundaryStyle(level));
      });
    }
  });

  // First, fit map to show all original features to ensure viewport includes everything
  if (originalFeatures.length > 0) {
    // Calculate bounds from all original features
    const bounds = L.latLngBounds([]);
    originalFeatures.forEach((feature) => {
      const coords = feature.geometry.coordinates;
      bounds.extend([coords[1], coords[0]]);
    });
    
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.1));
      
      // Wait for map to finish fitting bounds before updating markers
      // This ensures viewport filtering in updateMapAndChart includes all features
      map.once('moveend', function() {
        // Use updateMapAndChart to properly restore all features and update charts
        // This ensures the data source is correctly set to originalFeatures
        // Since selectedBoundary is now null, it will use originalFeatures
        updateMapAndChart();
      });
      
      return; // Exit early, updateMapAndChart will be called in moveend handler
    }
  }

  // If bounds calculation failed or no features, update immediately
  // Use updateMapAndChart to properly restore all features and update charts
  // This ensures the data source is correctly set to originalFeatures
  // Since selectedBoundary is now null, it will use originalFeatures
  updateMapAndChart();

  // Hide reset boundary button
  document.getElementById("reset-boundary-btn").style.display = "none";
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

// Function to get chart colors for categories
function getChartColors() {
  return [
    "#2c3e50", // Dark blue-gray
    "#34495e", // Lighter blue-gray
    "#95a5a6", // Light gray
    "#7f8c8d", // Medium gray
    "#3498db", // Blue
    "#2980b9", // Dark blue
    "#27ae60", // Green
    "#2ecc71", // Light green
    "#f39c12", // Orange
    "#e67e22", // Dark orange
    "#e74c3c", // Red
    "#c0392b", // Dark red
    "#9b59b6", // Purple
    "#8e44ad", // Dark purple
    "#1abc9c", // Teal
    "#16a085", // Dark teal
    "#f1c40f", // Yellow
    "#f39c12", // Orange
    "#e91e63", // Pink
    "#34495e", // Blue-gray
  ];
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

// Function to get selected boundary styling
function getSelectedBoundaryStyle(level) {
  const selectedStyles = {
    adm0: {
      color: "#1a252f",
      weight: 5,
      opacity: 1,
      fillColor: "#3498db",
      fillOpacity: 0.4,
    },
    adm1: {
      color: "#c0392b",
      weight: 4,
      opacity: 1,
      fillColor: "#e74c3c",
      fillOpacity: 0.4,
    },
    adm2: {
      color: "#d68910",
      weight: 3,
      opacity: 1,
      fillColor: "#f39c12",
      fillOpacity: 0.35,
    },
    adm3: {
      color: "#7d3c98",
      weight: 2.5,
      opacity: 1,
      fillColor: "#9b59b6",
      fillOpacity: 0.3,
    },
  };
  return selectedStyles[level] || selectedStyles.adm1;
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

  // Update map and chart
  updateMapAndChart();
}

// Function to update map markers and chart based on selected categories
function updateMapAndChart() {
  let filteredCount = 0;
  let currentFeatures = [];

  // Use current data source (boundary filtered or original)
  const dataSource = selectedBoundary ? filteredFeatures : originalFeatures;

  // Apply category filtering to the current data source
  const categoryFilteredFeatures = dataSource.filter((feature) => {
    const category = feature.properties.categories?.primary || "unknown";
    return (
      selectedCategories.length === 0 || selectedCategories.includes(category)
    );
  });

  // Clear cluster group and rebuild with filtered features
  if (markerClusterGroup) {
    markerClusterGroup.clearLayers();
  }

  // Apply viewport filtering to the filtered features
  const mapBounds = map.getBounds();
  const center = map.getCenter();
  const maxDistance =
    Math.max(
      mapBounds.getNorth() - mapBounds.getSouth(),
      mapBounds.getEast() - mapBounds.getWest()
    ) * 111000; // Convert degrees to meters (approximate)

  const viewportFilteredFeatures = categoryFilteredFeatures.filter(
    (feature) => {
      const coords = feature.geometry.coordinates;
      const point = L.latLng(coords[1], coords[0]);
      const distance = center.distanceTo(point);
      return distance <= maxDistance * 1.5; // Show markers within 1.5x viewport distance
    }
  );

  // Group filtered features by category
  const filteredFeaturesByCategory = {};
  viewportFilteredFeatures.forEach((feature) => {
    const category = feature.properties.categories?.primary || "unknown";
    if (!filteredFeaturesByCategory[category]) {
      filteredFeaturesByCategory[category] = [];
    }
    filteredFeaturesByCategory[category].push(feature);
    filteredCount++;
  });

  console.log(
    `Showing ${viewportFilteredFeatures.length} of ${categoryFilteredFeatures.length} filtered features in viewport`
  );

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

  // Add boundary filter info if applicable
  if (selectedBoundary && selectedBoundary.boundaryFeature) {
    const props = selectedBoundary.boundaryFeature.properties;
    const level = selectedBoundary.boundaryLevel;
    let boundaryName = "";
    switch (level) {
      case "adm0":
        boundaryName = props.ADM0_EN || "Country";
        break;
      case "adm1":
        boundaryName = props.ADM1_EN || "Governorate";
        break;
      case "adm2":
        boundaryName = props.ADM2_EN || "District";
        break;
      case "adm3":
        boundaryName = props.ADM3_EN || "Sub-district";
        break;
    }
    filterDisplay += ` in ${boundaryName}`;
  }

  document.getElementById("active-filter").textContent = filterDisplay;

  // Update chart with category-filtered features from current data source
  updateChart(categoryFilteredFeatures);

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
  resetBoundaryFilter();
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
        if (selectedBoundary !== layer) {
          layer.setStyle(hoverStyle);
        }
        // Don't bring boundaries to front to avoid covering markers
      });

      layer.on("mouseout", function (e) {
        if (selectedBoundary !== layer) {
          layer.setStyle(originalStyle);
        }
      });

      // Click event for filtering
      layer.on("click", function (e) {
        // Prevent event propagation
        L.DomEvent.stopPropagation(e);

        // Check if this boundary is already selected (toggle functionality)
        if (selectedBoundary === layer) {
          // Deselect current boundary
          resetBoundaryFilter();
          return;
        }

        // Reset previous selection
        if (selectedBoundary) {
          const prevLevel = selectedBoundary.boundaryLevel;
          selectedBoundary.setStyle(getBoundaryStyle(prevLevel));
        }

        // Set new selection
        selectedBoundary = layer;
        layer.setStyle(selectedStyle);

        // Filter features within this boundary
        filteredFeatures = filterFeaturesInBoundary(
          originalFeatures,
          feature.geometry
        );

        console.log(
          `Filtered ${filteredFeatures.length} features within boundary`
        );

        // Update markers and charts with filtered data using clustering
        createMarkers(filteredFeatures);
        updateMapAndChart();

        // Show reset boundary button
        document.getElementById("reset-boundary-btn").style.display =
          "inline-block";
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

// Function to toggle boundary layer (now handles radio button behavior)
async function toggleBoundary(level) {
  const radioButton = document.getElementById(`boundary-${level}`);

  if (radioButton.checked) {
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
  }
}

// Function to initialize charts
function initializeCharts(features) {
  // Count all categories and store globally
  allCategoryCounts = {};
  features.forEach((feature) => {
    const category = feature.properties.categories?.primary || "unknown";
    allCategoryCounts[category] = (allCategoryCounts[category] || 0) + 1;
  });

  // Initialize category pie chart
  categoryChart = echarts.init(document.getElementById("categoryChart"));

  // Add click event to pie chart for toggle functionality
  categoryChart.on("click", function (params) {
    const selectedCategory = params.data.category;
    toggleCategoryFilter(selectedCategory);
  });

  // Initial chart render
  updateChart(features);

  // Resize charts when window resizes
  window.addEventListener("resize", function () {
    categoryChart.resize();
  });
}

// Function to update chart with current data
function updateChart(features) {
  // Count categories in current features
  const categoryCounts = {};
  features.forEach((feature) => {
    const category = feature.properties.categories?.primary || "unknown";
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  });

  // Prepare data for pie chart - use only categories that exist in current features
  const allCategories = Object.entries(categoryCounts)
    .map(([category, currentCount]) => {
      const isSelected = selectedCategories.includes(category);

      return {
        name: category.replace(/_/g, " ").toUpperCase(),
        value: currentCount,
        category: category,
        isSelected: isSelected,
        opacity: selectedCategories.length === 0 || isSelected ? 1 : 0.3,
      };
    })
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);

  // Use all categories for the pie chart
  const pieData = allCategories;

  // Calculate total count for center display
  const totalCount = features.length;

  const pieOption = {
    tooltip: {
      trigger: "item",
      formatter: "{a} <br/>{b}: {c} ({d}%)",
      position: function (point, params, dom, rect, size) {
        // Position tooltip under the cursor
        return [point[0], point[1] + 20];
      },
    },
    legend: {
      type: 'scroll',
      orient: 'horizontal',
      left: 'center',
      bottom: 5,
      data: allCategories.map(item => item.name),
      selectedMode: false, // Disable selection to show all items
      formatter: function(name) {
        const category = allCategories.find(item => item.name === name);
        return `${name}: ${category ? category.value : 0}`;
      },
      textStyle: {
        fontSize: 8
      },
      pageButtonItemGap: 3,
      pageButtonGap: 8,
      pageFormatter: '{current}/{total}',
      pageIconColor: '#2c3e50',
      pageIconInactiveColor: '#aaa',
      pageIconSize: 10,
      pageTextStyle: {
        color: '#333',
        fontSize: 8
      }
    },
    series: [
      {
        name: "Categories",
        type: "pie",
        radius: ["30%", "60%"],
        center: ["50%", "40%"],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 3,
          borderColor: "#fff",
          borderWidth: 2,
        },
        label: {
          show: false,
          position: "center",
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 12,
            fontWeight: "bold",
          },
          itemStyle: {
            shadowBlur: 8,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
        labelLine: {
          show: false,
        },
        data: pieData.map((item, index) => ({
          ...item,
          itemStyle: {
            color: getChartColors()[index % getChartColors().length],
            opacity: item.opacity,
            borderWidth: item.isSelected ? 3 : 2,
            borderColor: item.isSelected ? "#333" : "#fff",
          },
        })),
      },
      // Add a second series for the center text
      {
        type: "pie",
        radius: ["0%", "0%"],
        center: ["50%", "40%"],
        label: {
          show: true,
          position: "center",
          formatter: function() {
            return totalCount.toLocaleString();
          },
          fontSize: 16,
          fontWeight: "bold",
          color: "#2c3e50",
        },
        data: [{}],
        silent: true,
        itemStyle: {
          opacity: 0,
        },
      },
    ],
  };
  categoryChart.setOption(pieOption, true);
}

// Load GeoJSON data from local files
async function loadGeoJSONData() {
  console.log("🔄 Loading GeoJSON data from local files");

  try {
    loadingInProgress = true;

    // Load combined dataset
    console.log("Loading combined places data...");
    const response = await fetch('./geo locations/combined_places.geojson');

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const geojsonData = await response.json();
    console.log(`Loaded ${geojsonData.features.length} features from combined file`);
    
    const allData = geojsonData.features || [];
    const totalFeatures = allData.length;

    console.log(`Total features loaded: ${totalFeatures}`);

    // Validate that we got data
    if (allData.length === 0) {
      throw new Error("No features found in the combined file");
    }

    // Set all features
    allFeatures = allData;
    originalFeatures = [...allData];

    // Build spatial index for efficient boundary filtering
    spatialIndex = new SpatialIndex(0.005); // ~500m cells
    spatialIndex.build(allFeatures);

    const categories = new Set();

    // Count categories from all loaded features
    allFeatures.forEach((feature) => {
      const category = feature.properties.categories?.primary || "unknown";
      categories.add(category);
    });

    console.log(`Found ${categories.size} different categories`);

    // Update markers with loaded data
    createMarkers(allFeatures);

    // Update charts
    initializeCharts(allFeatures);

    // Update info panel
    document.getElementById("location-count").textContent = allFeatures.length;
    document.getElementById("category-count").textContent = categories.size;

    // Hide loading indicator
    document.getElementById("loading").style.display = "none";

    console.log(
      `✅ Completed loading ${allFeatures.length} locations with ${categories.size} different categories from combined file`
    );

    // Fit map to show all loaded markers
    if (allFeatures.length > 0) {
      if (markerClusterGroup) {
        const clusterBounds = markerClusterGroup.getBounds();
        if (clusterBounds.isValid()) {
          map.fitBounds(clusterBounds.pad(0.1));
          markerClusterGroup.bringToFront();
        }
      } else {
        // If no clustering, fit to all individual markers
        const allVisibleMarkers = [];
        Object.values(categoryLayers).forEach((markers) => {
          markers.forEach((marker) => {
            if (map.hasLayer(marker)) {
              allVisibleMarkers.push(marker);
            }
          });
        });
        if (allVisibleMarkers.length > 0) {
          const group = new L.featureGroup(allVisibleMarkers);
          map.fitBounds(group.getBounds().pad(0.1));
        }
      }
    }

    // Mark as complete and load boundary data
    isLoadingComplete = true;
    loadingInProgress = false;

  } catch (error) {
    console.error("❌ Error loading GeoJSON data:", error);
    document.getElementById("loading").innerHTML =
      '<p style="color: red;">Error: Failed to load data from local files. Please check that the files exist and are accessible.</p>';
    loadingInProgress = false;
  }
}

// Initialize everything when page loads
document.addEventListener("DOMContentLoaded", function () {
  console.log("🚀 DOMContentLoaded - initializing map application");
  initializeMap();
  console.log("🗺️ Map initialized, starting data load");
  loadGeoJSONData();

  // Load default boundary layer (ADM3 - Sub-districts) after a short delay
  setTimeout(() => {
    toggleBoundary("adm3");
  }, 1000);
});
