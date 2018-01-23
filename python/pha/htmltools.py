import re
from nltk.stem import PorterStemmer
import lxml

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

def normalize_classes(c):
    if isinstance(c, lxml.etree.ElementBase):
        c = c.get("class")
    if not c:
        return []
    if isinstance(c, str):
        c = c.split()
    return filter(None, [sort_words(stem_words(wordify_class(a_class))) for a_class in c])
