// ══════════════════════════════════════════════════════════
//  plans.js  —  Paket tanımları, limit yönetimi, ödeme akışı
// ══════════════════════════════════════════════════════════
const Plans = (() => {
  const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/10.12.2';

  // ── Varsayılan plan şeması (Firestore'daki admin_settings/plans'tan override edilir) ──
  const DEFAULT_PLANS = {
    free: {
      id: 'free',
      name: 'Ücretsiz',
      price: 0,
      currency: 'TRY',
      color: '#6b7280',
      icon: '◇',
      features: ['5 proje', '10 AI sorgu/gün', '2 API bağlantısı', 'Temel analizler'],
      limits: { projects: 5, aiQueriesPerDay: 10, apis: 2, exportFormats: ['csv'] }
    },
    pro: {
      id: 'pro',
      name: 'Pro',
      price: 149,
      currency: 'TRY',
      color: '#8b5cf6',
      icon: '◈',
      badge: 'Popüler',
      features: ['50 proje', '100 AI sorgu/gün', '10 API bağlantısı', 'Tüm analizler', 'Excel export', 'Öncelikli destek'],
      limits: { projects: 50, aiQueriesPerDay: 100, apis: 10, exportFormats: ['csv', 'excel', 'json'] }
    },
    enterprise: {
      id: 'enterprise',
      name: 'Enterprise',
      price: 499,
      currency: 'TRY',
      color: '#f59e0b',
      icon: '◆',
      features: ['Sınırsız proje', 'Sınırsız AI sorgu', 'Sınırsız API', 'Tüm özellikler', 'Öncelikli destek', 'Özel entegrasyon'],
      limits: { projects: Infinity, aiQueriesPerDay: Infinity, apis: Infinity, exportFormats: ['csv', 'excel', 'json'] }
    }
  };

  let _cachedPlans = null;
  let _userDoc = null;

  async function _getFS() {
    return import(`${FIREBASE_CDN}/firebase-firestore.js`);
  }

  // ── Firestore'dan admin tarafından düzenlenmiş plan şemalarını çek ──
  async function getPlansConfig() {
    if (_cachedPlans) return _cachedPlans;
    try {
      const fs = await _getFS();
      const { getFirestore, doc, getDoc } = fs;
      const db = getFirestore(window.__fbApp);
      const snap = await getDoc(doc(db, 'admin_settings', 'plans'));
      if (snap.exists()) {
        _cachedPlans = { ...DEFAULT_PLANS, ...snap.data() };
      } else {
        _cachedPlans = DEFAULT_PLANS;
      }
    } catch {
      _cachedPlans = DEFAULT_PLANS;
    }
    return _cachedPlans;
  }

  function invalidatePlanCache() {
    _cachedPlans = null;
  }

  // ── Kullanıcının aktif planını ve limitlerini getir ──
  async function getUserPlanData(uid) {
    const fs = await _getFS();
    const { getFirestore, doc, getDoc } = fs;
    const db = getFirestore(window.__fbApp);
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    const plans = await getPlansConfig();
    const planDef = plans[data.plan || 'free'] || plans.free;
    return {
      ...data,
      planDef,
      // subscriptionEnd varsa kontrol et
      isExpired: data.subscriptionEnd ? data.subscriptionEnd.toDate() < new Date() : false
    };
  }

  // ── Bugünkü AI sorgu kullanımını getir/artır ──
  async function getTodayUsage(uid) {
    const fs = await _getFS();
    const { getFirestore, doc, getDoc } = fs;
    const db = getFirestore(window.__fbApp);
    const today = new Date().toISOString().split('T')[0];
    const snap = await getDoc(doc(db, 'users', uid, 'usage', today));
    return snap.exists() ? snap.data() : { aiQueries: 0, date: today };
  }

  async function incrementAIQuery(uid) {
    const fs = await _getFS();
    const { getFirestore, doc, setDoc, increment, serverTimestamp } = fs;
    const db = getFirestore(window.__fbApp);
    const today = new Date().toISOString().split('T')[0];
    const ref = doc(db, 'users', uid, 'usage', today);
    await setDoc(ref, {
      aiQueries: increment(1),
      date: today,
      lastUpdated: serverTimestamp()
    }, { merge: true });
  }

  // ── Limit kontrolü: kullanıcı işlemi yapabilir mi? ──
  async function checkLimit(uid, limitType) {
    const planData = await getUserPlanData(uid);
    if (!planData) return { allowed: false, reason: 'Kullanıcı bulunamadı' };

    // Süresi dolmuş abonelik → free'ye düşür
    const effectivePlan = planData.isExpired ? 'free' : (planData.plan || 'free');
    const plans = await getPlansConfig();
    const planDef = plans[effectivePlan] || plans.free;
    const limit = planDef.limits[limitType];

    if (limit === undefined || limit === Infinity) return { allowed: true };

    if (limitType === 'aiQueriesPerDay') {
      const usage = await getTodayUsage(uid);
      const used = usage.aiQueries || 0;
      if (used >= limit) {
        return {
          allowed: false,
          reason: `Günlük AI sorgu limitine ulaştınız (${limit}/${limit})`,
          used,
          limit,
          upgradeNeeded: true
        };
      }
      return { allowed: true, used, limit };
    }

    return { allowed: true };
  }

  // ── Ödeme kaydı oluştur (Firestore'a) ──
  async function createPaymentRecord(uid, planId, amount, method, ref) {
    const fs = await _getFS();
    const { getFirestore, collection, addDoc, serverTimestamp } = fs;
    const db = getFirestore(window.__fbApp);
    return addDoc(collection(db, 'payments'), {
      uid,
      planId,
      amount,
      currency: 'TRY',
      method,
      status: 'pending',
      reference: ref || null,
      createdAt: serverTimestamp()
    });
  }

  // ── Ödeme onaylandığında planı aktifleştir ──
  async function activatePlan(uid, planId, durationDays = 30) {
    const fs = await _getFS();
    const { getFirestore, doc, setDoc, Timestamp } = fs;
    const db = getFirestore(window.__fbApp);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationDays);
    await setDoc(doc(db, 'users', uid), {
      plan: planId,
      subscriptionStart: Timestamp.now(),
      subscriptionEnd: Timestamp.fromDate(endDate),
      autoRenew: false
    }, { merge: true });
  }

  // ── Kullanıcının ödeme geçmişi ──
  async function getPaymentHistory(uid) {
    const fs = await _getFS();
    const { getFirestore, collection, query, where, orderBy, getDocs } = fs;
    const db = getFirestore(window.__fbApp);
    const q = query(
      collection(db, 'payments'),
      where('uid', '==', uid),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ── Admin: tüm ödemeleri getir ──
  async function getAllPayments(limitCount = 100) {
    const fs = await _getFS();
    const { getFirestore, collection, query, orderBy, limit, getDocs } = fs;
    const db = getFirestore(window.__fbApp);
    const q = query(collection(db, 'payments'), orderBy('createdAt', 'desc'), limit(limitCount));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ── Admin: ödeme durumunu güncelle ──
  async function updatePaymentStatus(paymentId, status) {
    const fs = await _getFS();
    const { getFirestore, doc, updateDoc, serverTimestamp } = fs;
    const db = getFirestore(window.__fbApp);
    await updateDoc(doc(db, 'payments', paymentId), {
      status,
      updatedAt: serverTimestamp()
    });
  }

  // ── Admin: plan fiyatlarını Firestore'a kaydet ──
  async function savePlansConfig(plansData) {
    const fs = await _getFS();
    const { getFirestore, doc, setDoc, serverTimestamp } = fs;
    const db = getFirestore(window.__fbApp);
    await setDoc(doc(db, 'admin_settings', 'plans'), {
      ...plansData,
      updatedAt: serverTimestamp()
    });
    invalidatePlanCache();
  }

  // ── Admin: gelir istatistikleri ──
  async function getRevenueStats() {
    const payments = await getAllPayments(500);
    const confirmed = payments.filter(p => p.status === 'confirmed');
    const total = confirmed.reduce((sum, p) => sum + (p.amount || 0), 0);

    const byPlan = {};
    confirmed.forEach(p => {
      if (!byPlan[p.planId]) byPlan[p.planId] = { count: 0, revenue: 0 };
      byPlan[p.planId].count++;
      byPlan[p.planId].revenue += p.amount || 0;
    });

    // Son 30 günlük
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const last30Days = confirmed
      .filter(p => p.createdAt?.toDate?.() > thirtyDaysAgo)
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    return { total, last30Days, byPlan, totalTransactions: confirmed.length };
  }

  return {
    DEFAULT_PLANS,
    getPlansConfig,
    invalidatePlanCache,
    getUserPlanData,
    getTodayUsage,
    incrementAIQuery,
    checkLimit,
    createPaymentRecord,
    activatePlan,
    getPaymentHistory,
    getAllPayments,
    updatePaymentStatus,
    savePlansConfig,
    getRevenueStats
  };
})();
