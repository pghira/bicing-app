// Configuration & State
const state = {
    threshold: parseInt(localStorage.getItem('bicingThreshold')) || 2,
    userPos: [41.3851, 2.1734], // Fixed location (Plaça de Catalunya) for PC testing
    stations: [],
    map: null,
    userMarker: null,
    destMarker: null,
    routingLine: null
};

// DOM Elements
const ui = {
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
    ui.findBtn.addEventListener('click', findNearestStation);
    if(ui.locateBtn) {
        ui.locateBtn.addEventListener('click', () => {
            getUserLocation().then(pos => state.map.setView(pos, 15)).catch(err => notify(err.message, 'error'));
        });
    }
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
        
        // 5. Fetch Actual Street Routing from OSRM
        notify('Calculating street walking route...', 'info', 2000);
        
        const osrmUrl = `https://router.project-osrm.org/route/v1/foot/${state.userPos[1]},${state.userPos[0]};${closest.lon},${closest.lat}?overview=full&geometries=geojson`;
        const routeRes = await fetch(osrmUrl);
        if (!routeRes.ok) throw new Error("Could not fetch street route.");
        
        const routeData = await routeRes.json();
        if (routeData.code !== 'Ok' || !routeData.routes || routeData.routes.length === 0) {
            throw new Error("No walking route found.");
        }
        
        const activeRoute = routeData.routes[0];
        
        // 6. Draw on Map
        drawDestination(closest, activeRoute);
        
        const walkTime = Math.round(activeRoute.duration / 60);
        notify(`Found nearest e-bikes! ~${walkTime} min walk along streets`, 'success', 5000);
        
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
    
    // Draw real street routing geometry
    const coords = route.geometry.coordinates.map(c => [c[1], c[0]]); // GeoJSON is [lon, lat], Leaflet is [lat, lon]
    
    state.routingLine = L.polyline(coords, {
        color: '#10b981',
        weight: 6,
        opacity: 0.8,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(state.map);
    
    // Critical: Force Leaflet to update its internal size immediately before zooming
    state.map.invalidateSize(true);
    
    // Auto-frame the miniature map around the route
    state.map.fitBounds(state.routingLine.getBounds(), {
        padding: [30, 30],
        maxZoom: 17,
        animate: true,
        duration: 1
    });

    // Update Dashboard UI with real street stats
    const walkTime = Math.round(route.duration / 60);
    ui.etaText.textContent = `${walkTime} min`;
    ui.distText.textContent = `${Math.round(route.distance)} m`;
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
