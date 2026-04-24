let socket;
let map;
let droneMarker;
let waypointMarkers = [];
let waypointPath;
let waypoints = [];
let token = 'test';
let peer;

const WP_TYPE_WAYPOINT = 16;
const WP_TYPE_LAND = 21;

function initDashboard() {
    token = document.getElementById('token-input').value;
    document.getElementById('token-screen').classList.add('hidden');
    
    // Show UI elements
    document.getElementById('view-toggle').classList.remove('hidden');
    document.getElementById('top-left').classList.remove('hidden');
    document.getElementById('top-right').classList.remove('hidden');
    document.getElementById('bottom-left').classList.remove('hidden');
    document.getElementById('bottom-center').classList.remove('hidden');
    document.getElementById('bottom-right').classList.remove('hidden');

    socket = io();
    initPeer();
    initMap();
    initJoystick();
}

function initJoystick() {
    const container = document.getElementById('joystick-container');
    const handle = document.getElementById('joystick-handle');
    let dragging = false;

    const startDragging = (e) => {
        dragging = true;
        updateJoystick(e);
    };

    const stopDragging = () => {
        if (!dragging) return;
        dragging = false;
        handle.style.transform = 'translate(0,0)';
        sendAction('move', { pitch: 0, roll: 0, throttle: 0 });
    };

    const updateJoystick = (e) => {
        if (!dragging) return;
        
        const rect = container.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        let clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
        let clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);

        let x = clientX - rect.left - centerX;
        let y = clientY - rect.top - centerY;

        const maxRadius = rect.width / 2 - handle.offsetWidth / 2;
        const distance = Math.sqrt(x*x + y*y);
        
        if (distance > maxRadius) {
            x *= maxRadius / distance;
            y *= maxRadius / distance;
        }

        handle.style.transform = `translate(${x}px, ${y}px)`;

        // Map to -100 to 100 for the drone
        const roll = Math.round((x / maxRadius) * 100);
        const pitch = Math.round(-(y / maxRadius) * 100); // Inverted Y for pitch

        sendAction('move', { pitch, roll, throttle: 0 });
    };

    container.addEventListener('mousedown', startDragging);
    window.addEventListener('mousemove', updateJoystick);
    window.addEventListener('mouseup', stopDragging);
    
    container.addEventListener('touchstart', startDragging);
    window.addEventListener('touchmove', updateJoystick);
    window.addEventListener('touchend', stopDragging);
}

function initPeer() {
    peer = new SimplePeer({ initiator: false });

    peer.on('signal', data => {
        socket.emit('signal', data);
    });

    socket.on('signal', data => {
        peer.signal(data);
    });

    peer.on('stream', stream => {
        console.log('Received live stream');
        const video = document.getElementById('live-video');
        video.srcObject = stream;
    });

    peer.on('connect', () => {
        console.log('Peer connected');
        peer.send(JSON.stringify({ action: 'init', data: { token } }));
    });

    peer.on('data', data => {
        const packet = JSON.parse(data.toString());
        handlePacket(packet);
    });
}

function handlePacket(packet) {
    switch(packet.action) {
        case 'state':
            if (packet.data.isDiscoConnected !== undefined) {
                const dot = document.getElementById('dot-health');
                dot.className = 'dot ' + (packet.data.isDiscoConnected ? 'active' : 'error');
            }
            if (packet.data.flyingTime !== undefined) {
                updateFlightTime(packet.data.flyingTime);
            }
            if (packet.data.flyingState !== undefined) {
                updateFlyingState(packet.data.flyingState);
            }
            break;
        case 'gps':
            if (packet.data.isFixed !== undefined) {
                const gpsEl = document.getElementById('gps-status');
                gpsEl.innerText = packet.data.isFixed ? 'FIXED' : 'NO FIX';
                gpsEl.style.color = packet.data.isFixed ? 'var(--success)' : 'var(--danger)';
            }
            if (packet.data.location) {
                updateDroneLocation(packet.data.location.lat, packet.data.location.lon);
            }
            if (packet.data.satellites !== undefined) {
                document.getElementById('sats').innerText = packet.data.satellites;
            }
            break;
        case 'altitude':
            document.getElementById('alt').innerText = Math.round(packet.data);
            break;
        case 'speed':
            document.getElementById('speed').innerText = Math.round(packet.data * 3.6);
            break;
        case 'battery':
            const pct = packet.data.percent;
            document.getElementById('bat-text').innerText = pct + '%';
            const fill = document.getElementById('bat-fill');
            fill.style.width = pct + '%';
            fill.style.background = pct < 20 ? 'var(--danger)' : (pct < 50 ? 'var(--warning)' : 'var(--success)');
            break;
        case 'latency':
            document.getElementById('latency').innerText = packet.data + ' ms';
            document.getElementById('dot-latency').className = 'dot active';
            break;
        case 'alert':
            console.log('ALERT:', packet.data.message);
            // Optionally implement a custom alert UI here
            break;
    }
}

function updateFlightTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    document.getElementById('flight-time').innerText = 
        String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

function updateFlyingState(state) {
    // state: 1 = taking off, 2 = flying, 3 = landing, 4 = landed
    const btnTakeoff = document.getElementById('btn-takeoff');
    const btnLand = document.getElementById('btn-land');
    
    if (state === 4) { // Landed
        btnTakeoff.classList.remove('hidden');
        btnLand.classList.add('hidden');
    } else {
        btnTakeoff.classList.add('hidden');
        btnLand.classList.remove('hidden');
    }
}

function initMap() {
    map = L.map('map').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // Request user location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            const { latitude, longitude } = position.coords;
            console.log(`User location found: ${latitude}, ${longitude}`);
            if (map.getZoom() < 5) {
                map.setView([latitude, longitude], 15);
            }
        }, (err) => {
            console.warn("User denied geolocation or error occurred:", err);
        });
    }

    droneMarker = L.marker([0, 0], { 
        icon: L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/512/2963/2963840.png',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        })
    }).addTo(map);

    waypointPath = L.polyline([], { color: 'var(--accent-blue)', weight: 3, dashArray: '5, 10' }).addTo(map);

    map.on('click', (e) => {
        if (!document.getElementById('map-container').classList.contains('hidden')) {
            addWaypoint(e.latlng.lat, e.latlng.lng);
        }
    });
}

function updateDroneLocation(lat, lon) {
    const pos = [lat, lon];
    droneMarker.setLatLng(pos);
    document.getElementById('lat').innerText = lat.toFixed(6);
    document.getElementById('lon').innerText = lon.toFixed(6);
    if (map.getZoom() < 5) map.setView(pos, 15);
}

function addWaypoint(lat, lon) {
    // Inherit altitude from last waypoint if it exists, otherwise default to 50
    const lastWp = waypoints[waypoints.length - 1];
    const defaultAlt = lastWp ? lastWp.alt : 50;

    const wp = { lat, lon, alt: defaultAlt, type: WP_TYPE_WAYPOINT };
    waypoints.push(wp);
    
    const marker = L.marker([lat, lon], { draggable: true }).addTo(map);
    marker.bindPopup(`WP #${waypoints.length}`).openPopup();
    
    marker.on('dragend', (e) => {
        const index = waypointMarkers.indexOf(marker);
        const newPos = marker.getLatLng();
        waypoints[index].lat = newPos.lat;
        waypoints[index].lon = newPos.lng;
        updatePath();
    });

    waypointMarkers.push(marker);
    updatePath();
    renderWaypointList();
}

function updatePath() {
    waypointPath.setLatLngs(waypoints.map(w => [w.lat, w.lon]));
}

function renderWaypointList() {
    const list = document.getElementById('wp-list');
    list.innerHTML = '';
    waypoints.forEach((wp, i) => {
        const item = document.createElement('div');
        item.style = 'background:rgba(255,255,255,0.05); margin-bottom:4px; padding:5px; border-radius:3px; display:flex; justify-content:space-between;';
        item.innerHTML = `
            <span>#${i+1}</span>
            <input type="number" value="${wp.alt}" style="width:40px; background:none; border:1px solid #444; color:white" onchange="updateWpAlt(${i}, this.value)">
            <button onclick="removeWaypoint(${i})" style="background:none; border:none; color:var(--danger); cursor:pointer">X</button>
        `;
        list.appendChild(item);
    });
}

function updateWpAlt(index, alt) { waypoints[index].alt = Number(alt); }

function removeWaypoint(index) {
    map.removeLayer(waypointMarkers[index]);
    waypointMarkers.splice(index, 1);
    waypoints.splice(index, 1);
    updatePath();
    renderWaypointList();
}

function clearWaypoints() {
    waypointMarkers.forEach(m => map.removeLayer(m));
    waypointMarkers = [];
    waypoints = [];
    updatePath();
    renderWaypointList();
}

async function saveFlightPlan() {
    const name = document.getElementById('fp-name').value;
    if (!waypoints.length) return;
    const finalWaypoints = JSON.parse(JSON.stringify(waypoints));
    if (confirm("Set final waypoint as LAND?")) finalWaypoints[finalWaypoints.length - 1].type = WP_TYPE_LAND;
    
    const response = await fetch('/api/flightplans/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, waypoints: finalWaypoints })
    });
    if ((await response.json()).status === 'success') alert('MISSION SAVED');
}

function sendAction(action, data = null) {
    if (peer && peer.connected) peer.send(JSON.stringify({ action, data }));
}

function takeOff() { sendAction('takeOff'); }
function land() { sendAction('land'); }
function emergency() { sendAction('emergency', 'landingFlightPlan'); }
function startFlightPlan() { sendAction('flightPlanStart', document.getElementById('fp-name').value); }

let moveInterval;
function startMove(pitch, roll) {
    if (moveInterval) clearInterval(moveInterval);
    moveInterval = setInterval(() => {
        sendAction('move', { pitch, roll, throttle: 0 });
    }, 100);
}

function stopMove() {
    if (moveInterval) {
        clearInterval(moveInterval);
        moveInterval = null;
    }
    sendAction('move', { pitch: 0, roll: 0, throttle: 0 });
}

function switchView(view) {
    const isMap = view === 'map';
    document.getElementById('map-container').classList.toggle('hidden', !isMap);
    document.getElementById('pilot-container').classList.toggle('hidden', isMap);
    document.getElementById('flight-plan-panel').classList.toggle('hidden', !isMap);
    
    document.getElementById('toggle-pilot').classList.toggle('active', !isMap);
    document.getElementById('toggle-map').classList.toggle('active', isMap);
    
    if (isMap) setTimeout(() => map.invalidateSize(), 100);
}
