# Server

This is a small Node.js server for working with [fetcher-extension](../fetcher-extension) and a little management of your history.

A brief layout of the code:

* [`server.js`](./server.js) is the server code
* [`db.js`](./db.js) is a simple wrapper on the database. It has the schema, but no other domain logic.
* [`page-model.js](./page-model.js) is a little higher-level, but most of the code doesn't use it.
* [`viewer.js`](./viewer.js) implements the pages to view the history list and manage it (everything under `http://localhost:11180/viewer/`)
* `*.ejs` are templates, mostly used by viewer.js
* [`static/`](./static/) has a couple static files
* [`responses.js`](./responses.js) has a helper for generating responses.
* [`resync-pages.js`](./resync-pages.js) implements `npm run resync`, which can be used to reconstruct the database from the JSON in `pages/`
* [`for-each.js`](./for-each.js) is a script run by `npm run for-each`. It was an idea for doing post-processing on the pages, but I don't think it's a good idea any more.
