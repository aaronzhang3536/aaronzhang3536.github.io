"""Explicit storage codecs; no authentication, AI settings, location or birth data."""
import json
import math
import re
from commerce.services import BusinessError

LANG = r"(?:en|ja|ko|fr|de|es|it|ru)"
SCORES = set("snake tetris breakout invaders asteroids flappy dino bug typer tex2048 nback simon overfit frustum rhythm mines slide15 maze memory grad reaction tuner".split())


def require(ok):
    if not ok:
        raise BusinessError("数据字段、类型或大小无效。")


def obj(x, limit=5000):
    require(type(x) is dict and len(x) <= limit)
    require(all(type(k) is str and 0 < len(k) <= 300 and k not in ("__proto__", "constructor", "prototype") for k in x))
    return x


def number(x, low=0, high=1e15):
    require(type(x) in (int, float) and math.isfinite(x) and low <= x <= high)


def string(x, maximum=2000):
    require(type(x) is str and len(x) <= maximum)


def count_map(x):
    for k, v in obj(x).items():
        require(re.fullmatch(r"\d{4}-\d{2}-\d{2}", k) is not None)
        number(v, 0, 1e9)


def validate(key, raw):
    require(type(key) is str and len(key) <= 100)
    is_lang = re.fullmatch(rf"yzzn-({LANG})-(words|stats|daily|dojo|game)", key)
    is_score = key in ("yzzn-fish", "yzzn-arc-coins", "yzzn-arcade-hi", "yzzn-uke-ear") or (
        key.startswith("yzzn-arc-") and (key[9:] in SCORES or re.fullmatch(r"rhythm-(easy|hard|hell)|jig([2-9]|1[0-9]|20)", key[9:])))
    special = {"wof:bookmarks", "wof:browse-mode", "wof:reading-size", "yzzn-uke-rhythm", "yzzn-uke-plan",
               "yzzn-xlr-history", "yzzn-gy-history", "babel-manual", "yzzn-theme", "yzzn-bg", "yzzn-wx",
               "yzzn-snd", "yzzn-music", "yzzn-arc-rhythm-diff", "yzzn-sync-meta"}
    require(is_lang or is_score or key in special)
    if raw is None:
        return
    require(type(raw) is str and len(raw.encode()) <= 750000)
    if key in ("yzzn-theme", "yzzn-bg", "yzzn-wx", "yzzn-snd"):
        options = {"yzzn-theme": {"dark", "light", "wire"}, "yzzn-wx": set("auto clear rain wind snow sand storm cloudy fog".split()), "yzzn-snd": {"0", "1"}}
        require(raw in options[key] if key in options else raw == "off" or (raw.isdigit() and 1 <= int(raw) <= 86400))
        return
    try:
        value = json.loads(raw, parse_constant=lambda _: require(False))
    except (ValueError, TypeError):
        raise BusinessError("数据不是有效 JSON。")
    if is_score or key == "yzzn-arc-rhythm-diff":
        number(value, 0, 3 if key.endswith("-diff") else 1e15)
    elif is_lang:
        lang, kind = is_lang.groups()
        require(kind != "stats" or lang == "en")
        require(kind != "dojo" or lang != "en")
        if kind == "words":
            require(type(value) is list and len(value) <= 10000)
            seen = set()
            for word in value:
                obj(word, 15)
                allowed = {"w", "def", "t", "mt", "ph", "lv", "srs"} if lang == "en" else {"w", "r", "rom", "def", "due", "iv", "ef", "rep", "mt", "f"}
                require(set(word) <= allowed and "w" in word)
                string(word["w"], 300)
                identity = word["w"].lower() if lang == "en" else word["w"]
                require(identity and identity not in seen)
                seen.add(identity)
                for k, v in word.items():
                    if k in {"w", "def", "ph", "r", "rom", "f"}:
                        string(v)
                    elif k == "lv":
                        require(type(v) in (str, int))
                    elif k == "srs":
                        require(set(obj(v)) <= {"ef", "n", "i", "d"})
                        for n in v.values():
                            number(n)
                    else:
                        number(v)
        elif kind in ("stats", "daily"):
            count_map(value)
        elif kind == "dojo":
            for pair in obj(value).values():
                require(type(pair) is list and len(pair) == 2)
                for n in pair:
                    number(n, 0, 1e9)
        else:
            games = obj(value).values() if lang == "en" else [value]
            for game in games:
                require(set(obj(game)) <= {"stars", "exempt", "placed", "arenaBest"})
                for k, v in game.items():
                    if k == "stars":
                        for n in obj(v).values():
                            number(n, 0, 10)
                    elif k == "exempt":
                        require(all(type(n) is bool for n in obj(v).values()))
                    elif k == "placed":
                        require(type(v) is bool)
                    else:
                        number(v)
    elif key == "wof:bookmarks":
        require(type(value) is list and len(value) <= 5000)
        for item in value:
            string(item, 300)
    elif key == "wof:browse-mode":
        require(value in ("gallery", "list"))
    elif key == "wof:reading-size":
        require(type(value) is int and value in (16, 18, 20))
    elif key == "yzzn-uke-rhythm":
        for k, v in obj(value).items():
            require(re.fullmatch(r"\d+\|[\w-]+\|\d+", k) is not None)
            require(set(obj(v)) == {"score", "grade", "acc"})
            number(v["score"])
            number(v["acc"], 0, 100)
            string(v["grade"], 20)
    elif key == "yzzn-uke-plan":
        require(all(re.fullmatch(r"\d+-\d+", k) and type(v) is bool for k, v in obj(value).items()))
    elif key.endswith("-history"):
        require(type(value) is list and len(value) <= 6)
        for item in value:
            require(set(obj(item)) == ({"n", "p", "s", "t"} if key == "yzzn-xlr-history" else {"i", "s", "t"}))
            string(item["s"], 300)
            number(item["t"])
            if "i" in item:
                number(item["i"], 0, 32)
            else:
                for k in ("n", "p"):
                    require(type(item[k]) is list and len(item[k]) <= 20)
                    for n in item[k]:
                        number(n)
    elif key == "babel-manual":
        for n in obj(value, 10000).values():
            number(n, 0, 3)
    elif key == "yzzn-music":
        require(set(obj(value)) == {"ch", "vol"} and value["ch"] in ("lofi", "ambient", "chip"))
        number(value["vol"], 0, 1)
    elif key == "yzzn-sync-meta":
        require(set(obj(value)) <= {"del", "wipe"})
        for k, stamps in obj(value.get("del", {})).items():
            require(re.fullmatch(rf"yzzn-{LANG}-words", k) is not None)
            for n in obj(stamps, 3000).values():
                number(n)
        for k, n in obj(value.get("wipe", {})).items():
            require(re.fullmatch(rf"yzzn-{LANG}-(words|stats|daily|dojo|game)", k) is not None)
            number(n)


def validate_values(values):
    obj(values, 120)
    require(len(json.dumps(values).encode()) <= 2 * 1024 * 1024)
    for key, value in values.items():
        validate(key, value)
