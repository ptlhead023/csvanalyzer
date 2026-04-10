const Admin = (() => {
  const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/10.12.2';

  async function _getModules() {
    const fs = await import(`${FIREBASE_CDN}/firebase-firestore.js`);
    return { fs };
  }

  async function _getDB() {
    const { fs } = await _getModules();
    const { getFirestore } = fs;
    return getFirestore(window.__fbApp);
  }

  async function getAllUsers() {
    const { fs } = await _getModules();
    const { collection, getDocs, query, orderBy } = fs;
    const db = await _getDB();
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function banUser(uid, banned) {
    const { fs } = await _getModules();
    const { doc, setDoc } = fs;
    const db = await _getDB();
    await setDoc(doc(db, 'users', uid), { banned }, { merge: true });
  }

  async function setUserRole(uid, role) {
    const { fs } = await _getModules();
    const { doc, setDoc } = fs;
    const db = await _getDB();
    await setDoc(doc(db, 'users', uid), { role }, { merge: true });
  }

  async function setUserPlan(uid, plan) {
    const { fs } = await _getModules();
    const { doc, setDoc } = fs;
    const db = await _getDB();
    await setDoc(doc(db, 'users', uid), { plan }, { merge: true });
  }

  async function toggleRegistration(disabled) {
    const { fs } = await _getModules();
    const { doc, setDoc } = fs;
    const db = await _getDB();
    await setDoc(doc(db, 'admin_settings', 'global'), { registrationDisabled: disabled }, { merge: true });
  }

  async function getRegistrationStatus() {
    const { fs } = await _getModules();
    const { doc, getDoc } = fs;
    const db = await _getDB();
    const snap = await getDoc(doc(db, 'admin_settings', 'global'));
    return snap.exists() ? snap.data().registrationDisabled || false : false;
  }

  async function getStats() {
    const users = await getAllUsers();
    const activeUsers = users.filter(u => {
      const lastLogin = u.lastLogin?.toDate?.();
      if (!lastLogin) return false;
      const daysSince = (Date.now() - lastLogin.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince <= 7;
    });

    const { fs } = await _getModules();
    const { collection, getDocs } = fs;
    const db = await _getDB();
    
    let totalProjects = 0;
    for (const user of users) {
      const projectsSnap = await getDocs(collection(db, 'users', user.id, 'projects'));
      totalProjects += projectsSnap.size;
    }

    return {
      totalUsers: users.length,
      activeUsers: activeUsers.length,
      bannedUsers: users.filter(u => u.banned).length,
      adminUsers: users.filter(u => u.role === 'admin').length,
      totalProjects,
      planDistribution: {
        free: users.filter(u => u.plan === 'free').length,
        pro: users.filter(u => u.plan === 'pro').length,
        enterprise: users.filter(u => u.plan === 'enterprise').length
      }
    };
  }

  async function getUserProjects(uid) {
    const { fs } = await _getModules();
    const { collection, getDocs, query, orderBy } = fs;
    const db = await _getDB();
    const q = query(collection(db, 'users', uid, 'projects'), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function getUserAPIs(uid) {
    const { fs } = await _getModules();
    const { collection, getDocs } = fs;
    const db = await _getDB();
    const snap = await getDocs(collection(db, 'users', uid, 'apis'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function deleteUserAPI(uid, apiId) {
    const { fs } = await _getModules();
    const { doc, deleteDoc } = fs;
    const db = await _getDB();
    await deleteDoc(doc(db, 'users', uid, 'apis', apiId));
  }

  async function getAllAPIs() {
    const users = await getAllUsers();
    const allAPIs = [];
    for (const user of users) {
      const apis = await getUserAPIs(user.id);
      apis.forEach(api => allAPIs.push({ ...api, userId: user.id, userEmail: user.email }));
    }
    return allAPIs;
  }

  return {
    getAllUsers,
    banUser,
    setUserRole,
    setUserPlan,
    toggleRegistration,
    getRegistrationStatus,
    getStats,
    getUserProjects,
    getUserAPIs,
    deleteUserAPI,
    getAllAPIs
  };
})();
