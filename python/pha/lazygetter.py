"""
Fetch a remote file, if it hasn't been fetched before.

Typically used in Jupyter Notebooks.
"""
import os
import shutil
from urllib.request import urlopen

def lazyget(url, filename):
    if os.path.exists(filename):
        if os.path.getsize(filename):
            print("File", filename, "already exists")
            return
        else:
            print("File", filename, "is empty; overwriting")
    dirname = os.path.dirname(filename)
    if not os.path.exists(dirname):
        print("Creating directory %s/" % dirname)
        os.makedirs(dirname)
    with urlopen(url) as resp:
        try:
            length = int(resp.getheader("Content-Length")) // 1000
            length = "%skb" % length
        except:
            length = "unknown size"
        print("Reading %s into %s..." % (length, filename), end="")
        with open(filename, "wb") as fp:
            shutil.copyfileobj(resp, fp)
        print(" done.")
