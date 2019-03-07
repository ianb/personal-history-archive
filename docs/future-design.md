# Future Design

PHA has turned into a conglomeration of a bunch of use cases and techniques, and it's become downright confusing.

## Issues

* The name is long
* It's unclear where control happens: what makes things happen?
* There's no clear interface
* Mixed patterns
* Build process is all wonky and weird

## Name

What would be a good name for this? The essential aspects:

1. It collects browsing information
2. It makes that information easy to work with
3. It finds higher-level information about the pages
4. It can drive the browser

Obviously "browsing" shows up a lot. Other phrases:

* Navigation
* Web
* HTML / pages
* Session
* Dataset

Candidate names:

* Browser-dataset
* Personal-web-dataset
* Webnav-dataset
* Webnav-collector
* Webnav-archiver
* Browser-archiver
* barchive
* firefox-dataset
* browser-data
* webnav-data
* browserdump
* navdump
* pagedump
* **browserdump**
* Browser Science (also used in 2013, site is still up but inactive)
* Browser Lab (was used in 2013)
* Navlab
* Browsing Lab

Some dataset concepts ([from](https://medium.com/datadriveninvestor/the-50-best-public-datasets-for-machine-learning-d80e9f030279)):

* A dataset should not be messy, because you do not want to spend a lot of time cleaning data.
* A dataset should not have too many rows or columns, so it is easy to work with.
* The cleaner the data, the better — cleaning a large data set can be very time consuming.
* There should be an interesting question, which in turn can be answered with data.

## Query interface

Right now we have:

1. `Archive`: this represents one set of data, a run, dev-vs-live, test-vs-dev, etc. Represents a database *and* a set of JSON files.
2. `Browser`: a browser *profile*
3. `BrowserSession`: a particular run of a browser. Belongs to a Browser.
4. `Activity`: a browsing activity, typically a navigation. Can include in-page navigations, like changing the hash of a page. Has a relation to [browser.tabs.onUpdated](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/onUpdated), though not a 1:1 mapping (not every onUpdated event turns into an activity). Belongs to a BrowserSession.
5. `ActivityLink`: links found in a page
6. `Page`: a page, with a URL, that belongs to a session (FIXME: doesn't currently map to a session), and has a time in place. It's more like a "page load". Belongs to an activity.

What are we missing?

1. A "job" of some sort, such as a fetching of a list of stuff.
2. Combining found history with pages and activity.
3. The HTTP response that led to a page.
4. Filling in data like Common Crawl or Wikipedia data.
5. Using CSP to speed up activity (but also noting that it happened)
6. Any use of [Containers](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/contextualIdentities). Probably cookieStorageId needs to be added to everything, or maybe just to Browser.
7. Annotations on any of this data. (These may be very ad hoc and hard to implement, but maybe a naive approach would be good enough?)

## Interface

There's a couple ways to start this:

1. Add it explicitly to an existing profile as a Temporary Installation
2. Have it run with `web-ext` and a scratch profile
3. Have it run with `web-ext` and an existing profile
4. Have it run with `web-ext` and a long-lived dev-only profile
5. Have it run via Selenium

It uses multiple Native Connect names for handling some of these cases. I think that's good *for testing*, where we want good isolation between any old code, running code, production code, and the filesystem. Otherwise I think the archive location should be coded into the add-on storage.

# Proposal

1. Make this an installable package. Lead with the Python side. Will include node_modules/etc as well.
2. The package includes an XPI, that you install in your browser (usually, some use cases might involve web-ext)
3. There's a script that you can use on an Archive to trigger activity (i.e., drive the browser)
4. Use an ORM, maybe SQLObject?
5. History will get extracted, but only informationally. You'll have to use the trigger to revisit history in some fashion.
6. We'll need a database view of the live browser connections. This both registers those connections, and is a queue to allow incoming connections.

## User experience:

1. Install the application (probably start with pip install + npm install, or a downloadable installation script)
2. Put the XPI in some known location
3. Install the special files for Native Connect
4. Maybe include something like `blab http` to open a local server that gives instructions and a link to the XPI
5. With the XPI installed, there's a button that controls the add-on
6. You can turn it on and off, with different icons
7. You can enable it just for some containers
8. There are instructions about using browser profiles and `about:profiles`
9. Create a script launcher, `blab browse --Profile` etc?
10. Create a central place to list known archives, in `~/.browserdump/` - just to make it easy to list
11. Archives should have names (user assignable)
12. The browser interface should be allowed to connect to different archives
13. You should be able to "remember" recording decisions. But if you don't, then on restart probably don't reconnect.
14. Offer a quick summary of what's happened in the archive.
15. Give a default archive path of something like `$HOME/browserdump-archive`
16. Connect browserdump script to a running browser with `blab connect`
17. Offer simple commands: like open a list of pages.
18. Something with Jupyter?
