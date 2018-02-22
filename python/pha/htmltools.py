"""
Some helpers for use with HTML.

Mostly normalize_classes()
"""
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
    c = c.strip("-")
    return "-".join(c.lower().split("-"))

def stem_words(c):
    return "-".join([stemmer.stem(w) for w in c.split("-")])

def sort_words(c):
    return "-".join(sorted(c.split("-")))

def normalize_classes(c, shuffle=False):
    """Takes an HTML class attribute (or element) and returns a normalized form of the classes:

    * Each class name is split into "words", either based on dashes or mixed case
    * Numbers are removed
    * Each word is stemmed
    * The words are sorted
    * They are combined back using dashes.

    If `shuffle` is true, then (if there is more than one class), the classes will be randomly shuffled.
    """
    if isinstance(c, lxml.etree.ElementBase):
        c = c.get("class")
    if not c:
        return []
    if isinstance(c, str):
        c = c.split()
    result = list(filter(None, [sort_words(stem_words(wordify_class(a_class))) for a_class in c]))
    if shuffle and len(result) > 1:
        random.shuffle(result)
    return result

www_regex = re.compile(r'^www[0-9]*\.')
number_regex = re.compile(r'^[0-9]+$')
hex_only = re.compile(r'^[a-f0-9]+$', re.I)

def _url_ignore_word(w):
    return w.strip() and number_regex.search(w) or (len(w) > 10 and hex_only.search(w))

def url_words(url):
    """
    Tries to reduce a URL to a set of "words" that define the URL. This leaves out numbers,
    things that look like hex tokens, and the TLD.

    Typically used for searchable full text indexing of the URL.
    """
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

DEFAULT_DISPLAY = {
    "a": "inline",
    "applet": "inline",
    "article": "block",
    "area": "none",
    "audio": "none",
    "base": "none",
    "basefont": "none",
    "bgsound": "inline",
    "blockquote": "block",
    "body": "flex",
    "br": "inline",
    "button": "inline-block",
    "canvas": "inline",
    "col": "table-column",
    "colgroup": "table-column-group",
    "del": "inline",
    "details": "block",
    "dir": "block",
    "div": "block",
    "dl": "block",
    "embed": "inline",
    "fieldset": "block",
    "footer": "block",
    "font": "inline",
    "form": "block",
    "frame": "inline",
    "frameset": "block",
    "h1": "block",
    "h2": "block",
    "h3": "block",
    "h4": "block",
    "h5": "block",
    "h6": "block",
    "head": "none",
    "hr": "block",
    "iframe": "inline",
    "img": "inline",
    "input": "inline",
    "ins": "inline",
    "isindex": "inline",
    "label": "inline",
    "li": "list-item",
    "link": "none",
    "nav": "block",
    "map": "inline",
    "marquee": "inline-block",
    "menu": "block",
    "meta": "none",
    "meter": "inline-block",
    "object": "inline",
    "ol": "block",
    "optgroup": "block",
    "option": "block",
    "output": "inline",
    "p": "block",
    "param": "none",
    "pre": "block",
    "progress": "inline-block",
    "q": "inline",
    "script": "none",
    "select": "inline-block",
    "source": "inline",
    "span": "inline",
    "style": "none",
    "table": "table",
    "tbody": "table-row-group",
    "td": "table-cell",
    "textarea": "inline",
    "tfoot": "table-footer-group",
    "title": "none",
    "th": "table-cell",
    "thead": "table-header-group",
    "time": "inline",
    "tr": "table-row",
    "track": "inline",
    "ul": "block",
    "video": "inline"
}

blockish_display_values = ["block", "table-cell", "table", "flex", "list-item"]

def _make_blockish_selector():
    blockish_elements = set()
    for tagname, display_value in DEFAULT_DISPLAY.items():
        if display_value in blockish_display_values:
            blockish_elements.add(tagname)
    blockish_selectors = ', '.join(
        '%s:not([data-display])' % tagname for tagname in sorted(blockish_elements))
    extra_selectors = ', '.join(
        "*[data-display='%s']" % display for display in sorted(blockish_display_values))
    return "%s, %s" % (blockish_selectors, extra_selectors)

blockish_selector = _make_blockish_selector()

def iter_block_level_elements(el):
    return el.cssselect(blockish_selector)

def iter_block_level_text(el):
    """
    Goes through the document, returning `[(text, element), ...]` for block-level elements.
    When block-level elements are nested, the text of the outer element only includes text that
    isn't in an inner element. Elements that have no text or only whitespace text are omitted.
    """
    for child in el.iter():
        if not is_blockish(child):
            continue
        text_chunks = get_unblockish_text(child)
        text_chunks = [s.strip() for s in text_chunks if s and s.strip()]
        if text_chunks:
            yield (' '.join(text_chunks), child)

def is_blockish(el):
    display = el.get("data-display") or DEFAULT_DISPLAY.get(el.tag, "block")
    return display in blockish_display_values

def get_unblockish_text(el):
    chunks = [el.text]
    for child in el:
        if not is_blockish(child):
            chunks.extend(get_unblockish_text(child))
        chunks.append(child.tail)
    return chunks

def element_to_css(el):
    """
    Create a CSS selector that will select the given element
    """
    singleton_elements = ["body", "head"]
    parts = []
    context = el
    while True:
        if context.tag in singleton_elements:
            parts.insert(0, context.tag)
            break
        if context.get("id"):
            parts.insert(0, "#" + context.get("id"))
            break
        parent = context.getparent()
        position = parent.index(context)
        parts.insert(0, "*:nth-child(%s)" % (position + 1))
        context = parent
    return " > ".join(parts)


