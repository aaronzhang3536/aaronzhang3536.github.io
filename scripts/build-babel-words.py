# -*- coding: utf-8 -*-
"""巴别塔词库瘦身：8 档考纲各取高频前 N 词，构建期算好简短中文+词性，
   丢掉冗长完整释义，合并成一个小 JSON —— 3.5MB → ~150KB，游戏秒开。
   用法: python scripts/build-babel-words.py
"""
import json
import os
import re

LEVELS = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre']
N_PER_TIER = 450          # 每档取高频前 N 词（远超单局所需，仍很小）
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', 'en', 'levels')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', 'babel-words.json')

# 连续剥掉开头的「词性.」标记（art. / n. / vt.& vi. 等），长度 1~6 字母 + 点
POS_PREFIX = re.compile(r'^\s*(?:[a-zA-Z]{1,6}\.\s*)+')
BRACKET = re.compile(r'\[[^\]]*\]')
WORD_OK = re.compile(r"^[a-z][a-z'-]{1,13}$")
# 取「首个」词性标记（反映主要用法），而非一律优先动词
POS_FIRST = re.compile(r'\b(adv|adj|vt|vi|ad|prep|conj|pron|art|num|aux|int|abbr|n|v|a)\.')
# 指示代词/限定词等：即便被标成 adj/noun 也不适合做卡（构词无意义，如 that→thatter）
STOP = set('that this these those what which whose whom some any each every other another such same both either neither many much more most few less least own several enough whatever whichever'.split())


def short_cn(defstr):
    s = BRACKET.sub('', defstr)
    first = re.split(r'[;；]', s)[0] or s
    first = POS_PREFIX.sub('', first)
    first = '，'.join([p.strip() for p in re.split(r'[,，]', first) if p.strip()][:2]).strip()
    return first or POS_PREFIX.sub('', s)[:8]


def pos_of(defstr):
    m = POS_FIRST.search(defstr.lower())
    if not m:
        return 'noun'
    t = m.group(1)
    if t in ('v', 'vt', 'vi'):
        return 'verb'
    if t == 'n':
        return 'noun'
    if t in ('a', 'adj'):
        return 'adj'
    return 'other'   # adv/prep/conj/pron/art/num/aux… 不适合做卡，过滤掉


def main():
    seen = set()
    tiers = []
    total = 0
    for li, lv in enumerate(LEVELS):
        data = json.load(open(os.path.join(SRC, lv + '.json'), encoding='utf-8'))
        words = data.get('words', [])
        bucket = []
        for e in words:
            if len(bucket) >= N_PER_TIER:
                break
            w = (e[0] or '')
            lw = w.lower()
            if not WORD_OK.match(lw) or ' ' in w or lw in seen or lw in STOP:
                continue
            pos = pos_of(e[2] or '')
            if pos == 'other':          # 冠词/介词/连词等功能词不做卡
                continue
            cn = short_cn(e[2] or '')
            if not cn:
                continue
            seen.add(lw)
            bucket.append([w, e[1] or '', cn, pos])
        tiers.append(bucket)
        total += len(bucket)
        print('[%s] tier %d: %d 词' % (lv, li, len(bucket)))
    out = {'n': total, 'tiers': tiers}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize(OUT)
    print('合并完成: %d 词, %.0f KB → %s' % (total, size / 1024, OUT))


if __name__ == '__main__':
    main()
