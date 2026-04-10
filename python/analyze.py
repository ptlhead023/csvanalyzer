import sys
import json
import warnings
import numpy as np
import pandas as pd
from io import StringIO
from datetime import datetime

warnings.filterwarnings("ignore")


# ─────────────────────────────────────────────
# YARDIMCI FONKSİYONLAR
# ─────────────────────────────────────────────

def safe_float(v):
    try:
        f = float(v)
        if np.isnan(f) or np.isinf(f):
            return None
        return round(f, 6)
    except Exception:
        return None


def series_to_list(s):
    return [safe_float(v) for v in s]


def detect_delimiter(text):
    counts = {d: text[:4096].count(d) for d in [",", ";", "\t", "|"]}
    return max(counts, key=counts.get)


def load_csv(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    delim = detect_delimiter(text)
    df = pd.read_csv(StringIO(text), sep=delim, encoding="utf-8", on_bad_lines="skip")
    df.columns = [str(c).strip() for c in df.columns]
    return df


def numeric_cols(df):
    cols = []
    for c in df.columns:
        converted = pd.to_numeric(df[c], errors="coerce")
        if converted.notna().sum() / max(len(df), 1) >= 0.5:
            df[c] = converted
            cols.append(c)
    return cols, df


# ─────────────────────────────────────────────
# 1. TEMEL İSTATİSTİK
# ─────────────────────────────────────────────

def basic_stats(df, num_cols):
    result = {}
    for c in num_cols:
        s = df[c].dropna()
        if len(s) == 0:
            continue
        from scipy import stats as sp_stats
        result[c] = {
            "count":    int(s.count()),
            "mean":     safe_float(s.mean()),
            "median":   safe_float(s.median()),
            "std":      safe_float(s.std()),
            "variance": safe_float(s.var()),
            "skewness": safe_float(sp_stats.skew(s)),
            "kurtosis": safe_float(sp_stats.kurtosis(s)),
            "min":      safe_float(s.min()),
            "max":      safe_float(s.max()),
            "range":    safe_float(s.max() - s.min()),
            "p5":       safe_float(s.quantile(0.05)),
            "p25":      safe_float(s.quantile(0.25)),
            "p75":      safe_float(s.quantile(0.75)),
            "p95":      safe_float(s.quantile(0.95)),
        }
    return result


# ─────────────────────────────────────────────
# 2. TREND ANALİZİ
# ─────────────────────────────────────────────

def trend_analysis(df, num_cols):
    from scipy import stats as sp_stats
    result = {}
    for c in num_cols:
        s = df[c].dropna().reset_index(drop=True)
        if len(s) < 3:
            continue
        x = np.arange(len(s), dtype=float)
        slope, intercept, r, p, se = sp_stats.linregress(x, s.values.astype(float))

        poly2 = np.polyfit(x, s.values.astype(float), 2).tolist()
        poly3 = np.polyfit(x, s.values.astype(float), 3).tolist()

        alpha = 0.3
        ema = [float(s.iloc[0])]
        for v in s.iloc[1:]:
            ema.append(alpha * float(v) + (1 - alpha) * ema[-1])

        direction = "up" if slope > 0 else ("down" if slope < 0 else "flat")

        result[c] = {
            "slope":     safe_float(slope),
            "intercept": safe_float(intercept),
            "r2":        safe_float(r ** 2),
            "p_value":   safe_float(p),
            "direction": direction,
            "poly2":     [safe_float(v) for v in poly2],
            "poly3":     [safe_float(v) for v in poly3],
            "ema":       [safe_float(v) for v in ema],
        }
    return result


# ─────────────────────────────────────────────
# 3. ZAMAN SERİSİ TAHMİNİ
# ─────────────────────────────────────────────

def forecast_analysis(df, num_cols, options):
    from statsmodels.tsa.arima.model import ARIMA
    from statsmodels.tsa.holtwinters import SimpleExpSmoothing

    n_periods = int(options.get("forecast_periods", 6))
    result = {}

    for c in num_cols:
        s = df[c].dropna().reset_index(drop=True).astype(float)
        if len(s) < 4:
            continue

        col_result = {}

        # Hareketli ortalamalar
        window = max(2, min(5, len(s) // 3))
        sma = s.rolling(window=window, min_periods=1).mean()
        ema = s.ewm(span=window, adjust=False).mean()
        weights = np.arange(1, window + 1, dtype=float)
        wma_vals = s.rolling(window=window, min_periods=1).apply(
            lambda x: np.dot(x, weights[-len(x):]) / weights[-len(x):].sum(), raw=True
        )
        col_result["sma"] = series_to_list(sma)
        col_result["ema"] = series_to_list(ema)
        col_result["wma"] = series_to_list(wma_vals)

        # ARIMA tahmini
        try:
            model = ARIMA(s, order=(1, 1, 1))
            fit = model.fit()
            fc = fit.get_forecast(steps=n_periods)
            mean_fc = fc.predicted_mean.tolist()
            ci = fc.conf_int(alpha=0.05)
            ci80 = fit.get_forecast(steps=n_periods).conf_int(alpha=0.20)

            col_result["arima"] = {
                "next_values":    [safe_float(v) for v in mean_fc],
                "confidence_80":  [[safe_float(ci80.iloc[i, 0]), safe_float(ci80.iloc[i, 1])] for i in range(n_periods)],
                "confidence_95":  [[safe_float(ci.iloc[i, 0]), safe_float(ci.iloc[i, 1])] for i in range(n_periods)],
                "aic":            safe_float(fit.aic),
            }
        except Exception as e:
            col_result["arima"] = {"error": str(e)}

        # Exponential Smoothing tahmini
        try:
            es_model = SimpleExpSmoothing(s).fit(optimized=True)
            es_fc = es_model.forecast(n_periods).tolist()
            col_result["exp_smoothing"] = {
                "next_values": [safe_float(v) for v in es_fc]
            }
        except Exception as e:
            col_result["exp_smoothing"] = {"error": str(e)}

        result[c] = col_result

    return result


# ─────────────────────────────────────────────
# 4. ANOMALİ TESPİTİ
# ─────────────────────────────────────────────

def anomaly_analysis(df, num_cols):
    from sklearn.ensemble import IsolationForest

    result = {}
    for c in num_cols:
        s = df[c].dropna().reset_index(drop=True).astype(float)
        if len(s) < 4:
            continue

        col_result = {}

        # IQR
        q1 = s.quantile(0.25)
        q3 = s.quantile(0.75)
        iqr = q3 - q1
        if iqr > 0:
            lo = q1 - 1.5 * iqr
            hi = q3 + 1.5 * iqr
            iqr_idx = s[(s < lo) | (s > hi)].index.tolist()
            col_result["iqr"] = {
                "indices": iqr_idx,
                "values":  [safe_float(s[i]) for i in iqr_idx],
                "lower_bound": safe_float(lo),
                "upper_bound": safe_float(hi),
            }
        else:
            col_result["iqr"] = {"indices": [], "values": [], "lower_bound": None, "upper_bound": None}

        # Z-score
        mean = s.mean()
        std = s.std()
        if std > 0:
            z = (s - mean) / std
            z_idx = s[z.abs() > 3].index.tolist()
            col_result["zscore"] = {
                "indices": z_idx,
                "values":  [safe_float(s[i]) for i in z_idx],
            }
        else:
            col_result["zscore"] = {"indices": [], "values": []}

        # Isolation Forest
        try:
            X = s.values.reshape(-1, 1)
            clf = IsolationForest(contamination=0.1, random_state=42)
            preds = clf.fit_predict(X)
            if_idx = [int(i) for i, p in enumerate(preds) if p == -1]
            col_result["isolation_forest"] = {
                "indices": if_idx,
                "values":  [safe_float(s[i]) for i in if_idx],
            }
        except Exception as e:
            col_result["isolation_forest"] = {"error": str(e)}

        # Ruptures - kırılma noktaları
        try:
            import ruptures as rpt
            arr = s.values.astype(float)
            n_bkps = max(1, min(5, len(arr) // 10))
            model = rpt.Pelt(model="rbf").fit(arr)
            bkps = model.predict(pen=10)
            col_result["breakpoints"] = [int(b) for b in bkps if b < len(arr)]
        except Exception as e:
            col_result["breakpoints"] = []

        result[c] = col_result

    return result


# ─────────────────────────────────────────────
# 5. KORELASYON ANALİZİ
# ─────────────────────────────────────────────

def correlation_analysis(df, num_cols):
    if len(num_cols) < 2:
        return {"pearson": {}, "spearman": {}}

    sub = df[num_cols].dropna()
    if len(sub) < 3:
        return {"pearson": {}, "spearman": {}}

    pearson = sub.corr(method="pearson")
    spearman = sub.corr(method="spearman")

    def matrix_to_dict(m):
        d = {}
        for c in m.columns:
            d[c] = {r: safe_float(m.loc[r, c]) for r in m.index}
        return d

    return {
        "pearson":  matrix_to_dict(pearson),
        "spearman": matrix_to_dict(spearman),
    }


# ─────────────────────────────────────────────
# 6. BAYESIAN GÜNCELLEME
# ─────────────────────────────────────────────

def bayesian_analysis(df, num_cols):
    result = {}
    for c in num_cols:
        s = df[c].dropna().astype(float)
        if len(s) < 3:
            continue

        vals = s.values
        iterations = []
        running_mean = []
        running_std = []
        running_ci_lo = []
        running_ci_hi = []

        for n in range(2, len(vals) + 1):
            sub = vals[:n]
            mu = float(np.mean(sub))
            sigma = float(np.std(sub, ddof=1)) if n > 1 else 0.0
            se = sigma / np.sqrt(n) if n > 1 else sigma
            running_mean.append(safe_float(mu))
            running_std.append(safe_float(sigma))
            running_ci_lo.append(safe_float(mu - 1.96 * se))
            running_ci_hi.append(safe_float(mu + 1.96 * se))
            iterations.append(n)

        final_mu = float(np.mean(vals))
        final_std = float(np.std(vals, ddof=1)) if len(vals) > 1 else 0.0

        result[c] = {
            "iterations":   iterations,
            "running_mean": running_mean,
            "running_std":  running_std,
            "ci_lower":     running_ci_lo,
            "ci_upper":     running_ci_hi,
            "final_mean":   safe_float(final_mu),
            "final_std":    safe_float(final_std),
            "n_observations": len(vals),
        }
    return result


# ─────────────────────────────────────────────
# 7. OLASILIK DAĞILIMI
# ─────────────────────────────────────────────

def distribution_analysis(df, num_cols):
    from scipy import stats as sp_stats

    result = {}
    for c in num_cols:
        s = df[c].dropna().astype(float)
        if len(s) < 4:
            continue

        col_result = {}

        # Histogram
        hist_counts, bin_edges = np.histogram(s, bins="auto")
        col_result["histogram"] = {
            "counts":     hist_counts.tolist(),
            "bin_edges":  [safe_float(v) for v in bin_edges],
        }

        # KDE
        try:
            kde = sp_stats.gaussian_kde(s)
            x_kde = np.linspace(s.min(), s.max(), 100)
            col_result["kde"] = {
                "x": [safe_float(v) for v in x_kde],
                "y": [safe_float(v) for v in kde(x_kde)],
            }
        except Exception:
            col_result["kde"] = {}

        # Distribution fits
        fits = {}
        for dist_name, dist in [("normal", sp_stats.norm), ("lognorm", sp_stats.lognorm)]:
            try:
                params = dist.fit(s)
                ks_stat, ks_p = sp_stats.kstest(s, dist_name, args=params)
                fits[dist_name] = {
                    "params": [safe_float(p) for p in params],
                    "ks_stat": safe_float(ks_stat),
                    "ks_p":    safe_float(ks_p),
                }
            except Exception:
                fits[dist_name] = {}

        col_result["fits"] = fits

        # Normallik testi
        try:
            stat, p = sp_stats.shapiro(s[:50]) if len(s) >= 3 else (None, None)
            col_result["normality"] = {
                "shapiro_stat": safe_float(stat),
                "shapiro_p":    safe_float(p),
                "is_normal":    bool(p > 0.05) if p is not None else None,
            }
        except Exception:
            col_result["normality"] = {}

        result[c] = col_result

    return result


# ─────────────────────────────────────────────
# 8. GRUP ANALİZİ
# ─────────────────────────────────────────────

def group_analysis(df, groups):
    result = {}
    for g in groups:
        name = g.get("name", "")
        cols = g.get("columns", [])
        g_min = g.get("min")
        g_max = g.get("max")

        valid_cols = [c for c in cols if c in df.columns]
        if not valid_cols:
            continue

        numeric_data = []
        for c in valid_cols:
            converted = pd.to_numeric(df[c], errors="coerce").dropna()
            numeric_data.append(converted)

        if not numeric_data:
            continue

        totals = pd.concat(numeric_data, axis=1).sum(axis=1).dropna()

        if len(totals) == 0:
            continue

        total_mean = safe_float(totals.mean())
        total_last = safe_float(totals.iloc[-1]) if len(totals) > 0 else None

        within_bounds = None
        if g_min is not None and g_max is not None and total_last is not None:
            within_bounds = bool(g_min <= total_last <= g_max)

        forecast_total = None
        try:
            from statsmodels.tsa.arima.model import ARIMA
            if len(totals) >= 4:
                fit = ARIMA(totals.values, order=(1, 1, 1)).fit()
                forecast_total = safe_float(fit.forecast(steps=1)[0])
        except Exception:
            pass

        result[name] = {
            "columns":       valid_cols,
            "min_bound":     safe_float(g_min) if g_min is not None else None,
            "max_bound":     safe_float(g_max) if g_max is not None else None,
            "current_total": total_last,
            "mean_total":    total_mean,
            "within_bounds": within_bounds,
            "total_forecast": forecast_total,
            "total_series":  series_to_list(totals),
        }

    return result


# ─────────────────────────────────────────────
# ANA FONKSİYON
# ─────────────────────────────────────────────

def run(input_path, config_path, result_path):
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    groups  = config.get("groups", [])
    options = config.get("options", {})

    df = load_csv(input_path)
    num_cols_list, df = numeric_cols(df)

    output = {
        "meta": {
            "columns":     list(df.columns),
            "rows":        int(len(df)),
            "numeric_cols": num_cols_list,
            "analyzed_at": datetime.now().isoformat(),
        },
        "stats":        basic_stats(df, num_cols_list),
        "trend":        trend_analysis(df, num_cols_list),
        "forecast":     forecast_analysis(df, num_cols_list, options),
        "anomalies":    anomaly_analysis(df, num_cols_list),
        "correlation":  correlation_analysis(df, num_cols_list),
        "bayesian":     bayesian_analysis(df, num_cols_list),
        "distribution": distribution_analysis(df, num_cols_list),
        "groups":       group_analysis(df, groups),
    }

    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(json.dumps({"success": True, "columns": num_cols_list, "rows": len(df)}))


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Kullanim: analyze.py <input.csv> <config.json> <result.json>"}))
        sys.exit(1)
    try:
        run(sys.argv[1], sys.argv[2], sys.argv[3])
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
