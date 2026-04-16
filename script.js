let currentUserRole = '';
let currentUsername = '';

// ==========================================
// 1. LOGIKA LOGIN & RBAC (PURE FIREBASE)
// ==========================================
function prosesLogin(e) {
    e.preventDefault();
    const user = document.getElementById('login-user').value;
    const pass = document.getElementById('login-pass').value;
    const btn = document.getElementById('btn-login-submit');
    btn.innerText = "Memeriksa..."; btn.disabled = true;
    db.collection("users").where("username", "==", user).where("password", "==", pass).get()
        .then((querySnapshot) => {
            if (!querySnapshot.empty) {
                const userData = querySnapshot.docs[0].data();
                executeLogin(userData.role, user);
            } else { throw new Error("Invalid credentials"); }
        })
        .catch(() => {
            btn.innerText = "LOGIN"; btn.disabled = false;
            document.getElementById('login-error').style.display = 'block';
            setTimeout(() => { document.getElementById('login-error').style.display = 'none'; }, 3000);
        });
}

function executeLogin(role, username) {
    currentUserRole = role; currentUsername = username;
    applyRoleRestrictions();
    document.getElementById('display-logged-user').innerText = `${username} (${role})`;
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('dashboard-view').style.display = 'block';
    setTimeout(() => { map.invalidateSize(true); }, 500);
    syncFirebaseData(); syncKmlDatabase();
}

function applyRoleRestrictions() {
    const isAdmin = currentUserRole === 'Admin Sektor';
    document.getElementById('admin-upload-section').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('admin-btn-inventory').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('admin-btn-teknisi').style.display = isAdmin ? 'block' : 'none';
}

function toggleDashMenu() {
    document.getElementById('dash-fab-menu').classList.toggle('show');
    document.getElementById('dash-fab-btn').classList.toggle('active');
}
function toggleModal(modalId) {
    let modal = document.getElementById(modalId);
    if (modal) modal.style.display = (modal.style.display === "flex") ? "none" : "flex";
    let menu = document.getElementById('dash-fab-menu');
    if (menu && menu.classList.contains('show') && modal.style.display === "flex") toggleDashMenu();
}

// ==========================================
// 2. KML LABEL, MAPS, & FIREBASE SYNC
// ==========================================
const labelStyle = document.createElement('style');
labelStyle.innerHTML = `.kml-label-text { background: transparent !important; border: none !important; box-shadow: none !important; color: white !important; font-weight: bold !important; font-size: 11px !important; text-shadow: 1px 1px 2px black, -1px -1px 2px black, 1px -1px 2px black, -1px 1px 2px black !important; white-space: nowrap; } .kml-label-text::before { display: none !important; }`;
document.head.appendChild(labelStyle);

var stoKlojenCoord = [-7.9645935, 112.6160466];
var stoIcon = L.icon({ iconUrl: 'https://maps.google.com/mapfiles/kml/pal3/icon21.png', iconSize: [45, 45], iconAnchor: [22, 45], popupAnchor: [0, -40] });
var stoMarker = L.marker(stoKlojenCoord, { icon: stoIcon }).addTo(map);
stoMarker.bindPopup(`<div style="text-align: center; font-family: Arial;"><b style="color: #ed1e28; font-size: 14px;">KANTOR PUSAT STO KLOJEN</b><br><hr style="margin: 5px 0; border:0; border-top:1px solid #eee;"><span style="font-size: 12px;">Main Hub Sektor KLJ</span><br><button onclick="map.flyTo([${stoKlojenCoord}], 19); document.getElementById('modal-alpro').style.display='none';" style="margin-top:8px; background:#ed1e28; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Fokus Lokasi</button></div>`);

var layerCable = L.layerGroup().addTo(map);
var layerODP = L.layerGroup().addTo(map);
var layerODC = L.layerGroup().addTo(map);
var layerSektor = L.layerGroup().addTo(map);

// ==========================================
// FILTER DAERAH — DATABASE 33 KODE AREA (TANPA UI CHIP)
// ==========================================
const AREA_CODES = [
    'APG','BLB','BLR','BNR','BRG','BTU','CAT','DNO','DPT',
    'GDG','GDI','GKW','KBN','KEP','KLJ','KPU','LDY','LWG',
    'MLG','NGU','NTG','PAN','PGK','PKS','SBM','SBP','SGS',
    'SNT','SWJ','TMP','TUL','TUR','WGI'
];
let activeMapFilter = null;

function applyMapFilter() {
    const input = document.getElementById('map-filter-input');
    const code = input ? input.value.trim().toUpperCase() : '';
    if (!code) { clearMapFilter(); return; }

    // Auto-complete partial: jika ketik 'KL' otomatis jadi 'KLJ'
    if (!AREA_CODES.includes(code)) {
        const match = AREA_CODES.find(c => c.startsWith(code));
        if (match) { input.value = match; applyMapFilter(); return; }
        // Kode tidak dikenali tapi tetap coba filter (untuk kode baru yg belum terdaftar)
    }
    activeMapFilter = code;
    const badge = document.getElementById('filter-active-badge');
    if (badge) { badge.style.display = 'inline-block'; badge.innerText = `✓ ${code}`; }
    const btnClear = document.getElementById('btn-clear-filter');
    if (btnClear) { btnClear.style.display = 'block'; btnClear.innerText = `✕ Hapus Filter [${code}]`; }
    filterActiveLayers(code);
    console.log(`🗺️ Filter aktif: ${code}`);
}

function clearMapFilter() {
    activeMapFilter = null;
    const input = document.getElementById('map-filter-input'); if (input) input.value = '';
    const badge = document.getElementById('filter-active-badge'); if (badge) badge.style.display = 'none';
    const btnClear = document.getElementById('btn-clear-filter'); if (btnClear) btnClear.style.display = 'none';
    reloadAllActiveLayers();
}

function filterActiveLayers(code) {
    for (const catKey in activeCategoryLayers) {
        if (!activeCategoryLayers[catKey]) continue;
        const parts = catKey.match(/^(.+?)-([A-Z]+)$/);
        if (parts) reloadBatchLayer(parts[1], parts[2], code);
    }
}

function reloadAllActiveLayers() {
    for (const catKey in activeCategoryLayers) {
        const parts = catKey.match(/^(.+?)-([A-Z]+)$/);
        if (parts) reloadBatchLayer(parts[1], parts[2], null);
    }
}

function reloadBatchLayer(fileId, cat, filterCode) {
    const catKey = `${fileId}-${cat}`;
    if (!activeCategoryLayers[catKey]) return;
    map.removeLayer(activeCategoryLayers[catKey]);
    delete activeCategoryLayers[catKey];
    const geoData = cachedGeoJson[fileId]; if (!geoData || !geoData.features) return;
    let features = geoData.features.filter(f => getFeatureCategory(f) === cat);
    if (filterCode) {
        features = features.filter(f => {
            const name = (f.properties && f.properties.name ? f.properties.name : '').toUpperCase();
            const desc = (f.properties && f.properties.description ? f.properties.description : '').toUpperCase();
            return name.includes(filterCode) || desc.includes(filterCode);
        });
    }
    if (features.length === 0) return;
    const layer = createBatchLayer(fileId, cat, features);
    layer.addTo(map);
    activeCategoryLayers[catKey] = layer;
}

// Helper: ekstrak identifier rute dengan memisahkan pencarian spesifik (ODP/ODC) vs baseroute (KABEL/TIANG)
function extractRouteIdentifiers(name) {
    if (!name) return { exact: [], base: [] };
    const withoutPrefix = name.replace(/^(ODP|ODC|DS|TIANG|TL|PS|OPD)[\-\s\/]+/i, '').trim();
    
    // Exact: harus sama persis dengan angka spesifiknya (digunakan untuk memfilter sesama ODP/ODC)
    const exact = [name];
    if (withoutPrefix !== name) exact.push(withoutPrefix);
    
    // Base: ambil jalur utamanya saja tanpa angka (digunakan untuk memanggil JALUR KABEL yang tidak punya indikator /12)
    const base = [...exact];
    const faIndex = withoutPrefix.toUpperCase().indexOf('FA');
    if (faIndex !== -1) {
        // Ekstrak string dari awal sampai kata "FA" (contoh: "KLJ-FA")
        const bPattern = withoutPrefix.substring(0, faIndex + 2);
        if (!base.includes(bPattern)) base.push(bPattern);
    }
    
    return { 
        exact: [...new Set(exact.map(s => s.toUpperCase().trim()))],
        base: [...new Set(base.map(s => s.toUpperCase().trim()))]
    };
}

// Buat regex pencarian yang fleksibel (spasi, strip, garis miring dianggap sama)
function buildFuzzyRegex(str) {
    let escaped = str.trim().toUpperCase().replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    let fuzzy = escaped.replace(/(\\\/|\\-|\s)+/g, '[\\s\\/\\-_]*');
    return new RegExp(fuzzy + "(?![A-Z])", "i");
}

// Cek apakah feature cocok dengan query pencarian berdasarkan kategorinya
function featureMatchesQuery(f, query, cat) {
    if (!f.properties || !f.properties.name) return false;
    const name = f.properties.name.toUpperCase();
    const desc = (f.properties.description || '').toUpperCase();
    
    const queryRegex = buildFuzzyRegex(query);
    if (queryRegex.test(name) || queryRegex.test(desc)) return true;
    
    const identifiers = extractRouteIdentifiers(query);
    // Jika mencari kabel atau tiang distribusi, gunakan base route. 
    // Jika mencari ODP/ODC spesifik, gunakan exact route agar tidak tercampur.
    const idsToUse = (cat === 'KABEL' || cat === 'TIANG' || cat === 'TL') ? identifiers.base : identifiers.exact;
    
    for (const id of idsToUse) {
        if (id.length < 3) continue;
        const routeRegex = buildFuzzyRegex(id);
        if (routeRegex.test(name) || routeRegex.test(desc)) return true;
    }
    return false;
}

function syncFirebaseData() {
    db.collection("employees").onSnapshot((snapshot) => {
        var container = document.getElementById('employee-list');
        var totalElement = document.getElementById('total-teknisi');
        if (!container) return; container.innerHTML = "";
        if (totalElement) totalElement.innerText = snapshot.size;
        snapshot.forEach((doc) => {
            var emp = doc.data();
            var statusColor = emp.status === 'Online' ? '#28a745' : emp.status === 'Busy' ? '#ffc107' : '#888888';
            let deleteBtnHtml = (currentUserRole === 'Admin Sektor') ? `<button onclick="deleteEmployee('${doc.id}')" style="background:none; border:none; color:#b6252a; font-size:10px; cursor:pointer; padding:0; margin-top:5px;">[Hapus]</button>` : '';
            var div = document.createElement('div'); div.className = 'list-item emp-item'; div.style.borderLeft = `5px solid ${statusColor}`;
            div.innerHTML = `<div style="flex:1"><div style="font-weight: bold;">${emp.name}</div><div style="font-size: 11px; color: #666;">${emp.role} - ${emp.area}</div></div><div style="text-align: right;"><div style="font-size: 10px; color: ${statusColor}">● ${emp.status}</div>${deleteBtnHtml}</div>`;
            container.appendChild(div);
        });
    });
    db.collection("inventory").doc("klj_assets").onSnapshot((doc) => {
        if (doc.exists) {
            var d = doc.data();
            ['splicer', 'opm', 'otdr', 'tangga'].forEach(k => {
                let el = document.getElementById('count-' + k); if (el) el.innerText = d[k] || 0;
            });
        }
    });
}

function addEmployee() { if (currentUserRole !== 'Admin Sektor') return; var name = document.getElementById('add-name').value; var role = document.getElementById('add-role').value; var area = document.getElementById('add-area').value; if (!name || !role || !area) return alert("Lengkapi data petugas!"); db.collection("employees").add({ name, role, area, status: "Offline" }).then(() => { alert("Petugas berhasil ditambah!"); document.getElementById('add-name').value = ""; toggleModal('admin-modal'); }); }
function deleteEmployee(id) { if (currentUserRole !== 'Admin Sektor') return; if (confirm("Hapus petugas ini secara permanen?")) { db.collection("employees").doc(id).delete().then(() => alert("Petugas telah dihapus.")); } }
function updateInventory() { if (currentUserRole !== 'Admin Sektor') return; var s = document.getElementById('input-splicer').value; var o = document.getElementById('input-opm').value; var ot = document.getElementById('input-otdr').value; var t = document.getElementById('input-tangga').value; var updateData = {}; if (s) updateData.splicer = parseInt(s); if (o) updateData.opm = parseInt(o); if (ot) updateData.otdr = parseInt(ot); if (t) updateData.tangga = parseInt(t); db.collection("inventory").doc("klj_assets").update(updateData).then(() => { alert("Inventaris diperbarui!"); toggleModal('admin-modal'); }); }
function copyToClipboard(text) { navigator.clipboard.writeText(text).then(() => alert("Salin: " + text)); }
function focusOffice() { map.flyTo(stoKlojenCoord, 18); stoMarker.openPopup(); document.getElementById('modal-alpro').style.display = 'none'; }
function showKlojenArea() { if (layerSektor.getLayers().length > 0) map.fitBounds(layerSektor.getBounds()); document.getElementById('modal-alpro').style.display = 'none'; }

// ==========================================
// 3. KML ENGINE - HIGH PERFORMANCE BATCH RENDERING
// ==========================================
let cachedGeoJson = {};
// activeCategoryLayers[fileId-cat] = satu L.geoJson layer berisi SEMUA fitur kategori tsb
let activeCategoryLayers = {};
// activeFeatureLayers[fileId-index] = layer individual (hanya utk single feature toggle)
let activeFeatureLayers = {};

const kmlIcons = {
    'TIANG': L.icon({ iconUrl: 'https://maps.google.com/mapfiles/kml/shapes/flag.png', iconSize: [32, 32], iconAnchor: [9, 32], popupAnchor: [7, -32] }),
    'TL': L.icon({ iconUrl: 'https://maps.google.com/mapfiles/kml/pal4/icon53.png', iconSize: [32, 32], iconAnchor: [9, 32], popupAnchor: [7, -32] }),
    'ODP': L.icon({ iconUrl: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png', iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -32] }),
    'ODC': L.icon({ iconUrl: 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Cpolygon points="16,2 30,28 2,28" fill="none" stroke="black" stroke-width="6" stroke-linejoin="round"/%3E%3Cpolygon points="16,2 30,28 2,28" fill="none" stroke="red" stroke-width="4" stroke-linejoin="round"/%3E%3C/svg%3E', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14] })
};

function getFeatureCategory(feature) {
    if (!feature || !feature.geometry || !feature.geometry.type) return 'LAINNYA';
    const name = (feature.properties && feature.properties.name ? feature.properties.name : "").toUpperCase();
    if (feature.geometry.type.includes('Line')) return 'KABEL';
    if (name.includes('ODP')) return 'ODP';
    if (name.includes('ODC')) return 'ODC';
    if (name === 'TL' || name.includes('LISTRIK')) return 'TL';
    if (name.includes('T;E') || (name.includes('TIANG') && !name.includes('LISTRIK'))) return 'TIANG';
    return 'LAINNYA';
}

// Helper: buat popup HTML standar
function makePopupHtml(name, lat, lng) {
    return `<div style="font-family: Arial; min-width: 160px;"><b style="color:#ed1e28; font-size:14px;">${name}</b><br><hr style="margin: 5px 0; border: 0; border-top: 1px solid #eee;"><b>Lat:</b> ${lat.toFixed(6)}<br><b>Lng:</b> ${lng.toFixed(6)}<br><br><button onclick="openStreetView(${lat}, ${lng})" style="width:100%; margin-bottom:8px; cursor:pointer; background:#28a745; color:white; border:none; padding:8px; border-radius:4px; font-weight:bold;">🚶‍♂️ Lihat 3D Street View</button><button onclick="copyToClipboard('${lat},${lng}')" style="width:100%; cursor:pointer; background:#ed1e28; color:white; border:none; padding:8px; border-radius:4px; font-weight:bold;">📋 Salin Koordinat</button></div>`;
}

// Helper: style geoJson
function getLineStyle(f) {
    let lineColor = f.properties ? (f.properties.stroke || f.properties["stroke-color"]) : null;
    if (!lineColor) {
        const palette = ["#ff7800", "#28a745", "#9c27b0", "#e91e63", "#00bcd4", "#ffeb3b", "#f44336", "#3f51b5"];
        const ref = f.properties ? (f.properties.styleUrl || f.properties.name || '') : '';
        let hash = 0; for (let i = 0; i < ref.length; i++) hash = ref.charCodeAt(i) + ((hash << 5) - hash);
        lineColor = palette[Math.abs(hash) % palette.length];
    }
    return { color: lineColor, weight: 5, opacity: 0.9 };
}

// ==========================================
// BATCH LAYER: Buat 1 layer berisi SEMUA fitur per kategori
// ==========================================
function createBatchLayer(fileId, cat, features) {
    const featureCollection = { type: "FeatureCollection", features: features };
    const isBig = features.length > 50;
    const layer = L.geoJson(featureCollection, {
        pointToLayer: function (f, latlng) {
            if (isBig) {
                // PERFORMA: Gunakan circleMarker untuk dataset besar (Canvas-based, 100x lebih cepat)
                const colorMap = { 'ODP': '#2196F3', 'ODC': '#f44336', 'TIANG': '#ff9800', 'TL': '#9c27b0' };
                return L.circleMarker(latlng, { radius: 6, fillColor: colorMap[cat] || '#666', color: '#fff', weight: 2, fillOpacity: 0.9 });
            }
            return L.marker(latlng, { icon: kmlIcons[cat] || new L.Icon.Default() });
        },
        style: getLineStyle,
        onEachFeature: function (f, l) {
            var lat, lng;
            var name = (f.properties && f.properties.name) ? f.properties.name : cat;
            if (f.geometry && f.geometry.type === "Point") {
                lat = f.geometry.coordinates[1]; lng = f.geometry.coordinates[0];
                // PERFORMA: Tooltip hanya saat hover untuk dataset besar
                if (!isBig) {
                    l.bindTooltip(name, { permanent: true, direction: 'top', className: 'kml-label-text', offset: [0, -15] });
                } else {
                    l.bindTooltip(name, { permanent: false, direction: 'top', className: 'kml-label-text' });
                }
            } else if (l.getBounds) {
                lat = l.getBounds().getCenter().lat; lng = l.getBounds().getCenter().lng;
            }
            if (lat && lng) l.bindPopup(makePopupHtml(name, lat, lng));
        }
    });
    return layer;
}

// ==========================================
// SYNC KML DATABASE
// ==========================================
function syncKmlDatabase() {
    db.collection("kml_assets").onSnapshot((snapshot) => {
        const container = document.getElementById('kml-database-list'); if (!container) return; container.innerHTML = "";
        let kmlFiles = []; snapshot.forEach((doc) => { let data = doc.data(); data.id = doc.id; kmlFiles.push(data); });
        kmlFiles.sort((a, b) => { let timeA = a.uploadedAt ? a.uploadedAt.toMillis() : 0; let timeB = b.uploadedAt ? b.uploadedAt.toMillis() : 0; return timeB - timeA; });
        if (document.getElementById('kml-count-badge')) document.getElementById('kml-count-badge').innerText = kmlFiles.length;

        kmlFiles.forEach((file) => {
            try {
                const id = file.id;
                if (file.isChunked) {
                    if (!cachedGeoJson[id]) {
                        const card = document.createElement('div'); card.className = 'kml-file-card'; card.id = `card-placeholder-${id}`;
                        card.innerHTML = `<div class="kml-header" style="cursor:pointer;"><span style="flex:1;">📄 ${file.fileName} <span style="color:#007bff; font-size:9px;">⏳ Memuat ${file.totalChunks} chunks...</span></span></div>`;
                        container.appendChild(card);
                        db.collection("kml_assets").doc(id).collection("chunks").orderBy("index").get().then((chunkSnap) => {
                            if (chunkSnap.empty) { db.collection("kml_assets").doc(id).delete(); let p = document.getElementById(`card-placeholder-${id}`); if (p) p.remove(); return; }
                            let combined = ""; chunkSnap.forEach((chunkDoc) => { combined += chunkDoc.data().data; });
                            if (!combined || combined.length === 0) { db.collection("kml_assets").doc(id).delete(); let p = document.getElementById(`card-placeholder-${id}`); if (p) p.remove(); return; }
                            const geoData = JSON.parse(combined); geoData.fileName = file.fileName; cachedGeoJson[id] = geoData;
                            let p = document.getElementById(`card-placeholder-${id}`); if (p) p.remove();
                            renderKmlCard(id, file, geoData, container);
                        }).catch(err => {
                            let p = document.getElementById(`card-placeholder-${id}`);
                            if (p) p.innerHTML = `<div class="kml-header"><span style="flex:1;">📄 ${file.fileName} <span style="color:red; font-size:9px;">❌ Error: ${err.message}</span></span></div>`;
                        });
                    } else { renderKmlCard(id, file, cachedGeoJson[id], container); }
                    return;
                }
                const rawData = file.geojsonData; if (!rawData) return;
                const geoData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
                geoData.fileName = file.fileName; cachedGeoJson[id] = geoData;
                renderKmlCard(id, file, geoData, container);
            } catch (err) { console.error(err); }
        });
    });
}

// ==========================================
// RENDER KML CARD (LAZY LOAD CHILDREN)
// ==========================================
function renderKmlCard(id, file, geoData, container) {
    const grouped = { 'TIANG': [], 'TL': [], 'ODP': [], 'ODC': [], 'KABEL': [] };
    if (geoData.features) geoData.features.forEach((f, index) => { let cat = getFeatureCategory(f); if (grouped[cat]) { f.originalIndex = index; grouped[cat].push(f); } });

    let deleteBtnHtml = (currentUserRole === 'Admin Sektor') ? `<span class="btn-delete-kml" onclick="event.stopPropagation(); deleteKmlFile('${id}')" title="Hapus File">×</span>` : '';
    let chunkBadge = file.isChunked ? ` <span style="color:#007bff; font-size:9px;">(${(file.totalSize / 1024 / 1024).toFixed(1)} MB)</span>` : '';

    const card = document.createElement('div'); card.className = 'kml-file-card';
    let html = `<div class="kml-header" style="cursor:pointer;" onclick="toggleKmlBody('${id}')"><span style="flex:1;">📄 ${file.fileName}${chunkBadge}</span><span id="kml-chevron-${id}" style="margin-right:10px; color:#888; transition:0.3s;">▼</span>${deleteBtnHtml}</div><div id="kml-body-${id}" style="display: none;"> `;
    const catLabels = { 'TIANG': 'TIANG (Telkom)', 'TL': 'TIANG LISTRIK', 'ODP': 'ODP', 'ODC': 'ODC', 'KABEL': 'JALUR KABEL' };

    for (let cat in grouped) {
        if (grouped[cat].length > 0) {
            html += `<div class="layer-item" style="justify-content: space-between; background: #fafafa; border-bottom: 1px solid #eee;"><div style="display:flex; align-items:center; gap:8px;"><input type="checkbox" checked id="chk-${id}-${cat}" onchange="toggleCategoryBatch('${id}', '${cat}')"><label for="chk-${id}-${cat}" style="font-weight:bold; color:#b6252a; font-size: 10px;">${catLabels[cat]} (${grouped[cat].length})</label></div><span onclick="lazyLoadChildren('${id}', '${cat}')" style="cursor:pointer; font-size:18px; padding:0 5px; color:#888;">▾</span></div>`;
            // PERFORMA: Child container kosong, diisi saat user klik expand
            html += `<div id="child-container-${id}-${cat}" style="display:none; padding: 5px 10px 5px 25px; border-bottom: 1px solid #eee; max-height: 200px; overflow-y: auto;" data-loaded="false"></div>`;
        }
    }
    html += `</div>`; card.innerHTML = html; container.appendChild(card);

    // Auto-load semua data secara default
    setTimeout(() => {
        for (let cat in grouped) {
            if (grouped[cat].length > 0) {
                toggleCategoryBatch(id, cat, true); // true = skipZoom
            }
        }
    }, 100);
}

// LAZY LOAD: Render child checkboxes hanya saat user klik expand
function lazyLoadChildren(fileId, cat) {
    let el = document.getElementById(`child-container-${fileId}-${cat}`);
    if (!el) return;
    // Toggle visibility
    if (el.style.display === "block") { el.style.display = "none"; return; }
    el.style.display = "block";
    // Jika sudah pernah di-load, skip
    if (el.getAttribute('data-loaded') === 'true') return;
    el.setAttribute('data-loaded', 'true');

    const geoData = cachedGeoJson[fileId]; if (!geoData || !geoData.features) return;
    let html = '';
    geoData.features.forEach((f, index) => {
        if (getFeatureCategory(f) !== cat) return;
        let featName = (f.properties && f.properties.name) ? f.properties.name : "Aset Tanpa Nama";
        html += `<div class="layer-item" style="border:none; padding: 3px 0; gap: 8px;"><input type="checkbox" class="child-chk-${fileId}-${cat}" data-index="${index}" id="chk-${fileId}-${index}" onchange="toggleSingleFeature('${fileId}', '${cat}', ${index})"><label for="chk-${fileId}-${index}" style="font-size:10px; color:#555;">${featName}</label></div>`;
    });
    el.innerHTML = html;
    // Sync checkbox state jika kategori sudah aktif
    if (activeCategoryLayers[`${fileId}-${cat}`]) {
        el.querySelectorAll(`input[type="checkbox"]`).forEach(chk => chk.checked = true);
    }
}

function toggleKmlBody(id) {
    let body = document.getElementById(`kml-body-${id}`);
    let chevron = document.getElementById(`kml-chevron-${id}`);
    if (body.style.display === "none") { body.style.display = "block"; if (chevron) chevron.style.transform = "rotate(180deg)"; }
    else { body.style.display = "none"; if (chevron) chevron.style.transform = "rotate(0deg)"; }
}

// ==========================================
// TOGGLE CATEGORY - BATCH (1 LAYER UNTUK SELURUH KATEGORI)
// ==========================================
function toggleCategoryBatch(fileId, cat, skipZoom = false) {
    let isChecked = document.getElementById(`chk-${fileId}-${cat}`).checked;
    let catKey = `${fileId}-${cat}`;

    // Sync toast checkbox
    let toastChk = document.getElementById(`toast-chk-${fileId}-${cat}`);
    if (toastChk) toastChk.checked = isChecked;

    if (isChecked) {
        if (!activeCategoryLayers[catKey]) {
            const geoData = cachedGeoJson[fileId]; if (!geoData || !geoData.features) return;
            // PERFORMA: Terapkan filter daerah aktif saat membuat layer baru
            let features = geoData.features.filter(f => getFeatureCategory(f) === cat);
            if (activeMapFilter) {
                features = features.filter(f => {
                    const name = (f.properties && f.properties.name ? f.properties.name : '').toUpperCase();
                    const desc = (f.properties && f.properties.description ? f.properties.description : '').toUpperCase();
                    return name.includes(activeMapFilter) || desc.includes(activeMapFilter);
                });
            }
            if (features.length === 0) return;

            const layer = createBatchLayer(fileId, cat, features);
            layer.addTo(map);
            activeCategoryLayers[catKey] = layer;

            // Fly to bounds
            if (!skipZoom && layer.getBounds && layer.getBounds().isValid()) {
                map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 17 });
            }
        }
    } else {
        if (activeCategoryLayers[catKey]) {
            map.removeLayer(activeCategoryLayers[catKey]);
            delete activeCategoryLayers[catKey];
        }
    }

    // Sync child checkboxes jika sudah di-load
    let childContainer = document.getElementById(`child-container-${fileId}-${cat}`);
    if (childContainer && childContainer.getAttribute('data-loaded') === 'true') {
        childContainer.querySelectorAll('input[type="checkbox"]').forEach(chk => chk.checked = isChecked);
    }

    // Sync toast children
    document.querySelectorAll(`.toast-child-chk-${fileId}-${cat}`).forEach(tc => tc.checked = isChecked);
}

function openStreetView(lat, lng) { document.getElementById('sv-iframe').src = `https://maps.google.com/maps?layer=c&cbll=${lat},${lng}&cbp=11,0,0,0,0&source=embed&output=svembed`; document.getElementById('sv-modal').style.display = 'block'; }
function closeStreetView() { document.getElementById('sv-modal').style.display = 'none'; document.getElementById('sv-iframe').src = ''; }

// Toggle individual feature (untuk pencarian spesifik)
function toggleSingleFeature(fileId, cat, index, skipZoom = false) {
    let chkElem = document.getElementById(`chk-${fileId}-${index}`);
    let isChecked = chkElem ? chkElem.checked : false;
    let layerKey = `${fileId}-${index}`;

    let toastChk = document.getElementById(`toast-chk-${fileId}-${index}`);
    if (toastChk) toastChk.checked = isChecked;

    if (isChecked) {
        if (!activeFeatureLayers[layerKey]) {
            let feature = cachedGeoJson[fileId].features[index];
            let layer = L.geoJson(feature, {
                pointToLayer: function (f, latlng) { return L.marker(latlng, { icon: kmlIcons[cat] || new L.Icon.Default() }); },
                style: getLineStyle,
                onEachFeature: function (f, l) {
                    var lat, lng; var name = (f.properties && f.properties.name) ? f.properties.name : cat;
                    if (f.geometry && f.geometry.type === "Point") { lat = f.geometry.coordinates[1]; lng = f.geometry.coordinates[0]; l.bindTooltip(name, { permanent: true, direction: 'top', className: 'kml-label-text', offset: [0, -15] }); }
                    else if (l.getBounds) { lat = l.getBounds().getCenter().lat; lng = l.getBounds().getCenter().lng; }
                    if (lat && lng) l.bindPopup(makePopupHtml(name, lat, lng));
                }
            }).addTo(map);
            activeFeatureLayers[layerKey] = layer;
            if (!skipZoom) {
                if (layer.getBounds && layer.getBounds().isValid()) map.fitBounds(layer.getBounds(), { maxZoom: 19 });
                else if (layer.getLayers && layer.getLayers()[0] && layer.getLayers()[0].getLatLng) map.flyTo(layer.getLayers()[0].getLatLng(), 19);
            }
            return layer;
        }
    } else {
        if (activeFeatureLayers[layerKey]) { map.removeLayer(activeFeatureLayers[layerKey]); delete activeFeatureLayers[layerKey]; }
    }
    return null;
}

// ==========================================
// DELETE KML
// ==========================================
function deleteKmlFile(id) {
    if (currentUserRole !== 'Admin Sektor') return;
    if (confirm("Hapus file ini dari Database?")) {
        db.collection("kml_assets").doc(id).get().then((doc) => {
            if (doc.exists && doc.data().isChunked) {
                return db.collection("kml_assets").doc(id).collection("chunks").get().then((chunkSnap) => {
                    const batch = db.batch(); chunkSnap.forEach((chunkDoc) => batch.delete(chunkDoc.ref)); return batch.commit();
                });
            }
        }).then(() => db.collection("kml_assets").doc(id).delete()).then(() => {
            // Hapus batch layers
            Object.keys(activeCategoryLayers).forEach(key => { if (key.startsWith(id + '-')) { map.removeLayer(activeCategoryLayers[key]); delete activeCategoryLayers[key]; } });
            Object.keys(activeFeatureLayers).forEach(key => { if (key.startsWith(id + '-')) { map.removeLayer(activeFeatureLayers[key]); delete activeFeatureLayers[key]; } });
            delete cachedGeoJson[id];
        });
    }
}

// ==========================================
// KML UPLOAD + ANTI DUPLIKASI + FILTER DAERAH
// ==========================================
document.getElementById('kml-upload').addEventListener('change', function (e) {
    if (currentUserRole !== 'Admin Sektor') { alert("Hanya Admin yang dapat mengupload!"); return; }
    var file = e.target.files[0]; if (!file) return;
    document.getElementById('loading-indicator').style.display = 'block';
    var reader = new FileReader();
    reader.onload = function (event) {
        try {
            const parser = new DOMParser(); const kmlDom = parser.parseFromString(event.target.result, 'text/xml');
            const styleDict = {}; const styles = kmlDom.getElementsByTagName('Style');
            for (let i = 0; i < styles.length; i++) { const id = styles[i].getAttribute('id'); const lineStyles = styles[i].getElementsByTagName('LineStyle'); if (id && lineStyles.length > 0) { const colorNode = lineStyles[0].getElementsByTagName('color')[0]; if (colorNode) { let aabbggrr = colorNode.textContent.trim(); if (aabbggrr.length === 8) { styleDict['#' + id] = '#' + aabbggrr.substring(6, 8) + aabbggrr.substring(4, 6) + aabbggrr.substring(2, 4); } } } }
            const styleMaps = kmlDom.getElementsByTagName('StyleMap');
            for (let i = 0; i < styleMaps.length; i++) { const id = styleMaps[i].getAttribute('id'); const pairs = styleMaps[i].getElementsByTagName('Pair'); for (let j = 0; j < pairs.length; j++) { const key = pairs[j].getElementsByTagName('key')[0]; const styleUrl = pairs[j].getElementsByTagName('styleUrl')[0]; if (key && key.textContent === 'normal' && styleUrl) { styleDict['#' + id] = styleDict[styleUrl.textContent.trim()]; } } }
            let geojson = toGeoJSON.kml(kmlDom);
            if (geojson.features) {
                geojson.features.forEach(f => { if (f.properties && f.properties.styleUrl) { const exactColor = styleDict[f.properties.styleUrl]; if (exactColor) f.properties.stroke = exactColor; } });

                // FILTER DAERAH
                const enableFilter = document.getElementById('enable-region-filter') ? document.getElementById('enable-region-filter').checked : false;
                const regionCode = document.getElementById('region-filter-code') ? document.getElementById('region-filter-code').value.trim().toUpperCase() : '';
                if (enableFilter && regionCode) {
                    const beforeCount = geojson.features.length;
                    geojson.features = geojson.features.filter(f => {
                        const name = (f.properties && f.properties.name ? f.properties.name : '').toUpperCase();
                        const desc = (f.properties && f.properties.description ? f.properties.description : '').toUpperCase();
                        return name.includes(regionCode) || desc.includes(regionCode);
                    });
                    const afterCount = geojson.features.length;
                    console.log(`🔍 Filter [${regionCode}]: ${beforeCount} → ${afterCount}`);
                    if (afterCount === 0) {
                        document.getElementById('loading-indicator').style.display = 'none';
                        alert(`⚠️ Tidak ada data "${regionCode}" di file ini. Hilangkan centang filter untuk upload semua.`);
                        document.getElementById('kml-upload').value = ''; return;
                    }
                }

                // ANTI DUPLIKASI: Hapus fitur yang sudah ada di database
                let existingNames = new Set();
                for (let fid in cachedGeoJson) {
                    if (cachedGeoJson[fid].features) {
                        cachedGeoJson[fid].features.forEach(f => {
                            if (f.properties && f.properties.name) existingNames.add(f.properties.name.toUpperCase());
                        });
                    }
                }
                if (existingNames.size > 0) {
                    const beforeDedup = geojson.features.length;
                    geojson.features = geojson.features.filter(f => {
                        const name = (f.properties && f.properties.name ? f.properties.name : '').toUpperCase();
                        return !name || !existingNames.has(name);
                    });
                    const afterDedup = geojson.features.length;
                    const dupCount = beforeDedup - afterDedup;
                    if (dupCount > 0) console.log(`🚫 Anti-Duplikasi: ${dupCount} fitur sudah ada, dilewati.`);
                    if (afterDedup === 0) {
                        document.getElementById('loading-indicator').style.display = 'none';
                        alert(`ℹ️ Semua ${beforeDedup} fitur di file ini sudah ada di database.\nTidak ada data baru untuk ditambahkan.`);
                        document.getElementById('kml-upload').value = ''; return;
                    }
                    if (dupCount > 0) alert(`ℹ️ Anti-Duplikasi:\n✅ ${afterDedup.toLocaleString()} fitur baru akan ditambahkan\n🚫 ${dupCount.toLocaleString()} fitur sudah ada (dilewati)`);
                }

                const stringifiedData = JSON.stringify(geojson); const byteSize = new Blob([stringifiedData]).size;
                const CHUNK_LIMIT = 300000;

                if (byteSize <= CHUNK_LIMIT) {
                    db.collection("kml_assets").add({ fileName: file.name, geojsonData: stringifiedData, uploadedAt: firebase.firestore.FieldValue.serverTimestamp() }).then(() => { document.getElementById('loading-indicator').style.display = 'none'; alert("✅ Berhasil disimpan ke Cloud!"); document.getElementById('kml-upload').value = ""; }).catch((err) => { document.getElementById('loading-indicator').style.display = 'none'; alert("❌ Gagal: " + err.message); document.getElementById('kml-upload').value = ""; });
                } else {
                    const totalChunks = Math.ceil(stringifiedData.length / CHUNK_LIMIT);
                    const loadEl = document.getElementById('loading-indicator');
                    const docRef = db.collection("kml_assets").doc();
                    (async function () {
                        async function uploadChunkWithRetry(chunkRef, chunkPayload, maxRetries = 3) {
                            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                                try { await chunkRef.set(chunkPayload); return; }
                                catch (err) { if (attempt === maxRetries) throw err; await new Promise(r => setTimeout(r, 1000 * attempt)); }
                            }
                        }
                        for (let i = 0; i < totalChunks; i++) {
                            const chunkData = stringifiedData.substring(i * CHUNK_LIMIT, (i + 1) * CHUNK_LIMIT);
                            await uploadChunkWithRetry(docRef.collection("chunks").doc(`chunk_${String(i).padStart(4, '0')}`), { index: i, data: chunkData });
                            loadEl.innerText = `⌛ Upload chunk ${i + 1}/${totalChunks} (${Math.round(((i + 1) / totalChunks) * 100)}%)`;
                        }
                        await docRef.set({ fileName: file.name, isChunked: true, totalChunks, totalSize: byteSize, uploadedAt: firebase.firestore.FieldValue.serverTimestamp() });
                        loadEl.style.display = 'none'; loadEl.innerText = '⌛ Memproses KML...';
                        alert(`✅ Berhasil! ${totalChunks} chunks (${(byteSize / 1024 / 1024).toFixed(2)} MB)`);
                        document.getElementById('kml-upload').value = "";
                    })().catch((err) => { loadEl.style.display = 'none'; loadEl.innerText = '⌛ Memproses KML...'; alert("❌ Gagal: " + err.message); document.getElementById('kml-upload').value = ""; });
                }
            }
        } catch (error) { document.getElementById('loading-indicator').style.display = 'none'; alert("Gagal memproses KML: " + error.message); }
    }; reader.readAsText(file);
});

// ==========================================
// TOAST KML + SINKRONISASI
// ==========================================
function toggleToastCategory(fileId, cat) {
    let isChecked = document.getElementById(`toast-chk-${fileId}-${cat}`).checked;
    let mainChk = document.getElementById(`chk-${fileId}-${cat}`);
    if (mainChk) { mainChk.checked = isChecked; toggleCategoryBatch(fileId, cat); }
}

function toggleToastSingleFeature(fileId, cat, index) {
    let isChecked = document.getElementById(`toast-chk-${fileId}-${index}`).checked;
    let mainChk = document.getElementById(`chk-${fileId}-${index}`);
    if (mainChk) { mainChk.checked = isChecked; toggleSingleFeature(fileId, cat, index, true); }
}

function toggleToastExpand(containerId) {
    let el = document.getElementById(`toast-child-container-${containerId}`);
    if (el) el.style.display = (el.style.display === "none" || el.style.display === "") ? "block" : "none";
}

function showActiveKmlToast(openedFilesMap) {
    let toast = document.getElementById('active-kml-toast'); let list = document.getElementById('active-kml-list');
    if (!toast || !list) return;
    list.innerHTML = ""; list.style.paddingLeft = "0";
    const catLabels = { 'TIANG': 'TIANG (Telkom)', 'TL': 'TIANG LISTRIK', 'ODP': 'ODP', 'ODC': 'ODC', 'KABEL': 'JALUR KABEL' };
    openedFilesMap.forEach((fileName, fileId) => {
        let geoData = cachedGeoJson[fileId]; if (!geoData) return;
        let grouped = { 'TIANG': [], 'TL': [], 'ODP': [], 'ODC': [], 'KABEL': [] };
        if (geoData.features) geoData.features.forEach(f => { let cat = getFeatureCategory(f); if (grouped[cat]) grouped[cat].push(f); });
        let fileHtml = `<div style="margin-bottom: 10px; background: #f9f9f9; border: 1px solid #eee; border-radius: 6px; overflow: hidden;"><div style="padding: 6px 10px; background: #f1f1f1; font-weight: bold; color: #333;">📄 ${fileName}</div>`;
        for (let cat in grouped) {
            if (grouped[cat].length > 0) {
                let mainChk = document.getElementById(`chk-${fileId}-${cat}`);
                let isChecked = mainChk ? (mainChk.checked ? 'checked' : '') : '';
                fileHtml += `<div style="padding: 6px 10px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #eee;"><div style="display: flex; align-items: center; gap: 8px;"><input type="checkbox" id="toast-chk-${fileId}-${cat}" onchange="toggleToastCategory('${fileId}', '${cat}')" style="accent-color: #ed1e28; cursor: pointer;" ${isChecked}><label for="toast-chk-${fileId}-${cat}" style="cursor: pointer; font-weight: normal;">${catLabels[cat]} (${grouped[cat].length})</label></div><span onclick="toggleToastExpand('${fileId}-${cat}')" style="cursor: pointer; font-size: 16px; color: #888; padding: 0 5px;">▾</span></div><div id="toast-child-container-${fileId}-${cat}" style="display: none; padding: 5px 10px 5px 25px; border-top: 1px solid #eee; max-height: 150px; overflow-y: auto; background: #fff;">`;
                grouped[cat].forEach(f => {
                    let featName = (f.properties && f.properties.name) ? f.properties.name : "Aset Tanpa Nama";
                    let idx = f.originalIndex;
                    let mainChildChk = document.getElementById(`chk-${fileId}-${idx}`);
                    let isChildChecked = mainChildChk ? (mainChildChk.checked ? 'checked' : '') : '';
                    fileHtml += `<div style="padding: 3px 0; display: flex; align-items: center; gap: 8px;"><input type="checkbox" class="toast-child-chk-${fileId}-${cat}" id="toast-chk-${fileId}-${idx}" data-index="${idx}" onchange="toggleToastSingleFeature('${fileId}', '${cat}', ${idx})" style="accent-color: #ed1e28; cursor: pointer;" ${isChildChecked}><label for="toast-chk-${fileId}-${idx}" style="font-size: 10px; color: #555; cursor: pointer;">${featName}</label></div>`;
                });
                fileHtml += `</div>`;
            }
        }
        fileHtml += `</div>`;
        list.insertAdjacentHTML('beforeend', fileHtml);
    });
    toast.style.display = 'block';
}

function toggleEntireFile(fileId, isChecked) {
    let geoData = cachedGeoJson[fileId]; if (!geoData || !geoData.features) return;
    // Gunakan batch toggle per-kategori, jauh lebih cepat
    ['TIANG', 'TL', 'ODP', 'ODC', 'KABEL'].forEach(cat => {
        let parentChk = document.getElementById(`chk-${fileId}-${cat}`);
        if (parentChk && parentChk.checked !== isChecked) {
            parentChk.checked = isChecked;
            toggleCategoryBatch(fileId, cat);
        }
    });
}

// ==========================================
// SEARCH ODP/ODC & RADIUS SCAN
// ==========================================
function cariTitikAset() {
    var rawInput = document.getElementById('search-aset').value.trim();
    if (!rawInput) return alert("Masukkan nama aset!");
    var input = rawInput.toUpperCase();
    var found = false; var targetLeafletLayer = null; let openedFiles = new Map();

    for (let fileId in cachedGeoJson) {
        let geoData = cachedGeoJson[fileId];
        if (!geoData.features) continue;

        // Cek apakah ada minimal 1 fitur yang cocok secara fuzzy
        const anyMatch = geoData.features.some(f => featureMatchesQuery(f, input));
        if (!anyMatch) {
            ['TIANG', 'TL', 'ODP', 'ODC', 'KABEL'].forEach(cat => {
                let parentChk = document.getElementById(`chk-${fileId}-${cat}`);
                if (parentChk) parentChk.checked = false;
                let catKey = `${fileId}-${cat}`;
                if (activeCategoryLayers[catKey]) {
                    map.removeLayer(activeCategoryLayers[catKey]);
                    delete activeCategoryLayers[catKey];
                }
            });
            continue;
        }

        found = true;
        openedFiles.set(fileId, geoData.fileName || "Database KML");

        // Expand card di sidebar
        let body = document.getElementById(`kml-body-${fileId}`);
        let chevron = document.getElementById(`kml-chevron-${fileId}`);
        if (body && body.style.display === 'none') { body.style.display = 'block'; if (chevron) chevron.style.transform = "rotate(180deg)"; }

        // ==============================================
        // AKTIFKAN SELURUH ISI FILE 
        // Permintaan user: otomatis nyalakan semua (ODC, ODP, Kabel, dll) saat pencarian
        // ==============================================
        const allCats = ['ODC', 'ODP', 'TL', 'TIANG', 'KABEL'];
        
        allCats.forEach(cat => {
            // 1. Pastikan checkbox kategori dicentang
            let parentChk = document.getElementById(`chk-${fileId}-${cat}`);
            if (parentChk) {
                parentChk.checked = true;
            }
            
            // 2. Tampilkan/Aktifkan layer secara penuh (tanpa filter sepotong)
            toggleCategoryBatch(fileId, cat, true); // true = skip zoom otomatis agar kita bisa zoom ke ODP
            
            // 3. Cari secara spesifik layer Leaflet dari ODP/Aset yang dicari untuk titik Zoom
            let catKey = `${fileId}-${cat}`;
            let layerGroup = activeCategoryLayers[catKey];
            if (layerGroup) {
                layerGroup.eachLayer(l => {
                    if (l.feature && featureMatchesQuery(l.feature, input, cat)) {
                        // Prioritaskan ODP atau ODC sebagai target fokus utama (daripada sekadar kabel)
                        if (!targetLeafletLayer && (cat === 'ODP' || cat === 'ODC')) {
                            targetLeafletLayer = l;
                        } else if (!targetLeafletLayer) {
                            targetLeafletLayer = l;
                        }
                    }
                });
            }
        });
    }

    if (found && targetLeafletLayer) {
        if (openedFiles.size > 0) showActiveKmlToast(openedFiles);
        
        let latlng = targetLeafletLayer.getLatLng ? targetLeafletLayer.getLatLng() : 
                     (targetLeafletLayer.getBounds ? targetLeafletLayer.getBounds().getCenter() : null);
                     
        if (latlng) {
            map.flyTo(latlng, 19);
            setTimeout(() => {
                if (targetLeafletLayer.openPopup) targetLeafletLayer.openPopup();
            }, 800);
        } else if (targetLeafletLayer.getBounds) {
            map.flyToBounds(targetLeafletLayer.getBounds(), { maxZoom: 19 });
        }
    }
    if (!found) alert("Aset '" + rawInput + "' tidak ditemukan di database KML.");
}

document.getElementById('search-aset').addEventListener('keypress', (e) => { if (e.key === 'Enter') cariTitikAset(); });

// INISIALISASI PLUGIN LEAFLET RULER
L.control.ruler({ position: 'topright', lengthUnit: { display: 'm', decimal: 0, factor: 1000, label: 'Jarak:' }, angleUnit: { display: '°', decimal: 0, label: 'Arah:' } }).addTo(map);

let searchCircle = null; let searchMarker = null;
function cariTitikKoordinat() {
    var input = document.getElementById('search-koordinat').value.trim(); if (!input) return alert("Masukkan koordinat!");
    var coords = input.split(/[, ]+/).filter(Boolean); if (coords.length < 2) return alert("Format salah (contoh: -7.964, 112.616)");
    var lat = parseFloat(coords[0]); var lng = parseFloat(coords[1]); if (isNaN(lat) || isNaN(lng)) return alert("Koordinat harus angka!");
    var targetLatLng = L.latLng(lat, lng);
    if (searchCircle) map.removeLayer(searchCircle); if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker(targetLatLng, { icon: L.icon({ iconUrl: 'https://maps.google.com/mapfiles/kml/paddle/grn-circle.png', iconSize: [45, 45], iconAnchor: [22, 45], popupAnchor: [0, -45] }) }).addTo(map);
    searchCircle = L.circle(targetLatLng, { stroke: true, color: '#ffffff', weight: 1.5, dashArray: '5, 5', fillColor: '#000000', fillOpacity: 0.35, radius: 100 }).addTo(map);
    map.flyTo(targetLatLng, 18);

    let asetDitemukan = { 'TIANG': 0, 'TL': 0, 'ODP': 0, 'ODC': 0, 'KABEL': 0 }; let total = 0; let openedFiles = new Map();
    for (let id in cachedGeoJson) {
        let geoData = cachedGeoJson[id];
        if (geoData.features) {
            let hasMatch = false;
            geoData.features.forEach(f => {
                if (!f.geometry || !f.geometry.type || !f.geometry.coordinates) return;
                let cat = getFeatureCategory(f);
                if (f.geometry.type === "Point") {
                    if (map.distance(targetLatLng, L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0])) <= 100) { if (asetDitemukan[cat] !== undefined) { asetDitemukan[cat]++; total++; } hasMatch = true; }
                } else if (f.geometry.type === "LineString") {
                    if (f.geometry.coordinates.some(c => map.distance(targetLatLng, L.latLng(c[1], c[0])) <= 100)) { asetDitemukan['KABEL']++; total++; hasMatch = true; }
                }
            });
            if (hasMatch) {
                openedFiles.set(id, geoData.fileName || "Database KML");
                // Aktifkan semua kategori via batch
                ['TIANG', 'TL', 'ODP', 'ODC', 'KABEL'].forEach(cat => {
                    let parentChk = document.getElementById(`chk-${id}-${cat}`);
                    if (parentChk && !parentChk.checked) { parentChk.checked = true; toggleCategoryBatch(id, cat); }
                });
                let body = document.getElementById(`kml-body-${id}`); let chevron = document.getElementById(`kml-chevron-${id}`);
                if (body && body.style.display === 'none') { body.style.display = 'block'; if (chevron) chevron.style.transform = "rotate(180deg)"; }
            }
        }
    }
    if (openedFiles.size > 0) showActiveKmlToast(openedFiles);
    let popupHtml = `<div style="font-family: Arial; text-align: center; min-width: 160px;"><b style="color:#28a745; font-size:14px;">Lokasi Pencarian</b><br><span style="font-size:10px; color:#666;">Lat: ${lat}, Lng: ${lng}</span><hr style="margin: 5px 0; border: 0; border-top: 1px solid #eee;"><b style="font-size:12px;">Aset Telkom (Radius 100 M):</b><div style="text-align: left; font-size: 11px; margin-top: 5px; line-height:1.5;">${asetDitemukan['TIANG'] > 0 ? `Tiang Telkom: <b>${asetDitemukan['TIANG']} titik</b><br>` : ''}${asetDitemukan['TL'] > 0 ? `Tiang Listrik: <b>${asetDitemukan['TL']} titik</b><br>` : ''}${asetDitemukan['ODP'] > 0 ? `ODP: <b>${asetDitemukan['ODP']} titik</b><br>` : ''}${asetDitemukan['ODC'] > 0 ? `ODC: <b>${asetDitemukan['ODC']} titik</b><br>` : ''}${asetDitemukan['KABEL'] > 0 ? `Jalur Kabel: <b>${asetDitemukan['KABEL']} segmen</b><br>` : ''}${total === 0 ? `<i style="color:#ed1e28;">Tidak ada aset terdeteksi.</i>` : ''}</div></div>`;
    searchMarker.bindPopup(popupHtml).openPopup();
}

// LOCAL CARD (fallback)
function renderLocalCard(id, fileName, geoData) {
    const container = document.getElementById('kml-database-list');
    geoData.fileName = fileName; cachedGeoJson[id] = geoData;
    // Reuse renderKmlCard
    renderKmlCard(id, { fileName: fileName, isChunked: false }, geoData, container);
}
function hapusLocalCard(id) { if (currentUserRole !== 'Admin Sektor') return; if (confirm("Hapus file lokal ini?")) { Object.keys(activeCategoryLayers).forEach(key => { if (key.startsWith(id + '-')) { map.removeLayer(activeCategoryLayers[key]); delete activeCategoryLayers[key]; } }); Object.keys(activeFeatureLayers).forEach(key => { if (key.startsWith(id + '-')) { map.removeLayer(activeFeatureLayers[key]); delete activeFeatureLayers[key]; } }); delete cachedGeoJson[id]; let card = document.getElementById(`card-${id}`); if (card) card.remove(); } }
document.addEventListener('DOMContentLoaded', () => { let searchInput = document.getElementById('search-koordinat'); if (searchInput) { searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') cariTitikKoordinat(); }); } });

// ==========================================
// 4. SAPU BERSIH (TUTUP TOAST & CLEAR PETA)
// ==========================================
function closeAndClearKmlToast() {
    document.getElementById('active-kml-toast').style.display = 'none';
    for (let fileId in cachedGeoJson) toggleEntireFile(fileId, false);
    if (searchCircle) map.removeLayer(searchCircle);
    if (searchMarker) map.removeLayer(searchMarker);
    document.getElementById('search-aset').value = '';
    document.getElementById('search-koordinat').value = '';
    map.flyTo(stoKlojenCoord, 16);
}