# Master Plan Viewer

A lightweight, no-build web application that displays georeferenced raster master plans of Indian Cities (Cloud Optimized GeoTIFFs) on an interactive web map using **OpenLayers** loaded from a CDN.

<img width="1920" height="908" alt="master-plan-viewer" src="https://github.com/user-attachments/assets/6ed666ef-4fae-45ed-911f-08434dd02923" />

## Quick Start

1. Serve the directory with any local HTTP server (required for `fetch` and CORS):

   ```bash
   # Python
   python -m http.server 8000

   # Node (npx)
   npx serve .

   # VS Code — use the "Live Server" extension
   ```

2. Open `http://localhost:8000` in a browser.

## Files

| File          | Purpose                                                    |
| ------------- | ---------------------------------------------------------- |
| `index.html`  | HTML shell — loads OpenLayers CSS/JS from CDN, app CSS/JS  |
| `main.js`     | All application logic (map, controls, COG loading, swipe)  |
| `style.css`   | Minimal functional layout for controls and swipe handle    |
| `cities.json` | Array of cities with COG URL, centre coordinates, and zoom |

## Features

| Feature            | Description                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------ |
| **City selector**  | Dropdown populated from `cities.json`. Selecting a city flies the map and loads its COG.    |
| **Geolocation**    | Button that calls the browser Geolocation API and pans the map to the user's position.     |
| **Opacity slider** | Range input (0–1) controlling the COG overlay opacity.                                     |
| **Swipe compare**  | Vertical draggable divider — COG visible on the left, basemap-only on the right.           |
| **Basemap toggle** | Two buttons switching between OpenStreetMap tiles and ESRI World Imagery satellite tiles.   |

## Adding Cities

Edit `cities.json`. Each entry needs:

```json
{
  "name": "City Name",
  "cogUrl": "https://…/filename.tif",
  "center": [longitude, latitude],
  "zoom": 12
}
```

- **cogUrl** must point to a publicly accessible Cloud Optimized GeoTIFF.
- **center** is `[lon, lat]` in EPSG:4326 (WGS 84).
- **zoom** is the initial zoom level when the city is selected.

## Technical Notes

- **Projection**: The map uses EPSG:3857 (Web Mercator). OpenLayers reprojects COGs from EPSG:4326 automatically.
- **COG rendering**: Uses `ol.source.GeoTIFF` + `ol.layer.WebGLTile` for efficient streaming of Cloud Optimized GeoTIFFs.
- **WEBP compression**: The COGs use WEBP-compressed tiles. The `geotiff.js` library (bundled in the OpenLayers full build) handles decompression in the browser.
- **CORS**: The R2 bucket must have CORS headers configured for the viewer's origin.
- **Swipe mechanism**: Implemented via the WebGL scissor test on the COG layer's `prerender`/`postrender` events — no extra libraries needed.
- **No build step**: Everything runs directly in the browser. No npm, no bundler, no framework.

## Dependencies (CDN)

- [OpenLayers 10.5.0](https://openlayers.org/) — `ol.js` + `ol.css` from jsDelivr

## Browser Support

Any modern browser with WebGL2 support (Chrome, Firefox, Edge, Safari 16.4+).
