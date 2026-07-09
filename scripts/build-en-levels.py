# -*- coding: utf-8 -*-
"""从 ECDICT 完整 CSV 生成考试分级词库 JSON（public/data/en/levels/*.json）

数据源: https://github.com/skywind3000/ECDICT (MIT)
用法:   python scripts/build-en-levels.py <path-to-ecdict.csv>
输出:   每级 {name, n, words: [[word, phonetic, 中文释义, 词频rank], ...]}，按词频升序（常用在前）
"""
import csv
import json
import os
import re
import sys

LEVELS = {
    'zk': '中考', 'gk': '高考', 'cet4': 'CET-4', 'cet6': 'CET-6',
    'ky': '考研', 'toefl': 'TOEFL', 'ielts': 'IELTS', 'gre': 'GRE',
}
WORD_RE = re.compile(r"^[A-Za-z][A-Za-z\-'\. ]*$")


def clean_trans(t):
    if not t:
        return ''
    t = t.replace('\\r', '').replace('\\n', '\n')
    lines = [l.strip() for l in t.split('\n') if l.strip()]
    picked = [l for l in lines if not l.startswith('[网络]')] or lines
    out = '；'.join(picked[:4])
    return out[:120]


def main(src):
    csv.field_size_limit(10 ** 7)
    buckets = {k: [] for k in LEVELS}
    total = 0
    with open(src, encoding='utf-8', newline='') as f:
        rd = csv.DictReader(f)
        for row in rd:
            total += 1
            tag = (row.get('tag') or '').strip()
            if not tag:
                continue
            toks = set(tag.split())
            hits = [k for k in LEVELS if k in toks]
            if not hits:
                continue
            w = (row.get('word') or '').strip()
            if not w or not WORD_RE.match(w) or len(w) > 24:
                continue
            trans = clean_trans(row.get('translation') or '')
            if not trans:
                continue
            ph = (row.get('phonetic') or '').strip()[:40]
            try:
                frq = int(row.get('frq') or 0)
            except ValueError:
                frq = 0
            if frq <= 0:
                try:
                    frq = int(row.get('bnc') or 0)
                except ValueError:
                    frq = 0
            sort_key = frq if frq > 0 else 999999
            for k in hits:
                buckets[k].append((sort_key, w, ph, trans))
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', 'en', 'levels')
    os.makedirs(outdir, exist_ok=True)
    for k, name in LEVELS.items():
        arr = sorted(buckets[k], key=lambda x: (x[0], x[1]))
        data = [[w, ph, tr, (sk if sk < 999999 else 0)] for (sk, w, ph, tr) in arr]
        path = os.path.join(outdir, k + '.json')
        with open(path, 'w', encoding='utf-8') as fo:
            json.dump({'name': name, 'n': len(data), 'words': data}, fo, ensure_ascii=False, separators=(',', ':'))
        print('%-6s %-6s %6d 词  %5d KB' % (k, name, len(data), os.path.getsize(path) // 1024))
    print('扫描总行数:', total)


if __name__ == '__main__':
    main(sys.argv[1])
