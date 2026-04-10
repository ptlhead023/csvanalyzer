import sys
import json
import pandas as pd
import numpy as np
import chardet

def detect_encoding(path):
    with open(path, 'rb') as f:
        raw = f.read()
    return chardet.detect(raw).get('encoding', 'utf-8') or 'utf-8'

def detect_delimiter(path, enc):
    with open(path, 'r', encoding=enc, errors='replace') as f:
        sample = f.read(4096)
    counts = {d: sample.count(d) for d in [',', ';', '\t', '|']}
    return max(counts, key=counts.get)

def run(input_path, output_path, meta_path):
    enc = detect_encoding(input_path)
    delim = detect_delimiter(input_path, enc)

    df = pd.read_csv(input_path, sep=delim, encoding=enc, errors='replace')

    original_shape = df.shape

    df.columns = [str(c).strip() for c in df.columns]
    df = df.loc[:, ~df.columns.duplicated()]
    df = df.dropna(how='all')
    df = df.loc[:, df.notna().any()]
    df = df.drop_duplicates()

    for col in df.columns:
        df[col] = df[col].astype(str).str.strip()
        df[col] = df[col].replace({'': np.nan, 'nan': np.nan, 'None': np.nan, 'NULL': np.nan, 'null': np.nan})

    numeric_cols = []
    outlier_info = {}

    for col in df.columns:
        converted = pd.to_numeric(df[col], errors='coerce')
        ratio = converted.notna().sum() / max(len(df), 1)
        if ratio >= 0.6:
            df[col] = converted
            numeric_cols.append(col)

            q1 = df[col].quantile(0.25)
            q3 = df[col].quantile(0.75)
            iqr = q3 - q1
            if iqr > 0:
                lo = q1 - 1.5 * iqr
                hi = q3 + 1.5 * iqr
                out_idx = df[(df[col] < lo) | (df[col] > hi)].index.tolist()
                if out_idx:
                    outlier_info[col] = {'count': len(out_idx), 'lo': round(lo, 4), 'hi': round(hi, 4)}

    df = df.reset_index(drop=True)
    df.to_csv(output_path, index=False, encoding='utf-8')

    col_types = {}
    for col in df.columns:
        if col in numeric_cols:
            col_types[col] = 'numeric'
        else:
            col_types[col] = 'text'

    meta = {
        'original_shape': list(original_shape),
        'clean_shape': list(df.shape),
        'encoding_detected': enc,
        'delimiter_detected': delim,
        'numeric_columns': numeric_cols,
        'column_types': col_types,
        'outliers': outlier_info,
        'duplicates_removed': int(original_shape[0] - df.shape[0])
    }

    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(json.dumps({'success': True, 'meta': meta}))

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(json.dumps({'error': 'Kullanim: preprocess.py <input> <output> <meta>'}))
        sys.exit(1)
    try:
        run(sys.argv[1], sys.argv[2], sys.argv[3])
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)