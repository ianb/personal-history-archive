"""Simple wrapper for GloVe: https://nlp.stanford.edu/projects/glove/

Runs the scripts and produces vector output"""

import tempfile
import os
import subprocess

default_glove_path = None


def set_glove_path(value):
    """
    Sets the path where we can find GloVe installed, for all future calls to vectorize.
    """
    global default_glove_path
    default_glove_path = value


def vectorize(
        corpus,
        vector_size=50,
        *,
        glove_path=None,
        debug_print=False,
        vocab_min_count=5,
        window_size=15):
    """
    Takes a corpus (list of words, or one big string with spaces separating words) and creates a mapping from words to vectors.

    This calls the scripts in GloVe and processes the results, it doesn't implement any vectorization itself.
    """
    glove_path = glove_path or default_glove_path
    if not os.path.exists(glove_path):
        raise OSError("No such directory: %s" % glove_path)
    if os.path.exists(os.path.join(glove_path, "build")):
        glove_path = os.path.join(glove_path, "build")
    if not isinstance(corpus, (str, bytes)):
        corpus = " ".join(corpus)
    if isinstance(corpus, str):
        corpus = corpus.encode("UTF-8")
    with tempfile.TemporaryDirectory() as dirname:
        if debug_print:
            print("Temporary directory:", dirname)
        vocab_file = os.path.join(dirname, "vocab.txt")
        with open(vocab_file, "wb") as fp:
            proc = _exec([
                os.path.join(glove_path, "vocab_count"),
                "-min-count", str(vocab_min_count),
                "-verbose", "2"],
                input=corpus,
                debug_print=debug_print)
            fp.write(proc.stdout)
        proc = _exec([
            os.path.join(glove_path, "cooccur"),
            "-memory", "4.0",
            "-vocab-file", vocab_file,
            "-window-size", str(window_size)],
            input=corpus,
            debug_print=debug_print)
        cooccur_data = proc.stdout
        cooccur_file = os.path.join(dirname, "coocur.txt")
        with open(cooccur_file, "wb") as fp:
            proc = _exec([
                os.path.join(glove_path, "shuffle"),
                "-memory", "4.0"],
                input=cooccur_data,
                debug_print=debug_print)
            fp.write(proc.stdout)
        save_file = os.path.join(dirname, "vectors.txt")
        proc = _exec([
            os.path.join(glove_path, "glove"),
            "-save-file", os.path.splitext(save_file)[0],
            "-threads", "8",
            "-input-file", cooccur_file,
            "-x-max", "10",
            "-iter", "15",
            "-vector-size", str(vector_size),
            "-binary", "2",
            "-vocab-file", vocab_file],
            debug_print=debug_print)
        result = {}
        with open(save_file, "r", encoding="UTF-8") as fp:
            for line in fp.readlines():
                line = line.strip().split()
                name = line[0]
                result[name] = [float(n) for n in line[1:]]
        return result


def _exec(command, input=None, debug_print=False):
    if isinstance(input, str):
        input = input.encode("UTF-8")
    proc = subprocess.run(command, check=True, input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if debug_print:
        print(" ".join(command))
        if input:
            print("Input:  %s bytes" % len(input))
        print("Output: %s bytes" % len(proc.stdout))
        if proc.stderr:
            print(proc.stderr.decode("UTF-8").rstrip())
            print("---------------------------------------------")
    return proc
