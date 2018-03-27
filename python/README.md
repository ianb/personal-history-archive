# Python Library

To install:

```sh
$ pip install -e python/
# Optional requirements:
$ pip install -r python/requirements.txt
```

## Usage

You'll probably want to get an instance of Archive:

```
from pha import Archive
archive = Archive.default_location()
```

Or `Archive(path)`, but normal installation always puts the data into the `data/` directory.

The key objects are all implemented in [`__init__.py`](./pha/__init__.py): `Archive`, `Activity`, and `Page`.

* `Activity` is one visit in the browser. This includes any changes to the location hash. This represents both old activity fetched from browser history (from [`HistoryItem`](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/history/HistoryItem) and [`VisitItem`](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/history/VisitItem)), as well as new activity (with more complete information available).
* `Page` is a fetched page. By default only one version a page will be created for a given URL (though the code/database allows for multiple pages fetched over time). A page is both stored in the database, as well as in a JSON file in `data/pages/` (the library tries to be resilient when the two sources don't match).

Note that URLs *do* include the fragment/hash, so `http://example.com/` and `http://example.com/#header` are treated as different.

Typically you'll call:

* `archive.get_activity(url)`: get a list of activities for the URL
* `archive.activity()`: get a list of ALL activities
* `archive.activity_with_page()`: get a list of all activity that also have a fetched page
* `archive.sample_activity_with_page(number, unique_url=True, unique_domain=False)`: fetch a random sample of pages. Because there tend to be *lots* of pages from some domains (e.g., gmail.com) this tries to get a sampling of "unique" pages. If you ask for `unique_url` then it will look at the entire URL, normalize segments of the URL, and treat number and non-number segments differently. So it would include a homepage and an article page, but probably not multiple article pages from the same site. `unique_domain` gets only one page per domain.
* `archive.get_activity_by_source(activity.id)`: get every activity that came from the given activity (typically through navigation).

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
* [`notebooktools`](./pha/notebooktools.py): other tools for working in Jupyter Notebooks. It's used to show inline HTML.
* [`search`](./pha/search.py): creates a search index of your pages. You need the SQLite [FTS5](https://sqlite.org/fts5.html) extension installed. See [the search_example notebook](./search_example.ipynb) for more.
* [`summarytools`](./pha/summarytools.py): some small helpers for doing document summarization. See [the document_summary notebook](./document_summary.ipynb) for more.

## Notebooks

I'm collecting notebooks in this directory as examples, and hopefully they'll grow into simultaneously documentation and interesting data interpretation. It would be cool to have more!
