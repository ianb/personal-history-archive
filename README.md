# personal-history-archive

Creating a dump of your personal browser history for analysis. This is a tool for people who want to research browsing behavior and content, starting with the only dataset you'll really be able to create: data about yourself.

This consists of several parts:

* A [browser extension](./tracker-extension#readme) (for Firefox and Chrome) to send your history to a local server
* A [server](./server#readme) to store that history in a local SQLite database and JSON files
* A [second extension](./fetcher-extension#readme) to fetch and serialize full copies of those pages
* A [python library](./python#readme) to use and analyze the history

## Installation

You must check out this repository to use the package.

Run `npm install` to install the necessary packages for the server.

Run `npm run server` to start the local server. A database `history.sqlite` will be created, and a directory `./pages/` that contains JSON files with the extracted pages. The server runs in the foreground, and you have to start it manually and leave your terminal open.

For the Python library, create a virtualenv and use `pip install -e python/` and probably `pip install -r python/requirements.txt` for optional dependencies (many of which are used in Jupyter Notebooks contained in `python/`).

### Installing history tracker

Install the extension `tracker-extension/` to upload your browser history. You can do this is `about:debugging` in Firefox or **Window > Extensions > Load unpacked extension...**. This extension will periodically update the server with your history. It uploads your entire history the first time, which typically causes the browser to freeze for a few seconds; later updates won't be noticeable. On Firefox it must be reinstalled everytime you start the browser.

You'll see a button in your browser toolbar: ![button](./tracker-extension/icon.png) – you can use this button to see the status of the extension, and to force uploading.


## Fetching history

![image](./docs/screencast-fetcher.gif)

Once you have history uploaded, you may want to fetch static versions of that history. Use `./bin/launch-fetcher` to launch a Firefox instance dedicated to that fetching. Probably use `./bin/launch-fetcher --use-profile "Profile Name"` to use a *copy* of an existing profile (after doing that once, the profile copy will be kept for later launches). You'll want to use a profile that is logged into your services, so that you can get personalized versions of your pages.

The page `http://localhost:11180/` will be loaded automatically in the fetcher browser instance, and that lets you start fetching pages.

You may want to review `http://localhost:11180/viewer/redirected` to see pages that get redirects. These are often pages that required missing authentication. You can login to the pages, then delete the fetched page so it can be re-fetched.

### Viewing and managing your history

The server runs on `http://localhost:11180`. You can:

* [View your history](http://localhost:11180/viewer/) – note this has no pagination, and takes very long to load
* [View pages that have redirected](http://localhost:11180/viewer/redirected) – this is often a sign of a page that requires authentication. In your fetching profile you can load this page, re-authenticate to necessary pages, and clear the fetched versions of those pages so they can be re-fetched later.
* View a specific page at `http://localhost:11180/viewer/view?url=...`

## Python library

There's a Python library in [the `python/` subdirectory](https://github.com/ianb/personal-history-archive/tree/master/python). You can install it like:

```sh
$ cd python
$ pip install -e .
# Optional packages:
$ pip install -r requirements.txt
```

It is a Python 3 library, and you should probably use [Virtualenv](https://virtualenv.pypa.io/en/stable/) before installing it. There's some [information here](https://docs.python.org/3/library/venv.html).

This adds a package called `pha`. There is some information [in the subdirectory](python/), and the notebooks (`*.ipynb`) show many examples.

## Collaborating

If you have a question, probably the best thing is to [open a ticket](https://github.com/ianb/personal-history-archive/issues/new). If you are interested in implementing something, it would also be great to open a ticket so we can discuss.

If you'd like to chat, I've created a channel `#pha` on irc.mozilla.org. I (`ianbicking`) am usually only online during business hours, Central Time/UTC-6.
