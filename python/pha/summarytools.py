"""
Helpers for summarization, using either textteaser or sumy
"""
import re

text_teaser_instance = None


def textteaser_summary(page, *, try_readable=True):
    """Uses TextTeaser (https://github.com/IndigoResearch/textteaser/tree/master/textteaser) to summarize
    the page into a list of sentences
    """
    global text_teaser_instance
    if text_teaser_instance is None:
        from textteaser import TextTeaser
        text_teaser_instance = TextTeaser()
    text = (try_readable and page.readable_text) or page.full_text
    return text_teaser_instance.summarize(page.title, text)


def normalize_sentences(sentences, sep="  "):
    sentences = [normalize_sentence(s) for s in sentences]
    return sep.join(sentences)


def normalize_sentence(sentence):
    return re.sub(r'\s+', ' ', str(sentence).replace("\n", " "))


def sumy_summary(page, sentence_count=5, *, language="english"):
    from sumy.parsers.html import HtmlParser
    from sumy.nlp.tokenizers import Tokenizer
    from sumy.summarizers.lsa import LsaSummarizer as Summarizer
    from sumy.nlp.stemmers import Stemmer
    from sumy.utils import get_stop_words
    parser = HtmlParser.from_string(page.html, page.url, Tokenizer(language))
    stemmer = Stemmer(language)
    summarizer = Summarizer(stemmer)
    summarizer.stop_words = get_stop_words(language)
    return summarizer(parser.document, sentence_count)


_has_letter_re = re.compile(r"[a-zA-Z]")


def is_good_entity(e):
    """
    Is this a plausible entity? For some reason scapy select entities like '-' or '\\n    '
    """
    return _has_letter_re.search(e)


_whitespace_re = re.compile(r"\s\s+", re.S)


def find_entities(page_element):
    """
    Uses SpaCy to find entities in the page element. Returns `[(entity_text, entity_label, element), ...]`
    """
    import xx_ent_wiki_sm
    from .htmltools import iter_block_level_text
    nlp = xx_ent_wiki_sm.load()
    for text, element in iter_block_level_text(page_element):
        text = _whitespace_re.sub(" ", text)
        doc = nlp(text)
        seen = set()
        for entity in doc.ents:
            if entity.text in seen:
                continue
            seen.add(entity.text)
            if not is_good_entity(entity.text):
                continue
            yield entity.text, entity.label_, element
