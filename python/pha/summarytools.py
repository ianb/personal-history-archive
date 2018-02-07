import re

text_teaser_instance = None

def textteaser_summary(page, try_readable=True):
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
    return re.sub(r'\s+', ' ', sentence.replace("\n", " "))
