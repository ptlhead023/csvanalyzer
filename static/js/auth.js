// ══════════════════════════════════════════════════════════
//  auth.js  —  Google Auth + Firestore user management
// ══════════════════════════════════════════════════════════
const Auth = (() => {
  let _user = null;
  let _onChangeCallbacks = [];

  const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/10.12.2';

  async function _getModules() {
    const [authMod, fsMod] = await Promise.all([
      import(`${FIREBASE_CDN}/firebase-auth.js`),
      import(`${FIREBASE_CDN}/firebase-firestore.js`)
    ]);
    return { auth: authMod, fs: fsMod };
  }

  async function getAuthInstance() {
    const { auth } = await _getModules();
    const { getAuth } = auth;
    return getAuth(window.__fbApp);
  }

  // ── Sign in ──────────────────────────────────────────────
  async function signInWithGoogle() {
    const { auth } = await _getModules();
    const { getAuth, GoogleAuthProvider, signInWithPopup } = auth;
    const authInst = getAuth(window.__fbApp);
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(authInst, provider);
    return result.user;
  }

  async function signOut() {
    const { auth } = await _getModules();
    const { getAuth, signOut: _signOut } = auth;
    await _signOut(getAuth(window.__fbApp));
  }

  // ── User doc in Firestore ────────────────────────────────
  async function ensureUserDoc(user) {
    const { fs } = await _getModules();
    const { getFirestore, doc, getDoc, setDoc, serverTimestamp } = fs;
    const db = getFirestore(window.__fbApp);
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);

    // Check if registration is open
    const settingsRef = doc(db, 'admin_settings', 'global');
    const settingsSnap = await getDoc(settingsRef);
    const settings = settingsSnap.exists() ? settingsSnap.data() : {};

    if (!snap.exists()) {
      if (settings.registrationDisabled) {
        await signOut();
        throw new Error('REGISTRATION_DISABLED');
      }
      await setDoc(ref, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        role: 'user',
        plan: 'free',
        banned: false,
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp()
      });
    } else {
      const data = snap.data();
      if (data.banned) {
        await signOut();
        throw new Error('BANNED');
      }
      await setDoc(ref, { lastLogin: serverTimestamp(), displayName: user.displayName, photoURL: user.photoURL }, { merge: true });
    }
  }

  async function getUserDoc(uid) {
    const { fs } = await _getModules();
    const { getFirestore, doc, getDoc } = fs;
    const db = getFirestore(window.__fbApp);
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  // ── State ────────────────────────────────────────────────
  function getUser() { return _user; }
  function getUID() { return _user?.uid || null; }
  function isLoggedIn() { return !!_user; }

  async function isAdmin() {
    if (!_user) return false;
    const data = await getUserDoc(_user.uid);
    return data?.role === 'admin';
  }

  function onChange(cb) { _onChangeCallbacks.push(cb); }

  // ── Init: listen to auth state ───────────────────────────
  async function init() {
    const { auth } = await _getModules();
    const { getAuth, onAuthStateChanged } = auth;
    
    return new Promise((resolve) => {
      const authInst = getAuth(window.__fbApp);
      onAuthStateChanged(authInst, async (user) => {
        _user = user;
        _onChangeCallbacks.forEach(cb => cb(user));
        resolve(user);
      });
    });
  }

  return { init, signInWithGoogle, signOut, ensureUserDoc, getUserDoc, getUser, getUID, isLoggedIn, isAdmin, onChange };
})();
