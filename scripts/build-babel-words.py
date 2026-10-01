# -*- coding: utf-8 -*-
"""巴别塔词库瘦身：8 档考纲各取高频前 N 词，构建期算好简短中文+词性，
   丢掉冗长完整释义，合并成一个小 JSON —— 3.5MB → ~180KB，游戏秒开。
   另用 ECDICT（MIT，https://github.com/skywind3000/ECDICT）的 exchange 字段
   给每个词附上「经过核对的」构词形式：名词复数 s / 动词过去式 p / 形容词比较级 r。
   游戏只拿这些真实形式出构词题；规则法生成的变形只当干扰项。

   用法: python scripts/build-babel-words.py <ecdict.csv>

   输出条目: [词, 音标, 短释义, 词性, 构词?]
     构词（可缺省）= "正确形式[/其他正确形式…][|其他真实变形…]"
       · 第一段：该词性对应考点的全部正确答案，第一个为标准答案；
       · 第二段：同一个词的其他真实变形（第三人称、过去分词、最高级…），
         只用于把它们排除出干扰项；
       · 以 ~ 开头表示「原词 + 后缀」，如 book 的 "~s" = books，"~" = 原词本身。
     没有可靠形式的词（不可数名词、用 more 比较的形容词、情态动词、专有名词等）
     不带第 5 项，游戏会改考词义。
"""
import csv
import json
import os
import re
import sys

LEVELS = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre']
N_PER_TIER = 450          # 每档取高频前 N 词（远超单局所需，仍很小）
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', 'en', 'levels')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', 'babel-words.json')

# 连续剥掉开头的「词性.」标记（art. / n. / vt.& vi. 等），长度 1~6 字母 + 点
POS_PREFIX = re.compile(r'^\s*(?:[a-zA-Z]{1,6}\.\s*)+')
BRACKET = re.compile(r'\[[^\]]*\]')
WORD_OK = re.compile(r"^[a-z][a-z'-]{1,13}$")
FORM_OK = re.compile(r"^[a-z][a-z'-]*$")
# 取「首个」词性标记（反映主要用法），而非一律优先动词
POS_FIRST = re.compile(r'\b(adv|adj|vt|vi|ad|prep|conj|pron|art|num|aux|int|abbr|n|v|a)\.')
# 指示代词/限定词等：即便被标成 adj/noun 也不适合做卡（构词无意义，如 that→thatter）
STOP = set('that this these those what which whose whom some any each every other another such same both either neither many much more most few less least own several enough whatever whichever'.split())

# ---------- 构词核对表 ----------
# 不出复数题的名词：ECDICT 给了 s 形式，但复数在实际语料里几乎不用（不可数/抽象/物质名词，
# 或被标成名词的形容词）。由 wordfreq 统计「复数词频 < 单数词频的 1/60」筛出，再人工补删。
NOUN_SKIP = set('''
access accountability accuracy aftermath air alcohol annual aside attention automatic autonomy awareness
banking blood bulk carbon childhood circulation clarity coffee cold compassion compensation compliance
confidence confusion congress consciousness consistency cooperation corruption cotton coverage criteria damp
destruction dignity discrimination distress diversity dust employment entertainment enthusiasm equipment
evidence excitement existence expertise extent external feedback fishing fitness flesh following funding
gold golf gravity grief growth guilt harassment hell heritage high honey housing humor ice inflation inside
insurance intelligence isolation knowledge labor leadership legislation likelihood literature litigation
living logic low magic majority management march medical mere metropolitan middle midnight milk mobility
modern money mortality mud music nature nobody normal opposition oral ownership oxygen people pollution
potential presence prevention prime privacy productivity prosperity psychology purple radiation ready rear
recognition research resistance retail revenge rhetoric rice rough safe satisfaction secular senate sharp
significance silver slight sovereignty stability staff starting steam steel still storage straight stuff
super surveillance survival tobacco today tough transportation ultimate understanding unity weather weekly
western whole wild wilderness wisdom working wright
abundance aggression anger approval architecture attendance butter cancer clay construction consent corn
determination disposal energy essence evolution faith fatigue fiction flour gravel heat inspiration justice
leather membership panic permission pride production protection relief reputation retirement sake silence
smoke terror tolerance torture transport worship
old one being yellow pink gray grey white black green blue red brown multiple general special major
independent specific constant notable solid negative extra primary dependent integral reverse musical
separate initial equivalent spare blind faint current average front top bottom future
'''.split())
# 名词复数修正 / 补充（第一个为标准答案）：ECDICT 的 sheeps、persons 之类不能当正确答案
NOUN_FIX = {
    'sheep': ['sheep'], 'deer': ['deer'], 'salmon': ['salmon'], 'fish': ['fish', 'fishes'],
    'aircraft': ['aircraft'], 'species': ['species'], 'series': ['series'],
    'person': ['people', 'persons'], 'medium': ['media', 'mediums'], 'penny': ['pennies', 'pence'],
    'half': ['halves'], 'self': ['selves'], 'guess': ['guesses'],
    'focus': ['focuses', 'foci'], 'stadium': ['stadiums', 'stadia'], 'millennium': ['millennia', 'millenniums'],
    'formula': ['formulas', 'formulae'], 'maximum': ['maximums', 'maxima'], 'index': ['indexes', 'indices'],
    'curriculum': ['curricula', 'curriculums'], 'spectrum': ['spectra', 'spectrums'], 'matrix': ['matrices', 'matrixes'],
    'cargo': ['cargoes', 'cargos'], 'mosquito': ['mosquitoes', 'mosquitos'], 'forum': ['forums', 'fora'],
    'basis': ['bases'], 'axis': ['axes'], 'emphasis': ['emphases'], 'thesis': ['theses'],
    'phenomenon': ['phenomena', 'phenomenons'], 'criterion': ['criteria', 'criterions'], 'genius': ['geniuses', 'genii'],
}
# 不出过去式题的动词：情态/助动词（can 在词库里释义是「装罐」，ECDICT 的 could 会教错）
VERB_SKIP = set('can will may must shall might ought'.split())
# 过去式的其他正确写法（英/美拼写、双形式），ECDICT 只列一个
VERB_ALT = {
    'be': ['was', 'were'], 'learn': ['learned', 'learnt'], 'burn': ['burned', 'burnt'], 'dream': ['dreamed', 'dreamt'],
    'spell': ['spelled', 'spelt'], 'smell': ['smelled', 'smelt'], 'spill': ['spilled', 'spilt'], 'spoil': ['spoiled', 'spoilt'],
    'leap': ['leaped', 'leapt'], 'kneel': ['knelt', 'kneeled'], 'lean': ['leaned', 'leant'], 'dwell': ['dwelt', 'dwelled'],
    'light': ['lit', 'lighted'], 'dive': ['dived', 'dove'], 'hang': ['hung', 'hanged'], 'shine': ['shone', 'shined'],
    'wake': ['woke', 'waked'], 'awake': ['awoke', 'awaked'], 'speed': ['sped', 'speeded'], 'fit': ['fitted', 'fit'],
    'quit': ['quit', 'quitted'], 'wed': ['wedded', 'wed'], 'bet': ['bet', 'betted'], 'bid': ['bid', 'bade'],
    'thrive': ['thrived', 'throve'], 'strive': ['strove', 'strived'], 'weave': ['wove', 'weaved'],
    'forbid': ['forbade', 'forbad'], 'sneak': ['sneaked', 'snuck'], 'plead': ['pleaded', 'pled'], 'spit': ['spat', 'spit'],
    'knit': ['knitted', 'knit'], 'broadcast': ['broadcast', 'broadcasted'], 'forecast': ['forecast', 'forecasted'],
    'slay': ['slew', 'slayed'], 'lie': ['lay', 'lied'], 'bend': ['bent', 'bended'], 'prove': ['proved'], 'get': ['got'],
}
# 不出比较级题的形容词：ECDICT 列了 -er 形式但现代英语基本用 more（curiouser 之类）
ADJ_SKIP = set('sorry vast severe remote curious bare profound pleasant handsome mature corrupt obscure'.split())
ADJ_ALT = {'far': ['further', 'farther'], 'old': ['older', 'elder']}
SLOT = {'noun': 's', 'verb': 'p', 'adj': 'r'}


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


def parse_exchange(s):
    """'p:went/d:gone/i:going/3:goes' → {'p': ['went'], 'd': ['gone'], ...}（丢掉空值和 0:/1: 词根标记）"""
    out = {}
    for part in (s or '').split('/'):
        if ':' not in part:
            continue
        k, v = part.split(':', 1)
        v = v.strip()
        if k in ('0', '1') or not v:
            continue
        out.setdefault(k, [])
        if v not in out[k]:
            out[k].append(v)
    return out


def load_exchange(path, wanted):
    """只取词库里用到的词的 exchange；同一个词优先大小写完全一致的行"""
    csv.field_size_limit(1 << 30)
    exact, lower = {}, {}
    with open(path, encoding='utf-8', newline='') as f:
        rd = csv.reader(f)
        head = next(rd)
        iw, ix = head.index('word'), head.index('exchange')
        for row in rd:
            if len(row) <= ix:
                continue
            w = row[iw]
            lw = w.lower()
            if lw not in wanted:
                continue
            if w in wanted[lw] and w not in exact:
                exact[w] = row[ix]
            if lw not in lower:
                lower[lw] = row[ix]
    return exact, lower


def verified_forms(w, pos, ex):
    """返回 (正确形式列表, 其他真实变形列表)；无可靠形式返回 (None, None)"""
    if w != w.lower():                      # 专有名词 / 缩写（American、TV…）不考构词
        return None, None
    if pos == 'noun':
        if w in NOUN_FIX:
            valid = list(NOUN_FIX[w])
        elif w in NOUN_SKIP:
            return None, None
        else:
            valid = list(ex.get('s', []))
            if valid == [w]:                # police / goods / clothes 这类本身即复数或无复数
                return None, None
    elif pos == 'verb':
        if w in VERB_SKIP:
            return None, None
        valid = list(ex.get('p', []))
        for x in VERB_ALT.get(w, []):
            if x not in valid:
                valid.append(x)
        if w in VERB_ALT:                   # 核对表给的标准答案排第一
            valid.sort(key=lambda x: VERB_ALT[w].index(x) if x in VERB_ALT[w] else 99)
    elif pos == 'adj':
        if w in ADJ_SKIP:
            return None, None
        valid = list(ex.get('r', []))
        for x in ADJ_ALT.get(w, []):
            if x not in valid:
                valid.append(x)
        if valid == [w]:                    # best 之类
            return None, None
    else:
        return None, None
    valid = [x for x in valid if FORM_OK.match(x)]
    if not valid:
        return None, None
    slot = SLOT[pos]
    avoid = []
    for k, vs in ex.items():
        if k == slot or k == 'i':           # -ing 形式干扰项生成器永远不会产生，省体积
            continue
        for x in vs:
            if FORM_OK.match(x) and x != w and x not in valid and x not in avoid:
                avoid.append(x)
    return valid, avoid


def enc(w, f):
    return '~' + f[len(w):] if f.startswith(w) else f


def encode_forms(w, valid, avoid):
    s = '/'.join(enc(w, x) for x in valid)
    if avoid:
        s += '|' + '/'.join(enc(w, x) for x in avoid)
    return s


def main():
    if len(sys.argv) < 2 or not os.path.isfile(sys.argv[1]):
        print('用法: python scripts/build-babel-words.py <ecdict.csv>')
        print('  ECDICT: https://github.com/skywind3000/ECDICT （ecdict.csv，MIT）')
        sys.exit(1)
    seen = set()
    tiers = []
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
        print('[%s] tier %d: %d 词' % (lv, li, len(bucket)))

    wanted = {}
    for bucket in tiers:
        for e in bucket:
            wanted.setdefault(e[0].lower(), set()).add(e[0])
    exact, lower = load_exchange(sys.argv[1], wanted)
    total, nforms = 0, {'noun': 0, 'verb': 0, 'adj': 0}
    for bucket in tiers:
        for e in bucket:
            w, pos = e[0], e[3]
            ex = parse_exchange(exact.get(w, lower.get(w.lower(), '')))
            valid, avoid = verified_forms(w, pos, ex)
            if valid:
                e.append(encode_forms(w, valid, avoid))
                nforms[pos] += 1
            total += 1
    out = {'n': total, 'tiers': tiers}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize(OUT)
    print('构词核对: 名词复数 %d / 动词过去式 %d / 形容词比较级 %d' % (nforms['noun'], nforms['verb'], nforms['adj']))
    print('合并完成: %d 词, %.0f KB → %s' % (total, size / 1024, OUT))


if __name__ == '__main__':
    main()
