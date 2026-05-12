const state = {
    threshold: parseInt(localStorage.getItem('bicingThreshold')) || 2,
    userPos: [41.3851, 2.1734], // Fixed location (Plaça de Catalunya) for PC testing
    stations: [],
    map: null,
    userMarker: null,
    destMarker: null,
    routingLine: null,
    heading: 0,
    isNavigating: false
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
        if (!state.isNavigating) return;
        
        // Calculate true heading
        let dir = 0;
        if (e.webkitCompassHeading) {
            dir = e.webkitCompassHeading; // iOS
        } else {
            dir = 360 - e.alpha; // Android (rough approximation, absolute orientation is better but this works for demo)
        }
        
        state.heading = dir;
        
        // Apply 3D perspective and rotation to the map
        ui.mapEl.style.transform = `scale(1.5) rotateX(60deg) rotateZ(${-state.heading}deg)`;
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
        const userIcon = L.divIcon({
            html: '<div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:3px solid white;box-shadow:0 0 10px rgba(59,130,246,0.8);"></div>',
            className: '',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });
        state.userMarker = L.marker(state.userPos, { icon: userIcon }).addTo(state.map);
        state.map.setView(state.userPos, 15);
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
        
        // 5. Fetch Actual Street Routing from BRouter (Pedestrian logic)
        notify('Calculating footpaths...', 'info', 2000);
        
        const brouterUrl = `https://brouter.de/brouter?lonlats=${state.userPos[1]},${state.userPos[0]}|${closest.lon},${closest.lat}&profile=shortest&alternativeidx=0&format=geojson`;
        const routeRes = await fetch(brouterUrl);
        if (!routeRes.ok) throw new Error("Could not fetch foot route.");
        
        const routeData = await routeRes.json();
        if (!routeData.features || routeData.features.length === 0) {
            throw new Error("No walking route found.");
        }
        
        const activeRoute = routeData.features[0];
        
        // 6. Draw on Map
        state.isNavigating = true;
        drawDestination(closest, activeRoute);
        
        // Convert BRouter 'total-time' string to integer seconds
        const rawTime = activeRoute.properties['total-time']; // usually "123"
        const walkTime = Math.round(parseInt(rawTime) / 60);
        
        notify(`GO! ~${walkTime} min walk through streets`, 'success', 5000);
        
    } catch (err) {
        notify(err.message, 'error', 4000);
    } finally {
        ui.findBtn.disabled = false;
    }
}

function drawDestination(dest, route) {
    const s = dest.station;
    const eBikes = s.extra?.ebikes ?? 0;
    const destPos = [dest.lat, dest.lon];
    
    // Clear old
    if (state.destMarker) state.map.removeLayer(state.destMarker);
    if (state.routingLine) state.map.removeLayer(state.routingLine);
    
    // Create custom marker with e-bike count
    const destIcon = L.divIcon({
        html: `
            <div style="background:var(--success);color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;border:3px solid white;box-shadow:0 0 15px rgba(16,185,129,0.6);">
                ${eBikes}
            </div>
            <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:10px solid var(--success);margin:-2px auto 0;"></div>
        `,
        className: '',
        iconSize: [36, 46],
        iconAnchor: [18, 46]
    });
    
    state.destMarker = L.marker(destPos, { icon: destIcon }).addTo(state.map);
    state.destMarker.bindPopup(`<b>${s.name || 'Bicing Station'}</b><br>${eBikes} E-Bikes available`).openPopup();
    
    // Draw real street routing geometry (BRouter GeoJSON)
    const coords = route.geometry.coordinates.map(c => [c[1], c[0]]); // GeoJSON is [lon, lat], Leaflet is [lat, lon]
    
    state.routingLine = L.polyline(coords, {
        color: '#10b981',
        weight: 8,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: '1, 15' // Makes it look a bit like dots
    }).addTo(state.map);
    
    // Critical: Force Leaflet to update its internal size immediately
    state.map.invalidateSize(true);
    
    // Zoom in hard to the user's location for 3D navigation!
    state.map.setView(state.userPos, 19, { animate: true, duration: 1.5 });

    // Update Dashboard UI with real street stats
    const rawTime = route.properties['total-time'];
    const walkTime = Math.round(parseInt(rawTime) / 60);
    ui.etaText.textContent = `${walkTime} min`;
    
    const distMeters = route.properties['track-length'];
    ui.distText.textContent = `${distMeters} m`;
    ui.routeStats.classList.remove('hidden');
}

// Boot
window.onload = () => {
    initMap();
    bindEvents();
    
    // Automatically try to get real GPS location at startup
    getUserLocation();
    
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
