import re
import random
from nltk.stem import PorterStemmer
import lxml
from urllib.parse import urlparse, parse_qsl

mixed_regex = re.compile(r'([a-z])([A-Z])')
non_char_regex = re.compile(r'[^a-z\-]', re.I)
stemmer = PorterStemmer()

def wordify_class(c):
    """Changes a class into a set of words"""
    c = mixed_regex.sub(r"\1-\2", c)
    c = c.replace("_", "-")
    c = non_char_regex.sub("", c)
    return "-".join(c.lower().split("-"))

def stem_words(c):
    return "-".join([stemmer.stem(w) for w in c.split("-")])

def sort_words(c):
    return "-".join(sorted(c.split("-")))

def normalize_classes(c, shuffle=False):
    if isinstance(c, lxml.etree.ElementBase):
        c = c.get("class")
    if not c:
        return []
    if isinstance(c, str):
        c = c.split()
    result = filter(None, [sort_words(stem_words(wordify_class(a_class))) for a_class in c])
    if shuffle and len(result) > 1:
        random.shuffle(result)
    return result

www_regex = re.compile(r'^www[0-9]*\.')
number_regex = re.compile(r'^[0-9]+$')
hex_only = re.compile(r'^[a-f0-9]+$', re.I)

def _url_ignore_word(w):
    return w.strip() and number_regex.search(w) or (len(w) > 10 and hex_only.search(w))

def url_words(url):
    result = []
    parsed = urlparse(url)
    hostname = parsed.hostname
    hostname = www_regex.sub("", hostname)
    hostname_parts = hostname.split(".")
    if len(hostname_parts) > 1:
        # Strip the TLD
        hostname_parts = hostname_parts[:-1]
    result.extend(hostname_parts)
    path = parsed.path.split("/")
    path = [p for p in path if not _url_ignore_word(p)]
    result.extend(path)
    if not _url_ignore_word(parsed.fragment or ""):
        result.append(parsed.fragment)
    query = parse_qsl(parsed.query)
    for name, value in query:
        if not _url_ignore_word(value):
            result.extend([name, value])
    return result
