// ══════════════════════════════════════════════════════════
//  firebase.js  v2.0  —  Firestore proje CRUD (kullanıcı bazlı)
//  Düzeltme: loadShared UID bağımsız, saveProject async düzeltildi
// ══════════════════════════════════════════════════════════
const FirebaseDB = (() => {
  const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/10.12.2';

  async function _getFS() {
    return import(`${FIREBASE_CDN}/firebase-firestore.js`);
  }

  function _requireUID() {
    const uid = Auth.getUID();
    if (!uid) throw new Error('Kaydetmek için giriş yapın');
    return uid;
  }

  async function _getDB() {
    const fs = await _getFS();
    const { getFirestore } = fs;
    return { fs, db: getFirestore(window.__fbApp) };
  }

  // ── Proje Kaydet ───────────────────────────────────────
  async function saveProject(projectData) {
    const uid = _requireUID();
    const { fs, db } = await _getDB();
    const { collection, doc, addDoc, setDoc, serverTimestamp } = fs;
    const now = serverTimestamp();

    // csvData boyut sınırı — Firestore 1MB max field
    let csvToSave = projectData.csvData || '';
    if (csvToSave.length > 900000) {
      csvToSave = csvToSave.slice(0, 900000);
      console.warn('[FirebaseDB] CSV çok büyük, kırpıldı');
    }

    const payload = {
      ...projectData,
      csvData: csvToSave,
      uid,
      updatedAt: now
    };
    delete payload.id; // Firestore doc ID ayrı tutulur

    if (projectData.id) {
      const ref = doc(db, 'users', uid, 'projects', projectData.id);
      await setDoc(ref, payload, { merge: true });
      return projectData.id;
    } else {
      const col = collection(db, 'users', uid, 'projects');
      payload.createdAt = now;
      const ref = await addDoc(col, payload);
      return ref.id;
    }
  }

  // ── Proje Yükle ────────────────────────────────────────
  async function loadProject(id) {
    const uid = _requireUID();
    const { fs, db } = await _getDB();
    const { doc, getDoc } = fs;
    const snap = await getDoc(doc(db, 'users', uid, 'projects', id));
    if (!snap.exists()) throw new Error('Proje bulunamadı');
    return { id: snap.id, ...snap.data() };
  }

  // ── Proje Listesi ──────────────────────────────────────
  async function listProjects() {
    const uid = _requireUID();
    const { fs, db } = await _getDB();
    const { collection, getDocs, orderBy, query } = fs;
    const q    = query(collection(db, 'users', uid, 'projects'), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ── Proje Sil ──────────────────────────────────────────
  async function deleteProject(id) {
    const uid = _requireUID();
    const { fs, db } = await _getDB();
    const { doc, deleteDoc } = fs;
    await deleteDoc(doc(db, 'users', uid, 'projects', id));
  }

  // ── Paylaşım Linki ─────────────────────────────────────
  async function createShareLink(projectId) {
    const uid = _requireUID();
    const { fs, db } = await _getDB();
    const { collection, addDoc, serverTimestamp, Timestamp } = fs;
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);
    const ref = await addDoc(collection(db, 'shared'), {
      projectId,
      uid,
      expiresAt: Timestamp.fromDate(expires),
      viewOnly: true,
      createdAt: serverTimestamp()
    });
    return ref.id;
  }

  // ── Paylaşılan Proje Yükle (UID bağımsız) ─────────────
  async function loadShared(shareId) {
    const { fs, db } = await _getDB();
    const { doc, getDoc } = fs;

    // Paylaşım kaydını al
    const shareSnap = await getDoc(doc(db, 'shared', shareId));
    if (!shareSnap.exists()) throw new Error('Paylaşım linki geçersiz');
    const shareData = shareSnap.data();
    if (shareData.expiresAt?.toDate?.() < new Date()) throw new Error('Paylaşım linkinin süresi dolmuş');

    // Projeyi UID ile çek (orijinal sahibin koleksiyonundan)
    const ownerUID = shareData.uid;
    if (!ownerUID) throw new Error('Paylaşım verisi eksik');
    const projSnap = await getDoc(doc(db, 'users', ownerUID, 'projects', shareData.projectId));
    if (!projSnap.exists()) throw new Error('Proje artık mevcut değil');
    return { id: projSnap.id, ...projSnap.data() };
  }

  // ── Bağlantı Testi ─────────────────────────────────────
  async function testConnection() {
    try {
      if (!window.__fbApp) return { ok: false, error: 'Firebase başlatılmamış' };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return { saveProject, loadProject, listProjects, deleteProject, createShareLink, loadShared, testConnection };
})();
