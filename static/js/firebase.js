const FirebaseDB = (() => {
  function getDB() {
    return window.__db || null;
  }

  function waitForFirebase(timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (window.__fbReady && window.__db) { resolve(window.__db); return; }
      const timer = setTimeout(() => reject(new Error('Firebase bağlantı zaman aşımı')), timeout);
      document.addEventListener('firebase-ready', () => {
        clearTimeout(timer);
        resolve(window.__db);
      }, { once: true });
    });
  }

  async function saveProject(projectData) {
    const { addDoc, setDoc, doc, collection, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const db = await waitForFirebase();
    const now = serverTimestamp();

    if (projectData.id) {
      const ref = doc(db, 'projects', projectData.id);
      await setDoc(ref, { ...projectData, updatedAt: now }, { merge: true });
      return projectData.id;
    } else {
      const ref = await addDoc(collection(db, 'projects'), {
        ...projectData,
        createdAt: now,
        updatedAt: now
      });
      return ref.id;
    }
  }

  async function loadProject(id) {
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const db = await waitForFirebase();
    const snap = await getDoc(doc(db, 'projects', id));
    if (!snap.exists()) throw new Error('Proje bulunamadı');
    return { id: snap.id, ...snap.data() };
  }

  async function listProjects() {
    const { collection, getDocs, orderBy, query } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const db = await waitForFirebase();
    const q = query(collection(db, 'projects'), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function deleteProject(id) {
    const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const db = await waitForFirebase();
    await deleteDoc(doc(db, 'projects', id));
  }

  async function createShareLink(projectId) {
    const { addDoc, collection, serverTimestamp, Timestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const db = await waitForFirebase();
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
    const { doc, getDoc, Timestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const db = await waitForFirebase();
    const shareSnap = await getDoc(doc(db, 'shared', shareId));
    if (!shareSnap.exists()) throw new Error('Paylaşım linki geçersiz');
    const shareData = shareSnap.data();
    if (shareData.expiresAt && shareData.expiresAt.toDate() < new Date()) {
      throw new Error('Paylaşım linki süresi dolmuş');
    }
    return loadProject(shareData.projectId);
  }

  async function testConnection() {
    try {
      await waitForFirebase(4000);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return { saveProject, loadProject, listProjects, deleteProject, createShareLink, loadShared, testConnection, getDB };
})();
