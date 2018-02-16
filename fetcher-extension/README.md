# Fetcher Extension

This implements the extension that fetches and serializes pages.

This is only tested in Firefox. The usual way to start it is through `./bin/launch-fetcher`. You shouldn't run it in a normal profile, as it does lots of work that will muck with the very history you are trying to interpret!

* [`sitescript.js`](./sitescript.js) implements most of the actual functionality on `http://localhost:11180` for fetching pages. It contacts the server, gets lists of pages that need to be fetched, saves the result back to the server, and generally manages the queue.
* [`background.js`](./background.js) is the persistent hidden page in the extension. It actually opens tabs and manages the serialization, though sitescript.js manages the work queue and background.js just does what it asks.
* [`make-static-html.js`](./make-static-html.js) does most of the DOM serialization.
* [`extractor-worker.js`](./extractor-worker.js) does a little more page serialization. The two are separate for no good reason.
  * `Readability.js` is just a library copied from [mozilla/readability](https://github.com/mozilla/readability), and is used in serialization.
* [`escape-catcher.js`](./escape-catcher.js) is a little script injected into tabs so if you hit Escape on any page it should eventually abort the fetching.
* `browser-polyfill.js` is used for Chrome compatibility, even though this part of the project isn't intended to be portable. Go figure.

You might note the tabs flop around a lot when fetching. This is based on a theory that background tabs don't "complete" well, so a tab has to be in the foreground to fully load and have all its scripts process. This is empirically true, but probably deserves more investigation.
