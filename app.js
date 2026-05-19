const state = {
    threshold: parseInt(localStorage.getItem('bicingThreshold')) || 2,
    userPos: [41.3851, 2.1734], // Fixed location (Plaça de Catalunya) for PC testing
    cachedStations: [],
    lastFetchTime: 0,
    map: null,
    userMarker: null,
    arrowEl: null,
    destMarker: null,
    destPos: null,
    destId: null,
    routingLine: null,
    heading: 0,
    isNavigating: false,
    isTracking: false,
    smouOpened: false,
    backgroundInterval: null,
    hasBeeped: false
};

// DOM Elements
const ui = {
    mapEl: document.getElementById('map'),
    recenterBtn: document.getElementById('recenter-btn'),
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
    
    // Dark Map Base
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19
    }).addTo(state.map);
    
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

    // When user touches the map, drop to 2D and zoom out to show the whole route!
    const dropTo2D = () => {
        if (state.isNavigating) {
            state.isTracking = false;
            state.isNavigating = false;
            ui.mapEl.style.transform = 'none';
            if (state.arrowEl) state.arrowEl.style.transform = `rotate(${state.heading}deg)`;
            
            if (ui.recenterBtn) ui.recenterBtn.classList.remove('hidden');
            
            // Zoom out to show both user and destination
            if (state.userPos && state.destPos) {
                // The map canvas is 300vw/300vh (to prevent 3D clipping), meaning there's 100vw of invisible padding on each side.
                // To fit the bounds in the VISIBLE 100vw area, we must pad Leaflet by the invisible amounts!
                const padX = window.innerWidth + 20;
                const padY = window.innerHeight + 20;
                state.map.fitBounds(L.latLngBounds([state.userPos, state.destPos]), { padding: [padX, padY], animate: true, duration: 0.5 });
            }
        }
    };

    state.map.on('dragstart', dropTo2D);
    state.map.on('mousedown', dropTo2D);
    state.map.on('touchstart', dropTo2D);
}

// Notification System
function notify(msg, type = 'info', duration = 3000) {
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    // Omitting text entirely for minimalist dot indicator
    document.getElementById('notification-container').appendChild(el);
    setTimeout(() => {
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 400);
    }, duration);
}

// Event Listeners
function bindEvents() {
    // Recenter button restores 3D navigation
    if (ui.recenterBtn) {
        ui.recenterBtn.addEventListener('click', () => {
            if (!state.isTracking && state.destPos) {
                state.isTracking = true;
                state.isNavigating = true;
                state.map.setView(state.userPos, 19, { animate: true, duration: 1.0 });
                ui.mapEl.style.transform = `scale(2.2) rotateX(75deg) rotateZ(${-state.heading}deg)`;
                if (state.arrowEl) state.arrowEl.style.transform = `rotate(${state.heading}deg)`;
                ui.recenterBtn.classList.add('hidden');
            }
        });
    }

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
            // 3D Tilt Mode: Map rotates to face forward (more tilted to see further ahead)
            ui.mapEl.style.transform = `scale(2.2) rotateX(75deg) rotateZ(${-state.heading}deg)`;
            // Arrow points UP on the screen (which matches where you are looking)
            // Because map is rotated -heading, arrow must rotate +heading to stay upright
            if (state.arrowEl) state.arrowEl.style.transform = `rotate(${state.heading}deg)`;
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
                
                // Keep the camera locked to the user while navigating ONLY if they haven't dragged away
                if (state.isNavigating && state.isTracking) {
                    state.map.setView(state.userPos, 19);
                }
                
                // Geofencing: Auto-open Smou app if within 30 meters
                if (state.isNavigating && state.destPos && !state.smouOpened) {
                    const distToStation = calcDistance(state.userPos[0], state.userPos[1], state.destPos[0], state.destPos[1]) * 1000;
                    if (distToStation < 30) {
                        state.smouOpened = true;
                        notify("Arrived! Opening Smou app...", "success", 5000);
                        // Launch Smou app directly via Android MAIN Intent (prevents Play Store fallback)
                        window.location.href = "intent://#Intent;package=cat.bcn.smoubcn;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end;";
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

// Fetch Stations (with caching)
async function fetchStations(forceNetwork = false) {
    const now = Date.now();
    if (!forceNetwork && state.cachedStations.length > 0 && now - state.lastFetchTime < 14000) {
        return state.cachedStations; // Instant cache return
    }
    
    if (!forceNetwork) notify('Fetching real-time bicing data...', 'info', 2000);
    
    const url = `https://api.citybik.es/v2/networks/bicing`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
    }
    
    const data = await response.json();
    state.cachedStations = data.network.stations || [];
    state.lastFetchTime = Date.now();
    return state.cachedStations;
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
async function findNearestStation(autoMode = false) {
    try {
        if (!autoMode) ui.findBtn.disabled = true;
        state.smouOpened = false; // Reset smou trigger
        
        // 1. Get Location (instant if already watching)
        await getUserLocation();
        
        // 2. Fetch Data (instant from cache)
        const stations = await fetchStations();
        
        // 3. Filter by E-Bikes Threshold
        const validStations = stations.filter(s => {
            const eBikes = s.extra?.ebikes ?? 0;
            return eBikes >= state.threshold;
        });
        
        if (validStations.length === 0) {
            if (!autoMode) notify(`No stations found with ${state.threshold}+ e-bikes`, 'error');
            return null;
        }
        
        // 4. Find Closest
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
        
        if (autoMode && state.destId === closest.station.id && state.isNavigating) {
            // Already navigating to the best one, do nothing
            return closest;
        }
        
        // 5. Draw Destination immediately (Zero Latency UI)
        state.isNavigating = true;
        drawDestination(closest, null, 0, closest.crowDist);
        if (!autoMode) notify('Calculating footpaths...', 'info', 2000);
        
        // 6. Fetch Actual Street Routing asynchronously so UI doesn't block!
        (async () => {
            try {
                let activeRouteGeometry = null;
                let walkTime = 0;
                let distMeters = 0;
                
                try {
                    // Try BRouter first (Slower but 100x smarter for pedestrians)
                    const brouterUrl = `https://brouter.de/brouter?lonlats=${state.userPos[1]},${state.userPos[0]}|${closest.lon},${closest.lat}&profile=shortest&alternativeidx=0&format=geojson`;
                    const res = await fetch(brouterUrl);
                    if (!res.ok) throw new Error("BRouter HTTP Error");
                    const data = await res.json();
                    if (!data.features || data.features.length === 0) throw new Error("No BRouter route");
                    
                    activeRouteGeometry = data.features[0].geometry;
                    walkTime = Math.round(parseInt(data.features[0].properties['total-time']) / 60);
                    distMeters = parseInt(data.features[0].properties['track-length']);
                } catch (err) {
                    // Fallback to OSRM
                    const osrmUrl = `https://router.project-osrm.org/route/v1/foot/${state.userPos[1]},${state.userPos[0]};${closest.lon},${closest.lat}?overview=full&geometries=geojson`;
                    const res = await fetch(osrmUrl);
                    if (!res.ok) throw new Error("Navigation engines offline.");
                    const data = await res.json();
                    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) throw new Error("No OSRM route");
                    
                    activeRouteGeometry = data.routes[0].geometry;
                    walkTime = Math.round(data.routes[0].duration / 60);
                    distMeters = Math.round(data.routes[0].distance);
                }
                
                // Update Route on Map
                updateRoute(activeRouteGeometry, walkTime, distMeters);
                if (!autoMode) notify(`GO! ~${walkTime} min walk`, 'success', 3000);
            } catch (err) {
                console.warn("Routing failed async:", err);
            }
        })();
        
        return closest;
    } catch (err) {
        if (!autoMode) notify(err.message, 'error', 4000);
    } finally {
        if (!autoMode) ui.findBtn.disabled = false;
    }
}

function updateRoute(routeGeometry, walkTime, distMeters) {
    if (state.routingLine) state.map.removeLayer(state.routingLine);
    
    const coords = routeGeometry.coordinates.map(c => [c[1], c[0]]); // GeoJSON is [lon, lat], Leaflet is [lat, lon]
    
    state.routingLine = L.polyline(coords, {
        color: '#32CD32',
        weight: 8,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: '1, 15'
    }).addTo(state.map);
    
    ui.etaText.textContent = `${walkTime} min`;
    ui.distText.textContent = `${distMeters} m`;
}

function drawDestination(dest, routeGeometry, walkTime, distMeters) {
    const s = dest.station;
    const eBikes = s.extra?.ebikes ?? 0;
    state.destPos = [dest.lat, dest.lon]; // Save globally for geofencing
    state.destId = s.id; // Save globally for polling
    
    // Clear old
    if (state.destMarker) state.map.removeLayer(state.destMarker);
    if (state.routingLine) state.map.removeLayer(state.routingLine);
    
    // Create custom marker with e-bike count (Giant balloon)
    const destIcon = L.divIcon({
        html: `
            <div style="background:#32CD32;color:white;width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:32px;border:4px solid white;box-shadow:0 0 20px rgba(50,205,50,0.8);">
                ${eBikes}
            </div>
            <div style="width:0;height:0;border-left:12px solid transparent;border-right:12px solid transparent;border-top:14px solid #32CD32;margin:-2px auto 0;"></div>
        `,
        className: '',
        iconSize: [60, 72],
        iconAnchor: [30, 72]
    });
    
    state.destMarker = L.marker(state.destPos, { icon: destIcon }).addTo(state.map);
    
    // Draw real street routing geometry (GeoJSON) or temporary straight line
    if (routeGeometry) {
        const coords = routeGeometry.coordinates.map(c => [c[1], c[0]]);
        state.routingLine = L.polyline(coords, {
            color: '#32CD32',
            weight: 8,
            opacity: 0.9,
            lineCap: 'round',
            lineJoin: 'round',
            dashArray: '1, 15'
        }).addTo(state.map);
    } else {
        // Temporary straight line while routing API loads
        state.routingLine = L.polyline([state.userPos, state.destPos], {
            color: '#32CD32',
            weight: 8,
            opacity: 0.5,
            lineCap: 'round',
            dashArray: '1, 20'
        }).addTo(state.map);
    }
    
    // Critical: Force Leaflet to update its internal size immediately
    state.map.invalidateSize(true);
    
    // Zoom in hard to the user's location for 3D navigation!
    state.isTracking = true; // Lock camera to GPS
    state.map.setView(state.userPos, 19, { animate: true, duration: 1.5 });
    
    if (ui.recenterBtn) ui.recenterBtn.classList.add('hidden');
    
    // Instantly apply the 3D transform so they don't have to wait for the compass to move
    ui.mapEl.style.transform = `scale(2.2) rotateX(75deg) rotateZ(${-state.heading}deg)`;

    // Update Dashboard UI with real street stats
    ui.etaText.textContent = walkTime > 0 ? `${walkTime} min` : '...';
    ui.distText.textContent = distMeters > 0 ? `${Math.round(distMeters)} m` : '...';
    ui.routeStats.classList.remove('hidden');
}

// --- LIVE POLLING & AUDIO ALARM ---
let audioCtx = null;

function triggerRunAlarm() {
    // Flash red UI
    const wrapper = document.querySelector('.app-wrapper');
    if (wrapper) {
        wrapper.style.transition = "box-shadow 0.2s";
        wrapper.style.boxShadow = "inset 0 0 100px 20px rgba(239, 68, 68, 0.8)";
        setTimeout(() => wrapper.style.boxShadow = "none", 800);
    }
    
    // Web Audio Synthesis beep
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // High pitch A5
    osc.frequency.setValueAtTime(1108.73, audioCtx.currentTime + 0.1); // C#6
    
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
}

async function backgroundEngine() {
    try {
        // 1. Fetch new data silently
        const stations = await fetchStations(true);
        
        if (!state.isNavigating || !state.destId) return;
        
        // 2. Locate current destination
        const destStation = stations.find(s => s.id === state.destId);
        if (!destStation) return;
        
        const eBikes = destStation.extra?.ebikes ?? 0;
        
        // Update marker UI silently
        if (state.destMarker) {
            const popup = state.destMarker.getPopup();
            if (popup) popup.setContent(`<b>${destStation.name || 'Bicing Station'}</b><br>${eBikes} E-Bikes available`);
            
            const destIcon = L.divIcon({
                html: `
                    <div style="background:#32CD32;color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;border:3px solid white;box-shadow:0 0 15px rgba(50,205,50,0.6);">
                        ${eBikes}
                    </div>
                    <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:10px solid #32CD32;margin:-2px auto 0;"></div>
                `,
                className: '',
                iconSize: [36, 46],
                iconAnchor: [18, 46]
            });
            state.destMarker.setIcon(destIcon);
        }
        
        // 3. Condition A: Destination Empty (Auto-Reroute)
        if (eBikes < state.threshold) {
            notify("Station empty! Rerouting...", "error", 5000);
            triggerRunAlarm();
            await findNearestStation(true);
            return;
        }
        
        // 4. Condition B: Closer Station Appeared (Auto-Reroute)
        const currentDist = calcDistance(state.userPos[0], state.userPos[1], destStation.latitude, destStation.longitude);
        
        let bestStation = null;
        let bestDist = Infinity;
        stations.forEach(s => {
            const b = s.extra?.ebikes ?? 0;
            if (b >= state.threshold) {
                const d = calcDistance(state.userPos[0], state.userPos[1], s.latitude, s.longitude);
                if (d < bestDist) {
                    bestDist = d;
                    bestStation = s;
                }
            }
        });
        
        // If best station saves > 50 meters, reroute!
        if (bestStation && bestStation.id !== state.destId && (currentDist - bestDist) > 0.05) {
            notify("Closer bike found! Rerouting...", "success", 5000);
            triggerRunAlarm();
            await findNearestStation(true);
            return;
        }
        
        // 5. Beep if exactly 1 left
        if (eBikes === 1 && !state.hasBeeped) {
            state.hasBeeped = true; // Only beep once
            notify(`RUN! Only 1 e-bike left!`, 'error', 8000);
            triggerRunAlarm();
        }
    } catch(err) {
        console.warn("Background engine failed", err);
    }
}

// Boot
window.onload = () => {
    initMap();
    bindEvents();
    
    // Zero-Latency Parallel Startup
    const gpsPromise = getUserLocation().catch(e => console.warn(e));
    const apiPromise = fetchStations(true).catch(e => console.warn(e));
    
    // Auto-start compass if not on iOS
    if (!(typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')) {
        startCompass();
    }
    
    Promise.all([gpsPromise, apiPromise]).then(() => {
        // Find best station instantly
        findNearestStation(true);
        
        // Start Autonomous Background Engine
        if (state.backgroundInterval) clearInterval(state.backgroundInterval);
        state.backgroundInterval = setInterval(backgroundEngine, 15000);
    });
    
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
