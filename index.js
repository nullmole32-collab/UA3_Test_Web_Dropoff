// URL to Apps Script (writes)
var scriptUrl =
  'https://script.google.com/macros/s/AKfycbz0FH4SPT_E4pfzapw1DLyvEl-VsG079krsWv1EFe-ezrykIHHiiCbZkBqX52Jmyr3s8g/exec';

// Live JSON (reads)
var listUrl = scriptUrl + '?action=list';

var latestLocations = [];

// ---- Map ----
var map = L.map('map', {
  zoomControl: false
}).setView([40.7128, -74.0060], 11);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// ---- Mode state ----
var editingEnabled = false;

const buttons = {
  view: document.getElementById('viewBtn'),
  edit: document.getElementById('editBtn'),
  detail: document.getElementById('detailBtn')
};

function activateMode(name) {
  Object.values(buttons).forEach(btn => btn.classList.remove('active-mode'));
  buttons[name].classList.add('active-mode');

  var mapEl = document.getElementById('map');
  var detailEl = document.getElementById('detailedPanel');
  var editOverlay = document.getElementById('editOverlay');
  var addBtnTop = document.getElementById('addBtnTop');

  // whenever we change mode, exit add mode
  addingNew = false;
  map.getContainer().style.cursor = '';
  if (tempNewMarker) {
    map.removeLayer(tempNewMarker);
    tempNewMarker = null;
  }
  if (addBtnTop) addBtnTop.classList.remove('add-active');

  if (name === 'detail') {
    mapEl.style.display = 'none';
    detailEl.classList.remove('hidden');
    editingEnabled = false;
    editOverlay.classList.add('hidden');
    if (addBtnTop) addBtnTop.classList.add('hidden');

    // render the live detailed table
    renderDetailedTable(latestLocations);

  } else if (name === 'edit') {
    mapEl.style.display = 'block';
    detailEl.classList.add('hidden');
    editingEnabled = true;
    editOverlay.classList.add('hidden');
    if (addBtnTop) addBtnTop.classList.remove('hidden');  // show Add in Edit mode only
  } else {
    // view
    mapEl.style.display = 'block';
    detailEl.classList.add('hidden');
    editingEnabled = false;
    editOverlay.classList.add('hidden');
    if (addBtnTop) addBtnTop.classList.add('hidden');
  }
}

buttons.view.addEventListener('click', () => activateMode('view'));
buttons.edit.addEventListener('click', () => activateMode('edit'));
buttons.detail.addEventListener('click', () => activateMode('detail'));

var addBtnTop = document.getElementById('addBtnTop');

if (addBtnTop) {
  addBtnTop.addEventListener('click', function () {
    if (!editingEnabled) {
      statusEl.textContent = 'Switch to Edit mode to add locations.';
      statusEl.style.color = 'red';
      return;
    }

    // enter add mode
    addingNew = true;
    currentEditingId = null;
    lastClickedLatLng = null;

    addBtnTop.classList.add('add-active');

    statusEl.textContent = 'Add mode: click on the map where the new location should be.';
    statusEl.style.color = 'black';
    map.getContainer().style.cursor = 'crosshair';

    if (tempNewMarker) {
      map.removeLayer(tempNewMarker);
      tempNewMarker = null;
    }
  });
}

// default mode
activateMode('view');

// ---- Edit overlay fields ----
var locationInput = document.getElementById('locationInput');
var hubInput = document.getElementById('hubInput');
var addressInput = document.getElementById('addressInput');
var viabilityInput = document.getElementById('viabilityInput');
var notesInput = document.getElementById('notesInput');
var expectingInput = document.getElementById('expectingInput');
var driverInput = document.getElementById('driverInput');
var latInput = document.getElementById('latInput');
var lngInput = document.getElementById('lngInput');
var statusEl = document.getElementById('status');
var saveBtn = document.getElementById('saveBtn');
var cancelBtn = document.getElementById('cancelBtn');
var editOverlay = document.getElementById('editOverlay');
var overlayTitle = document.getElementById('overlayTitle');

// ---- Marker state ----
var locationsById = {};
var markersById = {};
var nextId = 1;
var currentEditingId = null;
var lastClickedLatLng = null;

// add-mode state
var addingNew = false;
var tempNewMarker = null;

// ---- Marker drawing (hub / expecting colors + outline) ----
function drawMarker(loc) {
  var fill = "#555555";  // default: dark grey (not expecting)
  var expecting = (loc.expecting || "").toLowerCase();
  var hub = (loc.hub || "").toLowerCase();

  var isHub =
    hub === "yes" ||
    hub === "y" ||
    hub === "true" ||
    hub === "1";

  if (isHub) {
    fill = "#f4d03f";    // yellow hub
  } else if (
    expecting === "yes" ||
    expecting === "y" ||
    expecting === "true" ||
    expecting === "1"
  ) {
    fill = "#28a745";    // green expecting
  }

  var popupHtml =
    '<b>ID ' + loc.id + ' — ' + (loc.name || 'Unnamed') + '</b><br>' +
    (loc.addr ? loc.addr + '<br>' : '') +
    (loc.viability ? 'Viability: ' + loc.viability + '/10<br>' : '') +
    (loc.notes ? 'Notes: ' + loc.notes + '<br>' : '') +
    'Hub: ' + (loc.hub || '') + '<br>' +
    'Expecting: ' + (loc.expecting || '') + '<br>' +
    'Driver: ' + (loc.driver || 'Unassigned') + '<br>' +
    '<button type="button" class="edit-marker-btn" data-id="' + loc.id + '">Edit</button> ' +
    '<button type="button" class="delete-marker-btn" data-id="' + loc.id + '">Delete</button>';

  var marker = L.circleMarker([loc.lat, loc.lng], {
    radius: 10,
    fillColor: fill,
    fillOpacity: 1,
    color: "#000000",
    weight: 2
  })
    .addTo(map)
    .bindPopup(popupHtml);

  markersById[loc.id] = marker;
}

// ---- Load markers from live JSON ----
function loadMarkersFromSheet() {
  var url = listUrl + '&cacheBust=' + Date.now();

  fetch(url)
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data || !data.ok || !data.locations) {
        console.warn('Bad JSON from script', data);
        return;
      }

      latestLocations = data.locations.slice(); // keep a copy for Detailed tab

      // clear old markers from map
      for (var id in markersById) {
        if (markersById.hasOwnProperty(id)) {
          map.removeLayer(markersById[id]);
        }
      }
      markersById = {};
      locationsById = {};

      var maxExistingId = 0;

      data.locations.forEach(function (row) {
        var id = Number(row.id);
        if (!id || isNaN(id)) return;

        var lat = Number(row.lat);
        var lng = Number(row.lng);
        if (isNaN(lat) || isNaN(lng)) return;

        if (id > maxExistingId) maxExistingId = id;

        var loc = {
          id: id,
          name: row.name || '',
          hub: row.hub || '',
          addr: row.addr || '',
          lat: lat,
          lng: lng,
          viability: row.viability || '',
          notes: row.notes || '',
          expecting: row.expecting || '',
          driver: row.driver || ''
        };

        locationsById[id] = loc;
        drawMarker(loc);
      });

      nextId = maxExistingId + 1;
      if (nextId < 1) nextId = 1;

      // If user is currently on Detailed tab, re-render
      if (!document.getElementById('detailedPanel').classList.contains('hidden')) {
        renderDetailedTable(latestLocations);
      }
    })
    .catch(function (err) {
      console.error('Error loading locations JSON', err);
    });
}

// initial load
loadMarkersFromSheet();

// ---- Popup Edit/Delete handlers ----
map.on('popupopen', function (e) {
  var popupEl = e.popup.getElement();
  if (!popupEl) return;

  var editBtn = popupEl.querySelector('.edit-marker-btn');
  var deleteBtn = popupEl.querySelector('.delete-marker-btn');

  // VIEW MODE: hide buttons entirely
  if (!editingEnabled) {
    if (editBtn)   editBtn.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
    return;
  }

  // EDIT MODE: show and wire buttons
  if (editBtn) {
    editBtn.style.display = 'inline-block';
    editBtn.onclick = function () {
      var id = parseInt(this.getAttribute('data-id'), 10);
      var loc = locationsById[id];
      if (!loc) return;

      // fill overlay form
      currentEditingId  = id;
      lastClickedLatLng = L.latLng(loc.lat, loc.lng);

      locationInput.value  = loc.name || '';
      hubInput.value       = loc.hub || 'No';
      addressInput.value   = loc.addr || '';
      viabilityInput.value = loc.viability || '';
      notesInput.value     = loc.notes || '';
      expectingInput.value = loc.expecting || 'No';
      driverInput.value    = loc.driver || '';
      latInput.value       = loc.lat.toFixed(6);
      lngInput.value       = loc.lng.toFixed(6);

      statusEl.textContent = 'Editing ID ' + id + '.';
      statusEl.style.color = 'black';

      if (overlayTitle) overlayTitle.textContent = 'Edit Location';

      editOverlay.classList.remove('hidden');
    };
  }

  if (deleteBtn) {
    deleteBtn.style.display = 'inline-block';
    deleteBtn.onclick = function () {
      var id = parseInt(this.getAttribute('data-id'), 10);
      var loc = locationsById[id];
      if (!loc) return;

      if (!editingEnabled) {
        statusEl.textContent = 'Switch to Edit mode to delete markers.';
        statusEl.style.color = 'red';
        return;
      }

      if (markersById[id]) {
        map.removeLayer(markersById[id]);
        delete markersById[id];
      }
      delete locationsById[id];

      fetch(scriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', ID: id })
      }).catch(function (err) {
        console.error('Delete error', err);
      });

      statusEl.textContent = 'Deleted ID ' + id + ' (sheet should update).';
      statusEl.style.color = 'black';
      editOverlay.classList.add('hidden');

      // Pull fresh data from sheet
      loadMarkersFromSheet();
    };
  }
});

// ---- Detailed table renderer (no lat/lng columns) ----
function renderDetailedTable(locations) {
  var wrapper = document.getElementById('detailTableWrapper');
  if (!wrapper) return;

  if (!locations || locations.length === 0) {
    wrapper.innerHTML = '<p>No locations found.</p>';
    return;
  }

  var html = '<table><thead><tr>' +
    '<th>ID</th>' +
    '<th>Location</th>' +
    '<th>Hub</th>' +
    '<th>Address</th>' +
    '<th>Viability</th>' +
    '<th>Notes</th>' +
    '<th>Expecting</th>' +
    '<th>Driver</th>' +
    '</tr></thead><tbody>';

  locations.forEach(function (loc) {
    html += '<tr>' +
      '<td>' + loc.id + '</td>' +
      '<td>' + escapeHtml(loc.name || '') + '</td>' +
      '<td>' + escapeHtml(loc.hub || '') + '</td>' +
      '<td>' + escapeHtml(loc.addr || '') + '</td>' +
      '<td>' + escapeHtml(loc.viability || '') + '</td>' +
      '<td>' + escapeHtml(loc.notes || '') + '</td>' +
      '<td>' + escapeHtml(loc.expecting || '') + '</td>' +
      '<td>' + escapeHtml(loc.driver || '') + '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  wrapper.innerHTML = html;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Save button (add + update) ----
saveBtn.addEventListener('click', function () {
  statusEl.textContent = '';

  if (!editingEnabled) {
    statusEl.textContent = 'Switch to Edit mode to edit locations.';
    statusEl.style.color = 'red';
    return;
  }

  if (!lastClickedLatLng) {
    statusEl.textContent = 'No location selected on map.';
    statusEl.style.color = 'red';
    return;
  }

  var locationName = locationInput.value.trim();
  var hubVal       = hubInput.value;
  var addressVal   = addressInput.value.trim();
  var viabilityVal = viabilityInput.value.trim();
  var notesVal     = notesInput.value.trim();
  var expectingVal = expectingInput.value;
  var driverVal    = driverInput.value.trim();

  if (!locationName) {
    statusEl.textContent = 'Location name is required.';
    statusEl.style.color = 'red';
    return;
  }

  var isNew = (currentEditingId == null);
  var id = currentEditingId;

  var payload = {
    action: isNew ? 'add' : 'update',
    ID: isNew ? '' : id,
    Location: locationName,
    Hub: hubVal,
    Address: addressVal,
    Lat: lastClickedLatLng.lat,
    Lng: lastClickedLatLng.lng,
    Viability: viabilityVal,
    Notes: notesVal,
    ExpectingLoad: expectingVal,
    Driver: driverVal
  };

  statusEl.textContent = 'Updating ID ' + (id || '(new)') + '...';
  statusEl.style.color = 'black';

  fetch(scriptUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
    .then(function () {
      statusEl.textContent = isNew
        ? 'New location saved (sheet will assign ID).'
        : 'Updated ID ' + id + '.';
      statusEl.style.color = 'green';
      editOverlay.classList.add('hidden');
      currentEditingId = null;

      // leave add mode and remove temp marker
      addingNew = false;
      map.getContainer().style.cursor = '';
      if (tempNewMarker) {
        map.removeLayer(tempNewMarker);
        tempNewMarker = null;
      }
      if (addBtnTop) addBtnTop.classList.remove('add-active');

      // Reload everything from the sheet so the map matches the real data
      loadMarkersFromSheet();
    })
    .catch(function (err) {
      console.error(err);
      statusEl.textContent = 'Error submitting. See console.';
      statusEl.style.color = 'red';
    });
});

// ---- Map click to place new location in Add mode ----
map.on('click', function (e) {
  if (!addingNew) return;

  // temporary marker for the new location
  if (tempNewMarker) {
    map.removeLayer(tempNewMarker);
  }

  tempNewMarker = L.circleMarker(e.latlng, {
    radius: 10,
    fillColor: '#007bff', // blue temp marker
    fillOpacity: 1,
    color: '#000',
    weight: 2
  }).addTo(map);

  lastClickedLatLng = e.latlng;
  currentEditingId = null;  // new row

  // clear form fields for a new location
  locationInput.value  = '';
  hubInput.value       = 'No';
  addressInput.value   = '';
  viabilityInput.value = '';
  notesInput.value     = '';
  expectingInput.value = 'No';
  driverInput.value    = '';
  latInput.value       = e.latlng.lat.toFixed(6);
  lngInput.value       = e.latlng.lng.toFixed(6);

  statusEl.textContent = 'New location placed. Fill in details and click Save.';
  statusEl.style.color = 'black';

  if (overlayTitle) overlayTitle.textContent = 'Add Location';

  editOverlay.classList.remove('hidden');
});

// ---- Cancel button just hides overlay ----
cancelBtn.addEventListener('click', function () {
  editOverlay.classList.add('hidden');
  currentEditingId = null;

  addingNew = false;
  map.getContainer().style.cursor = '';
  if (tempNewMarker) {
    map.removeLayer(tempNewMarker);
    tempNewMarker = null;
  }
  if (addBtnTop) addBtnTop.classList.remove('add-active');
});
