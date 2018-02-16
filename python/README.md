# Python Library

To install:

```sh
$ pip install -e python/
$ pip install -r python/requirements.txt
```

## Usage

You'll probably want to get an instance of Archive:

```
from pha import Archive
archive = Archive.default_location()
```

Or `Archive(path)`, but since we don't have configurable places to put `history.sqlite` and `pages/`, the default location always works.

The key objects are all implemented in [`__init__.py`](./__init__.py): `Archive`, `History`, `Visit`, and `Page`.

* `History` is one history URL item in one browser. If you connect multiple browsers and merge their history, there could be more than one item for a given URL (but the code doesn't account for that well). These are based on the browser [`HistoryItem`](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/history/HistoryItem). A history item could represent multiple visits.
* `Visit` is one visit. Each visit is attached as `history.visits`, which is a dictionary of visit IDs to `Visit` objects. The object is based on [`VisitItem`](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/history/VisitItem).
* `Page` is a fetched page. Pages are based on URLs, but are generally accessed via history, as `history.page`. A Page is both located in the database, and as a JSON file in `pages/` (the library tries to be resilient when the two sources don't match).

Note that URLs *do* include the fragment/hash, so `http://example.com/` and `http://example.com/#header` are treated as different.

Typically you'll call:

* `archive.get_history(url)`: get one history item by URL
* `archive.histories()`: get a list of ALL histories
* `archive.histories_with_page()`: get a list of all histories that also have a fetched page
* `archive.sample_histories_with_page(number, unique_url=True, unique_domain=False)`: fetch a random sample of pages. Because there tend to be *lots* of pages from some domains (e.g., gmail.com) this tries to get a sampling of "unique" pages. If you ask for `unique_url` then it will look at the entire URL, normalize segments of the URL, and treat number and non-number segments differently. So it would include a homepage and an article page, but probably not multiple article pages from the same site. `unique_domain` gets only one page per domain.

### Pages

You might spend most of your time with the Page objects, at least if you are interested in content parsing and interpretation.

A few highlights:

* `page.html`: returns a viewable HTML representation of the page.
* `page.lxml`: returns the page, having been parsed with [lxml.html](http://lxml.de/lxmlhtml.html).
* `page.full_text`: tries to get the text of page.
* `page.readable_text`: if the page was parseable with [Readability](https://github.com/mozilla/readability) then this will contain the text extracted as part of the article view (excluding navigation, etc).
* `page.readable_html`: an HTML view of the readable portion of the page.
* `page.display_page()`: run in a Jupyter Notebook, this will show the page in an iframe (see also `notebooktools`).

## Helpers

There's several helper modules:

* [`glovehelper`](./pha/glovehelper.py): helps with calling [GloVe](https://nlp.stanford.edu/projects/glove/). You must install and build the code from that site. The helper lets you pass in a sequence of strings and get vectors back. See [the analyze_classnames notebook](./analyze_classnames.ipynb) for an example.
* [`htmltools`](./pha/htmltools.py): this includes various little functions to help you work with the HTML. Look at [analyze_classnames](./analyze_classnames.ipynb) for examples.
* [`lazygetter`](./pha/lazygetter.py): a helper to fetch remote data for Jupyter Notebooks.
* [`notebooktools`](./pha/notebooktools.py): other tools for working in Jupyter Notebooks. It's used to show inline HTML.
* [`search`](./pha/search.py): creates a search index of your pages. You need the SQLite [FTS5](https://sqlite.org/fts5.html) extension installed. See [the search_example notebook](./search_example.ipynb) for more.
* [`summarytools`](./pha/summarytools.py): some small helpers for doing document summarization. See [the document_summary notebook](./document_summary.ipynb) for more.

## Notebooks

I'm collecting notebooks in this directory as examples, and hopefully they'll grow into simultaneously documentation and interesting data interpretation. It would be cool to have more!
