const state = {
    threshold: parseInt(localStorage.getItem('bicingThreshold')) || 2,
    userPos: [41.3851, 2.1734], // Fixed location (Plaça de Catalunya) for PC testing
    stations: [],
    map: null,
    userMarker: null,
    arrowEl: null,
    destMarker: null,
    destPos: null,
    routingLine: null,
    heading: 0,
    isNavigating: false,
    smouOpened: false
};

// DOM Elements
const ui = {
    mapEl: document.getElementById('map'),
    settingsBtn: document.getElementById('settings-btn'),
    findBtn: document.getElementById('find-btn'),
    locateBtn: document.getElementById('locate-btn'),
    settingsModal: document.getElementById('settings-modal'),
    closeSettingsBtn: document.getElementById('close-settings'),
    saveSettingsBtn: document.getElementById('save-settings'),
    thresholdInput: document.getElementById('ebike-threshold'),
    notifContainer: document.getElementById('notification-container'),
    routeStats: document.getElementById('route-stats'),
    etaText: document.getElementById('eta-text'),
    distText: document.getElementById('dist-text')
};

// Initialize Map
function initMap() {
    state.map = L.map('map', { zoomControl: false }).setView([41.3851, 2.1734], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(state.map);
    
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

    // If user interacts with map, snap out of 3D compass mode so they can pan normally
    state.map.on('dragstart', () => {
        state.isNavigating = false;
        ui.mapEl.style.transform = 'none';
        
        // Ensure compass arrow keeps updating in flat mode
        if (state.arrowEl) {
            state.arrowEl.style.transform = `rotate(${state.heading}deg)`;
        }
    });

    // Allow manual location override via click
    state.map.on('click', (e) => {
        state.userPos = [e.latlng.lat, e.latlng.lng];
        updateUserMarker();
        notify('Manual location set!', 'success', 2000);
        
        // Auto-find nearest if they already clicked find before
        if (state.destMarker) {
            findNearestStation();
        }
    });
}

// Notification System
function notify(msg, type = 'info', duration = 3000) {
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.innerHTML = `<span>${msg}</span>`;
    
    ui.notifContainer.appendChild(el);
    
    setTimeout(() => {
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 400);
    }, duration);
}

// Event Listeners
function bindEvents() {
    ui.settingsBtn.addEventListener('click', openSettings);
    ui.closeSettingsBtn.addEventListener('click', closeSettings);
    ui.saveSettingsBtn.addEventListener('click', saveSettings);
    ui.findBtn.addEventListener('click', () => {
        // Request compass permission on iOS on first interaction
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(permissionState => {
                    if (permissionState === 'granted') {
                        startCompass();
                    }
                })
                .catch(console.error);
        } else {
            startCompass(); // Non-iOS
        }
        findNearestStation();
    });
}

function startCompass() {
    window.addEventListener('deviceorientation', (e) => {
        // Calculate true heading
        let dir = 0;
        if (e.webkitCompassHeading) {
            dir = e.webkitCompassHeading; // iOS
        } else {
            dir = 360 - e.alpha; // Android
        }
        state.heading = dir;
        
        state.arrowEl = document.getElementById('user-arrow');
        
        if (state.isNavigating) {
            // 3D Tilt Mode: Map rotates, Arrow points strictly UP relative to screen
            ui.mapEl.style.transform = `scale(1.7) rotateX(60deg) rotateZ(${-state.heading}deg)`;
            if (state.arrowEl) state.arrowEl.style.transform = `rotate(0deg)`;
        } else {
            // Flat 2D Mode: Map stays still, Arrow spins to show direction
            ui.mapEl.style.transform = 'none';
            if (state.arrowEl) state.arrowEl.style.transform = `rotate(${state.heading}deg)`;
        }
    }, true);
}

function openSettings() {
    ui.thresholdInput.value = state.threshold;
    ui.settingsModal.classList.remove('hidden');
}

function closeSettings() {
    ui.settingsModal.classList.add('hidden');
}

function saveSettings() {
    state.threshold = parseInt(ui.thresholdInput.value);
    
    localStorage.setItem('bicingThreshold', state.threshold);
    
    closeSettings();
    notify('Settings saved successfully', 'success');
}

// Geolocation
let gpsWatchId = null;

function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            console.warn("Geolocation not supported by this browser.");
            updateUserMarker(); // fallback to default
            resolve(state.userPos);
            return;
        }

        // Clear existing watch if any
        if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);

        let initialResolved = false;

        gpsWatchId = navigator.geolocation.watchPosition(
            position => {
                state.userPos = [position.coords.latitude, position.coords.longitude];
                updateUserMarker();
                
                // Geofencing: Auto-open Smou app if within 15 meters
                if (state.isNavigating && state.destPos && !state.smouOpened) {
                    const distToStation = calcDistance(state.userPos[0], state.userPos[1], state.destPos[0], state.destPos[1]) * 1000;
                    if (distToStation < 15) {
                        state.smouOpened = true;
                        notify("Arrived! Opening Smou app...", "success", 5000);
                        // Deep link to Smou app
                        window.location.href = "intent://#Intent;package=cat.bsm.smou;scheme=smou;end;";
                    }
                }
                
                if (!initialResolved) {
                    initialResolved = true;
                    resolve(state.userPos);
                }
            },
            error => {
                console.warn("GPS failed or denied. Using fallback location in Barcelona.");
                if (!initialResolved) {
                    updateUserMarker(); // fallback to default
                    initialResolved = true;
                    resolve(state.userPos);
                }
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
}

function updateUserMarker() {
    if (state.userMarker) {
        state.userMarker.setLatLng(state.userPos);
    } else {
        // Create blue dot with directional arrow
        const userIcon = L.divIcon({
            html: `
                <div style="position:relative;width:32px;height:32px;display:flex;align-items:center;justify-content:center;">
                    <div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:3px solid white;box-shadow:0 0 10px rgba(59,130,246,0.8);z-index:2;position:absolute;"></div>
                    <div id="user-arrow" style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:14px solid #ef4444;position:absolute;top:0px;z-index:1;transform-origin: 8px 16px;transition: transform 0.1s linear;"></div>
                </div>
            `,
            className: '',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });
        state.userMarker = L.marker(state.userPos, { icon: userIcon, zIndexOffset: 1000 }).addTo(state.map);
    }
}

// Fetch Stations
async function fetchStations() {
    notify('Fetching real-time bicing data...', 'info', 2000);
    const url = `https://api.citybik.es/v2/networks/bicing`;
    
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.network.stations || [];
}

// Haversine Distance (km)
function calcDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Find Nearest Station with E-Bikes
async function findNearestStation() {
    try {
        ui.findBtn.disabled = true;
        state.smouOpened = false; // Reset smou trigger
        
        // 1. Get Location
        await getUserLocation();
        
        // 2. Fetch Data
        const stations = await fetchStations();
        
        // 3. Filter by E-Bikes Threshold
        const validStations = stations.filter(s => {
            const eBikes = s.extra?.ebikes ?? 0;
            return eBikes >= state.threshold;
        });
        
        if (validStations.length === 0) {
            notify(`No stations found with ${state.threshold}+ e-bikes`, 'error');
            return;
        }
        
        // 4. Find Closest (As the crow flies just for initial fast filtering)
        let closest = null;
        let minDistance = Infinity;
        
        validStations.forEach(s => {
            const stLon = s.longitude;
            const stLat = s.latitude;
            
            const dist = calcDistance(state.userPos[0], state.userPos[1], stLat, stLon);
            if (dist < minDistance) {
                minDistance = dist;
                closest = { station: s, lat: stLat, lon: stLon, crowDist: dist };
            }
        });
        
        // 5. Fetch Actual Street Routing (BRouter with OSRM fallback)
        notify('Calculating footpaths...', 'info', 2000);
        
        let activeRouteGeometry = null;
        let walkTime = 0;
        let distMeters = 0;

        try {
            // Try BRouter first (best for pedestrians/parks)
            const brouterUrl = `https://brouter.de/brouter?lonlats=${state.userPos[1]},${state.userPos[0]}|${closest.lon},${closest.lat}&profile=shortest&alternativeidx=0&format=geojson`;
            const res = await fetch(brouterUrl);
            if (!res.ok) throw new Error("BRouter HTTP Error");
            const data = await res.json();
            if (!data.features || data.features.length === 0) throw new Error("No BRouter route");
            
            activeRouteGeometry = data.features[0].geometry;
            walkTime = Math.round(parseInt(data.features[0].properties['total-time']) / 60);
            distMeters = parseInt(data.features[0].properties['track-length']);
        } catch (err) {
            console.warn("BRouter failed, falling back to OSRM:", err);
            // Fallback to OSRM (bulletproof snapping for coastal/weird areas)
            const osrmUrl = `https://router.project-osrm.org/route/v1/foot/${state.userPos[1]},${state.userPos[0]};${closest.lon},${closest.lat}?overview=full&geometries=geojson`;
            const res = await fetch(osrmUrl);
            if (!res.ok) throw new Error("Navigation engines offline.");
            const data = await res.json();
            if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) throw new Error("No walking route found.");
            
            activeRouteGeometry = data.routes[0].geometry;
            walkTime = Math.round(data.routes[0].duration / 60);
            distMeters = Math.round(data.routes[0].distance);
        }
        
        // 6. Draw on Map
        state.isNavigating = true;
        drawDestination(closest, activeRouteGeometry, walkTime, distMeters);
        
        notify(`GO! ~${walkTime} min walk`, 'success', 5000);
        
    } catch (err) {
        notify(err.message, 'error', 4000);
    } finally {
        ui.findBtn.disabled = false;
    }
}

function drawDestination(dest, routeGeometry, walkTime, distMeters) {
    const s = dest.station;
    const eBikes = s.extra?.ebikes ?? 0;
    state.destPos = [dest.lat, dest.lon]; // Save globally for geofencing
    
    // Clear old
    if (state.destMarker) state.map.removeLayer(state.destMarker);
    if (state.routingLine) state.map.removeLayer(state.routingLine);
    
    // Create custom marker with e-bike count
    const destIcon = L.divIcon({
        html: `
            <div style="background:#ef4444;color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;border:3px solid white;box-shadow:0 0 15px rgba(239,68,68,0.6);">
                ${eBikes}
            </div>
            <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:10px solid #ef4444;margin:-2px auto 0;"></div>
        `,
        className: '',
        iconSize: [36, 46],
        iconAnchor: [18, 46]
    });
    
    state.destMarker = L.marker(state.destPos, { icon: destIcon }).addTo(state.map);
    state.destMarker.bindPopup(`<b>${s.name || 'Bicing Station'}</b><br>${eBikes} E-Bikes available`).openPopup();
    
    // Draw real street routing geometry (GeoJSON)
    const coords = routeGeometry.coordinates.map(c => [c[1], c[0]]); // GeoJSON is [lon, lat], Leaflet is [lat, lon]
    
    state.routingLine = L.polyline(coords, {
        color: '#ef4444',
        weight: 8,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: '1, 15'
    }).addTo(state.map);
    
    // Critical: Force Leaflet to update its internal size immediately
    state.map.invalidateSize(true);
    
    // Zoom in hard to the user's location for 3D navigation!
    state.map.setView(state.userPos, 19, { animate: true, duration: 1.5 });

    // Update Dashboard UI with real street stats
    ui.etaText.textContent = `${walkTime} min`;
    ui.distText.textContent = `${distMeters} m`;
    ui.routeStats.classList.remove('hidden');
}

// Boot
window.onload = () => {
    initMap();
    bindEvents();
    
    // Automatically try to get real GPS location at startup and instantly start navigating
    getUserLocation().then(() => {
        findNearestStation();
    }).catch(e => console.warn(e));
    
    // Register PWA Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.error(err));
    }
    
    // Fix Leaflet layout bug inside flex containers
    setTimeout(() => state.map.invalidateSize(), 100);
    setTimeout(() => state.map.invalidateSize(), 500);
    setTimeout(() => state.map.invalidateSize(), 1000);
    
    // Also invalidate on window resize
    window.addEventListener('resize', () => {
        if(state.map) state.map.invalidateSize();
    });

    // Register PWA Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('PWA Service Worker registered'))
            .catch(err => console.error('PWA SW failed:', err));
    }
};
