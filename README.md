# personal-history-archive

An experiment in creating a dump of your personal browser history for analysis

## Using

Run `npm install` to install the necessary packages for the server.

Run `npm run server` to start the server. A database `history.sqlite` will be created, and a directory `./pages/` that contains JSON files with the extracted pages.

Run `./bin/run-addon` to test the extension.

Run `./bin/run-addon --profile "Profile Name"` to run with an existing profile. A copy of the profile will be made, so changes won't be reflected in the main profile. (Is there a default profile name?)

There will be a dumb looking little button with a down arrow. Click on it, and a page to the server will be opened. You can upload history from the browser to the server via this page. Then you can click "Fetch some pages" to start fetching pages. Tabs will open, and pages will be saved as JSON to `pages/`.