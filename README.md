# personal-history-archive

An experiment in creating a dump of your personal browser history for analysis

## Using

Run `npm install` to install the necessary packages for the server.

Run `npm run server` to start the server. A database `history.sqlite` will be created, and a directory `./pages/` that contains JSON files with the extracted pages.

Install the extension `tracker-extension/` to upload your browser history. You can do this is `about:debugging` in Firefox or **Window > Extensions > Load unpacked extension...**. This will periodically update the server with your history. It uploads your entire history the first time, which typically causes the browser to freeze for a few seconds; later updates won't be noticeable.

Once you have history uploaded, you may want to fetch static versions of that history. Use `./bin/launch-fetcher` to launch a Firefox instance dedicated to that fetching. Probably use `./bin/launch-fetcher --use-profile "Profile Name"` to use a *copy* of an existing profile (after doing that once, the profile copy will be kept for later launches). You'll want the profile to have login information and cookies for your sites.

The page `http://localhost:11180/` will be loaded automatically in the fetcher instance, and let you start fetching pages.

You may want to review `http://localhost:11180/viewer/redirected` to see pages that get redirects. These are often pages that required missing authentication. You can login to the pages, then delete the fetched page so it can be re-fetched.

## for-each

One too for annotating the fetched pages is `npm run for-each`. You can see some examples in `examples/`.

This runs the script for each fetched page, and lets you continue in case of error. The invocation looks like:

    $ npm run for-each -- -j login examples/haslogin.py

Then `examples/haslogin.py` is run for each page, with three environmental variables:

  * `$PAGE_URL`: the URL of the fetched page
  * `$PAGE_META_FILE`: a JSON file that contains metadata about the page (e.g., when it was visited)
  * `$PAGE_JSON_FILE`: the main JSON file that contains the fetched page

The file should emit a JSON object or list of objects, with commands to be run:

  * `{"command": "annotate", "name": "hasLogin", "value": false}`: sets an annotation on the page (these are kept separately from the page JSON)
  * `{"command": "remove-annotation", "name": "hasLogin"}`: deletes something from the annotation
  * `{"command": "set-attr", "name": "title": "value": "new title"}`: changes the page in-place. Good for fix-ups
  * `{"command": "remove-attr", "name": "something"}`: removes something from the page JSON
  * `{"command": "remove-page"}`: removes the page entirely. Good for purging badly fetched pages. Does not remove the history item.

These commands are batched until the job completes successfully, then they are applied together.

The `-j login` option is used for continuity in case of failures.
