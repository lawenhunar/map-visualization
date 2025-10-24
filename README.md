# Map Visualization - Sulaymaniyah Places

An interactive map visualization showing business locations in Sulaymaniyah, Iraq, built with Leaflet.js and served without a backend.

## Features

- 🗺️ Interactive map with OpenStreetMap tiles
- 📍 Business location markers with clustering for performance
- 🏛️ Administrative boundary layers (Country, Governorates, Districts, Sub-districts)
- 📊 Interactive pie chart showing category distribution
- 🔍 Category filtering system
- 📐 Boundary-based filtering (click on boundaries to filter locations)
- 📱 Responsive design for mobile and desktop

## Project Structure

```
map-visualization/
├── index.html                    # Main HTML file
├── dashboard.js                  # JavaScript map logic
├── styles.css                    # CSS styling
├── server.py                     # Python HTTP server script
├── geo locations/
│   └── slemani_places.geojson    # Business locations data
└── map shapefiles/
    ├── metadata.json
    └── *.geojson                 # Administrative boundary files
```

## How to Run

### Option 1: Using Python HTTP Server (Recommended)

1. **Start the server:**

   ```bash
   python server.py
   ```

2. **Open your browser and go to:**
   ```
   http://localhost:8000
   ```

### Option 2: Using Python's built-in server

```bash
# Navigate to the project directory
cd /path/to/map-visualization

# Start server on port 8000
python -m http.server 8000

# Or use a different port
python -m http.server 8080
```

### Option 3: Using Node.js (if available)

```bash
npx http-server -p 8000
```

## Why a Server is Needed

This project loads JSON data files directly from the local filesystem. Modern browsers have CORS (Cross-Origin Resource Sharing) restrictions that prevent loading local JSON files directly by opening the HTML file.

The server provides the necessary HTTP headers to allow the browser to load the JSON files properly.

## Map Controls

### Markers

- Click on markers to see detailed information
- Markers are clustered for better performance at different zoom levels
- Colors indicate different business categories

### Boundaries

- Toggle administrative boundaries using checkboxes in the "Administrative Boundaries" panel
- Click on boundary areas to filter locations within that region
- Use "Reset Boundary Filter" to clear boundary filtering

### Categories

- Click on pie chart segments to filter by business category
- Use "Clear All Filters" to show all categories again

## Data Sources

- **Business Locations**: Overture Maps data for Sulaymaniyah region
- **Administrative Boundaries**: Iraq administrative boundaries (CSO/ITOS)
- **Map Tiles**: OpenStreetMap

## Browser Compatibility

- ✅ Chrome 80+
- ✅ Firefox 75+
- ✅ Safari 13+
- ✅ Edge 80+

## Troubleshooting

### Map doesn't load

- Make sure you're accessing the page through a web server (not file:// protocol)
- Check browser console for JavaScript errors
- Verify all files are in the correct directories

### JSON files don't load

- Ensure the server is running and accessible
- Check that file paths in the code match the actual file structure
- Look for CORS-related errors in browser console

### Performance issues

- The map uses clustering and viewport optimization for better performance
- Consider reducing the number of visible markers if performance is still an issue

## Customization

### Adding New Data

1. Replace `geo locations/slemani_places.geojson` with your own GeoJSON data
2. Update category colors in `getMarkerColor()` function in `dashboard.js`
3. Modify chart colors in `getChartColors()` function if needed

### Changing Default Settings

- **Map Center**: Modify coordinates in `initializeMap()` function
- **Zoom Level**: Adjust the `setView()` parameters
- **Clustering**: Modify cluster settings in `initializeMap()` function

## Development

The project uses vanilla JavaScript with no build process required. Simply edit the files and refresh the browser.

### Key Files to Modify:

- `dashboard.js`: Main map logic and data processing
- `styles.css`: Visual styling and responsive design
- `index.html`: HTML structure and library includes

## License

This project uses data from Overture Maps and OpenStreetMap, which are available under their respective licenses.
