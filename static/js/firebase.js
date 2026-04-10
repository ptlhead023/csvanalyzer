// ══════════════════════════════════════════════════════════
//  firebase.js  —  Firestore project CRUD (user-scoped)
// ══════════════════════════════════════════════════════════
const FirebaseDB = (() => {
  const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/10.12.2';

  async function _getFS() {
    return import(`${FIREBASE_CDN}/firebase-firestore.js`);
  }

  function _getDB() {
    if (!window.__fbApp) throw new Error('Firebase başlatılmamış');
    return null; // getFirestore called inline
  }

  async function _projectsCol() {
    const fs  = await _getFS();
    const { getFirestore, collection } = fs;
    const uid = Auth.getUID();
    if (!uid) throw new Error('Giriş yapılmamış');
    const db = getFirestore(window.__fbApp);
    return { fs, db, col: collection(db, 'users', uid, 'projects'), uid };
  }

  async function saveProject(projectData) {
    const { fs, db, col, uid } = await _projectsCol();
    const { addDoc, setDoc, doc, serverTimestamp } = fs;
    const now = serverTimestamp();
    if (projectData.id) {
      const ref = doc(db, 'users', uid, 'projects', projectData.id);
      await setDoc(ref, { ...projectData, updatedAt: now }, { merge: true });
      return projectData.id;
    } else {
      const ref = await addDoc(col, { ...projectData, createdAt: now, updatedAt: now });
      return ref.id;
    }
  }

  async function loadProject(id) {
    const { fs, db, uid } = await _projectsCol();
    const { doc, getDoc } = fs;
    const snap = await getDoc(doc(db, 'users', uid, 'projects', id));
    if (!snap.exists()) throw new Error('Proje bulunamadı');
    return { id: snap.id, ...snap.data() };
  }

  async function listProjects() {
    const { fs, col } = await _projectsCol();
    const { getDocs, orderBy, query } = fs;
    const q    = query(col, orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function deleteProject(id) {
    const { fs, db, uid } = await _projectsCol();
    const { doc, deleteDoc } = fs;
    await deleteDoc(doc(db, 'users', uid, 'projects', id));
  }

  async function createShareLink(projectId) {
    const { fs, db } = await _projectsCol();
    const { collection, addDoc, serverTimestamp, Timestamp } = fs;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const ref = await addDoc(collection(db, 'shared'), {
      projectId,
      expiresAt: Timestamp.fromDate(expiresAt),
      viewOnly: true,
      createdAt: serverTimestamp()
    });
    return ref.id;
  }

  async function loadShared(shareId) {
    const fs = await _getFS();
    const { getFirestore, doc, getDoc } = fs;
    const db   = getFirestore(window.__fbApp);
    const snap = await getDoc(doc(db, 'shared', shareId));
    if (!snap.exists()) throw new Error('Paylaşım linki geçersiz');
    const shareData = snap.data();
    if (shareData.expiresAt?.toDate() < new Date()) throw new Error('Paylaşım linki süresi dolmuş');
    return loadProject(shareData.projectId);
  }

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
