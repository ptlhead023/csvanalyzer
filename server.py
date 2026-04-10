# render.com → New Web Service → GitHub repo bağla
# Build Command: pip install -r requirements.txt
# Start Command: gunicorn server:app
# Environment: PORT otomatik set edilir

import os
import json
import subprocess
import sys
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_file
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "static", "output")
PYTHON_DIR = os.path.join(os.path.dirname(__file__), "python")

os.makedirs(OUTPUT_DIR, exist_ok=True)

# ─────────────────────────────────────────────
# SAYFA
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

# ─────────────────────────────────────────────
# SAĞLIK KONTROLÜ
# ─────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "python": sys.version
    })

# ─────────────────────────────────────────────
# ÖN İŞLEME
# ─────────────────────────────────────────────

@app.route("/api/preprocess", methods=["POST"])
def preprocess():
    try:
        data = request.get_json()
        if not data or "csv" not in data:
            return jsonify({"error": "CSV verisi bulunamadı"}), 400

        csv_content = data["csv"]
        options = data.get("options", {})

        input_path = os.path.join(OUTPUT_DIR, "input_raw.csv")
        output_path = os.path.join(OUTPUT_DIR, "input_clean.csv")
        meta_path = os.path.join(OUTPUT_DIR, "preprocess_meta.json")

        with open(input_path, "w", encoding="utf-8") as f:
            f.write(csv_content)

        with open(os.path.join(OUTPUT_DIR, "preprocess_options.json"), "w", encoding="utf-8") as f:
            json.dump(options, f, ensure_ascii=False)

        script = os.path.join(PYTHON_DIR, "preprocess.py")
        result = subprocess.run(
            [sys.executable, script, input_path, output_path, meta_path],
            capture_output=True, text=True, timeout=30
        )

        if result.returncode != 0:
            return jsonify({"error": "Ön işleme hatası", "detail": result.stderr}), 500

        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)

        with open(output_path, "r", encoding="utf-8") as f:
            clean_csv = f.read()

        return jsonify({
            "success": True,
            "clean_csv": clean_csv,
            "meta": meta
        })

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Ön işleme zaman aşımına uğradı"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─────────────────────────────────────────────
# ANALİZ
# ─────────────────────────────────────────────

@app.route("/api/analyze", methods=["POST"])
def analyze():
    try:
        data = request.get_json()
        if not data or "csv" not in data:
            return jsonify({"error": "CSV verisi bulunamadı"}), 400

        csv_content = data["csv"]
        groups = data.get("groups", [])
        options = data.get("options", {})

        input_path = os.path.join(OUTPUT_DIR, "analyze_input.csv")
        result_path = os.path.join(OUTPUT_DIR, "result.json")
        config_path = os.path.join(OUTPUT_DIR, "analyze_config.json")

        with open(input_path, "w", encoding="utf-8") as f:
            f.write(csv_content)

        config = {"groups": groups, "options": options}
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False)

        script = os.path.join(PYTHON_DIR, "analyze.py")
        result = subprocess.run(
            [sys.executable, script, input_path, config_path, result_path],
            capture_output=True, text=True, timeout=120
        )

        if result.returncode != 0:
            return jsonify({"error": "Analiz hatası", "detail": result.stderr}), 500

        with open(result_path, "r", encoding="utf-8") as f:
            analysis = json.load(f)

        return jsonify({"success": True, "result": analysis})

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Analiz zaman aşımına uğradı (120s)"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─────────────────────────────────────────────
# EXPORT
# ─────────────────────────────────────────────

@app.route("/api/export/json", methods=["GET"])
def export_json():
    try:
        result_path = os.path.join(OUTPUT_DIR, "result.json")
        if not os.path.exists(result_path):
            return jsonify({"error": "Henüz analiz yapılmadı"}), 404
        return send_file(result_path, as_attachment=True, download_name="datalens_result.json")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/export/excel", methods=["POST"])
def export_excel():
    try:
        import pandas as pd
        data = request.get_json()
        csv_content = data.get("csv", "")
        if not csv_content:
            return jsonify({"error": "CSV verisi yok"}), 400

        from io import StringIO
        df = pd.read_csv(StringIO(csv_content))
        excel_path = os.path.join(OUTPUT_DIR, "export.xlsx")
        df.to_excel(excel_path, index=False)
        return send_file(excel_path, as_attachment=True, download_name="datalens_export.xlsx")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─────────────────────────────────────────────
# BAŞLAT
# ─────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV", "development") == "development"
    print(f"\n🔬 DataLens başlatılıyor → http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=debug)