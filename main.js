/**
 * Master Plan Viewer — main.js
 *
 * Displays Cloud Optimized GeoTIFFs (COGs) on an OpenLayers map
 * with city selection, geolocation, opacity control, basemap toggle,
 * and a vertical swipe-compare divider.
 */
(function () {
  'use strict';

  // ── Shared state ─────────────────────────────────────
  var map, cogLayer, basemapLayer;
  var osmSource, satSource;
  var swipeX; // swipe position in CSS pixels from left edge of map

  // ── Bootstrap ────────────────────────────────────────
  fetch('cities.json')
    .then(function (res) { return res.json(); })
    .then(function (data) { init(data.cities); })
    .catch(function (err) { console.error('Failed to load cities.json:', err); });

  // ── Initialisation ───────────────────────────────────
  function init(cities) {
    // Basemap sources
    osmSource = new ol.source.OSM();
    satSource = new ol.source.XYZ({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maxZoom: 19,
      attributions: 'Tiles &copy; Esri'
    });

    basemapLayer = new ol.layer.Tile({ source: osmSource });

    // COG overlay layer — source is set when a city is selected.
    // WebGLTile is required for ol.source.GeoTIFF rendering.
    cogLayer = new ol.layer.WebGLTile();

    map = new ol.Map({
      target: 'map',
      layers: [basemapLayer, cogLayer],
      view: new ol.View({
        center: ol.proj.fromLonLat([78.9629, 20.5937]), // Centre of India
        zoom: 5
      })
    });

    setupCitySelector(cities);
    setupGeolocation();
    setupOpacitySlider();
    setupBasemapToggle();
    setupSwipe();
  }

  // ── 1. City Selector ─────────────────────────────────
  function setupCitySelector(cities) {
    var select = document.getElementById('city-select');

    // Populate dropdown
    cities.forEach(function (city, i) {
      var opt = document.createElement('option');
      opt.value = i;
      opt.textContent = city.name;
      select.appendChild(opt);
    });

    select.addEventListener('change', function () {
      if (select.value === '') return;
      var city = cities[parseInt(select.value, 10)];

      // Load the COG. OpenLayers reads the GeoTIFF metadata to derive
      // the correct projection, extent, and resolutions via source.getView().
      var source = new ol.source.GeoTIFF({
        sources: [{ url: city.cogUrl }]
      });
      cogLayer.setSource(source);

      // Apply current opacity slider value to the new source
      cogLayer.setOpacity(parseFloat(document.getElementById('opacity-slider').value));

      // Let the COG's own metadata drive the view (projection + extent),
      // matching the pattern from the official OpenLayers COG example.
      source.getView().then(function (viewConfig) {
        map.setView(new ol.View(viewConfig));
      }).catch(function (err) {
        console.error('Failed to read COG view metadata:', err);
        // Fallback: fly to the city center from cities.json
        map.getView().animate({
          center: ol.proj.fromLonLat(city.center),
          zoom: city.zoom,
          duration: 1500
        });
      });
    });
  }

  // ── 2. User Geolocation ──────────────────────────────
  function setupGeolocation() {
    document.getElementById('geolocate-btn').addEventListener('click', function () {
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          map.getView().animate({
            center: ol.proj.fromLonLat([pos.coords.longitude, pos.coords.latitude]),
            zoom: 14,
            duration: 1500
          });
        },
        function (err) {
          alert('Geolocation failed: ' + err.message);
        }
      );
    });
  }

  // ── 3. Opacity Slider ────────────────────────────────
  function setupOpacitySlider() {
    document.getElementById('opacity-slider').addEventListener('input', function (e) {
      cogLayer.setOpacity(parseFloat(e.target.value));
    });
  }

  // ── 4. Basemap Toggle ────────────────────────────────
  function setupBasemapToggle() {
    var osmBtn = document.getElementById('basemap-osm');
    var satBtn = document.getElementById('basemap-sat');

    osmBtn.addEventListener('click', function () {
      basemapLayer.setSource(osmSource);
      osmBtn.classList.add('active');
      satBtn.classList.remove('active');
    });

    satBtn.addEventListener('click', function () {
      basemapLayer.setSource(satSource);
      satBtn.classList.add('active');
      osmBtn.classList.remove('active');
    });
  }

  // ── 5. Swipe Compare ────────────────────────────────
  //
  // A vertical divider splits the map left / right.
  //   Left side  → COG overlay + basemap
  //   Right side → basemap only
  //
  // Implemented via WebGL scissor test on the COG layer's
  // prerender / postrender events.
  function setupSwipe() {
    var handle = document.getElementById('swipe-handle');
    var mapEl = document.getElementById('map');
    var dragging = false;

    // Position handle at the centre of the map
    swipeX = mapEl.clientWidth / 2;
    handle.style.left = swipeX + 'px';

    // ── Mouse drag ──
    handle.addEventListener('mousedown', function (e) {
      dragging = true;
      e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      updateSwipe(e.clientX, mapEl);
    });

    window.addEventListener('mouseup', function () {
      dragging = false;
    });

    // ── Touch drag ──
    handle.addEventListener('touchstart', function (e) {
      dragging = true;
      e.preventDefault();
    });

    window.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      updateSwipe(e.touches[0].clientX, mapEl);
    });

    window.addEventListener('touchend', function () {
      dragging = false;
    });

    // ── WebGL scissor clipping on the COG layer ──
    cogLayer.on('prerender', function (event) {
      var gl = event.context;
      if (!gl || !gl.enable) return; // guard: not a WebGL context
      var canvas = gl.canvas;
      // Ratio between physical pixels and CSS pixels
      var ratio = canvas.width / mapEl.clientWidth;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, Math.round(swipeX * ratio), canvas.height);
    });

    cogLayer.on('postrender', function (event) {
      var gl = event.context;
      if (!gl || !gl.disable) return;
      gl.disable(gl.SCISSOR_TEST);
    });

    // Keep handle centred on window resize
    window.addEventListener('resize', function () {
      if (swipeX > mapEl.clientWidth) {
        swipeX = mapEl.clientWidth;
        handle.style.left = swipeX + 'px';
        map.render();
      }
    });
  }

  /** Update the swipe divider position and trigger a re-render. */
  function updateSwipe(clientX, mapEl) {
    var rect = mapEl.getBoundingClientRect();
    swipeX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    document.getElementById('swipe-handle').style.left = swipeX + 'px';
    map.render();
  }

})();
