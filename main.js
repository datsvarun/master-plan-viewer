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
  var swipeX; // swipe position in CSS pixels from left edge (landscape)
  var swipeY; // swipe position in CSS pixels from top edge (portrait)

  // ── Bootstrap ────────────────────────────────────────
  fetch('cities.json')
    .then(function (res) { return res.json(); })
    .then(function (data) { init(data.cities); })
    .catch(function (err) { console.error('Failed to load cities.json:', err); });

  // ── Initialisation ───────────────────────────────────
  function init(cities) {
    // Basemap sources
    var IndiaBoundaryCorrectedTileLayer = IndiaBoundaryCorrector.IndiaBoundaryCorrectedTileLayer;
    
    // Corrected OSM Source Layer
    basemapLayer = new IndiaBoundaryCorrectedTileLayer({
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      sourceOptions: {
        attributions: '© OpenStreetMap contributors',
        crossOrigin: 'anonymous'
      }
    });

    var satLayer = new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maxZoom: 19,
        attributions: 'Tiles &copy; Esri',
        crossOrigin: 'anonymous'
      }),
      visible: false // Start hidden since default is OSM
    });

    // Make sure satLayer is exposed to the outer scope to be toggled
    window.satLayer = satLayer;

    // COG overlay layer — source is set when a city is selected.
    // WebGLTile is required for ol.source.GeoTIFF rendering.
    cogLayer = new ol.layer.WebGLTile();

    map = new ol.Map({
      target: 'map',
      layers: [basemapLayer, satLayer, cogLayer],
      controls: ol.control.defaults.defaults({ zoom: false }),
      view: new ol.View({
        center: ol.proj.fromLonLat([78.9629, 20.5937]), // Centre of India
        zoom: 5
      })
    });

    setupCitySelector(cities);
    setupAddressSearch();
    setupGeolocation();
    setupOpacitySlider();
    setupBasemapToggle();
    setupSwipe();
    setupMenuToggle();
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

      // Build the source.
      // WebGLTile works with both GeoTIFF and XYZ sources.
      var source;
      if (city.xyzUrl) {
        source = new ol.source.XYZ({
          url: city.xyzUrl,
          crossOrigin: 'anonymous'
        });
      } else {
        // Default to GeoTIFF
        // interpolate + normalize are required for correct WebGLTile rendering.
        // wrapX:false prevents phantom tile fetches at the antimeridian.
        source = new ol.source.GeoTIFF({
          sources: [{ url: city.cogUrl }],
          interpolate: true,
          normalize: true,
          wrapX: false
        });
      }

      // Set the layer extent if provided in cities.json.
      // This tells OL exactly where to draw tiles.
      cogLayer.setSource(source);
      if (city.extent) {
        cogLayer.setExtent(city.extent);
      } else {
        cogLayer.setExtent(undefined); // Clear previous extent
      }

      // Apply current opacity slider value
      cogLayer.setOpacity(parseFloat(document.getElementById('opacity-slider').value));

      // Do NOT use source.getView() — it derives minZoom/maxZoom from the COG
      // metadata and often clamps the zoom range too tightly, causing the layer
      // to vanish when zoomed out. Set the view manually instead.
      map.setView(new ol.View({
        center: ol.proj.fromLonLat(city.center),
        zoom: city.zoom,
        minZoom: 4,
        maxZoom: 20,
        projection: 'EPSG:3857'
      }));
    });
  }


  // ── 2. Address Search (Nominatim) ───────────────────
  function setupAddressSearch() {
    var input = document.getElementById('address-search');
    var resultsList = document.getElementById('search-results');
    var debounceTimer = null;
    var activeIndex = -1;

    function closeResults() {
      resultsList.classList.remove('open');
      resultsList.innerHTML = '';
      activeIndex = -1;
    }

    function renderResults(items) {
      resultsList.innerHTML = '';
      activeIndex = -1;
      if (!items.length) {
        var li = document.createElement('li');
        li.className = 'no-results';
        li.textContent = 'No results found';
        resultsList.appendChild(li);
      } else {
        items.forEach(function (item) {
          var li = document.createElement('li');
          li.textContent = item.display_name;
          li.setAttribute('role', 'option');
          li.addEventListener('mousedown', function (e) {
            e.preventDefault(); // keep input focused
            selectResult(item);
          });
          resultsList.appendChild(li);
        });
      }
      resultsList.classList.add('open');
    }

    function selectResult(item) {
      input.value = item.display_name;
      closeResults();
      var bbox = item.boundingbox; // [minLat, maxLat, minLon, maxLon]
      var extent = ol.proj.transformExtent(
        [parseFloat(bbox[2]), parseFloat(bbox[0]), parseFloat(bbox[3]), parseFloat(bbox[1])],
        'EPSG:4326',
        'EPSG:3857'
      );
      map.getView().fit(extent, { duration: 600, maxZoom: 17 });
    }

    function search(query) {
      if (!query.trim()) { closeResults(); return; }
      fetch(
        'https://nominatim.openstreetmap.org/search?q=' +
        encodeURIComponent(query) +
        '&format=json&limit=5&addressdetails=0',
        { headers: { 'Accept-Language': 'en' } }
      )
        .then(function (res) { return res.json(); })
        .then(function (data) { renderResults(data); })
        .catch(function () { closeResults(); });
    }

    input.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { search(input.value); }, 350);
    });

    // Keyboard navigation
    input.addEventListener('keydown', function (e) {
      var items = resultsList.querySelectorAll('li:not(.no-results)');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && items[activeIndex]) {
          items[activeIndex].dispatchEvent(new MouseEvent('mousedown'));
        }
        return;
      } else if (e.key === 'Escape') {
        closeResults();
        return;
      }
      items.forEach(function (li, i) {
        li.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
      });
    });

    document.addEventListener('click', function (e) {
      if (!document.getElementById('search-wrapper').contains(e.target)) {
        closeResults();
      }
    });
  }

  // ── 3. User Geolocation (was ── 2.) ─────────────────
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
    var toggleBtn = document.getElementById('basemap-toggle-btn');
    var isOsm = true;

    // Start with Satellite icon since starting map is OSM
    toggleBtn.textContent = '🛰️';
    toggleBtn.title = 'Switch to Satellite';

    toggleBtn.addEventListener('click', function () {
      isOsm = !isOsm;
      if (isOsm) {
        basemapLayer.setVisible(true);
        satLayer.setVisible(false);
        toggleBtn.textContent = '🛰️';
        toggleBtn.title = 'Switch to Satellite';
      } else {
        basemapLayer.setVisible(false);
        satLayer.setVisible(true);
        toggleBtn.textContent = '🗺️';
        toggleBtn.title = 'Switch to Street Map';
      }
    });
  }

  // ── 5. Menu Toggle ───────────────────────────────────
  function setupMenuToggle() {
    var toggleBtn = document.getElementById('menu-toggle');
    var menuContent = document.getElementById('menu-content');

    toggleBtn.addEventListener('click', function () {
      menuContent.classList.toggle('hidden');
    });
  }

  // ── 6. Swipe Compare ────────────────────────────────
  //
  // Landscape: vertical bar dragged left/right (X axis)
  // Portrait (height > width × 1.01): horizontal bar dragged up/down (Y axis)
  //
  // Implemented via WebGL scissor (within a render frame) +
  // CSS clip-path on the WebGL canvas (persists between frames,
  // fixing the "persistent overlay" bug caused by async tile loads).
  function setupSwipe() {
    var handle = document.getElementById('swipe-handle');
    var mapEl = document.getElementById('map');
    var dragging = false;
    var swipeEnabled = true;
    var cogCanvas = null; // cached reference to the WebGLTile canvas

    /** Returns true when the device is in portrait mode (height > width * 1.5). */
    function isPortrait() {
      return mapEl.clientHeight > mapEl.clientWidth * 1.01;
    }

    /** Apply the correct CSS clip to the cached WebGL canvas. */
    function applyClip() {
      if (!cogCanvas || !swipeEnabled) {
        if (cogCanvas) cogCanvas.style.clipPath = 'none';
        return;
      }
      if (isPortrait()) {
        // Keep top portion (0 → swipeY); clip away bottom
        cogCanvas.style.clipPath =
          'inset(0 0 ' + (mapEl.clientHeight - swipeY) + 'px 0)';
      } else {
        // Keep left portion (0 → swipeX); clip away right
        cogCanvas.style.clipPath =
          'inset(0 ' + (mapEl.clientWidth - swipeX) + 'px 0 0)';
      }
    }

    /** Set handle position and class for current orientation, centred. */
    function initOrientation() {
      if (isPortrait()) {
        handle.classList.add('portrait');
        swipeY = mapEl.clientHeight / 2;
        handle.style.top = swipeY + 'px';
        handle.style.left = '';
      } else {
        handle.classList.remove('portrait');
        swipeX = mapEl.clientWidth / 2;
        handle.style.left = swipeX + 'px';
        handle.style.top = '';
      }
      applyClip();
      map.render();
    }

    // Initial placement
    initOrientation();

    // ── Toggle button ──
    var toggleBtn = document.getElementById('swipe-toggle');
    toggleBtn.addEventListener('click', function () {
      swipeEnabled = !swipeEnabled;
      handle.style.display = swipeEnabled ? '' : 'none';
      toggleBtn.textContent = swipeEnabled ? '⇔ Swipe On' : '⇔ Swipe Off';
      toggleBtn.classList.toggle('active', swipeEnabled);
      applyClip();
      map.render();
    });

    // ── Mouse drag ──
    handle.addEventListener('mousedown', function (e) {
      dragging = true;
      e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      updateSwipe(e.clientX, e.clientY, mapEl);
    });

    window.addEventListener('mouseup', function () { dragging = false; });

    // ── Touch drag ──
    handle.addEventListener('touchstart', function (e) {
      dragging = true;
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      updateSwipe(e.touches[0].clientX, e.touches[0].clientY, mapEl);
    }, { passive: true });

    window.addEventListener('touchend', function () { dragging = false; });

    // ── WebGL scissor (clips within the render frame) ──
    cogLayer.on('prerender', function (event) {
      if (!swipeEnabled) return;
      var gl = event.context;
      if (!gl || !gl.enable) return;
      var canvas = gl.canvas;
      gl.enable(gl.SCISSOR_TEST);
      if (isPortrait()) {
        // WebGL Y is bottom-up; scissor the TOP portion (0 → swipeY CSS px)
        var ratioH = canvas.height / mapEl.clientHeight;
        var physH = Math.round(swipeY * ratioH);
        gl.scissor(0, canvas.height - physH, canvas.width, physH);
      } else {
        var ratioW = canvas.width / mapEl.clientWidth;
        gl.scissor(0, 0, Math.round(swipeX * ratioW), canvas.height);
      }
    });

    // ── CSS clip-path (fixes persistence between frames) ──
    cogLayer.on('postrender', function (event) {
      var gl = event.context;
      if (!gl || !gl.disable) return;
      gl.disable(gl.SCISSOR_TEST);
      cogCanvas = gl.canvas;
      applyClip();
    });

    // Re-initialise on resize / orientation change
    window.addEventListener('resize', function () { initOrientation(); });
    window.addEventListener('orientationchange', function () {
      // orientationchange fires before the viewport updates; defer slightly
      setTimeout(initOrientation, 100);
    });
  }

  /** Update swipe position for the current axis and trigger a re-render. */
  function updateSwipe(clientX, clientY, mapEl) {
    var rect = mapEl.getBoundingClientRect();
    if (mapEl.clientHeight > mapEl.clientWidth * 1.01) {
      swipeY = Math.max(0, Math.min(clientY - rect.top, rect.height));
      document.getElementById('swipe-handle').style.top = swipeY + 'px';
    } else {
      swipeX = Math.max(0, Math.min(clientX - rect.left, rect.width));
      document.getElementById('swipe-handle').style.left = swipeX + 'px';
    }
    map.render();
  }



})();
